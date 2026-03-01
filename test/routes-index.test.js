const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireWithMocks } = require('./helpers/require-with-mocks.cjs');

describe('route index setup', () => {
  it('registers all route modules with the same app instance', () => {
    const calls = [];
    const app = { name: 'test-app' };

    function makeSetup(name) {
      return (receivedApp) => {
        calls.push({ name, receivedApp });
      };
    }

    const routes = requireWithMocks('../lib/routes/index', {
      [require.resolve('../lib/routes/conversations')]: { setupConversationRoutes: makeSetup('conversations') },
      [require.resolve('../lib/routes/files')]: { setupFileRoutes: makeSetup('files') },
      [require.resolve('../lib/routes/git')]: { setupGitRoutes: makeSetup('git') },
      [require.resolve('../lib/routes/memory')]: { setupMemoryRoutes: makeSetup('memory') },
      [require.resolve('../lib/routes/capabilities')]: { setupCapabilitiesRoutes: makeSetup('capabilities') },
      [require.resolve('../lib/routes/preview')]: { setupPreviewRoutes: makeSetup('preview') },
      [require.resolve('../lib/routes/duckdb')]: { setupDuckDBRoutes: makeSetup('duckdb') },
      [require.resolve('../lib/routes/bigquery')]: { setupBigQueryRoutes: makeSetup('bigquery') },
      [require.resolve('../lib/routes/workflow')]: { setupWorkflowRoutes: makeSetup('workflow') },
      [require.resolve('../lib/routes/system')]: { setupSystemRoutes: makeSetup('system') },
    }, __filename);

    routes.setupRoutes(app);

    assert.deepEqual(
      calls.map((entry) => entry.name),
      ['conversations', 'files', 'git', 'memory', 'capabilities', 'preview', 'duckdb', 'bigquery', 'workflow', 'system']
    );
    assert.equal(calls.every((entry) => entry.receivedApp === app), true);
  });
});
