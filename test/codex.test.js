const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  processCodexEvent,
  MODELS,
  handleNoOutputClose,
  partitionAttachments,
  buildFileAttachmentPrompt,
} = require('../lib/providers/codex');

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

describe('Codex attachment helpers', () => {
  it('partitions image and non-image attachments with valid paths', () => {
    const result = partitionAttachments([
      { path: '/tmp/a.png' },
      { path: '/tmp/b.jpeg' },
      { path: '/tmp/c.pdf' },
      { path: '/tmp/d.txt' },
      { path: null },
      {},
    ]);

    assert.deepEqual(result.imageAttachments.map((item) => item.path), ['/tmp/a.png', '/tmp/b.jpeg']);
    assert.deepEqual(result.fileAttachments.map((item) => item.path), ['/tmp/c.pdf', '/tmp/d.txt']);
  });

  it('builds non-image attachment prompt block', () => {
    const text = buildFileAttachmentPrompt([
      { path: '/tmp/report.pdf' },
      { path: '/tmp/data.csv' },
    ]);

    assert.ok(text.includes('[Attached files'));
    assert.ok(text.includes('/tmp/report.pdf'));
    assert.ok(text.includes('/tmp/data.csv'));
  });

  it('returns empty prompt block when no files are provided', () => {
    assert.equal(buildFileAttachmentPrompt([]), '');
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

  it('closes open traces before appending agent_message text', () => {
    const conv = { messages: [], status: 'thinking' };
    const started = {
      type: 'item.started',
      item: {
        type: 'tool_use',
        name: 'command_execution',
        id: 'tool-open-1',
        input: { command: 'ls -1' },
      },
    };
    const agent = {
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'Summary outside trace.',
      },
    };

    let result = processCodexEvent(fakeWs, 'c', conv, started, '', onSave, broadcastStatus);
    result = processCodexEvent(fakeWs, 'c', conv, agent, result.assistantText, onSave, broadcastStatus);

    assert.ok(result.assistantText.includes(':::trace'));
    assert.ok(result.assistantText.includes('\n:::\n\nSummary outside trace.'));
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

  it('handles function_call style tool start events', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = {
      type: 'item.started',
      item: {
        type: 'function_call',
        function_name: 'write_file',
        call_id: 'call-123',
        input: { file_path: 'test.txt' },
      },
    };
    processCodexEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const toolStart = sent.find(m => m.type === 'tool_start');
    assert.ok(toolStart);
    assert.equal(toolStart.tool, 'write_file');
    assert.equal(toolStart.id, 'call-123');
  });

  it('handles function_call_output style tool results', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = {
      type: 'item.completed',
      item: {
        type: 'function_call_output',
        call_id: 'call-123',
        output: 'created test.txt',
      },
    };
    processCodexEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);

    const toolResult = sent.find(m => m.type === 'tool_result');
    assert.ok(toolResult);
    assert.equal(toolResult.toolUseId, 'call-123');
  });

  it('includes command details from command_line style tool input', () => {
    const conv = { messages: [], status: 'thinking' };
    const event = {
      type: 'item.started',
      item: {
        type: 'function_call',
        function_name: 'command_execution',
        call_id: 'call-cmd-1',
        input: { command_line: "/bin/zsh -lc 'touch testing.txt && ls -l testing.txt'" },
      },
    };
    const result = processCodexEvent(fakeWs, 'c', conv, event, '', onSave, broadcastStatus);
    assert.ok(result.assistantText.includes('touch testing.txt'));
  });

  it('extracts tool result text from output array', () => {
    const conv = { messages: [], status: 'thinking' };
    const start = {
      type: 'item.started',
      item: {
        type: 'tool_use',
        id: 'tool-array-1',
        name: 'command_execution',
      },
    };
    const done = {
      type: 'item.completed',
      item: {
        type: 'tool_result',
        tool_use_id: 'tool-array-1',
        output: [{ type: 'output_text', text: '-rw-r--r-- 0 testing.txt' }],
      },
    };
    let result = processCodexEvent(fakeWs, 'c', conv, start, '', onSave, broadcastStatus);
    result = processCodexEvent(fakeWs, 'c', conv, done, result.assistantText, onSave, broadcastStatus);
    assert.ok(result.assistantText.includes('testing.txt'));
  });

  it('shows command text when present on tool result item', () => {
    const conv = { messages: [], status: 'thinking' };
    const start = {
      type: 'item.started',
      item: { type: 'tool_use', id: 'tool-cmd-1', name: 'command_execution' },
    };
    const done = {
      type: 'item.completed',
      item: {
        type: 'tool_result',
        tool_use_id: 'tool-cmd-1',
        command: "touch testing.txt && ls -l testing.txt",
        output: "-rw-r--r-- 0 testing.txt",
      },
    };
    let result = processCodexEvent(fakeWs, 'c', conv, start, '', onSave, broadcastStatus);
    result = processCodexEvent(fakeWs, 'c', conv, done, result.assistantText, onSave, broadcastStatus);
    assert.ok(result.assistantText.includes('$ touch testing.txt && ls -l testing.txt'));
  });

  it('deduplicates tool start when both item.started and item.completed are emitted', () => {
    const conv = { messages: [], status: 'thinking' };
    const started = {
      type: 'item.started',
      item: {
        type: 'tool_use',
        name: 'command_execution',
        id: 'tool-dup-1',
      },
    };
    const completed = {
      type: 'item.completed',
      item: {
        type: 'tool_use',
        name: 'command_execution',
        id: 'tool-dup-1',
      },
    };

    let result = processCodexEvent(fakeWs, 'c', conv, started, '', onSave, broadcastStatus);
    processCodexEvent(fakeWs, 'c', conv, completed, result.assistantText, onSave, broadcastStatus);

    const starts = sent.filter(m => m.type === 'tool_start');
    assert.equal(starts.length, 1);
  });

  it('closes trace blocks even when tool ids are missing', () => {
    const conv = { messages: [], status: 'thinking' };
    const started = {
      type: 'item.started',
      item: {
        type: 'tool_use',
        name: 'command_execution',
      },
    };
    const completed = {
      type: 'item.completed',
      item: {
        type: 'tool_result',
        output: 'ok',
      },
    };

    let result = processCodexEvent(fakeWs, 'c', conv, started, '', onSave, broadcastStatus);
    result = processCodexEvent(fakeWs, 'c', conv, completed, result.assistantText, onSave, broadcastStatus);

    assert.ok(result.assistantText.includes(':::trace'));
    assert.ok(result.assistantText.includes('\n:::\n\n'));
  });

  it('auto-closes open trace on turn completion with newline-delimited closer', () => {
    const conv = { messages: [], status: 'thinking', model: 'gpt-5.3-codex' };
    const started = {
      type: 'item.started',
      item: {
        type: 'tool_use',
        name: 'command_execution',
      },
    };
    const textEvent = {
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'Created empty file.',
      },
    };
    const done = {
      type: 'turn.completed',
      usage: { input_tokens: 10, output_tokens: 5 },
    };

    let result = processCodexEvent(fakeWs, 'c', conv, started, '', onSave, broadcastStatus);
    result = processCodexEvent(fakeWs, 'c', conv, textEvent, result.assistantText, onSave, broadcastStatus);
    processCodexEvent(fakeWs, 'c', conv, done, result.assistantText, onSave, broadcastStatus);

    const saved = conv.messages[0].text;
    assert.ok(saved.includes(':::trace'));
    assert.ok(saved.includes('\n:::\n\n'));
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

  it('renders tool calls from batched turn.completed items', () => {
    const conv = { codexSessionId: 'sess-123', messages: [], status: 'thinking', model: 'gpt-5.3-codex' };
    const event = {
      type: 'turn.completed',
      items: [
        { type: 'tool_use', id: 'tool-batch-1', name: 'command_execution', input: { command: 'ls -l' } },
        { type: 'tool_result', tool_use_id: 'tool-batch-1', output: 'ok' },
      ],
      usage: { input_tokens: 20, output_tokens: 10 },
    };
    const result = processCodexEvent(fakeWs, 'conv-1', conv, event, 'Done.', onSave, broadcastStatus);

    const toolStart = sent.find(m => m.type === 'tool_start');
    const toolResult = sent.find(m => m.type === 'tool_result');
    assert.ok(toolStart);
    assert.ok(toolResult);
    assert.ok(result.assistantText.includes(':::trace'));
  });

  it('handles agent_message entries in turn.completed items without misclassifying tool results', () => {
    const conv = { codexSessionId: 'sess-123', messages: [], status: 'thinking', model: 'gpt-5.3-codex' };
    const event = {
      type: 'turn.completed',
      items: [
        { type: 'tool_use', id: 'tool-batch-2', name: 'command_execution', input: { command: 'ls -1' } },
        { type: 'agent_message', output: [{ type: 'output_text', text: 'Final explanation.' }] },
      ],
      usage: { input_tokens: 30, output_tokens: 15 },
    };
    processCodexEvent(fakeWs, 'conv-1', conv, event, '', onSave, broadcastStatus);

    const toolResults = sent.filter(m => m.type === 'tool_result');
    assert.equal(toolResults.length, 0);
    assert.ok(conv.messages[0].text.includes('Final explanation.'));
    assert.ok(conv.messages[0].text.includes('\n:::\n\nFinal explanation.'));
  });

  it('marks empty 0/0 resumed turn for fresh-session retry when enabled', () => {
    const conv = { codexSessionId: 'sess-123', messages: [], status: 'thinking', model: 'gpt-5.3-codex' };
    const event = {
      type: 'turn.completed',
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    processCodexEvent(
      fakeWs,
      'conv-1',
      conv,
      event,
      '',
      onSave,
      broadcastStatus,
      {
        canRetryWithCompactHistory: true,
        canRetryWithFreshSession: true,
      }
    );

    assert.equal(conv.status, 'thinking');
    assert.equal(conv.messages.length, 0);
    assert.equal(conv.codexSessionId, null);
    assert.equal(conv._retryAfterEmptyResultMode, 'fresh-session');
    assert.deepEqual(savedIds, []);
    assert.equal(sent.some(m => m.type === 'error'), false);
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

describe('handleNoOutputClose', () => {
  it('emits actionable slash-only error and marks conversation idle', () => {
    const sent = [];
    const fakeWs = {
      send(data) { sent.push(JSON.parse(data)); },
    };
    const conv = { status: 'thinking', thinkingStartTime: Date.now() };
    const statuses = [];
    const broadcastStatus = (id, status) => statuses.push({ id, status });

    const handled = handleNoOutputClose(fakeWs, 'conv-1', conv, {
      code: 0,
      providerName: 'Codex',
      broadcastStatus,
      isSlashOnlyPrompt: true,
    });

    assert.equal(handled, true);
    assert.equal(conv.status, 'idle');
    assert.equal(conv.thinkingStartTime, null);
    assert.deepEqual(statuses, [{ id: 'conv-1', status: 'idle' }]);

    const error = sent.find(m => m.type === 'error');
    assert.ok(error);
    assert.ok(error.error.includes('without producing a response'));
    assert.ok(error.error.includes('Slash-only skill/agent selections need a task'));
  });

  it('includes stderr details on non-zero exits', () => {
    const sent = [];
    const fakeWs = {
      send(data) { sent.push(JSON.parse(data)); },
    };
    const conv = { status: 'thinking', thinkingStartTime: Date.now() };

    const handled = handleNoOutputClose(fakeWs, 'conv-1', conv, {
      code: 2,
      providerName: 'Codex',
      broadcastStatus: () => {},
      stderr: 'invalid flag',
    });

    assert.equal(handled, true);
    const error = sent.find(m => m.type === 'error');
    assert.ok(error);
    assert.ok(error.error.includes('Codex process exited with code 2: invalid flag'));
  });
});
