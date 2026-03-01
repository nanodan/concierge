/**
 * OpenAI Codex CLI Provider
 * Implements LLM provider interface using the Codex CLI
 */

const { spawn } = require('child_process');
const path = require('path');
const { LLMProvider, safeSend } = require('./base');
const { resolveConversationExecutionMode, modeAllowsWrites } = require('../workflow/execution-mode');

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

function estimateTypedInputTokens(text) {
  return text ? Math.max(1, Math.ceil(String(text).length / 4)) : 0;
}

// Active Codex processes per conversation
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

function partitionAttachments(attachments = []) {
  const imageAttachments = [];
  const fileAttachments = [];

  for (const attachment of attachments || []) {
    const filePath = attachment?.path;
    if (!filePath || typeof filePath !== 'string') continue;

    if (/\.(png|jpg|jpeg|gif|webp)$/i.test(filePath)) {
      imageAttachments.push(attachment);
    } else {
      fileAttachments.push(attachment);
    }
  }

  return { imageAttachments, fileAttachments };
}

function buildFileAttachmentPrompt(fileAttachments = []) {
  if (!Array.isArray(fileAttachments) || fileAttachments.length === 0) return '';
  const paths = fileAttachments.map((a) => a.path).join('\n');
  return `\n\n[Attached file${fileAttachments.length > 1 ? 's' : ''} — read for context:]\n${paths}`;
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
    if (msg?.summarized) continue;
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

function combineWithOverlap(a, b) {
  if (!a) return b || '';
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

  return a + b;
}

function formatToolDescription(toolName, input) {
  let toolDesc = `\n\n**Using ${toolName}**`;
  if (input) {
    if (input.command) {
      toolDesc += `: \`${input.command}\``;
    } else if (input.cmd) {
      toolDesc += `: \`${input.cmd}\``;
    } else if (input.command_line) {
      toolDesc += `: \`${input.command_line}\``;
    } else if (input.shell_command) {
      toolDesc += `: \`${input.shell_command}\``;
    } else if (Array.isArray(input.argv) && input.argv.length > 0) {
      toolDesc += `: \`${input.argv.join(' ')}\``;
    } else if (input.file_path) {
      toolDesc += `: \`${input.file_path}\``;
    } else if (input.pattern) {
      toolDesc += `: \`${input.pattern}\``;
    }
  }
  toolDesc += '\n';
  return toolDesc;
}

function extractCommandText(obj = {}) {
  if (!obj || typeof obj !== 'object') return '';
  if (typeof obj.command === 'string') return obj.command;
  if (typeof obj.cmd === 'string') return obj.cmd;
  if (typeof obj.command_line === 'string') return obj.command_line;
  if (typeof obj.shell_command === 'string') return obj.shell_command;
  if (Array.isArray(obj.argv) && obj.argv.length > 0) return obj.argv.join(' ');
  if (obj.execution && typeof obj.execution === 'object') {
    return obj.execution.command || obj.execution.command_line || obj.execution.shell_command || '';
  }
  return '';
}

function getToolName(item = {}) {
  return item.name || item.tool || item.tool_name || item.function_name || item.type || 'Tool';
}

function getToolId(item = {}) {
  return item.id || item.tool_use_id || item.call_id || item.invocation_id || null;
}

function isToolResultItem(item = {}) {
  if (!item || typeof item !== 'object') return false;
  if (item.type === 'agent_message' || item.type === 'reasoning') {
    return false;
  }
  if (item.type === 'tool_result' || item.type === 'function_call_output' || item.type === 'tool_call_output') {
    return true;
  }
  return item.tool_use_id != null || item.call_id != null || item.stdout != null || item.stderr != null;
}

function isToolStartItem(item = {}) {
  if (!item || typeof item !== 'object') return false;
  if (item.type === 'tool_use' || item.type === 'tool_call' || item.type === 'function_call') {
    return true;
  }
  if (item.type === 'reasoning' || item.type === 'agent_message' || isToolResultItem(item)) {
    return false;
  }
  return !!(item.name || item.tool || item.tool_name || item.function_name || item.input || item.command);
}

function extractToolResultText(item = {}) {
  if (!item || typeof item !== 'object') return '';
  if (typeof item.content === 'string') return item.content;
  if (typeof item.output === 'string') return item.output;
  if (typeof item.result === 'string') return item.result;
  if (typeof item.text === 'string') return item.text;
  if (typeof item.summary === 'string') return item.summary;
  if (typeof item.stdout === 'string' || typeof item.stderr === 'string') {
    return [item.stdout, item.stderr].filter(Boolean).join('\n');
  }
  if (Array.isArray(item.output)) {
    const fromArray = item.output
      .map(part => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        return part.text || part.output_text || part.content || '';
      })
      .filter(Boolean)
      .join('\n');
    if (fromArray) return fromArray;
  }
  if (Array.isArray(item.content)) {
    const fromArray = item.content
      .map(part => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        return part.text || part.output_text || part.content || '';
      })
      .filter(Boolean)
      .join('\n');
    if (fromArray) return fromArray;
  }
  if (item.output && typeof item.output === 'object') {
    const nested = item.output.stdout || item.output.stderr || item.output.text || item.output.summary || item.output.content;
    if (typeof nested === 'string') return nested;
  }
  if (item.execution && typeof item.execution === 'object') {
    const cmd = item.execution.command || item.execution.command_line || item.execution.shell_command;
    const status = item.execution.exit_code != null ? `exit ${item.execution.exit_code}` : '';
    const duration = item.execution.duration_ms != null ? ` in ${item.execution.duration_ms}ms` : '';
    const line = [cmd, status, duration].filter(Boolean).join('');
    if (line) return line;
  }
  return '';
}

