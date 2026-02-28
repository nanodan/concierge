/**
 * File browser, download, upload routes
 */
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const readline = require('readline');

const { UPLOAD_DIR } = require('../data');

// Parquet support (lazy loaded to avoid startup cost if not used)
let parquet = null;
async function getParquet() {
  if (!parquet) {
    parquet = require('parquetjs-lite');
  }
  return parquet;
}

// Data file extensions that get special preview handling
const DATA_EXTS = new Set(['csv', 'tsv']);
const PARQUET_EXT = 'parquet';
const NOTEBOOK_EXT = 'ipynb';
const LARGE_GEO_PREVIEW_EXTS = new Set(['geojson', 'topojson', 'jsonl', 'ndjson']);

// Default row/cell limits for data previews
const DEFAULT_DATA_ROWS = 25;
const MAX_DATA_ROWS = 1000;
const DEFAULT_NOTEBOOK_CELLS = 50;
const MAX_NOTEBOOK_CELLS = 200;
const {
  withConversation,
  sanitizeFilename,
  handleFileUpload,
  isPathWithinCwd,
  listDirectory,
  isGitRepo,
  runGit,
  sendFileDownload,
} = require('./helpers');

// Extension to language mapping for syntax highlighting
const EXT_TO_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  cs: 'csharp', swift: 'swift', kt: 'kotlin',
  php: 'php', pl: 'perl', sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql', html: 'html', htm: 'html', xml: 'xml',
  css: 'css', scss: 'scss', less: 'less', sass: 'scss',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  geojson: 'json', topojson: 'json', jsonl: 'json', ndjson: 'json',
  md: 'markdown', markdown: 'markdown', txt: 'plaintext',
  dockerfile: 'dockerfile', makefile: 'makefile',
  gitignore: 'plaintext', env: 'plaintext',
};

// Binary file extensions that can't be previewed
const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'zip', 'tar', 'gz', 'rar', '7z',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv',
  'exe', 'dll', 'so', 'dylib', 'bin',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
]);

const MAX_FILE_SIZE = 500 * 1024; // 500KB
const MAX_GEO_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_GEO_RAW_FILE_SIZE = MAX_FILE_SIZE; // Keep raw text preview conservative on large geo files.
const BROWSE_SEARCH_DEFAULT_LIMIT = 50;
const BROWSE_SEARCH_MAX_LIMIT = 200;
const BROWSE_SEARCH_DEFAULT_DEPTH = 4;
const BROWSE_SEARCH_MAX_DEPTH = 8;
const BROWSE_SEARCH_MAX_SCANNED_DIRS = 5000;
const BROWSE_SEARCH_SKIP_NAMES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.idea',
  '.vscode',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.cache',
]);

