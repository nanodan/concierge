/**
 * Shared helpers for route handlers
 */
const path = require('path');
const fsp = require('fs').promises;
const { createReadStream } = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const { conversations } = require('../data');
const { MAX_UPLOAD_SIZE } = require('../constants');

// Error message for macOS permission issues
const MACOS_PERMISSION_ERROR = 'Permission denied. On macOS, grant Terminal/Node "Full Disk Access" in System Preferences > Privacy & Security.';

/**
 * Send a standardized JSON error response.
 * @param {Object} res - Express response object
 * @param {number} status - HTTP status code
 * @param {string} message - Error message
 * @param {Object} [extra] - Additional fields to include in the response
 */
function sendError(res, status, message, extra = {}) {
  res.status(status).json({ error: message, ...extra });
}

// MIME types for file serving
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.py': 'text/plain',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.jsx': 'text/plain',
};

/**
 * Wrap an async handler with try/catch error handling.
 * Catches unexpected errors and returns a consistent 500 response.
 * @param {Function} handler - Async route handler
 * @returns {Function} - Wrapped handler with error handling
 */
function withErrorHandling(handler) {
  return async (req, res, ...args) => {
    try {
      return await handler(req, res, ...args);
    } catch (err) {
      console.error(`[ROUTE ERROR] ${req.method} ${req.path}:`, err);
      // Don't send error if response already started
      if (!res.headersSent) {
        sendError(res, 500, err.message || 'Internal server error');
      }
    }
  };
}

/**
 * Middleware wrapper that loads a conversation by ID from req.params.id
 * Returns 404 if conversation not found
 */
function withConversation(handler) {
  return withErrorHandling(async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    return handler(req, res, conv);
  });
}

/**
 * Sanitize a filename to contain only safe characters.
 * @param {string} filename - The original filename
 * @returns {string} - Sanitized filename with only alphanumeric, dots, dashes, underscores
 */
function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Handle file upload from request body stream.
 * Collects chunks, writes to file, sends JSON response.
 * Enforces MAX_UPLOAD_SIZE limit.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} filePath - Full path where file should be written
 * @param {Function} [formatResponse] - Optional function to format response (receives filePath, safeName)
 */
function handleFileUpload(req, res, filePath, formatResponse) {
  const chunks = [];
  let totalSize = 0;
  let aborted = false;

  req.on('data', chunk => {
    if (aborted) return;
    totalSize += chunk.length;
    if (totalSize > MAX_UPLOAD_SIZE) {
      aborted = true;
      req.destroy();
      const maxMB = Math.round(MAX_UPLOAD_SIZE / (1024 * 1024));
      return res.status(413).json({ error: `File too large. Maximum size is ${maxMB}MB.` });
    }
    chunks.push(chunk);
  });

  req.on('end', async () => {
    if (aborted) return;
    try {
      await fsp.writeFile(filePath, Buffer.concat(chunks));
      const safeName = path.basename(filePath);
      const response = formatResponse
        ? formatResponse(filePath, safeName)
        : { path: filePath, filename: safeName };
      res.json(response);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  req.on('error', err => {
    if (!aborted) {
      res.status(500).json({ error: err.message });
    }
  });
}

/**
 * Check if a resolved path is within the base directory.
 * Handles the edge case where /foo/bar2 would incorrectly pass for base /foo/bar.
 * @param {string} baseCwd - The base directory path
 * @param {string} resolvedPath - The resolved absolute path to check
 * @returns {boolean} - True if the path is within baseCwd
 */
function isPathWithinCwd(baseCwd, resolvedPath) {
  const normalizedBase = baseCwd.endsWith(path.sep) ? baseCwd : baseCwd + path.sep;
  return resolvedPath === baseCwd || resolvedPath.startsWith(normalizedBase);
}

/**
 * Validate that all paths resolve to within the cwd directory.
 * @param {string} cwd - The base directory
 * @param {string[]} paths - Array of relative paths to validate
 * @returns {{valid: boolean, invalidPath?: string}} - Validation result
 */
function validatePathsWithinCwd(cwd, paths) {
  for (const p of paths) {
    const resolved = path.resolve(cwd, p);
    if (!isPathWithinCwd(cwd, resolved)) {
      return { valid: false, invalidPath: p };
    }
  }
  return { valid: true };
}

/**
 * Run a git command in a specific directory.
 * @param {string} cwd - Working directory
 * @param {string[]} args - Git command arguments
 * @returns {Promise<{stdout: string, stderr: string, ok: boolean, code?: string}>}
 */
async function runGit(cwd, args) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return { stdout, stderr, ok: true };
  } catch (err) {
    return { stdout: '', stderr: err.stderr || err.message, ok: false, code: err.code };
  }
}

/**
 * Check if a directory is a git repository.
 * @param {string} cwd - Directory path to check
 * @returns {Promise<boolean>}
 */
async function isGitRepo(cwd) {
  const result = await runGit(cwd, ['rev-parse', '--git-dir']);
  return result.ok;
}

/**
 * Middleware wrapper that validates the conversation exists and the cwd is a git repo.
 * Includes error handling for unexpected exceptions.
 * @param {Function} handler - Route handler (req, res, conv, cwd) => Promise
 */
function withGitRepo(handler) {
  return withErrorHandling(async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const cwd = conv.cwd || process.env.HOME;
    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }
    return handler(req, res, conv, cwd);
  });
}

