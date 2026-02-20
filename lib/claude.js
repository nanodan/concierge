/**
 * Claude module - backwards compatibility wrapper
 *
 * This module re-exports from the provider system for backwards compatibility.
 * New code should use lib/providers directly.
 */

const ClaudeProvider = require('./providers/claude');
const { getProvider } = require('./providers');

// Create a singleton instance for backwards compatibility
const claudeProvider = new ClaudeProvider();

// Re-export models and utilities from the provider
const { MODELS, activeProcesses, processStreamEvent } = ClaudeProvider;
const PROCESS_TIMEOUT = 5 * 60 * 1000;

// Backwards-compatible wrapper for spawnClaude
function spawnClaude(ws, conversationId, conv, text, attachments, uploadDir, callbacks, memories = []) {
  return claudeProvider.chat(ws, conversationId, conv, text, attachments, uploadDir, callbacks, memories);
}

function cancelProcess(conversationId) {
  return claudeProvider.cancel(conversationId);
}

function hasActiveProcess(conversationId) {
  return claudeProvider.isActive(conversationId);
}

function generateSummary(messages, model = 'sonnet', cwd = process.env.HOME) {
  return claudeProvider.generateSummary(messages, model, cwd);
}

module.exports = {
  MODELS,
  activeProcesses,
  PROCESS_TIMEOUT,
  spawnClaude,
  processStreamEvent,
  cancelProcess,
  hasActiveProcess,
  generateSummary,
};
