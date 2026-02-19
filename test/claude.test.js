const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { processStreamEvent, MODELS } = require('../lib/claude');

describe('MODELS', () => {
  it('contains expected models', () => {
    assert.ok(Array.isArray(MODELS));
    assert.ok(MODELS.length >= 2);

    const ids = MODELS.map(m => m.id);
    assert.ok(ids.includes('sonnet'));
    assert.ok(ids.includes('opus'));
  });

  it('each model has id, name, and context', () => {
    for (const model of MODELS) {
      assert.ok(model.id, 'model should have id');
      assert.ok(model.name, 'model should have name');
      assert.ok(typeof model.context === 'number', 'model should have numeric context');
      assert.ok(model.context > 0, 'context should be positive');
    }
  });
});

describe('processStreamEvent - tool calls', () => {
  let sent;
  let fakeWs;
  let broadcastCalled;

  beforeEach(() => {
    sent = [];
    broadcastCalled = [];
    fakeWs = {
      send(data) { sent.push(JSON.parse(data)); },
    };
  });

  const onSave = () => {};
  const broadcastStatus = (id, status) => { broadcastCalled.push({ id, status }); };

  it('handles tool_use in assistant message content', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    const event = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Bash', id: 'tool-1', input: { command: 'ls -la' } },
        ],
      },
    };
    processStreamEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const toolStart = sent.find(m => m.type === 'tool_start');
    assert.ok(toolStart);
    assert.equal(toolStart.tool, 'Bash');
    assert.equal(toolStart.id, 'tool-1');

    const delta = sent.find(m => m.type === 'delta');
    assert.ok(delta);
    assert.ok(delta.text.includes('Using Bash'));
    assert.ok(delta.text.includes('ls -la'));
  });

  it('handles tool_use with file_path input', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    const event = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', id: 'tool-2', input: { file_path: '/etc/hosts' } },
        ],
      },
    };
    processStreamEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const delta = sent.find(m => m.type === 'delta');
    assert.ok(delta.text.includes('Using Read'));
    assert.ok(delta.text.includes('/etc/hosts'));
  });

  it('handles tool_use with pattern input', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    const event = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Grep', id: 'tool-3', input: { pattern: 'TODO' } },
        ],
      },
    };
    processStreamEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const delta = sent.find(m => m.type === 'delta');
    assert.ok(delta.text.includes('Using Grep'));
    assert.ok(delta.text.includes('TODO'));
  });

  it('handles tool_result events', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    const event = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'file1.txt\nfile2.txt' },
        ],
      },
    };
    processStreamEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const toolResult = sent.find(m => m.type === 'tool_result');
    assert.ok(toolResult);
    assert.equal(toolResult.toolUseId, 'tool-1');
    assert.equal(toolResult.isError, false);
  });

  it('handles error tool_result', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    const event = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'Command failed', is_error: true },
        ],
      },
    };
    processStreamEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const toolResult = sent.find(m => m.type === 'tool_result');
    assert.ok(toolResult);
    assert.equal(toolResult.isError, true);

    const delta = sent.find(m => m.type === 'delta');
    assert.ok(delta.text.includes('Error:'));
  });

  it('truncates long tool results', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    const longContent = 'x'.repeat(1000);
    const event = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: longContent },
        ],
      },
    };
    processStreamEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const delta = sent.find(m => m.type === 'delta');
    assert.ok(delta.text.includes('(truncated)'));
    assert.ok(delta.text.length < longContent.length);
  });
});

describe('processStreamEvent - thinking', () => {
  let sent;
  let fakeWs;

  beforeEach(() => {
    sent = [];
    fakeWs = {
      send(data) { sent.push(JSON.parse(data)); },
    };
  });

  const onSave = () => {};
  const broadcastStatus = () => {};

  it('handles thinking_delta events', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'Let me think about this...' },
      },
    };
    processStreamEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const thinking = sent.find(m => m.type === 'thinking');
    assert.ok(thinking);
    assert.equal(thinking.text, 'Let me think about this...');
  });
});

