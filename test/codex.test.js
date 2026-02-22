const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { processCodexEvent, MODELS } = require('../lib/providers/codex');

describe('Codex MODELS', () => {
  it('contains expected models', () => {
    assert.ok(Array.isArray(MODELS));
    assert.ok(MODELS.length >= 2);

    const ids = MODELS.map(m => m.id);
    assert.ok(ids.some(id => id.includes('codex')), 'should have a codex model');
    assert.ok(ids.some(id => id.includes('o3')), 'should have o3 model');
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

describe('processCodexEvent - thread.started', () => {
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

  it('captures thread_id as session ID', () => {
    const conv = { codexSessionId: null, messages: [], status: 'thinking' };
    const event = {
      type: 'thread.started',
      thread_id: '019c8503-f981-1234-5678-abcdef',
    };
    processCodexEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    assert.equal(conv.codexSessionId, '019c8503-f981-1234-5678-abcdef');
  });
});

describe('processCodexEvent - item.completed', () => {
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

  it('handles reasoning items as thinking events', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = {
      type: 'item.completed',
      item: {
        type: 'reasoning',
        text: 'Let me think about this...',
      },
    };
    processCodexEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const thinking = sent.find(m => m.type === 'thinking');
    assert.ok(thinking);
    assert.equal(thinking.text, 'Let me think about this...');
  });

  it('handles agent_message items as delta events', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = {
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'Here is my response.',
      },
    };
    const result = processCodexEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const delta = sent.find(m => m.type === 'delta');
    assert.ok(delta);
    assert.equal(delta.text, 'Here is my response.');
    assert.equal(result.assistantText, 'Here is my response.');
  });

  it('accumulates assistant text across multiple messages', () => {
    const conv = { messages: [], status: 'thinking' };
    const event1 = {
      type: 'item.completed',
      item: { type: 'agent_message', text: 'First part. ' },
    };
    const event2 = {
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Second part.' },
    };

    let result = processCodexEvent(fakeWs, 'c', conv, event1, '', onSave, broadcastStatus);
    result = processCodexEvent(fakeWs, 'c', conv, event2, result.assistantText, onSave, broadcastStatus);

    assert.equal(result.assistantText, 'First part. Second part.');
  });

  it('handles tool_use items', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = {
      type: 'item.completed',
      item: {
        type: 'tool_use',
        name: 'Bash',
        id: 'tool-123',
      },
    };
    processCodexEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const toolStart = sent.find(m => m.type === 'tool_start');
    assert.ok(toolStart);
    assert.equal(toolStart.tool, 'Bash');
    assert.equal(toolStart.id, 'tool-123');
  });

  it('handles tool_result items', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = {
      type: 'item.completed',
      item: {
        type: 'tool_result',
        tool_use_id: 'tool-123',
        is_error: false,
      },
    };
    processCodexEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const toolResult = sent.find(m => m.type === 'tool_result');
    assert.ok(toolResult);
    assert.equal(toolResult.toolUseId, 'tool-123');
    assert.equal(toolResult.isError, false);
  });

  it('handles error tool_result items', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = {
      type: 'item.completed',
      item: {
        type: 'tool_result',
        tool_use_id: 'tool-456',
        is_error: true,
      },
    };
    processCodexEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const toolResult = sent.find(m => m.type === 'tool_result');
    assert.ok(toolResult);
    assert.equal(toolResult.isError, true);
  });
});

