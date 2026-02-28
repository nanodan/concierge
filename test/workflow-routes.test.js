const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { requireWithMocks } = require('./helpers/require-with-mocks.cjs');

async function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function stopServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

async function requestJson(baseUrl, method, routePath, body) {
  const response = await fetch(`${baseUrl}${routePath}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

function createWorkflowMocks() {
  const conversations = new Map([
    ['conv-1', { id: 'conv-1', name: 'Primary conversation', cwd: '/repo' }],
    ['conv-2', { id: 'conv-2', name: 'Secondary conversation', cwd: '/repo/sub' }],
  ]);
  const locksByCwd = new Map();
  const patchesById = new Map();
  let patchCounter = 0;
  let submitPayload = null;

  const locksApi = {
    acquireLock(cwd, conversationId) {
      const existing = locksByCwd.get(cwd);
      if (existing && existing.writerConversationId !== conversationId) {
        return { ok: false, code: 'WRITE_LOCKED', error: 'Repository is locked by another conversation', lock: existing };
      }
      const lock = {
        cwd,
        writerConversationId: conversationId || null,
        expiresAt: Date.now() + 30000,
      };
      locksByCwd.set(cwd, lock);
      return { ok: true, lock };
    },
    releaseLock(cwd, conversationId, { force } = {}) {
      const existing = locksByCwd.get(cwd);
      if (!existing) {
        return { ok: false, code: 'LOCK_NOT_FOUND', error: 'Lock not found', lock: null };
      }
      if (!force && existing.writerConversationId !== conversationId) {
        return { ok: false, code: 'WRITE_LOCKED', error: 'Repository is locked by another conversation', lock: existing };
      }
      locksByCwd.delete(cwd);
      return { ok: true, released: true };
    },
    heartbeatLock(cwd, conversationId) {
      const existing = locksByCwd.get(cwd);
      if (!existing) {
        return { ok: false, code: 'LOCK_NOT_FOUND', error: 'Lock not found', lock: null };
      }
      if (existing.writerConversationId !== conversationId) {
        return { ok: false, code: 'WRITE_LOCKED', error: 'Repository is locked by another conversation', lock: existing };
      }
      existing.expiresAt = Date.now() + 30000;
      return { ok: true, lock: existing };
    },
    getLock(cwd) {
      return locksByCwd.get(cwd) || null;
    },
    canWrite(cwd, conversationId) {
      const existing = locksByCwd.get(cwd);
      return !existing || existing.writerConversationId === conversationId;
    },
  };

  const patchApi = {
    async listPatches(cwd) {
      const items = Array.from(patchesById.values());
      if (!cwd) return items;
      return items.filter((item) => item.cwd === cwd);
    },
    async submitPatch(payload) {
      submitPayload = payload;
      if (!payload.cwd) {
        return { ok: false, code: 'PATCH_CWD_REQUIRED', error: 'cwd required' };
      }
      if (!payload.diff) {
        return { ok: false, code: 'PATCH_DIFF_REQUIRED', error: 'diff required' };
      }
      patchCounter += 1;
      const id = `patch-${patchCounter}`;
      const item = {
        id,
        cwd: payload.cwd,
        conversationId: payload.conversationId || null,
        title: payload.title || 'Untitled patch',
        diff: payload.diff,
        status: 'queued',
      };
      patchesById.set(id, item);
      return { ok: true, item };
    },
    async getPatchById(id) {
      return patchesById.get(id) || null;
    },
    async applyPatch(id, { appliedBy } = {}) {
      const item = patchesById.get(id);
      if (!item) {
        return { ok: false, code: 'PATCH_NOT_FOUND', error: 'Patch not found' };
      }
      item.status = 'applied';
      item.applyMeta = { appliedBy: appliedBy || null };
      return { ok: true, item };
    },
    async rejectPatch(id, { rejectedBy, reason } = {}) {
      const item = patchesById.get(id);
      if (!item) {
        return { ok: false, code: 'PATCH_NOT_FOUND', error: 'Patch not found' };
      }
      item.status = 'rejected';
      item.applyMeta = { rejectedBy: rejectedBy || null, reason: reason || null };
      return { ok: true, item };
    },
  };

  const setupModule = requireWithMocks('../lib/routes/workflow', {
    [require.resolve('../lib/data')]: { conversations },
    [require.resolve('../lib/routes/helpers')]: {
      withErrorHandling(handler) {
        return async (req, res) => {
          try {
            await handler(req, res);
          } catch (err) {
            res.status(500).json({ error: err?.message || 'handler failed' });
          }
        };
      },
    },
    [require.resolve('../lib/workflow/locks')]: locksApi,
    [require.resolve('../lib/workflow/patch-queue')]: patchApi,
  }, __filename);

  return {
    setupWorkflowRoutes: setupModule.setupWorkflowRoutes,
    state: {
      conversations,
      locksByCwd,
      patchesById,
      getSubmitPayload: () => submitPayload,
    },
  };
}

describe('workflow routes', () => {
  let server;
  let baseUrl;
  let state;

  beforeEach(async () => {
    const module = createWorkflowMocks();
    state = module.state;
    const app = express();
    app.use(express.json());
    module.setupWorkflowRoutes(app);
    server = await startServer(app);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await stopServer(server);
    server = null;
    baseUrl = null;
    state = null;
  });

  it('returns validation error when acquiring a lock without cwd', async () => {
    const response = await requestJson(baseUrl, 'POST', '/api/workflow/lock/acquire', {});
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'cwd required');
  });

  it('returns blocker conversation metadata on lock conflicts', async () => {
    const first = await requestJson(baseUrl, 'POST', '/api/workflow/lock/acquire', {
      cwd: '/repo',
      conversationId: 'conv-1',
    });
    assert.equal(first.status, 200);

    const conflict = await requestJson(baseUrl, 'POST', '/api/workflow/lock/acquire', {
      cwd: '/repo',
      conversationId: 'conv-2',
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'WRITE_LOCKED');
    assert.equal(conflict.body.blockerConversationId, 'conv-1');
    assert.equal(conflict.body.blockerConversationName, 'Primary conversation');
  });

  it('infers patch cwd from conversation when cwd is omitted', async () => {
    const response = await requestJson(baseUrl, 'POST', '/api/workflow/patches', {
      conversationId: 'conv-2',
      title: 'Test patch',
      diff: 'diff --git a/a.txt b/a.txt\n',
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.patch.cwd, '/repo/sub');
    assert.equal(state.getSubmitPayload().cwd, '/repo/sub');
  });

  it('returns apply conflict details when writer lock is owned by another conversation', async () => {
    const created = await requestJson(baseUrl, 'POST', '/api/workflow/patches', {
      cwd: '/repo',
      conversationId: 'conv-2',
      title: 'Patch needing lock',
      diff: 'diff --git a/a.txt b/a.txt\n',
    });
    assert.equal(created.status, 200);
    const patchId = created.body.patch.id;

    const locked = await requestJson(baseUrl, 'POST', '/api/workflow/lock/acquire', {
      cwd: '/repo',
      conversationId: 'conv-1',
    });
    assert.equal(locked.status, 200);

    const conflict = await requestJson(baseUrl, 'POST', `/api/workflow/patches/${patchId}/apply`, {
      conversationId: 'conv-2',
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'WRITE_LOCKED');
    assert.equal(conflict.body.blockerConversationId, 'conv-1');
    assert.equal(conflict.body.blockerConversationName, 'Primary conversation');
  });
});
