const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { convMeta, atomicWrite } = require('../lib/data');
const { processStreamEvent } = require('../lib/claude');

describe('convMeta', () => {
  it('returns metadata with messages loaded', () => {
    const conv = {
      id: 'test-1',
      name: 'Test Conv',
      cwd: '/tmp',
      status: 'idle',
      archived: false,
      autopilot: true,
      claudeSessionId: 'sess-1',
      createdAt: 1000,
      messages: [
        { role: 'user', text: 'hello', timestamp: 2000 },
        { role: 'assistant', text: 'hi', timestamp: 3000 },
      ],
    };
    const meta = convMeta(conv);
    assert.equal(meta.id, 'test-1');
    assert.equal(meta.name, 'Test Conv');
    assert.equal(meta.messageCount, 2);
    assert.deepEqual(meta.lastMessage, { role: 'assistant', text: 'hi', timestamp: 3000 });
    assert.equal(meta.autopilot, true);
    assert.equal(meta.archived, false);
  });

  it('returns metadata without messages (lazy mode)', () => {
    const conv = {
      id: 'test-2',
      name: 'Lazy Conv',
      cwd: '/home',
      status: 'idle',
      archived: true,
      autopilot: false,
      claudeSessionId: null,
      createdAt: 5000,
      messages: null,
      messageCount: 5,
      lastMessage: { role: 'assistant', text: 'last', timestamp: 4000 },
    };
    const meta = convMeta(conv);
    assert.equal(meta.messageCount, 5);
    assert.deepEqual(meta.lastMessage, { role: 'assistant', text: 'last', timestamp: 4000 });
    assert.equal(meta.archived, true);
    assert.equal(meta.autopilot, false);
  });

  it('defaults autopilot to true when undefined', () => {
    const conv = { id: 'x', name: 'X', messages: [] };
    const meta = convMeta(conv);
    assert.equal(meta.autopilot, true);
  });

  it('returns 0 messageCount with no messages and no fallback', () => {
    const conv = { id: 'x', name: 'X', messages: null };
    const meta = convMeta(conv);
    assert.equal(meta.messageCount, 0);
    assert.equal(meta.lastMessage, null);
  });
});

describe('atomicWrite', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes file atomically', async () => {
    const filePath = path.join(tmpDir, 'test.json');
    await atomicWrite(filePath, '{"ok":true}');
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(content, '{"ok":true}');
  });

  it('cleans up temp file after write', async () => {
    const filePath = path.join(tmpDir, 'test2.json');
    await atomicWrite(filePath, 'data');
    const tmpFile = filePath + '.tmp';
    assert.equal(fs.existsSync(tmpFile), false);
  });

  it('overwrites existing file', async () => {
    const filePath = path.join(tmpDir, 'test3.json');
    fs.writeFileSync(filePath, 'old');
    await atomicWrite(filePath, 'new');
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'new');
  });
});

describe('processStreamEvent', () => {
  let sent;
  let fakeWs;
  let onSaveCalled;
  let broadcastCalled;

  const onSave = () => { onSaveCalled = true; };
  const broadcastStatus = (id, status) => { broadcastCalled.push({ id, status }); };

  beforeEach(() => {
    sent = [];
    onSaveCalled = false;
    broadcastCalled = [];
    fakeWs = {
      send(data) { sent.push(JSON.parse(data)); },
    };
  });

  it('handles text_delta events', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello' },
      },
    };
    const result = processStreamEvent(fakeWs, 'conv-1', conv, event, '', '', onSave, broadcastStatus);
    assert.equal(result.assistantText, 'Hello');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'delta');
    assert.equal(sent[0].text, 'Hello');
    assert.equal(sent[0].conversationId, 'conv-1');
  });

  it('accumulates text across deltas', () => {
    const conv = { messages: [], status: 'thinking' };
    const event1 = {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
    };
    const event2 = {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
    };
    const r1 = processStreamEvent(fakeWs, 'c', conv, event1, '', '', onSave, broadcastStatus);
    const r2 = processStreamEvent(fakeWs, 'c', conv, event2, r1.assistantText, '', onSave, broadcastStatus);
    assert.equal(r2.assistantText, 'Hello world');
  });

  it('captures session_id from stream_event', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    const event = {
      type: 'stream_event',
      session_id: 'sess-abc',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } },
    };
    processStreamEvent(fakeWs, 'c', conv, event, '', '', onSave, broadcastStatus);
    assert.equal(conv.claudeSessionId, 'sess-abc');
  });

  it('does not overwrite existing session_id', () => {
    const conv = { claudeSessionId: 'existing', messages: [], status: 'thinking' };
    const event = {
      type: 'stream_event',
      session_id: 'new-id',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } },
    };
    processStreamEvent(fakeWs, 'c', conv, event, '', '', onSave, broadcastStatus);
    assert.equal(conv.claudeSessionId, 'existing');
  });

  it('handles result events', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    const event = {
      type: 'result',
      result: 'Final answer',
      session_id: 'sess-final',
      total_cost_usd: 0.05,
      duration_ms: 1200,
    };
    // Note: assistantText return value stays as the streaming accumulator,
    // result text goes to conv.messages and WebSocket
    processStreamEvent(fakeWs, 'conv-1', conv, event, 'partial', '', onSave, broadcastStatus);
    assert.equal(conv.claudeSessionId, 'sess-final');
    assert.equal(conv.status, 'idle');
    assert.equal(conv.messages.length, 1);
    assert.equal(conv.messages[0].role, 'assistant');
    assert.equal(conv.messages[0].text, 'Final answer');
    assert.equal(conv.messages[0].cost, 0.05);

    const resultMsg = sent.find(m => m.type === 'result');
    assert.ok(resultMsg);
    assert.equal(resultMsg.text, 'Final answer');
    assert.equal(resultMsg.cost, 0.05);
    assert.equal(resultMsg.duration, 1200);
  });

  it('handles assistant events with content blocks', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    const event = {
      type: 'assistant',
      session_id: 'sess-a',
      message: {
        content: [
          { type: 'text', text: 'Hello world' },
        ],
      },
    };
    const result = processStreamEvent(fakeWs, 'c', conv, event, 'Hello', '', onSave, broadcastStatus);
    // Should send delta with the new portion only
    assert.equal(result.assistantText, 'Hello world');
    const delta = sent.find(m => m.type === 'delta');
    assert.ok(delta);
    assert.equal(delta.text, ' world');
  });

  it('ignores assistant event when no new text', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    const event = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'same' }] },
    };
    const result = processStreamEvent(fakeWs, 'c', conv, event, 'same', '', onSave, broadcastStatus);
    assert.equal(result.assistantText, 'same');
    assert.equal(sent.length, 0);
  });

  it('ignores unknown event types', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = { type: 'unknown_type', data: 'foo' };
    const result = processStreamEvent(fakeWs, 'c', conv, event, 'existing', '', onSave, broadcastStatus);
    assert.equal(result.assistantText, 'existing');
    assert.equal(sent.length, 0);
  });
});
