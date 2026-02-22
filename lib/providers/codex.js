/**
 * OpenAI Codex CLI Provider
 * Implements LLM provider interface using the Codex CLI
 */

const { spawn } = require('child_process');
const path = require('path');
const { LLMProvider, safeSend } = require('./base');

// Debug logging - enabled via DEBUG_CODEX=1 environment variable
const DEBUG = process.env.DEBUG_CODEX === '1' || process.env.DEBUG_CODEX === 'true';

function debug(label, data, options = {}) {
  if (!DEBUG) return;
  const { truncate = 500, pretty = false } = options;
  let output;
  if (typeof data === 'object') {
    output = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    if (truncate && output.length > truncate) {
      output = output.slice(0, truncate) + '...';
    }
  } else {
    output = String(data);
  }
  console.error(`[CODEX ${label}]`, output);
}

const MODELS = [
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', context: 128000, inputPrice: 10, outputPrice: 30 },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', context: 128000, inputPrice: 10, outputPrice: 30 },
  { id: 'o3', name: 'o3', context: 200000, inputPrice: 15, outputPrice: 60 },
];

// Model pricing lookup (prices per million tokens)
const MODEL_PRICING = {};
for (const m of MODELS) {
  MODEL_PRICING[m.id] = { input: m.inputPrice, output: m.outputPrice };
}
const KNOWN_MODELS = new Set(MODELS.map(m => m.id));
const DEFAULT_MODEL = 'gpt-5.3-codex';

/**
 * Calculate per-message cost from token counts and model pricing
 */