/**
 * Middleware wrapper that validates cwd from query param or body and checks it's a git repo.
 * For standalone (non-conversation) git access.
 * @param {Function} handler - Route handler (req, res, cwd) => Promise
 */
function withCwd(handler) {
  return withErrorHandling(async (req, res) => {
    const cwd = req.query.cwd || req.body?.cwd;
    if (!cwd) return res.status(400).json({ error: 'cwd required' });

    const resolved = path.resolve(cwd);
    try {
      const stat = await fsp.stat(resolved);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    } catch (_err) {
      return res.status(400).json({ error: 'Directory not found' });
    }

    if (!(await isGitRepo(resolved))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }

    return handler(req, res, resolved);
  });
}

/**
 * List files and directories in a path.
 * @param {string} targetPath - Absolute path to list
 * @param {Object} options - Options
 * @param {string} [options.baseCwd] - If provided, paths are returned relative to this
 * @param {boolean} [options.includeHidden=false] - Include hidden files
 * @returns {Promise<{entries: Array, error?: string}>}
 */
async function listDirectory(targetPath, options = {}) {
  const { baseCwd, includeHidden = false } = options;

  try {
    const stat = await fsp.stat(targetPath);
    if (!stat.isDirectory()) {
      return { error: 'Not a directory', status: 400 };
    }

    const entries = await fsp.readdir(targetPath, { withFileTypes: true });
    const files = [];
    const dirs = [];

    for (const entry of entries) {
      if (!includeHidden && entry.name.startsWith('.')) continue;

      const entryPath = path.join(targetPath, entry.name);
      try {
        const entryStat = await fsp.stat(entryPath);
        const item = {
          name: entry.name,
          path: baseCwd ? path.relative(baseCwd, entryPath) : entryPath,
          size: entryStat.size,
          mtime: entryStat.mtime.getTime(),
        };

        if (entry.isDirectory()) {
          item.type = 'directory';
          dirs.push(item);
        } else {
          item.type = 'file';
          item.ext = path.extname(entry.name).toLowerCase().slice(1);
          files.push(item);
        }
      } catch (_e) {
        // Skip files we can't stat
      }
    }

    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    return { entries: [...dirs, ...files] };
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      return { error: MACOS_PERMISSION_ERROR, status: 403, code: err.code };
    }
    return { error: err.message, status: 400 };
  }
}

/**
 * Send a file as a download response with appropriate headers.
 * Handles stat, content-type, content-disposition, and streaming.
 * @param {Object} res - Express response object
 * @param {string} filePath - Absolute path to the file
 * @param {Object} options - Options
 * @param {boolean} [options.inline=false] - If true, display inline instead of download
 * @returns {Promise<boolean>} - True if successful, false if error was sent
 */
async function sendFileDownload(res, filePath, options = {}) {
  const { inline = false } = options;

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      res.status(400).json({ error: 'Cannot download directory' });
      return false;
    }

    const filename = path.basename(filePath);
    const ext = path.extname(filename).toLowerCase();

    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);

    if (!inline) {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    createReadStream(filePath).pipe(res);
    return true;
  } catch (_err) {
    res.status(404).json({ error: 'File not found' });
    return false;
  }
}

module.exports = {
  MACOS_PERMISSION_ERROR,
  MIME_TYPES,
  MAX_UPLOAD_SIZE,
  sendError,
  withErrorHandling,
  withConversation,
  sanitizeFilename,
  handleFileUpload,
  isPathWithinCwd,
  validatePathsWithinCwd,
  runGit,
  isGitRepo,
  withGitRepo,
  withCwd,
  listDirectory,
  sendFileDownload,
};