function getPreviewSizeLimitForExtension(ext) {
  return LARGE_GEO_PREVIEW_EXTS.has(ext) ? MAX_GEO_FILE_SIZE : MAX_FILE_SIZE;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function resolveBrowsePathInput(rawPath) {
  const value = String(rawPath || '').trim();
  if (!value) return process.env.HOME || '/';
  if (value === '~') return process.env.HOME || '/';
  if (value.startsWith('~/') && process.env.HOME) {
    return path.resolve(process.env.HOME, value.slice(2));
  }
  return path.resolve(value);
}

function buildDirectorySearchScore(name, relPath, queryLower, tokens) {
  const safeRel = String(relPath || '').replace(/\\/g, '/');
  const nameLower = String(name || '').toLowerCase();
  const relLower = safeRel.toLowerCase();

  if (!relLower) return null;
  if (tokens.length > 0 && !tokens.every((token) => relLower.includes(token))) return null;

  let score = 0;
  if (nameLower === queryLower) score += 120;
  if (nameLower.startsWith(queryLower)) score += 85;
  if (relLower.startsWith(queryLower)) score += 60;
  if (nameLower.includes(queryLower)) score += 40;
  if (relLower.includes(queryLower)) score += 25;

  let ordered = true;
  let cursor = 0;
  for (const token of tokens) {
    const next = relLower.indexOf(token, cursor);
    if (next === -1) {
      ordered = false;
      break;
    }
    cursor = next + token.length;
  }
  if (ordered) score += 12;

  score -= safeRel.length / 200;
  return score;
}

async function searchDirectoriesRecursive(basePath, query, { limit, depth }) {
  const root = path.resolve(basePath);
  const queryLower = String(query || '').trim().toLowerCase();
  const tokens = queryLower.split(/\s+/).filter(Boolean);
  const queue = [{ absPath: root, relPath: '', depth: 0 }];
  const visited = new Set([root]);
  const results = [];
  let queueIndex = 0;
  let scannedDirs = 0;
  let truncated = false;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex++];
    scannedDirs++;
    if (scannedDirs > BROWSE_SEARCH_MAX_SCANNED_DIRS) {
      truncated = true;
      break;
    }

    let entries;
    try {
      entries = await fsp.readdir(current.absPath, { withFileTypes: true });
    } catch (err) {
      if (err?.code === 'EPERM' || err?.code === 'EACCES') {
        continue;
      }
      throw err;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (BROWSE_SEARCH_SKIP_NAMES.has(entry.name)) continue;

      const childAbsPath = path.join(current.absPath, entry.name);
      const childRelPath = current.relPath ? `${current.relPath}/${entry.name}` : entry.name;
      const normalizedRelPath = childRelPath.replace(/\\/g, '/');
      const score = buildDirectorySearchScore(entry.name, normalizedRelPath, queryLower, tokens);
      if (score !== null) {
        results.push({
          path: childAbsPath,
          relPath: normalizedRelPath,
          name: entry.name,
          score,
        });
      }

      if (current.depth < depth && !visited.has(childAbsPath)) {
        visited.add(childAbsPath);
        queue.push({
          absPath: childAbsPath,
          relPath: normalizedRelPath,
          depth: current.depth + 1,
        });
      }

      if (results.length >= limit) {
        truncated = true;
        break;
      }
    }

    if (results.length >= limit) break;
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.relPath.localeCompare(b.relPath, undefined, { sensitivity: 'base' });
  });

  return {
    results: results.slice(0, limit).map(({ path: itemPath, relPath, name }) => ({
      path: itemPath,
      relPath,
      name,
    })),
    truncated,
  };
}

/**
 * Parse CSV/TSV file with row limit
 * Returns { columns, rows, totalRows, truncated }
 */
async function parseDelimitedFile(filePath, delimiter, maxRows) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let columns = null;
    let lineCount = 0;

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      lineCount++;
      // Skip empty lines
      if (!line.trim()) return;

      const values = parseDelimitedLine(line, delimiter);

      if (!columns) {
        columns = values;
      } else if (rows.length < maxRows) {
        rows.push(values);
      }
    });

    rl.on('close', () => {
      const totalRows = lineCount - 1; // Subtract header
      resolve({
        columns: columns || [],
        rows,
        totalRows: Math.max(0, totalRows),
        truncated: totalRows > maxRows
      });
    });

    rl.on('error', reject);
  });
}

/**
 * Parse a single delimited line, handling quoted values
 */
function parseDelimitedLine(line, delimiter) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  values.push(current);
  return values;
}

/**
 * Detect delimiter (comma or tab) from first line
 */
function detectDelimiter(firstLine) {
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return tabCount > commaCount ? '\t' : ',';
}

/**
 * Parse Jupyter notebook file
 * Returns { cells, metadata }
 */
async function parseNotebook(filePath, maxCells) {
  const content = await fsp.readFile(filePath, 'utf-8');
  const notebook = JSON.parse(content);

  const cells = [];
  const nbCells = notebook.cells || [];

  for (let i = 0; i < Math.min(nbCells.length, maxCells); i++) {
    const cell = nbCells[i];
    const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');

    const parsedCell = {
      type: cell.cell_type,
      source,
    };

    if (cell.cell_type === 'code') {
      parsedCell.execution_count = cell.execution_count;
      parsedCell.outputs = (cell.outputs || []).map(output => parseNotebookOutput(output));
    }

    cells.push(parsedCell);
  }

  return {
    cells,
    totalCells: nbCells.length,
    truncated: nbCells.length > maxCells,
    metadata: {
      kernelspec: notebook.metadata?.kernelspec,
      language_info: notebook.metadata?.language_info
    }
  };
}

/**
 * Parse a single notebook output
 */
function parseNotebookOutput(output) {
  const parsed = {
    output_type: output.output_type
  };

  if (output.output_type === 'stream') {
    parsed.name = output.name; // stdout or stderr
    parsed.text = Array.isArray(output.text) ? output.text.join('') : (output.text || '');
  } else if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
    parsed.data = {};
    // Extract text/plain, text/html, image/png, etc.
    if (output.data) {
      for (const mime of Object.keys(output.data)) {
        const value = output.data[mime];
        parsed.data[mime] = Array.isArray(value) ? value.join('') : value;
      }
    }
  } else if (output.output_type === 'error') {
    parsed.ename = output.ename;
    parsed.evalue = output.evalue;
    parsed.traceback = output.traceback || [];
  }

  return parsed;
}