function extractAssistantMessageText(item = {}) {
  if (!item || typeof item !== 'object') return '';
  if (typeof item.text === 'string') return item.text;
  if (typeof item.content === 'string') return item.content;
  if (typeof item.output_text === 'string') return item.output_text;
  if (typeof item.summary === 'string') return item.summary;

  const pickPartText = (part) => {
    if (!part) return '';
    if (typeof part === 'string') return part;
    if (typeof part.text === 'string') return part.text;
    if (typeof part.output_text === 'string') return part.output_text;
    if (typeof part.content === 'string') return part.content;
    if (typeof part.summary === 'string') return part.summary;
    return '';
  };

  if (Array.isArray(item.content)) {
    const text = item.content.map(pickPartText).filter(Boolean).join('\n');
    if (text) return text;
  }
  if (Array.isArray(item.output)) {
    const text = item.output.map(pickPartText).filter(Boolean).join('\n');
    if (text) return text;
  }
  if (item.output && typeof item.output === 'object') {
    if (typeof item.output.text === 'string') return item.output.text;
    if (typeof item.output.content === 'string') return item.output.content;
    if (typeof item.output.summary === 'string') return item.output.summary;
  }

  return '';
}

/**
 * Process a single JSONL event from Codex CLI
 */
function processCodexEvent(
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
  debug('EVENT', event);
  if (!conv._codexOpenToolIds) {
    conv._codexOpenToolIds = new Set();
  }
  if (typeof conv._codexOpenTraceCount !== 'number') {
    conv._codexOpenTraceCount = 0;
  }

  function appendToolStart(item) {
    const toolName = getToolName(item);
    const toolId = getToolId(item);
    if (toolId && conv._codexOpenToolIds.has(toolId)) {
      return;
    }
    if (toolId) {
      conv._codexOpenToolIds.add(toolId);
    }
    conv._codexOpenTraceCount += 1;
    safeSend(ws, {
      type: 'tool_start',
      conversationId,
      tool: toolName,
      id: toolId,
    });
    const toolInput = item.input || item.arguments || item.params || item;
    const toolDesc = formatToolDescription(toolName, toolInput);
    const traceStart = '\n\n:::trace\n' + toolDesc;
    assistantText += traceStart;
    safeSend(ws, { type: 'delta', conversationId, text: traceStart });
  }

  function buildTraceClosers(count = 1) {
    if (count <= 0) return '';
    const prefix = assistantText.endsWith('\n') ? '' : '\n';
    return prefix + ':::\n\n'.repeat(count);
  }

  function closeOpenTraces() {
    if (conv._codexOpenTraceCount <= 0) return;
    const closers = buildTraceClosers(conv._codexOpenTraceCount);
    assistantText += closers;
    safeSend(ws, { type: 'delta', conversationId, text: closers });
    conv._codexOpenTraceCount = 0;
    conv._codexOpenToolIds.clear();
  }

  function appendAssistantMessage(item) {
    const newText = extractAssistantMessageText(item);
    if (!newText) return;
    // Keep assistant narrative outside of tool trace sections.
    closeOpenTraces();
    const nextText = combineWithOverlap(assistantText, newText);
    const deltaText = nextText.slice(assistantText.length);
    assistantText = nextText;
    if (deltaText) {
      safeSend(ws, {
        type: 'delta',
        conversationId,
        text: deltaText,
      });
    }
  }

  function appendToolResult(item) {
    const toolId = getToolId(item);
    const hasIdTrace = !!(toolId && conv._codexOpenToolIds.has(toolId));
    const hadOpenTrace = hasIdTrace || conv._codexOpenTraceCount > 0;
    if (toolId) {
      conv._codexOpenToolIds.delete(toolId);
    }
    if (hadOpenTrace) {
      conv._codexOpenTraceCount = Math.max(0, conv._codexOpenTraceCount - 1);
    }

    safeSend(ws, {
      type: 'tool_result',
      conversationId,
      toolUseId: toolId,
      isError: item.is_error || false,
    });

    let output = '';
    const commandText = extractCommandText(item);
    if (commandText) {
      output += `\n\`\`\`\n$ ${commandText}\n\`\`\`\n`;
    }
    const resultText = extractToolResultText(item);
    if (resultText) {
      const truncated = resultText.length > TOOL_RESULT_MAX_LENGTH
        ? resultText.slice(0, TOOL_RESULT_MAX_LENGTH) + '...\n(truncated)'
        : resultText;
      output += item.is_error
        ? `\n\`\`\`\nError: ${truncated}\n\`\`\`\n`
        : `\n\`\`\`\n${truncated}\n\`\`\`\n`;
    }
    if (hadOpenTrace) {
      output += buildTraceClosers(1);
    }
    assistantText += output;
    if (output) {
      safeSend(ws, { type: 'delta', conversationId, text: output });
    }
  }

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

    case 'item.started':
      if (event.item && isToolStartItem(event.item)) {
        appendToolStart(event.item);
      }
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
          appendAssistantMessage(event.item);
        } else if (isToolResultItem(event.item)) {
          appendToolResult(event.item);
        } else if (isToolStartItem(event.item)) {
          appendToolStart(event.item);
        }
      }
      break;

    case 'turn.completed': {
      if (Array.isArray(event.items)) {
        for (const item of event.items) {
          if (item?.type === 'agent_message') {
            appendAssistantMessage(item);
            continue;
          }
          if (isToolStartItem(item)) {
            appendToolStart(item);
          }
          if (isToolResultItem(item)) {
            appendToolResult(item);
          }
        }
      }

      const usage = event.usage || {};
      const rawInputTokens = usage.input_tokens || 0;
      const cachedInputTokens =
        usage.input_tokens_details?.cached_tokens ??
        usage.input_tokens_details?.cache_read_input_tokens ??
        0;
      // For UX, show net new input tokens instead of full cached prompt tokens.
      const inputTokens = Math.max(0, rawInputTokens - cachedInputTokens);
      const netInputTokens = inputTokens;
      const displayInputTokens = conv._codexDisplayInputTokens ?? inputTokens;
      const typedInputTokens = conv._typedInputTokens ?? displayInputTokens;
      const outputTokens = usage.output_tokens || 0;
      const reasoningTokens =
        usage.output_tokens_details?.reasoning_tokens ??
        usage.completion_tokens_details?.reasoning_tokens ??
        0;
      if (!assistantText.trim() && inputTokens === 0 && outputTokens === 0) {
        if (canRetryWithFreshSession) {
          // Resumed sessions can occasionally become invalid and return empty 0/0.
          // Retry once with a fresh session before surfacing an error.
          conv.codexSessionId = null;
          conv._retryAfterEmptyResultMode = 'fresh-session';
          break;
        }
        if (canRetryWithCompactHistory) {
          // Empty 0/0 result can happen when the full inline history is too large.
          // Defer error to close handler to allow a compact-history retry.
          conv.codexSessionId = null;
          conv._retryAfterEmptyResultMode = 'compact-history';
          break;
        }
        conv.status = 'idle';
        conv.thinkingStartTime = null;
        onSave(conversationId);
        safeSend(ws, {
          type: 'error',
          conversationId,
          error: 'Model returned an empty response. Please retry.',
        });
        delete conv._codexDisplayInputTokens;
        delete conv._typedInputTokens;
        broadcastStatus(conversationId, 'idle');
        break;
      }
      if (conv._codexOpenTraceCount > 0) {
        closeOpenTraces();
      }
      const messageCost = calculateMessageCost(inputTokens, outputTokens, conv.model);

      conv.messages.push({
        role: 'assistant',
        text: assistantText,
        timestamp: Date.now(),
        cost: messageCost,
        duration: event.duration_ms,
        sessionId: conv.codexSessionId,
        inputTokens,
        netInputTokens,
        displayInputTokens,
        typedInputTokens,
        outputTokens,
        reasoningTokens,
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
        netInputTokens,
        displayInputTokens,
        typedInputTokens,
        outputTokens,
        reasoningTokens,
        rawInputTokens,
        cachedInputTokens,
      });
      delete conv._codexDisplayInputTokens;
      delete conv._typedInputTokens;
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

  async chat(ws, conversationId, conv, text, attachments, uploadDir, callbacks, memories = [], runtime = {}) {
    const { onSave, broadcastStatus } = callbacks;
    const isSlashOnlyPrompt = typeof text === 'string' && /^\/\S+\s*$/.test(text.trim());
    const executionMode = resolveConversationExecutionMode(conv);
    const allowWrites = modeAllowsWrites(executionMode);

    // Build command args - flags must come before the prompt
    const args = [];
    const model = KNOWN_MODELS.has(conv.model) ? conv.model : DEFAULT_MODEL;
    const isResume = !!conv.codexSessionId;
    const hadSessionAtStart = isResume;
    const inlineHistoryMode = runtime.inlineHistoryMode === 'compact' ? 'compact' : 'full';

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

    if (allowWrites && conv.sandboxed === false) {
      // "Sandbox off" should always map to dangerous mode in Codex.
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else if (!isResume) {
      // Resume subcommand does not accept -s, so only set sandbox mode on fresh exec.
      args.push('-s', allowWrites ? 'workspace-write' : 'read-only');
    }

    const { imageAttachments, fileAttachments } = partitionAttachments(attachments);

    // Image attachments
    for (const img of imageAttachments) {
      args.push('-i', img.path);
    }

    // Grant access to uploads directory
    if (!isResume && (imageAttachments.length > 0 || fileAttachments.length > 0)) {
      args.push('--add-dir', path.join(uploadDir, conversationId));
    }

    const enabledMemories = (memories || []).filter(m => m.enabled !== false);
    const inlineHistory = isResume
      ? ''
      : buildInlineHistoryContext(
          conv.messages,
          text,
          inlineHistoryMode === 'compact' ? { maxChars: RETRY_INLINE_HISTORY_CHAR_BUDGET } : {}
        );
    const canRetryWithCompactHistory = !isResume
      && inlineHistoryMode === 'full'
      && !!inlineHistory
      && runtime.retried !== true;
    const canRetryWithFreshSession = hadSessionAtStart && runtime.retried !== true;
    delete conv._retryAfterEmptyResultMode;
    const promptBase = inlineHistory
      ? `${inlineHistory}\n\n[New user message]\n${text}`
      : text;
    const prompt = promptBase
      + buildFileAttachmentPrompt(fileAttachments)
      + formatMemoriesForPrompt(enabledMemories);
    conv._typedInputTokens = estimateTypedInputTokens(text);
    conv._codexDisplayInputTokens = conv._typedInputTokens;

    // Prompt must be last
    args.push(prompt);

    debug('SPAWN', { cwd: conv.cwd, executionMode, args }, { truncate: 0 });

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
        const result = processCodexEvent(
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

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          const result = processCodexEvent(
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
        delete conv._codexOpenToolIds;
        delete conv._codexOpenTraceCount;
        delete conv._codexDisplayInputTokens;
        delete conv._typedInputTokens;
        void this.chat(ws, conversationId, conv, text, attachments, uploadDir, callbacks, memories, {
          ...runtime,
          retried: true,
          inlineHistoryMode: retryMode === 'compact-history' ? 'compact' : 'full',
        });
        return;
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

      handleNoOutputClose(ws, conversationId, conv, {
        code,
        providerName: 'Codex',
        broadcastStatus,
        stderr,
        isSlashOnlyPrompt,
      });
      delete conv._retryAfterEmptyResultMode;
      delete conv._codexOpenToolIds;
      delete conv._codexOpenTraceCount;
      delete conv._codexDisplayInputTokens;
      delete conv._typedInputTokens;
    });

    proc.on('error', (err) => {
      clearTimeout(processTimeout);
      activeProcesses.delete(conversationId);

      if (!retryScheduled && conv.status === 'thinking' && canRetryWithCompactHistory && isContextOverflowError(err?.message || err?.code)) {
        retryScheduled = true;
        delete conv._codexOpenToolIds;
        delete conv._codexOpenTraceCount;
        delete conv._codexDisplayInputTokens;
        delete conv._typedInputTokens;
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
        error: `Failed to spawn codex: ${err.message}`,
      });
      broadcastStatus(conversationId, 'idle');
      delete conv._retryAfterEmptyResultMode;
      delete conv._codexOpenToolIds;
      delete conv._codexOpenTraceCount;
      delete conv._codexDisplayInputTokens;
      delete conv._typedInputTokens;
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
module.exports.handleNoOutputClose = handleNoOutputClose;
module.exports.partitionAttachments = partitionAttachments;
module.exports.buildFileAttachmentPrompt = buildFileAttachmentPrompt;
module.exports._private = {
  buildInlineHistoryContext,
};
