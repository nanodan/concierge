/**
 * Claude CLI Provider
 * Implements LLM provider interface using the Claude CLI
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { LLMProvider, safeSend } = require('./base');
const { embedConversation, hasEmbedding } = require('../embeddings');
const { resolveConversationExecutionMode, modeAllowsWrites } = require('../workflow/execution-mode');

const MEMORY_PROMPT_FILE = path.join(__dirname, '..', 'memory-prompt.txt');

// Debug logging - enabled via DEBUG_CLAUDE=1 environment variable
const DEBUG = process.env.DEBUG_CLAUDE === '1' || process.env.DEBUG_CLAUDE === 'true';

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
  console.error(`[CLAUDE ${label}]`, output);
}

// Format memories into a system prompt section
function formatMemoriesForPrompt(memories) {
  const globalMemories = memories.filter(m => m.scope === 'global');
  const projectMemories = memories.filter(m => m.scope !== 'global');

  // Load template from file
  let template;
  try {
    template = fs.readFileSync(MEMORY_PROMPT_FILE, 'utf8');
  } catch {
    // Fallback if file doesn't exist
    template = '# User Memories\n\n{{GLOBAL_MEMORIES}}\n{{PROJECT_MEMORIES}}';
  }

  // Format memory sections
  let globalSection = '';
  if (globalMemories.length > 0) {
    globalSection = '## Global\n' + globalMemories.map(m => `- ${m.text}`).join('\n');
  }

  let projectSection = '';
  if (projectMemories.length > 0) {
    projectSection = '## Project-specific\n' + projectMemories.map(m => `- ${m.text}`).join('\n');
  }

  // Replace placeholders
  let text = template
    .replace('{{GLOBAL_MEMORIES}}', globalSection)
    .replace('{{PROJECT_MEMORIES}}', projectSection);

  // Clean up empty lines from missing sections
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return '\n' + text;
}

const MODELS = [
  { id: 'claude-sonnet-4.5', name: 'Sonnet 4.5', context: 200000, inputPrice: 3, outputPrice: 15 },
  { id: 'claude-opus-4.6', name: 'Opus 4.6', context: 200000, inputPrice: 15, outputPrice: 75 },
  { id: 'claude-opus-4.5', name: 'Opus 4.5', context: 200000, inputPrice: 15, outputPrice: 75 },
  { id: 'claude-haiku-4.5', name: 'Haiku 4.5', context: 200000, inputPrice: 1.5, outputPrice: 7.5 },
];

// Model pricing lookup (prices per million tokens)
const MODEL_PRICING = {};
for (const m of MODELS) {
  MODEL_PRICING[m.id] = { input: m.inputPrice, output: m.outputPrice };
}

/**
 * Combine two strings, detecting and removing overlap.
 */
function combineWithOverlap(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;

  const maxOverlap = Math.min(a.length, b.length);
  for (let len = maxOverlap; len > 0; len--) {
    if (a.slice(-len) === b.slice(0, len)) {
      return a + b.slice(len);
    }
  }

  return a + '\n\n' + b;
}

/**
 * Calculate per-message cost from token counts and model pricing
 */
