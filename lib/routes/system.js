/**
 * System management routes (restart, health, etc.)
 */
const { spawn } = require('child_process');
const path = require('path');

/**
 * Setup system management routes on the Express app.
 * @param {Express.Application} app - Express app instance
 */
function setupSystemRoutes(app) {
  /**
   * POST /api/restart - Restart the server
   * Spawns a new server process and exits the current one
   */
  app.post('/api/restart', (_req, res) => {
    console.log('[SYSTEM] Restart requested via API');

    // Send success response before restarting
    res.json({ ok: true, message: 'Server restarting...' });

    // Schedule restart after response is sent
    setTimeout(() => {
      const serverPath = path.join(__dirname, '..', '..', 'server.js');

      // Spawn a new detached process
      const child = spawn('node', [serverPath], {
        detached: true,
        stdio: 'inherit',
        cwd: path.join(__dirname, '..', '..'),
        env: { ...process.env },
      });

      // Unreference so parent can exit
      child.unref();

      console.log('[SYSTEM] New server process spawned, exiting current process...');

      // Exit current process
      process.exit(0);
    }, 100);
  });

  /**
   * GET /api/health - Simple health check
   * Useful for checking if server is up after restart
   */
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });
}

module.exports = { setupSystemRoutes };