/**
 * Parse Parquet file with row limit
 * Returns { columns, rows, totalRows, truncated }
 */
async function parseParquetFile(filePath, maxRows) {
  const parquetLib = await getParquet();
  const reader = await parquetLib.ParquetReader.openFile(filePath);

  const schema = reader.getSchema();
  const columns = Object.entries(schema.fields).map(([name, field]) => ({
    name,
    type: field.originalType || field.primitiveType || 'unknown'
  }));

  const cursor = reader.getCursor();
  const rows = [];
  let totalRows = 0;

  let record;
  while ((record = await cursor.next())) {
    totalRows++;
    if (rows.length < maxRows) {
      // Convert record object to array matching column order
      rows.push(columns.map(col => {
        const val = record[col.name];
        // Handle BigInt and Buffer types
        if (typeof val === 'bigint') return val.toString();
        if (Buffer.isBuffer(val)) return val.toString('utf-8');
        return val;
      }));
    }
  }

  await reader.close();

  return {
    columns,
    rows,
    totalRows,
    truncated: totalRows > maxRows
  };
}

/**
 * Send structured file content response for viewer endpoints.
 */
async function sendFileContentResponse(res, filePath, targetPath, query = {}) {
  try {
    const stat = await fsp.stat(targetPath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Cannot read directory content' });
    }

    const filename = path.basename(targetPath);
    const ext = path.extname(filename).toLowerCase().slice(1);

    if (BINARY_EXTS.has(ext)) {
      return res.json({
        path: filePath,
        name: filename,
        ext,
        size: stat.size,
        mtime: stat.mtime.getTime(),
        binary: true,
      });
    }

    // CSV/TSV preview - structured data with row limit
    if (DATA_EXTS.has(ext)) {
      const maxRows = Math.min(
        parseInt(query.rows, 10) || DEFAULT_DATA_ROWS,
        MAX_DATA_ROWS
      );
      // Detect delimiter from first line
      const firstLine = await new Promise((resolve) => {
        const rl = readline.createInterface({
          input: fs.createReadStream(targetPath, { encoding: 'utf-8' }),
          crlfDelay: Infinity
        });
        rl.once('line', (line) => {
          rl.close();
          resolve(line);
        });
        rl.once('close', () => resolve(''));
      });
      const delimiter = ext === 'tsv' ? '\t' : detectDelimiter(firstLine);
      const data = await parseDelimitedFile(targetPath, delimiter, maxRows);
      return res.json({
        path: filePath,
        name: filename,
        ext,
        size: stat.size,
        mtime: stat.mtime.getTime(),
        csv: true,
        delimiter: delimiter === '\t' ? 'tab' : 'comma',
        ...data
      });
    }

    // Jupyter notebook preview - cells with outputs
    if (ext === NOTEBOOK_EXT) {
      const maxCells = Math.min(
        parseInt(query.cells, 10) || DEFAULT_NOTEBOOK_CELLS,
        MAX_NOTEBOOK_CELLS
      );
      const data = await parseNotebook(targetPath, maxCells);
      return res.json({
        path: filePath,
        name: filename,
        ext,
        size: stat.size,
        mtime: stat.mtime.getTime(),
        notebook: true,
        ...data
      });
    }

    // Parquet preview - structured columnar data
    if (ext === PARQUET_EXT) {
      const maxRows = Math.min(
        parseInt(query.rows, 10) || DEFAULT_DATA_ROWS,
        MAX_DATA_ROWS
      );
      try {
        const data = await parseParquetFile(targetPath, maxRows);
        return res.json({
          path: filePath,
          name: filename,
          ext,
          size: stat.size,
          mtime: stat.mtime.getTime(),
          parquet: true,
          ...data
        });
      } catch (err) {
        return res.json({
          path: filePath,
          name: filename,
          ext,
          size: stat.size,
          mtime: stat.mtime.getTime(),
          binary: true,
          parquetError: err.message
        });
      }
    }

    if (LARGE_GEO_PREVIEW_EXTS.has(ext)) {
      if (stat.size > MAX_GEO_FILE_SIZE) {
        return res.json({
          path: filePath,
          name: filename,
          ext,
          size: stat.size,
          mtime: stat.mtime.getTime(),
          truncated: true,
          maxPreviewSize: MAX_GEO_FILE_SIZE,
        });
      }

      const content = await fsp.readFile(targetPath, 'utf-8');
      const language = EXT_TO_LANG[ext] || EXT_TO_LANG[filename.toLowerCase()] || '';
      const rawTruncated = stat.size > MAX_GEO_RAW_FILE_SIZE;

      return res.json({
        path: filePath,
        name: filename,
        ext,
        content,
        size: stat.size,
        mtime: stat.mtime.getTime(),
        language,
        rawTruncated,
        rawPreviewSize: MAX_GEO_RAW_FILE_SIZE,
        mapPreviewSize: MAX_GEO_FILE_SIZE,
      });
    }

    const maxPreviewSize = getPreviewSizeLimitForExtension(ext);
    if (stat.size > maxPreviewSize) {
      return res.json({
        path: filePath,
        name: filename,
        ext,
        size: stat.size,
        mtime: stat.mtime.getTime(),
        truncated: true,
        maxPreviewSize,
      });
    }

    const content = await fsp.readFile(targetPath, 'utf-8');
    const language = EXT_TO_LANG[ext] || EXT_TO_LANG[filename.toLowerCase()] || '';

    return res.json({
      path: filePath,
      name: filename,
      ext,
      content,
      size: stat.size,
      mtime: stat.mtime.getTime(),
      language,
    });
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    return res.status(404).json({ error: 'File not found' });
  }
}

