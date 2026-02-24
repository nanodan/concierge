const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  EXECUTION_MODES,
  normalizeExecutionMode,
  inferExecutionModeFromLegacyAutopilot,
  resolveConversationExecutionMode,
  modeToLegacyAutopilot,
  applyExecutionMode,
  modeAllowsWrites,
} = require('../lib/workflow/execution-mode');

describe('workflow execution mode', () => {
  it('normalizes valid modes and falls back to patch', () => {
    assert.equal(normalizeExecutionMode('AUTONOMOUS'), 'autonomous');
    assert.equal(normalizeExecutionMode('patch'), 'patch');
    assert.equal(normalizeExecutionMode(''), 'patch');
    assert.equal(normalizeExecutionMode('invalid'), 'patch');
  });

  it('maps legacy autopilot to execution mode', () => {
    assert.equal(inferExecutionModeFromLegacyAutopilot(true), EXECUTION_MODES.AUTONOMOUS);
    assert.equal(inferExecutionModeFromLegacyAutopilot(false), EXECUTION_MODES.DISCUSS);
    assert.equal(inferExecutionModeFromLegacyAutopilot(undefined), EXECUTION_MODES.AUTONOMOUS);
  });

  it('resolves mode from conversation with legacy fallback', () => {
    assert.equal(resolveConversationExecutionMode({ executionMode: 'patch' }), 'patch');
    assert.equal(resolveConversationExecutionMode({ autopilot: false }), 'discuss');
    assert.equal(resolveConversationExecutionMode({ autopilot: true }), 'autonomous');
    assert.equal(resolveConversationExecutionMode({}), 'patch');
  });

  it('keeps legacy autopilot semantics in sync', () => {
    assert.equal(modeToLegacyAutopilot('autonomous'), true);
    assert.equal(modeToLegacyAutopilot('patch'), true);
    assert.equal(modeToLegacyAutopilot('discuss'), false);
  });

  it('applies mode to conversation object', () => {
    const conv = { autopilot: true };
    applyExecutionMode(conv, 'discuss');
    assert.equal(conv.executionMode, 'discuss');
    assert.equal(conv.autopilot, false);

    applyExecutionMode(conv, 'patch');
    assert.equal(conv.executionMode, 'patch');
    assert.equal(conv.autopilot, true);
  });

  it('allows writes only in autonomous mode', () => {
    assert.equal(modeAllowsWrites('autonomous'), true);
    assert.equal(modeAllowsWrites('patch'), false);
    assert.equal(modeAllowsWrites('discuss'), false);
  });
});