function calculateMessageCost(inputTokens, outputTokens, modelId) {
  let pricing = MODEL_PRICING[modelId];
  if (!pricing) {
    // Default to GPT-5.3 pricing
    pricing = MODEL_PRICING['gpt-5.3-codex'] || { input: 10, output: 30 };
  }
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

// Active Codex processes per conversation
const activeProcesses = new Map();
const PROCESS_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function formatMemoriesForPrompt(memories) {
  const globalMemories = memories.filter(m => m.scope === 'global');
  const projectMemories = memories.filter(m => m.scope !== 'global');
  const sections = [];

  if (globalMemories.length > 0) {
    sections.push(`Global:\n${globalMemories.map(m => `- ${m.text}`).join('\n')}`);
  }
  if (projectMemories.length > 0) {
    sections.push(`Project-specific:\n${projectMemories.map(m => `- ${m.text}`).join('\n')}`);
  }
  if (sections.length === 0) return '';

  return `\n\n[User memories]\n${sections.join('\n\n')}\n[/User memories]`;
}

/**
 * Process a single JSONL event from Codex CLI
 */
function processCodexEvent(ws, conversationId, conv, event, assistantText, onSave, broadcastStatus) {
  debug('EVENT', event);

  switch (event.type) {
    case 'thread.started':
      // Capture session ID for resume
      if (event.thread_id) {
        conv.codexSessionId = event.thread_id;
        debug('SESSION', event.thread_id);
      }
      break;

    case 'turn.started':
      // Turn started - nothing to do
      break;

    case 'item.completed':
      if (event.item) {
        if (event.item.type === 'reasoning') {
          // Send reasoning/thinking events
          safeSend(ws, {
            type: 'thinking',
            conversationId,
            text: event.item.text || '',
          });
        } else if (event.item.type === 'agent_message') {
          // Append message text and stream delta
          const newText = event.item.text || '';
          assistantText += newText;
          safeSend(ws, {
            type: 'delta',
            conversationId,
            text: newText,
          });
        } else if (event.item.type === 'tool_use') {
          // Tool use event
          safeSend(ws, {
            type: 'tool_start',
            conversationId,
            tool: event.item.name || 'unknown',
            id: event.item.id,
          });
          // Add trace block for tool use
          const toolDesc = `\n\n:::trace\n\n**Using ${event.item.name || 'Tool'}**\n`;
          assistantText += toolDesc;
          safeSend(ws, { type: 'delta', conversationId, text: toolDesc });
        } else if (event.item.type === 'tool_result') {
          // Tool result
          safeSend(ws, {
            type: 'tool_result',
            conversationId,
            toolUseId: event.item.tool_use_id,
            isError: event.item.is_error || false,
          });
          // Close trace block
          const output = ':::\n\n';
          assistantText += output;
          safeSend(ws, { type: 'delta', conversationId, text: output });
        }
      }
      break;

    case 'turn.completed': {
      const usage = event.usage || {};
      const rawInputTokens = usage.input_tokens || 0;
      const cachedInputTokens =
        usage.input_tokens_details?.cached_tokens ??
        usage.input_tokens_details?.cache_read_input_tokens ??
        0;
      // For UX, show net new input tokens instead of full cached prompt tokens.
      const inputTokens = Math.max(0, rawInputTokens - cachedInputTokens);
      const displayInputTokens = conv._codexDisplayInputTokens ?? inputTokens;
      const outputTokens = usage.output_tokens || 0;
      const messageCost = calculateMessageCost(inputTokens, outputTokens, conv.model);

      conv.messages.push({
        role: 'assistant',
        text: assistantText,
        timestamp: Date.now(),
        cost: messageCost,
        duration: event.duration_ms,
        sessionId: conv.codexSessionId,
        inputTokens,
        displayInputTokens,
        outputTokens,
        rawInputTokens,
        cachedInputTokens,
      });
      conv.status = 'idle';
      conv.thinkingStartTime = null;
      onSave(conversationId);

      safeSend(ws, {
        type: 'result',
        conversationId,
        text: assistantText,
        cost: messageCost,
        duration: event.duration_ms,
        sessionId: conv.codexSessionId,
        inputTokens,
        displayInputTokens,
        outputTokens,
        rawInputTokens,
        cachedInputTokens,
      });
      delete conv._codexDisplayInputTokens;
      broadcastStatus(conversationId, 'idle');
      break;
    }

    default:
      debug('UNKNOWN_EVENT', event.type);
  }

  return { assistantText };
}

class CodexProvider extends LLMProvider {
  static id = 'codex';
  static name = 'OpenAI Codex';

  async getModels() {
    return MODELS;
  }

  async chat(ws, conversationId, conv, text, attachments, uploadDir, callbacks, memories = []) {
    const { onSave, broadcastStatus } = callbacks;

    // Build command args - flags must come before the prompt
    const args = [];
    const model = KNOWN_MODELS.has(conv.model) ? conv.model : DEFAULT_MODEL;
    const isResume = !!conv.codexSessionId;

    if (isResume) {
      // Resume existing session: codex exec resume <session_id> [flags] <prompt>
      args.push('exec', 'resume', conv.codexSessionId);
    } else {
      // New session: codex exec [flags] <prompt>
      args.push('exec');
    }

    // Add flags before the prompt
    args.push('--json');

    if (model) {
      args.push('-m', model);
    }

    // -C is not supported for "exec resume".
    if (!isResume && conv.cwd) {
      args.push('-C', conv.cwd);
    }
    // Allow Codex to run when cwd is outside a git repository.
    args.push('--skip-git-repo-check');

    if (isResume) {
      // Resume subcommand supports bypass flag, but not -s/--add-dir.
      if (conv.sandboxed === false && conv.autopilot !== false) {
        args.push('--dangerously-bypass-approvals-and-sandbox');
      }
    } else {
      // Match Claude behavior: sandbox first, then autopilot bypass only when unsandboxed.
      if (conv.sandboxed !== false) {
        args.push('-s', 'workspace-write');
      } else if (conv.autopilot !== false) {
        args.push('--dangerously-bypass-approvals-and-sandbox');
      } else {
        args.push('-s', 'workspace-write');
      }
    }

    // Image attachments
    const images = (attachments || []).filter(a => /\.(png|jpg|jpeg|gif|webp)$/i.test(a.path));
    for (const img of images) {
      args.push('-i', img.path);
    }

    // Grant access to uploads directory
    if (!isResume && attachments && attachments.length > 0) {
      args.push('--add-dir', path.join(uploadDir, conversationId));
    }

    const enabledMemories = (memories || []).filter(m => m.enabled !== false);
    const prompt = text + formatMemoriesForPrompt(enabledMemories);
    conv._codexDisplayInputTokens = text ? Math.max(1, Math.ceil(text.length / 4)) : 0;

    // Prompt must be last
    args.push(prompt);

    debug('SPAWN', { cwd: conv.cwd, args }, { truncate: 0 });

    const proc = spawn('codex', args, {
      cwd: conv.cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeProcesses.set(conversationId, proc);

    const processTimeout = setTimeout(() => {
      if (activeProcesses.has(conversationId)) {
        proc.kill('SIGTERM');
      }
    }, PROCESS_TIMEOUT);

    let buffer = '';
    let assistantText = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        const result = processCodexEvent(ws, conversationId, conv, event, assistantText, onSave, broadcastStatus);
        assistantText = result.assistantText;
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      safeSend(ws, { type: 'stderr', conversationId, text });
    });

    proc.on('close', async (code) => {
      clearTimeout(processTimeout);
      activeProcesses.delete(conversationId);

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          const result = processCodexEvent(ws, conversationId, conv, event, assistantText, onSave, broadcastStatus);
          assistantText = result.assistantText;
        } catch {
          // ignore
        }
      }

      // Handle incomplete response (no turn.completed received)
      if (assistantText && conv.status === 'thinking') {
        conv.messages.push({
          role: 'assistant',
          text: assistantText,
          timestamp: Date.now(),
          incomplete: true,
        });
        conv.status = 'idle';
        conv.thinkingStartTime = null;
        await onSave(conversationId);
        safeSend(ws, {
          type: 'result',
          conversationId,
          text: assistantText,
          incomplete: true,
        });
        broadcastStatus(conversationId, 'idle');
      }

      // Handle error exit with no output
      if (code !== 0 && !assistantText) {
        conv.status = 'idle';
        conv.thinkingStartTime = null;
        const details = stderr.trim().slice(0, 1200);
        safeSend(ws, {
          type: 'error',
          conversationId,
          error: details
            ? `Codex process exited with code ${code}: ${details}`
            : `Codex process exited with code ${code}`,
        });
        broadcastStatus(conversationId, 'idle');
      }
      delete conv._codexDisplayInputTokens;
    });

    proc.on('error', (err) => {
      clearTimeout(processTimeout);
      activeProcesses.delete(conversationId);
      conv.status = 'idle';
      conv.thinkingStartTime = null;
      safeSend(ws, {
        type: 'error',
        conversationId,
        error: `Failed to spawn codex: ${err.message}`,
      });
      broadcastStatus(conversationId, 'idle');
      delete conv._codexDisplayInputTokens;
    });
  }

  cancel(conversationId) {
    const proc = activeProcesses.get(conversationId);
    if (proc) {
      proc.kill('SIGTERM');
      return true;
    }
    return false;
  }

  isActive(conversationId) {
    return activeProcesses.has(conversationId);
  }

  async generateSummary(messages, model = 'gpt-5.3-codex', cwd = process.env.HOME) {
    const conversationText = messages.map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      let text = m.text || '';
      if (text.length > 2000) {
        text = text.slice(0, 2000) + '\n[... truncated ...]';
      }
      return `[${role}]: ${text}`;
    }).join('\n\n');

    const prompt = `You are compressing a conversation history to preserve context while reducing token usage.

Summarize the following conversation in approximately 2000-3000 tokens. Preserve:
1. Key decisions and conclusions reached
2. Important code snippets, file paths, and technical details discussed
3. Current state of any ongoing tasks
4. Action items or commitments made
5. User preferences or requirements stated

Format as a clear summary that could be used to continue the conversation naturally.

---
CONVERSATION TO SUMMARIZE:
${conversationText}
---

Write your summary:`;

    return new Promise((resolve, reject) => {
      const proc = spawn('codex', [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '-m', model,
        prompt,
      ], {
        cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buffer = '';
      let output = '';
      let stderr = '';

      proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
              output += event.item.text || '';
            }
          } catch {
            // ignore
          }
        }
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('Summary generation timed out'));
      }, 120000);

      proc.on('close', (code) => {
        clearTimeout(timeout);

        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer);
            if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
              output += event.item.text || '';
            }
          } catch {
            // ignore
          }
        }

        if (code === 0 && output.trim()) {
          resolve(output.trim());
        } else {
          reject(new Error(`Summary generation failed (code ${code}): ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
}

// Export the class and utilities for testing
module.exports = CodexProvider;
module.exports.MODELS = MODELS;
module.exports.activeProcesses = activeProcesses;
module.exports.processCodexEvent = processCodexEvent;