function setupFileRoutes(app) {
  // Browse directories (for cwd picker)
  app.get('/api/browse', async (req, res) => {
    const target = req.query.path || process.env.HOME;
    const resolved = resolveBrowsePathInput(target);
    try {
      const entries = await fsp.readdir(resolved, { withFileTypes: true });
      const dirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => e.name)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      res.json({ path: resolved, dirs, parent: path.dirname(resolved) });
    } catch (err) {
      res.status(400).json({ error: err.message, path: resolved });
    }
  });

  // Recursive directory search (for cwd picker fuzzy find)
  app.get('/api/browse/search', async (req, res) => {
    const baseInput = req.query.base || req.query.path;
    const query = String(req.query.q || '').trim();
    if (!baseInput) return res.status(400).json({ error: 'base required' });
    if (!query) return res.status(400).json({ error: 'q required' });

    const base = resolveBrowsePathInput(baseInput);
    const limit = clampInteger(req.query.limit, BROWSE_SEARCH_DEFAULT_LIMIT, 1, BROWSE_SEARCH_MAX_LIMIT);
    const depth = clampInteger(req.query.depth, BROWSE_SEARCH_DEFAULT_DEPTH, 1, BROWSE_SEARCH_MAX_DEPTH);

    let baseStat;
    try {
      baseStat = await fsp.stat(base);
    } catch (err) {
      if (err?.code === 'EPERM' || err?.code === 'EACCES') {
        return res.status(403).json({ error: 'Permission denied', base });
      }
      return res.status(404).json({ error: 'Base directory not found', base });
    }
    if (!baseStat.isDirectory()) {
      return res.status(400).json({ error: 'base must be a directory', base });
    }

    try {
      const { results, truncated } = await searchDirectoriesRecursive(base, query, { limit, depth });
      res.json({ base, q: query, limit, depth, results, truncated });
    } catch (err) {
      if (err?.code === 'EPERM' || err?.code === 'EACCES') {
        return res.status(403).json({ error: 'Permission denied', base });
      }
      res.status(500).json({ error: err.message || 'Directory search failed', base });
    }
  });

  // General file browser
  app.get('/api/files', async (req, res) => {
    const targetPath = req.query.path || process.env.HOME;
    const resolved = path.resolve(targetPath);

    const result = await listDirectory(resolved);
    if (result.error) {
      return res.status(result.status || 400).json({
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
      });
    }

    res.json({
      path: resolved,
      parent: path.dirname(resolved) !== resolved ? path.dirname(resolved) : null,
      entries: result.entries,
    });
  });

  // General file download
  app.get('/api/files/download', async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const resolved = path.resolve(filePath);
    const inline = req.query.inline === 'true';
    await sendFileDownload(res, resolved, { inline });
  });

  // General file content (structured preview for viewer)
  app.get('/api/files/content', async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const resolved = path.resolve(filePath);
    await sendFileContentResponse(res, resolved, resolved, req.query);
  });

  // Upload file to any directory
  app.post('/api/files/upload', (req, res) => {
    const targetDir = req.query.path || process.env.HOME;
    const filename = req.query.filename;

    if (!filename) return res.status(400).json({ error: 'filename required' });

    const resolved = path.resolve(targetDir);
    const safeName = sanitizeFilename(filename);
    const filePath = path.join(resolved, safeName);

    handleFileUpload(req, res, filePath);
  });

  // Create directory
  app.post('/api/mkdir', async (req, res) => {
    const target = req.body.path;
    if (!target) return res.status(400).json({ error: 'path required' });
    try {
      await fsp.mkdir(target, { recursive: true });
      res.json({ ok: true, path: target });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Delete file or directory
  app.delete('/api/files', async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const resolved = path.resolve(filePath);

    try {
      const stat = await fsp.stat(resolved);
      if (stat.isDirectory()) {
        await fsp.rm(resolved, { recursive: true });
      } else {
        await fsp.unlink(resolved);
      }
      res.json({ ok: true, path: resolved });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found' });
      }
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        return res.status(403).json({ error: 'Permission denied' });
      }
      res.status(400).json({ error: err.message });
    }
  });

  // Upload file for conversation attachments
  app.post('/api/conversations/:id/upload', withConversation(async (req, res, conv) => {
    const convId = conv.id;
    const filename = req.query.filename || `upload-${Date.now()}`;
    const safeName = sanitizeFilename(filename);
    const uploadDir = path.join(UPLOAD_DIR, convId);
    await fsp.mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, safeName);

    handleFileUpload(req, res, filePath, (fPath, fName) => ({
      path: fPath,
      filename: fName,
      url: `/uploads/${convId}/${fName}`
    }));
  }));

  // List files in conversation's working directory
  app.get('/api/conversations/:id/files', withConversation(async (req, res, conv) => {
    const subpath = req.query.path || '';
    const baseCwd = conv.cwd || process.env.HOME;

    const targetPath = path.resolve(baseCwd, subpath);
    if (!isPathWithinCwd(baseCwd, targetPath)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await listDirectory(targetPath, { baseCwd });
    if (result.error) {
      return res.status(result.status || 400).json({
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
      });
    }

    res.json({
      cwd: baseCwd,
      path: subpath || '.',
      fullPath: targetPath,
      parent: subpath ? path.dirname(subpath) || null : null,
      entries: result.entries,
    });
  }));

  // Get file content (for file viewer panel)
  app.get('/api/conversations/:id/files/content', withConversation(async (req, res, conv) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const baseCwd = conv.cwd || process.env.HOME;
    const targetPath = path.resolve(baseCwd, filePath);

    if (!isPathWithinCwd(baseCwd, targetPath)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await sendFileContentResponse(res, filePath, targetPath, req.query);
  }));

  // Search files in conversation's working directory (git grep)
  app.get('/api/conversations/:id/files/search', withConversation(async (req, res, conv) => {
    const query = req.query.q;
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'q parameter required' });
    }

    const cwd = conv.cwd || process.env.HOME;

    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Search requires a git repository' });
    }

    const result = await runGit(cwd, ['grep', '-n', '-I', '--no-color', '-e', query.trim()]);

    if (!result.ok) {
      if (result.stderr && !result.stderr.includes('did not match')) {
        return res.status(500).json({ error: result.stderr });
      }
      return res.json({ results: [] });
    }

    const lines = result.stdout.split('\n').filter(line => line.trim());
    const results = [];
    const MAX_RESULTS = 100;

    for (const line of lines) {
      if (results.length >= MAX_RESULTS) break;
      const match = line.match(/^(.+?):(\d+):(.*)$/);
      if (match) {
        results.push({
          path: match[1],
          line: parseInt(match[2], 10),
          content: match[3]
        });
      }
    }

    res.json({ results });
  }));

  // Download file from conversation's working directory
  app.get('/api/conversations/:id/files/download', withConversation(async (req, res, conv) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const baseCwd = conv.cwd || process.env.HOME;
    const targetPath = path.resolve(baseCwd, filePath);

    if (!isPathWithinCwd(baseCwd, targetPath)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const inline = req.query.inline === 'true';
    await sendFileDownload(res, targetPath, { inline });
  }));
}

module.exports = { setupFileRoutes, getPreviewSizeLimitForExtension };