describe('processStreamEvent - content_block_start', () => {
  let sent;
  let fakeWs;

  beforeEach(() => {
    sent = [];
    fakeWs = {
      send(data) { sent.push(JSON.parse(data)); },
    };
  });

  const onSave = () => {};
  const broadcastStatus = () => {};

  it('handles top-level content_block_start for tool_use', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = {
      type: 'content_block_start',
      content_block: { type: 'tool_use', name: 'Write', id: 'tool-5' },
    };
    processStreamEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const toolStart = sent.find(m => m.type === 'tool_start');
    assert.ok(toolStart);
    assert.equal(toolStart.tool, 'Write');
    assert.equal(toolStart.id, 'tool-5');
  });

  it('handles nested content_block_start in stream_event', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Edit', id: 'tool-6' },
      },
    };
    processStreamEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const toolStart = sent.find(m => m.type === 'tool_start');
    assert.ok(toolStart);
    assert.equal(toolStart.tool, 'Edit');
  });
});

describe('processStreamEvent - system events', () => {
  let sent;
  let fakeWs;

  beforeEach(() => {
    sent = [];
    fakeWs = {
      send(data) { sent.push(JSON.parse(data)); },
    };
  });

  const onSave = () => {};
  const broadcastStatus = () => {};

  it('handles system tool_use subtype', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = {
      type: 'system',
      subtype: 'tool_use',
      tool: 'Glob',
    };
    processStreamEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const toolStart = sent.find(m => m.type === 'tool_start');
    assert.ok(toolStart);
    assert.equal(toolStart.tool, 'Glob');
  });

  it('handles system init subtype with session_id', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    const event = {
      type: 'system',
      subtype: 'init',
      session_id: 'sess-init-123',
    };
    processStreamEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    assert.equal(conv.claudeSessionId, 'sess-init-123');
  });
});

describe('processStreamEvent - result with tokens', () => {
  let sent;
  let fakeWs;
  let savedIds;

  beforeEach(() => {
    sent = [];
    savedIds = [];
    fakeWs = {
      send(data) { sent.push(JSON.parse(data)); },
    };
  });

  const onSave = (id) => { savedIds.push(id); };
  const broadcastStatus = () => {};

  it('extracts token counts from result event', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    const event = {
      type: 'result',
      result: 'Done!',
      session_id: 'sess-result',
      total_cost_usd: 0.01,
      duration_ms: 500,
      total_input_tokens: 1000,
      total_output_tokens: 200,
    };
    processStreamEvent(fakeWs, 'conv-1', conv, event, '', onSave, broadcastStatus);

    assert.equal(conv.messages.length, 1);
    assert.equal(conv.messages[0].inputTokens, 1000);
    assert.equal(conv.messages[0].outputTokens, 200);

    const result = sent.find(m => m.type === 'result');
    assert.equal(result.inputTokens, 1000);
    assert.equal(result.outputTokens, 200);
  });

  it('falls back to usage object for tokens', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    const event = {
      type: 'result',
      result: 'Done!',
      usage: { input_tokens: 500, output_tokens: 100 },
    };
    processStreamEvent(fakeWs, 'conv-1', conv, event, '', onSave, broadcastStatus);

    assert.equal(conv.messages[0].inputTokens, 500);
    assert.equal(conv.messages[0].outputTokens, 100);
  });

  it('defaults tokens to 0 when not provided', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    const event = {
      type: 'result',
      result: 'Done!',
    };
    processStreamEvent(fakeWs, 'conv-1', conv, event, '', onSave, broadcastStatus);

    assert.equal(conv.messages[0].inputTokens, 0);
    assert.equal(conv.messages[0].outputTokens, 0);
  });

  it('preserves inline trace blocks in final message', () => {
    const conv = { claudeSessionId: null, messages: [], status: 'thinking' };
    // Simulate streamed assistantText with inline trace block
    const assistantText = ':::trace\n\n**Using Bash**: `ls`\n\n```\nfile.txt\n```\n:::\n\nI found file.txt';
    const event = {
      type: 'result',
      result: 'I found file.txt',
    };
    processStreamEvent(fakeWs, 'conv-1', conv, event, assistantText, onSave, broadcastStatus);

    const msg = conv.messages[0];
    assert.ok(msg.text.includes(':::trace'));
    assert.ok(msg.text.includes('Using Bash'));
    assert.ok(msg.text.includes('I found file.txt'));
  });
});
