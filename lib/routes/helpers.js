/**
 * Shared helpers for route handlers
 */
const path = require('path');
const fsp = require('fs').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const { conversations } = require('../data');

// Error message for macOS permission issues
const MACOS_PERMISSION_ERROR = 'Permission denied. On macOS, grant Terminal/Node "Full Disk Access" in System Preferences > Privacy & Security.';

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
 * Middleware wrapper that loads a conversation by ID from req.params.id
 * Returns 404 if conversation not found
 */
function withConversation(handler) {
  return async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    return handler(req, res, conv);
  };
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
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} filePath - Full path where file should be written
 * @param {Function} [formatResponse] - Optional function to format response (receives filePath, safeName)
 */
function handleFileUpload(req, res, filePath, formatResponse) {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', async () => {
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
  req.on('error', err => res.status(500).json({ error: err.message }));
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
 * @param {Function} handler - Route handler (req, res, conv, cwd) => Promise
 */
function withGitRepo(handler) {
  return withConversation(async (req, res, conv) => {
    const cwd = conv.cwd || process.env.HOME;
    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }
    return handler(req, res, conv, cwd);
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

module.exports = {
  MACOS_PERMISSION_ERROR,
  MIME_TYPES,
  withConversation,
  sanitizeFilename,
  handleFileUpload,
  isPathWithinCwd,
  validatePathsWithinCwd,
  runGit,
  isGitRepo,
  withGitRepo,
  listDirectory,
};
