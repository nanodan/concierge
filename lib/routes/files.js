/**
 * File browser, download, upload routes
 */
const path = require('path');
const fsp = require('fs').promises;

const { UPLOAD_DIR } = require('../data');
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

      res.json({
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
      res.status(404).json({ error: 'File not found' });
    }
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
