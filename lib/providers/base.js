/**
 * Base LLM Provider class
 * Defines the interface that all providers must implement
 */

const WebSocket = require('ws');

/**
 * Safe WebSocket send - checks connection state before sending
 */
function safeSend(ws, data) {
  if (!ws || !ws.send) return false;
  if (ws.readyState !== undefined && ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  ws.send(JSON.stringify(data));
  return true;
}

class LLMProvider {
  /**
   * Provider ID (e.g., 'claude', 'ollama')
   * @type {string}
   */
  static id = 'base';

  /**
   * Display name for the provider
   * @type {string}
   */
  static name = 'Base Provider';

  /**
   * Get available models for this provider
   * @returns {Promise<Array<{id: string, name: string, context?: number}>>}
   */
  async getModels() {
    throw new Error('getModels() must be implemented by provider');
  }

  /**
   * Send a message and stream the response
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} conversationId - Conversation ID
   * @param {Object} conv - Conversation object with messages, model, cwd, etc.
   * @param {string} text - User message text
   * @param {Array} attachments - File attachments
   * @param {string} uploadDir - Upload directory path
   * @param {Object} callbacks - Callback functions { onSave, broadcastStatus }
   * @param {Array} memories - Active memories to inject
   */
  async chat(ws, conversationId, conv, text, attachments, uploadDir, callbacks, memories = []) {
    throw new Error('chat() must be implemented by provider');
  }

  /**
   * Cancel an in-progress generation
   * @param {string} conversationId - Conversation ID
   * @returns {boolean} - Whether cancellation was successful
   */
  cancel(conversationId) {
    return false;
  }

  /**
   * Check if a generation is currently active
   * @param {string} conversationId - Conversation ID
   * @returns {boolean}
   */
  isActive(conversationId) {
    return false;
  }

  /**
   * Generate a summary of messages (for compression)
   * @param {Array} messages - Messages to summarize
   * @param {string} model - Model to use
   * @param {string} cwd - Working directory
   * @returns {Promise<string>} - Summary text
   */
  async generateSummary(messages, model, cwd) {
    throw new Error('generateSummary() must be implemented by provider');
  }
}

module.exports = {
  LLMProvider,
  safeSend,
};
