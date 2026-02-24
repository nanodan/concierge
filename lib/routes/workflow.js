const { conversations } = require('../data');
const { withErrorHandling } = require('./helpers');
const {
  acquireLock,
  releaseLock,
  heartbeatLock,
  getLock,
  canWrite,
} = require('../workflow/locks');
const {
  listPatches,
  submitPatch,
  getPatchById,
  applyPatch,
  rejectPatch,
} = require('../workflow/patch-queue');

function getConversationCwd(conversationId) {
  if (!conversationId) return null;
  const conv = conversations.get(conversationId);
  return conv ? conv.cwd : null;
}

function parseLockBody(req) {
  const conversationId = req.body?.conversationId || null;
  const cwd = req.body?.cwd || getConversationCwd(conversationId);
  return { cwd, conversationId };
}

function lockErrorStatus(code) {
  if (code === 'WRITE_LOCKED') return 409;
  if (code === 'LOCK_NOT_FOUND') return 404;
  return 400;
}

function enrichLockConflict(result) {
  const lock = result?.lock || null;
  const blockerConversationId = lock?.writerConversationId || null;
  const blockerConversationName = blockerConversationId
    ? (conversations.get(blockerConversationId)?.name || null)
    : null;
  const error = blockerConversationName
    ? `Repository is locked by "${blockerConversationName}"`
    : (result?.error || 'Repository is locked by another conversation');
  return { lock, blockerConversationId, blockerConversationName, error };
}

function setupWorkflowRoutes(app) {
  app.get('/api/workflow/lock', withErrorHandling(async (req, res) => {
    const cwd = req.query.cwd;
    if (!cwd) return res.status(400).json({ error: 'cwd required' });
    const lock = getLock(cwd);
    res.json({ ok: true, lock });
  }));

  app.post('/api/workflow/lock/acquire', withErrorHandling(async (req, res) => {
    const { cwd, conversationId } = parseLockBody(req);
    if (!cwd) return res.status(400).json({ error: 'cwd required' });
    const result = acquireLock(cwd, conversationId, { ttlMs: req.body?.ttlMs });
    if (!result.ok) {
      const conflict = enrichLockConflict(result);
      return res.status(lockErrorStatus(result.code)).json({
        error: conflict.error,
        code: result.code,
        lock: conflict.lock,
        blockerConversationId: conflict.blockerConversationId,
        blockerConversationName: conflict.blockerConversationName,
      });
    }
    res.json({ ok: true, lock: result.lock });
  }));

  app.post('/api/workflow/lock/heartbeat', withErrorHandling(async (req, res) => {
    const { cwd, conversationId } = parseLockBody(req);
    if (!cwd) return res.status(400).json({ error: 'cwd required' });
    const result = heartbeatLock(cwd, conversationId, { ttlMs: req.body?.ttlMs });
    if (!result.ok) {
      const conflict = enrichLockConflict(result);
      return res.status(lockErrorStatus(result.code)).json({
        error: conflict.error,
        code: result.code,
        lock: conflict.lock,
        blockerConversationId: conflict.blockerConversationId,
        blockerConversationName: conflict.blockerConversationName,
      });
    }
    res.json({ ok: true, lock: result.lock });
  }));

  app.post('/api/workflow/lock/release', withErrorHandling(async (req, res) => {
    const { cwd, conversationId } = parseLockBody(req);
    if (!cwd) return res.status(400).json({ error: 'cwd required' });
    const result = releaseLock(cwd, conversationId, { force: req.body?.force === true });
    if (!result.ok) {
      return res.status(lockErrorStatus(result.code)).json({
        error: result.error,
        code: result.code,
        lock: result.lock || null,
      });
    }
    res.json({ ok: true, released: result.released });
  }));

  app.get('/api/workflow/patches', withErrorHandling(async (req, res) => {
    const items = await listPatches(req.query.cwd || null);
    res.json({ ok: true, patches: items });
  }));

  app.post('/api/workflow/patches', withErrorHandling(async (req, res) => {
    const conversationId = req.body?.conversationId || null;
    const cwd = req.body?.cwd || getConversationCwd(conversationId);
    const result = await submitPatch({
      cwd,
      conversationId,
      title: req.body?.title,
      diff: req.body?.diff,
      baseCommit: req.body?.baseCommit,
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.error, code: result.code });
    }
    res.json({ ok: true, patch: result.item });
  }));

  app.post('/api/workflow/patches/:id/apply', withErrorHandling(async (req, res) => {
    const patch = await getPatchById(req.params.id);
    if (!patch) return res.status(404).json({ error: 'Patch not found', code: 'PATCH_NOT_FOUND' });

    const conversationId = req.body?.conversationId || null;
    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId required', code: 'CONVERSATION_ID_REQUIRED' });
    }

    if (!canWrite(patch.cwd, conversationId)) {
      const lock = getLock(patch.cwd);
      const conflict = enrichLockConflict({ lock, error: 'Repository is locked by another conversation' });
      return res.status(409).json({
        error: conflict.error,
        code: 'WRITE_LOCKED',
        lock: conflict.lock,
        blockerConversationId: conflict.blockerConversationId,
        blockerConversationName: conflict.blockerConversationName,
      });
    }

    const result = await applyPatch(req.params.id, { appliedBy: conversationId });
    if (!result.ok) {
      const status = result.code === 'PATCH_NOT_FOUND' ? 404 : 409;
      return res.status(status).json({ error: result.error, code: result.code, patch: result.item || null });
    }
    res.json({ ok: true, patch: result.item });
  }));

  app.post('/api/workflow/patches/:id/reject', withErrorHandling(async (req, res) => {
    const result = await rejectPatch(req.params.id, {
      rejectedBy: req.body?.conversationId || null,
      reason: req.body?.reason || null,
    });
    if (!result.ok) {
      const status = result.code === 'PATCH_NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ error: result.error, code: result.code });
    }
    res.json({ ok: true, patch: result.item });
  }));
}

module.exports = { setupWorkflowRoutes };
