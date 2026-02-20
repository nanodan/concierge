/**
 * Ollama Provider
 * Implements LLM provider interface using the Ollama HTTP API
 */

const { LLMProvider, safeSend } = require('./base');

// Ollama host from environment variable or default
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

// Active requests per conversation (for cancellation)
const activeRequests = new Map();

// Default models if Ollama is not available
const DEFAULT_MODELS = [
  { id: 'llama3.2', name: 'Llama 3.2', context: 128000 },
  { id: 'llama3.1', name: 'Llama 3.1', context: 128000 },
  { id: 'mistral', name: 'Mistral', context: 32000 },
  { id: 'codellama', name: 'Code Llama', context: 16000 },
  { id: 'gemma2', name: 'Gemma 2', context: 8192 },
];

class OllamaProvider extends LLMProvider {
  static id = 'ollama';
  static name = 'Ollama';

  /**
   * Get available models from Ollama
   */
  async getModels() {
    try {
      const response = await fetch(`${OLLAMA_HOST}/api/tags`);
      if (!response.ok) {
        console.error(`[OLLAMA] Failed to fetch models: ${response.status}`);
        return DEFAULT_MODELS;
      }
      const data = await response.json();
      if (!data.models || data.models.length === 0) {
        return DEFAULT_MODELS;
      }
      return data.models.map(m => ({
        id: m.name,
        name: m.name.split(':')[0], // Remove tag for display
        context: m.details?.parameter_size ? this._estimateContext(m.details.parameter_size) : 4096,
        size: m.size,
        modified_at: m.modified_at,
      }));
    } catch (err) {
      console.error(`[OLLAMA] Error fetching models: ${err.message}`);
      return DEFAULT_MODELS;
    }
  }

  /**
   * Estimate context window based on model size (rough heuristic)
   */
  _estimateContext(paramSize) {
    if (!paramSize) return 4096;
    const sizeStr = paramSize.toLowerCase();
    if (sizeStr.includes('70b') || sizeStr.includes('65b')) return 32000;
    if (sizeStr.includes('34b') || sizeStr.includes('30b')) return 16000;
    if (sizeStr.includes('13b') || sizeStr.includes('14b')) return 8192;
    if (sizeStr.includes('7b') || sizeStr.includes('8b')) return 8192;
    return 4096;
  }

  /**
   * Build messages array from conversation history
   * Ollama is stateless, so we need to send full history each time
   */
  _buildMessages(conv, text, memories = []) {
    const messages = [];

    // Add system message with memories if any
    let systemPrompt = 'You are a helpful assistant.';
    if (memories && memories.length > 0) {
      const enabledMemories = memories.filter(m => m.enabled !== false);
      if (enabledMemories.length > 0) {
        const globalMems = enabledMemories.filter(m => m.scope === 'global');
        const projectMems = enabledMemories.filter(m => m.scope !== 'global');
        systemPrompt += '\n\n# User Memories\nThese are things the user has asked you to remember:\n';
        if (globalMems.length > 0) {
          systemPrompt += '\n## Global\n' + globalMems.map(m => `- ${m.text}`).join('\n');
        }
        if (projectMems.length > 0) {
          systemPrompt += '\n## Project-specific\n' + projectMems.map(m => `- ${m.text}`).join('\n');
        }
      }
    }

    // Check for compression summary
    const summaryMsg = conv.messages && conv.messages.find(m => m.role === 'system' && m.compressionMeta);
    if (summaryMsg) {
      systemPrompt += `\n\n[COMPRESSED CONVERSATION CONTEXT]
The following is a summary of earlier messages:
${summaryMsg.text}
[END COMPRESSED CONTEXT]`;
    }

    messages.push({ role: 'system', content: systemPrompt });

    // Add conversation history (skip system/compressed messages)
    if (conv.messages) {
      for (const m of conv.messages) {
        if (m.role === 'system') continue;
        if (m.summarized) continue; // Skip compressed messages
        messages.push({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.text || '',
        });
      }
    }

    // Add current message
    messages.push({ role: 'user', content: text });

    return messages;
  }