describe('processCodexEvent - turn.completed', () => {
  let sent;
  let fakeWs;
  let savedIds;
  let broadcastCalled;

  beforeEach(() => {
    sent = [];
    savedIds = [];
    broadcastCalled = [];
    fakeWs = {
      send(data) { sent.push(JSON.parse(data)); },
    };
  });

  const onSave = (id) => { savedIds.push(id); };
  const broadcastStatus = (id, status) => { broadcastCalled.push({ id, status }); };

  it('extracts token counts from usage', () => {
    const conv = { codexSessionId: 'sess-123', messages: [], status: 'thinking', model: 'gpt-5.3-codex' };
    const event = {
      type: 'turn.completed',
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
      },
    };
    processCodexEvent(fakeWs, 'conv-1', conv, event, 'Test response', onSave, broadcastStatus);

    assert.equal(conv.messages.length, 1);
    assert.equal(conv.messages[0].inputTokens, 1500);
    assert.equal(conv.messages[0].outputTokens, 300);
    assert.equal(conv.messages[0].text, 'Test response');
    assert.equal(conv.status, 'idle');
  });

  it('sends result event with token info', () => {
    const conv = { codexSessionId: 'sess-123', messages: [], status: 'thinking', model: 'gpt-5.3-codex' };
    const event = {
      type: 'turn.completed',
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
      },
    };
    processCodexEvent(fakeWs, 'conv-1', conv, event, 'Done!', onSave, broadcastStatus);

    const result = sent.find(m => m.type === 'result');
    assert.ok(result);
    assert.equal(result.text, 'Done!');
    assert.equal(result.inputTokens, 1000);
    assert.equal(result.outputTokens, 200);
  });

  it('broadcasts idle status', () => {
    const conv = { codexSessionId: 'sess-123', messages: [], status: 'thinking', model: 'gpt-5.3-codex' };
    const event = {
      type: 'turn.completed',
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    processCodexEvent(fakeWs, 'conv-1', conv, event, 'Response', onSave, broadcastStatus);

    assert.deepEqual(broadcastCalled, [{ id: 'conv-1', status: 'idle' }]);
  });

  it('calls onSave with conversation ID', () => {
    const conv = { codexSessionId: 'sess-123', messages: [], status: 'thinking', model: 'gpt-5.3-codex' };
    const event = {
      type: 'turn.completed',
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    processCodexEvent(fakeWs, 'conv-42', conv, event, 'Response', onSave, broadcastStatus);

    assert.deepEqual(savedIds, ['conv-42']);
  });

  it('defaults tokens to 0 when not provided', () => {
    const conv = { codexSessionId: 'sess-123', messages: [], status: 'thinking', model: 'gpt-5.3-codex' };
    const event = {
      type: 'turn.completed',
      usage: {},
    };
    processCodexEvent(fakeWs, 'conv-1', conv, event, 'Response', onSave, broadcastStatus);

    assert.equal(conv.messages[0].inputTokens, 0);
    assert.equal(conv.messages[0].outputTokens, 0);
  });

  it('completes turn when usage is missing', () => {
    const conv = { codexSessionId: 'sess-123', messages: [], status: 'thinking', model: 'gpt-5.3-codex' };
    const event = {
      type: 'turn.completed',
      duration_ms: 1200,
    };
    processCodexEvent(fakeWs, 'conv-1', conv, event, 'Response', onSave, broadcastStatus);

    assert.equal(conv.messages.length, 1);
    assert.equal(conv.messages[0].inputTokens, 0);
    assert.equal(conv.messages[0].outputTokens, 0);
    assert.equal(conv.status, 'idle');
  });

  it('subtracts cached prompt tokens from displayed input tokens', () => {
    const conv = {
      codexSessionId: 'sess-123',
      messages: [],
      status: 'thinking',
      model: 'gpt-5.3-codex',
      _codexDisplayInputTokens: 1,
    };
    const event = {
      type: 'turn.completed',
      usage: {
        input_tokens: 12000,
        output_tokens: 300,
        input_tokens_details: {
          cached_tokens: 11000,
        },
      },
    };
    processCodexEvent(fakeWs, 'conv-1', conv, event, 'Response', onSave, broadcastStatus);

    assert.equal(conv.messages[0].rawInputTokens, 12000);
    assert.equal(conv.messages[0].cachedInputTokens, 11000);
    assert.equal(conv.messages[0].inputTokens, 1000);
    assert.equal(conv.messages[0].displayInputTokens, 1);
  });
});

describe('processCodexEvent - unknown events', () => {
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

  it('handles turn.started without error', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = { type: 'turn.started' };

    // Should not throw
    const result = processCodexEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);
    assert.equal(result.assistantText, '');
    assert.equal(sent.length, 0);
  });

  it('handles unknown event types gracefully', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = { type: 'some.unknown.event', data: 'foo' };

    // Should not throw
    const result = processCodexEvent(fakeWs, 'c', conv, event, 'existing', onSave, broadcastStatus);
    assert.equal(result.assistantText, 'existing');
    assert.equal(sent.length, 0);
  });
});
