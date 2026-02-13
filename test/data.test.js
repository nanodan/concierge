const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  convMeta,
  getStatsCache,
  setStatsCache,
  invalidateStatsCache,
} = require('../lib/data');

describe('convMeta', () => {
  it('includes pinned status', () => {
    const conv = { id: 'x', name: 'X', pinned: true, messages: [] };
    const meta = convMeta(conv);
    assert.equal(meta.pinned, true);
  });

  it('defaults pinned to false', () => {
    const conv = { id: 'x', name: 'X', messages: [] };
    const meta = convMeta(conv);
    assert.equal(meta.pinned, false);
  });

  it('includes model defaulting to sonnet', () => {
    const conv = { id: 'x', name: 'X', messages: [] };
    const meta = convMeta(conv);
    assert.equal(meta.model, 'sonnet');
  });

  it('preserves custom model', () => {
    const conv = { id: 'x', name: 'X', model: 'opus', messages: [] };
    const meta = convMeta(conv);
    assert.equal(meta.model, 'opus');
  });

  it('computes messageCount from messages array', () => {
    const conv = {
      id: 'x',
      name: 'X',
      messages: [
        { role: 'user', text: 'a' },
        { role: 'assistant', text: 'b' },
        { role: 'user', text: 'c' },
      ],
    };
    const meta = convMeta(conv);
    assert.equal(meta.messageCount, 3);
  });

  it('uses lastMessage from messages array', () => {
    const conv = {
      id: 'x',
      name: 'X',
      messages: [
        { role: 'user', text: 'first' },
        { role: 'assistant', text: 'last', timestamp: 9999 },
      ],
    };
    const meta = convMeta(conv);
    assert.deepEqual(meta.lastMessage, { role: 'assistant', text: 'last', timestamp: 9999 });
  });

  it('handles cwd and status', () => {
    const conv = { id: 'x', name: 'X', cwd: '/home/user', status: 'thinking', messages: [] };
    const meta = convMeta(conv);
    assert.equal(meta.cwd, '/home/user');
    assert.equal(meta.status, 'thinking');
  });

  it('includes createdAt', () => {
    const conv = { id: 'x', name: 'X', createdAt: 1234567890, messages: [] };
    const meta = convMeta(conv);
    assert.equal(meta.createdAt, 1234567890);
  });

  it('includes claudeSessionId', () => {
    const conv = { id: 'x', name: 'X', claudeSessionId: 'sess-123', messages: [] };
    const meta = convMeta(conv);
    assert.equal(meta.claudeSessionId, 'sess-123');
  });
});

describe('stats cache', () => {
  beforeEach(() => {
    invalidateStatsCache();
  });

  it('returns null when cache is empty', () => {
    assert.equal(getStatsCache(), null);
  });

  it('returns cached data after set', () => {
    const data = { total: 100, cost: 5.5 };
    setStatsCache(data);
    const result = getStatsCache();
    assert.deepEqual(result, data);
  });

  it('returns null after invalidation', () => {
    setStatsCache({ foo: 'bar' });
    invalidateStatsCache();
    assert.equal(getStatsCache(), null);
  });

  it('caches complex objects', () => {
    const data = {
      conversations: 50,
      messages: 1000,
      byModel: { sonnet: 800, opus: 200 },
      dailyCosts: [{ date: '2025-01-01', cost: 1.5 }],
    };
    setStatsCache(data);
    const result = getStatsCache();
    assert.deepEqual(result, data);
  });
});
