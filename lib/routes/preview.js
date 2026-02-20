/**
 * Preview server management routes
 * Starts/stops dev servers for live previewing web projects
 */
const { spawn } = require('child_process');
const path = require('path');
const fsp = require('fs').promises;
const net = require('net');
const { withConversation } = require('./helpers');

// Track active preview processes: conversationId -> { proc, port, type, cwd }
const previewProcesses = new Map();

// Port allocation
const PORT_START = 3600;
const PORT_END = 3699;
const usedPorts = new Set();

/**
 * Find an available port in the range.
 * @returns {Promise<number|null>} - Available port or null if none found
 */
async function getAvailablePort() {
  for (let port = PORT_START; port <= PORT_END; port++) {
    if (usedPorts.has(port)) continue;

    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });

    if (available) return port;
  }
  return null;
}

/**
 * Find all HTML files in a directory (non-recursive, top-level only).
 * @param {string} cwd - Directory to search
 * @returns {Promise<string[]>} - Array of HTML filenames
 */
async function findHtmlFiles(cwd) {
  try {
    const files = await fsp.readdir(cwd);
    const htmlFiles = files.filter(f => f.endsWith('.html')).sort();
    // Put index.html first if it exists
    if (htmlFiles.includes('index.html')) {
      const idx = htmlFiles.indexOf('index.html');
      htmlFiles.splice(idx, 1);
      htmlFiles.unshift('index.html');
    }
    return htmlFiles;
  } catch (_e) {
    return [];
  }
}

/**
 * Detect project type and determine how to run a dev server.
 * @param {string} cwd - Project directory
 * @returns {Promise<{type: string, command: string, args: string[]}|null>}
 */
async function detectProjectType(cwd) {
  // Check for package.json
  try {
    const pkgPath = path.join(cwd, 'package.json');
    const pkgContent = await fsp.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);

    // Check for dev script
    if (pkg.scripts?.dev) {
      return { type: 'npm', command: 'npm', args: ['run', 'dev'] };
    }

    // Check for start script
    if (pkg.scripts?.start) {
      return { type: 'npm', command: 'npm', args: ['run', 'start'] };
    }
  } catch (_e) {
    // No package.json or invalid
  }

  // Check for vite.config.*
  try {
    const files = await fsp.readdir(cwd);
    const hasViteConfig = files.some(f => f.startsWith('vite.config.'));
    if (hasViteConfig) {
      return { type: 'vite', command: 'npx', args: ['vite'] };
    }
  } catch (_e) {
    // Ignore
  }

  // Check for any HTML files (static site)
  try {
    const files = await fsp.readdir(cwd);
    const htmlFiles = files.filter(f => f.endsWith('.html'));
    if (htmlFiles.length > 0) {
      // Prefer index.html, otherwise use the first HTML file found
      const entryFile = htmlFiles.includes('index.html') ? null : htmlFiles[0];
      // Use Python's built-in HTTP server - more reliable than npx serve
      return { type: 'static', command: 'python3', args: ['-m', 'http.server'], entryFile };
    }
  } catch (_e) {
    // Ignore
  }

  return null;
}

/**
 * Stop a preview process for a conversation.
 * @param {string} convId - Conversation ID
 * @returns {boolean} - True if process was stopped
 */
function stopPreview(convId) {
  const preview = previewProcesses.get(convId);
  if (!preview) return false;

  try {
    preview.proc.kill('SIGTERM');
    // Force kill after 2 seconds if still running
    setTimeout(() => {
      try {
        preview.proc.kill('SIGKILL');
      } catch (_e) {
        // Already dead
      }
    }, 2000);
  } catch (_e) {
    // Process may already be dead
  }

  usedPorts.delete(preview.port);
  previewProcesses.delete(convId);
  return true;
}

/**
 * Stop all preview processes (for server shutdown).
 */
function stopAllPreviews() {
  for (const [convId] of previewProcesses) {
    stopPreview(convId);
  }
}

// Handle server shutdown - clean up preview processes then exit
process.on('SIGTERM', () => {
  stopAllPreviews();
  process.exit(0);
});
process.on('SIGINT', () => {
  stopAllPreviews();
  process.exit(0);
});

/**
 * Setup preview routes on the Express app.
 * @param {Express.Application} app - Express app instance
 */
