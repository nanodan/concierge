/**
 * Route aggregator - imports all route modules and exports a single setup function
 */
const { setupConversationRoutes } = require('./conversations');
const { setupFileRoutes } = require('./files');
const { setupGitRoutes } = require('./git');
const { setupMemoryRoutes } = require('./memory');
const { setupCapabilitiesRoutes } = require('./capabilities');
const { setupPreviewRoutes } = require('./preview');
const { setupDuckDBRoutes } = require('./duckdb');

/**
 * Setup all API routes on the Express app.
 * @param {Express.Application} app - Express app instance
 */
function setupRoutes(app) {
  setupConversationRoutes(app);
  setupFileRoutes(app);
  setupGitRoutes(app);
  setupMemoryRoutes(app);
  setupCapabilitiesRoutes(app);
  setupPreviewRoutes(app);
  setupDuckDBRoutes(app);
}

module.exports = { setupRoutes };