  /**
   * Send a message and stream the response
   */
  async chat(ws, conversationId, conv, text, attachments, uploadDir, callbacks, memories = []) {
    const { onSave, broadcastStatus } = callbacks;

    // Note: Ollama doesn't support file attachments natively
    // We could read file contents and append to the message, but skip for now
    if (attachments && attachments.length > 0) {
      safeSend(ws, {
        type: 'error',
        conversationId,
        error: 'Ollama does not support file attachments. Please use Claude for file-based conversations.',
      });
      conv.status = 'idle';
      conv.thinkingStartTime = null;
      broadcastStatus(conversationId, 'idle');
      return;
    }

    const messages = this._buildMessages(conv, text, memories);
    const model = conv.model || 'llama3.2';

    // Create AbortController for cancellation
    const controller = new AbortController();
    activeRequests.set(conversationId, controller);

    try {
      const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      let assistantText = '';
      const startTime = Date.now();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);

            // Stream text delta
            if (json.message && json.message.content) {
              assistantText += json.message.content;
              safeSend(ws, {
                type: 'delta',
                conversationId,
                text: json.message.content,
              });
            }

            // Done - send result
            if (json.done) {
              const duration = Date.now() - startTime;

              conv.messages.push({
                role: 'assistant',
                text: assistantText,
                timestamp: Date.now(),
                cost: 0, // Ollama is free/local
                duration,
                inputTokens: json.prompt_eval_count || 0,
                outputTokens: json.eval_count || 0,
              });
              conv.status = 'idle';
              conv.thinkingStartTime = null;
              await onSave(conversationId);

              safeSend(ws, {
                type: 'result',
                conversationId,
                text: assistantText,
                cost: 0,
                duration,
                inputTokens: json.prompt_eval_count || 0,
                outputTokens: json.eval_count || 0,
              });
              broadcastStatus(conversationId, 'idle');
            }
          } catch {
            // Ignore JSON parse errors for incomplete chunks
          }
        }
      }
    } catch (err) {
      activeRequests.delete(conversationId);

      if (err.name === 'AbortError') {
        // Cancelled by user - don't show error
        conv.status = 'idle';
        conv.thinkingStartTime = null;
        broadcastStatus(conversationId, 'idle');
        return;
      }

      console.error(`[OLLAMA] Chat error: ${err.message}`);
      conv.status = 'idle';
      conv.thinkingStartTime = null;

      // Provide helpful error message
      let errorMessage = err.message;
      if (err.message.includes('ECONNREFUSED')) {
        errorMessage = `Cannot connect to Ollama at ${OLLAMA_HOST}. Is Ollama running? Try: ollama serve`;
      }

      safeSend(ws, {
        type: 'error',
        conversationId,
        error: errorMessage,
      });
      broadcastStatus(conversationId, 'idle');
    } finally {
      activeRequests.delete(conversationId);
    }
  }

  cancel(conversationId) {
    const controller = activeRequests.get(conversationId);
    if (controller) {
      controller.abort();
      activeRequests.delete(conversationId);
      return true;
    }
    return false;
  }

  isActive(conversationId) {
    return activeRequests.has(conversationId);
  }

  async generateSummary(messages, model = 'llama3.2', cwd = process.env.HOME) {
    const conversationText = messages.map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      let text = m.text || '';
      if (text.length > 2000) {
        text = text.slice(0, 2000) + '\n[... truncated ...]';
      }
      return `[${role}]: ${text}`;
    }).join('\n\n');

    const prompt = `You are compressing a conversation history to preserve context while reducing token usage.

Summarize the following conversation in approximately 500-1000 words. Preserve:
1. Key decisions and conclusions reached
2. Important technical details discussed
3. Current state of any ongoing tasks
4. User preferences or requirements stated

Format as a clear summary that could be used to continue the conversation naturally.

---
CONVERSATION TO SUMMARIZE:
${conversationText}
---

Write your summary:`;

    try {
      const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      return data.response || '';
    } catch (err) {
      throw new Error(`Failed to generate summary: ${err.message}`);
    }
  }
}

module.exports = OllamaProvider;
module.exports.OLLAMA_HOST = OLLAMA_HOST;