function setupPreviewRoutes(app) {
  // Start preview server
  app.post('/api/conversations/:id/preview/start', withConversation(async (req, res, conv) => {
    const convId = conv.id;
    const cwd = conv.cwd || process.env.HOME;

    // Check if already running
    const existing = previewProcesses.get(convId);
    if (existing) {
      const existingUrl = existing.entryFile
        ? `http://localhost:${existing.port}/${existing.entryFile}`
        : `http://localhost:${existing.port}`;
      // Get current HTML files for the file picker
      const htmlFiles = await findHtmlFiles(existing.cwd);
      return res.json({
        running: true,
        port: existing.port,
        type: existing.type,
        url: existingUrl,
        htmlFiles,
        currentFile: existing.entryFile || (htmlFiles.includes('index.html') ? 'index.html' : htmlFiles[0] || null)
      });
    }

    // Detect project type
    const projectType = await detectProjectType(cwd);
    if (!projectType) {
      return res.status(400).json({
        error: 'No web project detected',
        message: 'Could not find package.json with dev/start script, vite.config.*, or any .html files'
      });
    }

    // Get available port
    const port = await getAvailablePort();
    if (!port) {
      return res.status(503).json({
        error: 'No available ports',
        message: 'All preview ports (3600-3699) are in use'
      });
    }

    // Build command args with port
    let args = [...projectType.args];
    if (projectType.type === 'vite') {
      args.push('--port', String(port));
    } else if (projectType.type === 'static') {
      args.push(String(port));
    } else if (projectType.type === 'npm') {
      // For npm scripts, pass port via environment
    }

    // Spawn the process
    const proc = spawn(projectType.command, args, {
      cwd,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    // Collect stderr for error reporting
    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      // Limit stderr buffer
      if (stderr.length > 10000) {
        stderr = stderr.slice(-5000);
      }
    });

    // Handle process exit
    proc.on('exit', (code) => {
      usedPorts.delete(port);
      previewProcesses.delete(convId);
      if (code !== 0 && code !== null) {
        console.error(`Preview process for ${convId} exited with code ${code}`);
      }
    });

    proc.on('error', (err) => {
      usedPorts.delete(port);
      previewProcesses.delete(convId);
      console.error(`Preview process error for ${convId}:`, err.message);
    });

    // Track the process
    usedPorts.add(port);
    const entryFile = projectType.entryFile || null;
    previewProcesses.set(convId, { proc, port, type: projectType.type, cwd, entryFile, stderr: '' });

    // Wait a moment for the server to start
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Check if process is still running
    if (proc.exitCode !== null) {
      usedPorts.delete(port);
      previewProcesses.delete(convId);
      return res.status(500).json({
        error: 'Failed to start preview server',
        message: stderr.slice(0, 500) || 'Process exited immediately'
      });
    }

    // Get HTML files for the file picker
    const htmlFiles = await findHtmlFiles(cwd);
    const currentFile = entryFile || (htmlFiles.includes('index.html') ? 'index.html' : htmlFiles[0] || null);
    const url = currentFile
      ? `http://localhost:${port}/${currentFile}`
      : `http://localhost:${port}`;
    res.json({
      running: true,
      port,
      type: projectType.type,
      url,
      htmlFiles,
      currentFile
    });
  }));

  // Stop preview server
  app.post('/api/conversations/:id/preview/stop', withConversation(async (req, res, conv) => {
    const stopped = stopPreview(conv.id);
    res.json({ ok: true, wasRunning: stopped });
  }));

  // Get preview status
  app.get('/api/conversations/:id/preview/status', withConversation(async (req, res, conv) => {
    const preview = previewProcesses.get(conv.id);
    if (!preview) {
      return res.json({ running: false });
    }

    // Check if process is still alive
    if (preview.proc.exitCode !== null) {
      usedPorts.delete(preview.port);
      previewProcesses.delete(conv.id);
      return res.json({ running: false });
    }

    // Get current HTML files for the file picker
    const htmlFiles = await findHtmlFiles(preview.cwd);
    const currentFile = preview.entryFile || (htmlFiles.includes('index.html') ? 'index.html' : htmlFiles[0] || null);
    const url = currentFile
      ? `http://localhost:${preview.port}/${currentFile}`
      : `http://localhost:${preview.port}`;
    res.json({
      running: true,
      port: preview.port,
      type: preview.type,
      url,
      htmlFiles,
      currentFile
    });
  }));
}

module.exports = { setupPreviewRoutes, stopPreview, previewProcesses };
