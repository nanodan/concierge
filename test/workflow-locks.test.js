const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  acquireLock,
  getLock,
  heartbeatLock,
  releaseLock,
  canWrite,
  clearLocks,
} = require('../lib/workflow/locks');

describe('workflow locks', () => {
  beforeEach(() => {
    clearLocks();
  });

  it('acquires a lock and allows owner writes', () => {
    const result = acquireLock('/tmp/project', 'conv-a');
    assert.equal(result.ok, true);
    assert.equal(result.lock.writerConversationId, 'conv-a');
    assert.equal(canWrite('/tmp/project', 'conv-a'), true);
  });

  it('blocks competing owner for same cwd', () => {
    acquireLock('/tmp/project', 'conv-a');
    const blocked = acquireLock('/tmp/project', 'conv-b');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'WRITE_LOCKED');
    assert.equal(blocked.lock.writerConversationId, 'conv-a');
    assert.equal(canWrite('/tmp/project', 'conv-b'), false);
  });

  it('heartbeats only for owner', () => {
    acquireLock('/tmp/project', 'conv-a', { ttlMs: 5000 });
    const denied = heartbeatLock('/tmp/project', 'conv-b', { ttlMs: 10000 });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'LOCK_NOT_OWNED');

    const ok = heartbeatLock('/tmp/project', 'conv-a', { ttlMs: 10000 });
    assert.equal(ok.ok, true);
    assert.ok(ok.lock.expiresAt > Date.now());
  });

  it('releases only for owner unless forced', () => {
    acquireLock('/tmp/project', 'conv-a');
    const denied = releaseLock('/tmp/project', 'conv-b');
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'LOCK_NOT_OWNED');
    assert.ok(getLock('/tmp/project'));

    const forced = releaseLock('/tmp/project', 'conv-b', { force: true });
    assert.equal(forced.ok, true);
    assert.equal(getLock('/tmp/project'), null);
  });

  it('expires locks after ttl and allows takeover', async () => {
    const first = acquireLock('/tmp/project', 'conv-a', { ttlMs: 5 });
    assert.equal(first.ok, true);
    await new Promise((resolve) => setTimeout(resolve, 12));
    const second = acquireLock('/tmp/project', 'conv-b');
    assert.equal(second.ok, true);
    assert.equal(second.lock.writerConversationId, 'conv-b');
  });
});