function calculateMessageCost(inputTokens, outputTokens, modelId) {
  let pricing = MODEL_PRICING[modelId];
  if (!pricing) {
    const shorthand = modelId ? modelId.toLowerCase() : '';
    const matchingKey = Object.keys(MODEL_PRICING).find(k => k.includes(shorthand));
    pricing = matchingKey ? MODEL_PRICING[matchingKey] : MODEL_PRICING['claude-sonnet-4.5'];
  }
  if (!pricing) {
    pricing = { input: 3, output: 15 };
  }
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

// Active Claude processes per conversation
const activeProcesses = new Map();
const PROCESS_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const TOOL_RESULT_MAX_LENGTH = 500;
const RETRY_INLINE_HISTORY_CHAR_BUDGET = 24_000;

function handleNoOutputClose(
  ws,
  conversationId,
  conv,
  {
    code,
    providerName,
    broadcastStatus,
    stderr = '',
    isSlashOnlyPrompt = false,
  }
) {
  if (conv.status !== 'thinking') return false;

  conv.status = 'idle';
  conv.thinkingStartTime = null;

  const trimmedStderr = String(stderr || '').trim();
  const details = trimmedStderr ? `: ${trimmedStderr.slice(0, 1200)}` : '';
  let error = code === 0
    ? `${providerName} process exited without producing a response`
    : `${providerName} process exited with code ${code}${details}`;

  if (isSlashOnlyPrompt) {
    error += '. Slash-only skill/agent selections need a task. Example: `/code-quality-reviewer review my latest changes`.';
  }

  safeSend(ws, {
    type: 'error',
    conversationId,
    error,
  });
  broadcastStatus(conversationId, 'idle');
  return true;
}

/**
 * Send a tool_start event to the WebSocket client
 */
function sendToolStart(ws, conversationId, toolName, toolId) {
  safeSend(ws, {
    type: 'tool_start',
    conversationId,
    tool: toolName,
    id: toolId,
  });
}

function buildInlineHistoryContext(messages = [], latestUserText = '', options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const maxChars = Number.isFinite(Number(options.maxChars)) && Number(options.maxChars) > 0
    ? Number(options.maxChars)
    : null;

  const priorMessages = messages.slice();
  const last = priorMessages[priorMessages.length - 1];
  if (last?.role === 'user' && String(last.text || '') === String(latestUserText || '')) {
    priorMessages.pop();
  }

  const chunks = [];
  let totalChars = 0;
  for (let i = priorMessages.length - 1; i >= 0; i--) {
    const msg = priorMessages[i];
    const text = String(msg?.text || '').trim();
    if (!text) continue;

    const role = msg.role === 'assistant'
      ? 'Assistant'
      : (msg.role === 'system' ? 'System' : 'User');
    const chunk = `[${role}]\n${text}`;
    if (maxChars && totalChars + chunk.length > maxChars) break;
    chunks.push(chunk);
    totalChars += chunk.length;
  }

  if (chunks.length === 0) return '';
  chunks.reverse();
  return `[Conversation history]\n${chunks.join('\n\n')}\n[/Conversation history]`;
}

function isContextOverflowError(value) {
  const text = String(value || '').toLowerCase();
  return /(context|token|prompt|request).*(limit|length|size|large|long|exceed|overflow)|e2big/.test(text);
}

/**
 * Handle stream_event type
 */
function handleStreamEvent(ws, conversationId, conv, event, assistantText) {
  const inner = event.event;

  if (inner.type === 'content_block_delta' && inner.delta && inner.delta.type === 'text_delta') {
    assistantText += inner.delta.text;
    safeSend(ws, { type: 'delta', conversationId, text: inner.delta.text });
  }

  if (inner.type === 'content_block_delta' && inner.delta && inner.delta.type === 'thinking_delta') {
    safeSend(ws, { type: 'thinking', conversationId, text: inner.delta.thinking });
  }

  if (inner.type === 'content_block_start' && inner.content_block) {
    const block = inner.content_block;
    if (block.type === 'tool_use') {
      sendToolStart(ws, conversationId, block.name, block.id);
    }
  }

  if (event.session_id && !conv.claudeSessionId) {
    conv.claudeSessionId = event.session_id;
  }

  return assistantText;
}

function handleContentBlockStart(ws, conversationId, event) {
  const block = event.content_block;
  if (block.type === 'tool_use') {
    sendToolStart(ws, conversationId, block.name, block.id);
  }
}

function handleSystemEvent(ws, conversationId, conv, event) {
  if (event.subtype === 'tool_use') {
    sendToolStart(ws, conversationId, event.tool || 'unknown');
  } else if (event.subtype === 'init') {
    if (event.session_id && !conv.claudeSessionId) {
      conv.claudeSessionId = event.session_id;
    }
  }
}

function formatToolDescription(toolName, input) {
  let toolDesc = `\n\n**Using ${toolName}**`;
  if (input) {
    if (input.command) {
      toolDesc += `: \`${input.command}\``;
    } else if (input.file_path) {
      toolDesc += `: \`${input.file_path}\``;
    } else if (input.pattern) {
      toolDesc += `: \`${input.pattern}\``;
    }
  }
  toolDesc += '\n';
  return toolDesc;
}

function handleAssistantEvent(ws, conversationId, conv, event, assistantText) {
  if (event.session_id && !conv.claudeSessionId) {
    conv.claudeSessionId = event.session_id;
  }

  if (!event.message || !event.message.content) {
    return assistantText;
  }

  for (const block of event.message.content) {
    if (block.type === 'text' && block.text) {
      if (block.text.startsWith(assistantText)) {
        const newText = block.text.slice(assistantText.length);
        if (newText) {
          safeSend(ws, { type: 'delta', conversationId, text: newText });
        }
        assistantText = block.text;
      } else if (!assistantText.endsWith(block.text)) {
        safeSend(ws, { type: 'delta', conversationId, text: block.text });
        assistantText += block.text;
      }
    }
    if (block.type === 'tool_use' && block.name) {
      sendToolStart(ws, conversationId, block.name, block.id);
      const toolDesc = formatToolDescription(block.name, block.input);
      const traceStart = '\n\n:::trace\n' + toolDesc;
      safeSend(ws, { type: 'delta', conversationId, text: traceStart });
      assistantText += traceStart;
    }
  }

  return assistantText;
}

function handleUserEvent(ws, conversationId, event, assistantText) {
  for (const block of event.message.content) {
    if (block.type !== 'tool_result') continue;

    safeSend(ws, {
      type: 'tool_result',
      conversationId,
      toolUseId: block.tool_use_id,
      isError: block.is_error || false,
    });

    let resultText = '';
    if (typeof block.content === 'string') {
      resultText = block.content;
    } else if (event.tool_use_result && event.tool_use_result.stdout) {
      resultText = event.tool_use_result.stdout;
    }

    let output = '';
    if (resultText) {
      const truncated = resultText.length > TOOL_RESULT_MAX_LENGTH
        ? resultText.slice(0, TOOL_RESULT_MAX_LENGTH) + '...\n(truncated)'
        : resultText;
      output = block.is_error
        ? `\n\`\`\`\nError: ${truncated}\n\`\`\`\n`
        : `\n\`\`\`\n${truncated}\n\`\`\`\n`;
    }
    output += ':::\n\n';

    assistantText += output;
    safeSend(ws, { type: 'delta', conversationId, text: output });
  }

  return assistantText;
}

function handleResultEvent(
  ws,
  conversationId,
  conv,
  event,
  assistantText,
  onSave,
  broadcastStatus,
  options = {}
) {
  const {
    canRetryWithCompactHistory = false,
    canRetryWithFreshSession = false,
  } = options;
  const resultText = combineWithOverlap(assistantText, event.result || '');

  if (event.session_id) {
    conv.claudeSessionId = event.session_id;
  }

  const inputTokens = event.total_input_tokens ?? event.input_tokens ?? event.usage?.input_tokens ?? 0;
  const outputTokens = event.total_output_tokens ?? event.output_tokens ?? event.usage?.output_tokens ?? 0;
  if (!resultText.trim() && inputTokens === 0 && outputTokens === 0) {
    if (canRetryWithFreshSession) {
      // Resumed sessions can occasionally become invalid and return empty 0/0.
      // Retry once with a fresh session before surfacing an error.
      conv.claudeSessionId = null;
      conv._retryAfterEmptyResultMode = 'fresh-session';
      return;
    }
    if (canRetryWithCompactHistory) {
      // Empty 0/0 result can happen when the full inline history is too large.
      // Defer error handling to close handler so we can retry once with compact history.
      if (event.session_id && conv.claudeSessionId === event.session_id) {
        conv.claudeSessionId = null;
      }
      conv._retryAfterEmptyResultMode = 'compact-history';
      return;
    }
    conv.status = 'idle';
    conv.thinkingStartTime = null;
    onSave(conversationId);
    safeSend(ws, {
      type: 'error',
      conversationId,
      error: 'Model returned an empty response. Please retry.',
    });
    broadcastStatus(conversationId, 'idle');
    return;
  }
  const messageCost = calculateMessageCost(inputTokens, outputTokens, conv.model || 'sonnet');

  conv.messages.push({
    role: 'assistant',
    text: resultText,
    timestamp: Date.now(),
    cost: messageCost,
    duration: event.duration_ms,
    sessionId: event.session_id,
    inputTokens,
    outputTokens,
  });
  conv.status = 'idle';
  conv.thinkingStartTime = null;
  onSave(conversationId);

  if (!hasEmbedding(conversationId) || conv.messages.length <= 2) {
    embedConversation(conv).catch(err => {
      console.error(`[EMBED] Failed to embed conversation ${conversationId}:`, err.message);
    });
  }

  safeSend(ws, {
    type: 'result',
    conversationId,
    text: resultText,
    cost: messageCost,
    duration: event.duration_ms,
    sessionId: event.session_id,
    inputTokens,
    outputTokens,
  });
  broadcastStatus(conversationId, 'idle');
}

function processStreamEvent(
  ws,
  conversationId,
  conv,
  event,
  assistantText,
  onSave,
  broadcastStatus,
  options = {}
) {
  debug('EVENT', event);

  if (event.type === 'result') {
    debug('RESULT_KEYS', Object.keys(event));
    debug('RESULT', event, { pretty: true, truncate: 0 });
  }

  switch (event.type) {
    case 'stream_event':
      if (event.event) {
        assistantText = handleStreamEvent(ws, conversationId, conv, event, assistantText);
      }
      break;
    case 'content_block_start':
      if (event.content_block) {
        handleContentBlockStart(ws, conversationId, event);
      }
      break;
    case 'system':
      handleSystemEvent(ws, conversationId, conv, event);
      break;
    case 'assistant':
      assistantText = handleAssistantEvent(ws, conversationId, conv, event, assistantText);
      break;
    case 'user':
      if (event.message && event.message.content) {
        assistantText = handleUserEvent(ws, conversationId, event, assistantText);
      }
      break;
    case 'result':
      handleResultEvent(
        ws,
        conversationId,
        conv,
        event,
        assistantText,
        onSave,
        broadcastStatus,
        options
      );
      break;
  }

  return { assistantText };
}

class ClaudeProvider extends LLMProvider {
  static id = 'claude';
  static name = 'Claude';

  async getModels() {
    return MODELS;
  }

  async chat(ws, conversationId, conv, text, attachments, uploadDir, callbacks, memories = [], runtime = {}) {
    const { onSave, broadcastStatus } = callbacks;
    const isSlashOnlyPrompt = typeof text === 'string' && /^\/\S+\s*$/.test(text.trim());
    const executionMode = resolveConversationExecutionMode(conv);
    const allowWrites = modeAllowsWrites(executionMode);
    const inlineHistoryMode = runtime.inlineHistoryMode === 'compact' ? 'compact' : 'full';
    const hadSessionAtStart = !!conv.claudeSessionId;
    delete conv._retryAfterEmptyResultMode;
    const inlineHistory = conv.claudeSessionId
      ? ''
      : buildInlineHistoryContext(
          conv.messages,
          text,
          inlineHistoryMode === 'compact' ? { maxChars: RETRY_INLINE_HISTORY_CHAR_BUDGET } : {}
        );
    const canRetryWithCompactHistory = !conv.claudeSessionId
      && inlineHistoryMode === 'full'
      && !!inlineHistory
      && runtime.retried !== true;
    const canRetryWithFreshSession = hadSessionAtStart && runtime.retried !== true;
    const promptText = inlineHistory
      ? `${inlineHistory}\n\n[New user message]\n${text}`
      : text;

    const args = [
      '-p', promptText,
      '--output-format', 'stream-json',
      '--verbose',
      '--model', conv.model || 'sonnet',
      '--include-partial-messages',
    ];

    // Inject memories via --append-system-prompt
    if (memories && memories.length > 0) {
      const enabledMemories = memories.filter(m => m.enabled !== false);
      if (enabledMemories.length > 0) {
        const memoryText = formatMemoriesForPrompt(enabledMemories);
        args.push('--append-system-prompt', memoryText);
      }
    }

    // Handle permissions based on sandbox and execution mode.
    if (conv.sandboxed !== false || !allowWrites) {
      const allow = allowWrites ? [
        // Use / prefix since cwd already starts with / (// = absolute path)
        `Edit(/${conv.cwd}/**)`,
        `Write(/${conv.cwd}/**)`,
      ] : [];
      const sandboxSettings = {
        sandbox: {
          enabled: true,
          autoAllowBashIfSandboxed: true,
          allowUnsandboxedCommands: false,
          network: {
            allowedDomains: ['github.com', '*.npmjs.org', 'registry.yarnpkg.com', 'api.github.com']
          }
        },
        permissions: {
          allow,
          deny: [
            'Read(**/.env)',
            'Read(**/.env.*)',
            'Read(**/credentials.json)',
            'Read(~/.ssh/**)',
            'Read(~/.aws/**)',
            'Read(~/.config/**)',
          ]
        }
      };
      args.push('--settings', JSON.stringify(sandboxSettings));

      if (conv.cwd) {
        args.push('--add-dir', conv.cwd);
      }
    } else if (conv.autopilot !== false && allowWrites) {
      args.push('--dangerously-skip-permissions');
    }

    if (conv.claudeSessionId) {
      args.push('--resume', conv.claudeSessionId);
    } else {
      const summaryMsg = !inlineHistory && conv.messages && conv.messages.find(m => m.role === 'system' && m.compressionMeta);
      if (summaryMsg) {
        const summaryText = `[COMPRESSED CONVERSATION CONTEXT]
The following is a summary of earlier messages in this conversation that have been compressed to save context space:

${summaryMsg.text}

[END COMPRESSED CONTEXT]

Please continue the conversation naturally, using the above context as background information.`;
        args.push('--append-system-prompt', summaryText);
      }
    }

    // Grant access to uploads directory
    if (attachments && attachments.length > 0) {
      args.push('--add-dir', path.join(uploadDir, conversationId));
    }

    // Append attachment file paths to the prompt
    if (attachments && attachments.length > 0) {
      const imageAtts = attachments.filter(a => a.path && /\.(png|jpg|jpeg|gif|webp)$/i.test(a.path));
      const fileAtts = attachments.filter(a => a.path && !/\.(png|jpg|jpeg|gif|webp)$/i.test(a.path));
      if (imageAtts.length > 0) {
        const paths = imageAtts.map(a => a.path).join('\n');
        args[1] += `\n\n[Attached image${imageAtts.length > 1 ? 's' : ''} — view by reading ${imageAtts.length > 1 ? 'these files' : 'this file'}:]\n${paths}`;
      }
      if (fileAtts.length > 0) {
        const paths = fileAtts.map(a => a.path).join('\n');
        args[1] += `\n\n[Attached file${fileAtts.length > 1 ? 's' : ''} — read for context:]\n${paths}`;
      }
    }

    // Debug sandbox settings
    debug('SPAWN', {
      cwd: conv.cwd,
      sandboxed: conv.sandboxed,
      autopilot: conv.autopilot,
      executionMode,
      hasSessionId: !!conv.claudeSessionId,
      args: args,
    }, { truncate: 0 });

    const proc = spawn('claude', args, {
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
    let retryScheduled = false;

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
        const result = processStreamEvent(
          ws,
          conversationId,
          conv,
          event,
          assistantText,
          onSave,
          broadcastStatus,
          {
            canRetryWithCompactHistory,
            canRetryWithFreshSession,
          }
        );
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
      if (retryScheduled) return;

      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          const result = processStreamEvent(
            ws,
            conversationId,
            conv,
            event,
            assistantText,
            onSave,
            broadcastStatus,
            {
              canRetryWithCompactHistory,
              canRetryWithFreshSession,
            }
          );
          assistantText = result.assistantText;
        } catch {
          // ignore
        }
      }

      const retryMode = conv._retryAfterEmptyResultMode;
      if (
        !assistantText
        && conv.status === 'thinking'
        && runtime.retried !== true
        && (
          retryMode === 'fresh-session'
          || retryMode === 'compact-history'
          || (canRetryWithCompactHistory && isContextOverflowError(stderr))
        )
      ) {
        retryScheduled = true;
        delete conv._retryAfterEmptyResultMode;
        void this.chat(ws, conversationId, conv, text, attachments, uploadDir, callbacks, memories, {
          ...runtime,
          retried: true,
          inlineHistoryMode: retryMode === 'compact-history' ? 'compact' : 'full',
        });
        return;
      }

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

      handleNoOutputClose(ws, conversationId, conv, {
        code,
        providerName: 'Claude',
        broadcastStatus,
        stderr,
        isSlashOnlyPrompt,
      });
      delete conv._retryAfterEmptyResultMode;
    });

    proc.on('error', (err) => {
      clearTimeout(processTimeout);
      activeProcesses.delete(conversationId);

      if (!retryScheduled && conv.status === 'thinking' && canRetryWithCompactHistory && isContextOverflowError(err?.message || err?.code)) {
        retryScheduled = true;
        void this.chat(ws, conversationId, conv, text, attachments, uploadDir, callbacks, memories, {
          ...runtime,
          retried: true,
          inlineHistoryMode: 'compact',
        });
        return;
      }

      conv.status = 'idle';
      conv.thinkingStartTime = null;
      safeSend(ws, {
        type: 'error',
        conversationId,
        error: `Failed to spawn claude: ${err.message}`,
      });
      broadcastStatus(conversationId, 'idle');
      delete conv._retryAfterEmptyResultMode;
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

  async generateSummary(messages, model = 'sonnet', cwd = process.env.HOME) {
    const conversationText = messages.map(m => {
      const role = m.role === 'user' ? 'User' : 'Claude';
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
      const proc = spawn('claude', [
        '-p', prompt,
        '--model', model,
        '--output-format', 'text',
      ], {
        cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      let stderr = '';

      proc.stdout.on('data', (chunk) => {
        output += chunk.toString();
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

// Export both the class and some utilities for backwards compatibility
module.exports = ClaudeProvider;
module.exports.MODELS = MODELS;
module.exports.activeProcesses = activeProcesses;
module.exports.processStreamEvent = processStreamEvent;
module.exports.handleNoOutputClose = handleNoOutputClose;
