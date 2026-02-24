const path = require('path');

const DEFAULT_LOCK_TTL_MS = 60_000;
const locksByCwd = new Map();

function nowMs() {
  return Date.now();
}

function resolveTtlMs(options = {}) {
  const candidate = Number(options.ttlMs);
  if (Number.isFinite(candidate) && candidate > 0) {
    return candidate;
  }
  return DEFAULT_LOCK_TTL_MS;
}

function normalizeCwd(cwd) {
  return path.resolve(cwd || process.env.HOME || '.');
}

function isExpired(lock, current = nowMs()) {
  return !lock || lock.expiresAt <= current;
}

function cleanupExpiredLocks() {
  const current = nowMs();
  for (const [cwd, lock] of locksByCwd.entries()) {
    if (isExpired(lock, current)) {
      locksByCwd.delete(cwd);
    }
  }
}

function getLock(cwd) {
  cleanupExpiredLocks();
  const key = normalizeCwd(cwd);
  return locksByCwd.get(key) || null;
}

function setLock(key, writerConversationId, ttlMs) {
  const createdAt = nowMs();
  const previous = locksByCwd.get(key);
  const lock = {
    cwd: key,
    writerConversationId,
    acquiredAt: previous ? previous.acquiredAt : createdAt,
    updatedAt: createdAt,
    expiresAt: createdAt + ttlMs,
  };
  locksByCwd.set(key, lock);
  return lock;
}

function acquireLock(cwd, writerConversationId, options = {}) {
  cleanupExpiredLocks();
  const ttlMs = resolveTtlMs(options);
  const key = normalizeCwd(cwd);
  const existing = locksByCwd.get(key);

  if (!writerConversationId) {
    return { ok: false, code: 'INVALID_LOCK_OWNER', error: 'writerConversationId required' };
  }

  if (!existing || existing.writerConversationId === writerConversationId) {
    const lock = setLock(key, writerConversationId, ttlMs);
    return { ok: true, lock };
  }

  return {
    ok: false,
    code: 'WRITE_LOCKED',
    error: 'Repository is locked by another conversation',
    lock: existing,
  };
}

function heartbeatLock(cwd, writerConversationId, options = {}) {
  const ttlMs = resolveTtlMs(options);
  const existing = getLock(cwd);

  if (!existing) {
    return { ok: false, code: 'LOCK_NOT_FOUND', error: 'No active lock for cwd' };
  }
  if (existing.writerConversationId !== writerConversationId) {
    return { ok: false, code: 'LOCK_NOT_OWNED', error: 'Lock owned by another conversation', lock: existing };
  }

  const lock = setLock(existing.cwd, writerConversationId, ttlMs);
  return { ok: true, lock };
}

function releaseLock(cwd, writerConversationId, options = {}) {
  const key = normalizeCwd(cwd);
  const existing = getLock(key);
  if (!existing) return { ok: true, released: false };

  const force = options.force === true;
  if (!force && existing.writerConversationId !== writerConversationId) {
    return { ok: false, code: 'LOCK_NOT_OWNED', error: 'Lock owned by another conversation', lock: existing };
  }

  locksByCwd.delete(key);
  return { ok: true, released: true };
}

function canWrite(cwd, writerConversationId) {
  const existing = getLock(cwd);
  if (!existing) return true;
  return existing.writerConversationId === writerConversationId;
}

function clearLocks() {
  locksByCwd.clear();
}

module.exports = {
  DEFAULT_LOCK_TTL_MS,
  normalizeCwd,
  getLock,
  acquireLock,
  heartbeatLock,
  releaseLock,
  canWrite,
  clearLocks,
  cleanupExpiredLocks,
};
