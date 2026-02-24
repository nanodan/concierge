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

    if (stat.size > MAX_FILE_SIZE) {
      return res.json({
        path: filePath,
        name: filename,
        ext,
        size: stat.size,
        mtime: stat.mtime.getTime(),
        truncated: true,
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
    const resolved = path.resolve(target);
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

module.exports = { setupFileRoutes };
