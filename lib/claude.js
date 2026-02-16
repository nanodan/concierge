const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const MEMORY_PROMPT_FILE = path.join(__dirname, 'memory-prompt.txt');

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

// Safe WebSocket send - checks connection state before sending
// Handles both real WebSocket (with readyState) and mock objects (without readyState)
function safeSend(ws, data) {
  if (!ws || !ws.send) return false;
  // Real WebSocket: check readyState; mock ws in tests: assume open if no readyState
  if (ws.readyState !== undefined && ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  ws.send(JSON.stringify(data));
  return true;
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
  { id: 'opus', name: 'Opus 4.6', context: 200000, inputPrice: 15, outputPrice: 75 },
  { id: 'claude-opus-4.5', name: 'Opus 4.5', context: 200000, inputPrice: 15, outputPrice: 75 },
  { id: 'sonnet', name: 'Sonnet 4.5', context: 200000, inputPrice: 3, outputPrice: 15 },
];

// Model pricing lookup (prices per million tokens)
const MODEL_PRICING = {};
for (const m of MODELS) {
  MODEL_PRICING[m.id] = { input: m.inputPrice, output: m.outputPrice };
}

/**
 * Calculate per-message cost from token counts and model pricing
 */
function calculateMessageCost(inputTokens, outputTokens, modelId) {
  const pricing = MODEL_PRICING[modelId] || MODEL_PRICING['sonnet'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

// Active Claude processes per conversation
const activeProcesses = new Map();
const PROCESS_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function spawnClaude(ws, conversationId, conv, text, attachments, uploadDir, callbacks, memories = []) {
  const { onSave, broadcastStatus } = callbacks;

  const args = [
    '-p', text,
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

  if (conv.autopilot !== false) {
    args.push('--dangerously-skip-permissions');
  }

  if (conv.claudeSessionId) {
    args.push('--resume', conv.claudeSessionId);
  } else {
    // No session - check for compression summary to inject as context
    const summaryMsg = conv.messages && conv.messages.find(m => m.role === 'system' && m.compressionMeta);
    if (summaryMsg) {
      const summaryText = `[COMPRESSED CONVERSATION CONTEXT]
The following is a summary of earlier messages in this conversation that have been compressed to save context space:

${summaryMsg.text}

[END COMPRESSED CONTEXT]

Please continue the conversation naturally, using the above context as background information.`;
      args.push('--append-system-prompt', summaryText);
    }
  }

  args.push('--add-dir', conv.cwd);

  // Grant access to uploads directory so Claude can read attached files
  if (attachments && attachments.length > 0) {
    args.push('--add-dir', path.join(uploadDir, conversationId));
  }

  // Append attachment file paths to the prompt so Claude can read them
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
  let toolCallsText = '';  // Separate accumulator for tool calls only

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
      const result = processStreamEvent(ws, conversationId, conv, event, assistantText, toolCallsText, onSave, broadcastStatus);
      assistantText = result.assistantText;
      toolCallsText = result.toolCallsText;
    }
  });

  proc.stderr.on('data', (chunk) => {
    safeSend(ws, { type: 'stderr', conversationId, text: chunk.toString() });
  });

  proc.on('close', async (code) => {
    clearTimeout(processTimeout);
    activeProcesses.delete(conversationId);

    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        const result = processStreamEvent(ws, conversationId, conv, event, assistantText, toolCallsText, onSave, broadcastStatus);
        assistantText = result.assistantText;
        toolCallsText = result.toolCallsText;
      } catch {
        // ignore
      }
    }

    if (assistantText && conv.status === 'thinking') {
      // Combine tool calls with assistant text (same logic as handleResultEvent)
      let finalText = assistantText;
      if (toolCallsText && assistantText) {
        finalText = `:::trace\n${toolCallsText}\n:::\n\n${assistantText}`;
      } else if (toolCallsText && !assistantText) {
        finalText = toolCallsText;
      }

      // Mark as incomplete since we didn't receive a proper result event
      conv.messages.push({
        role: 'assistant',
        text: finalText,
        timestamp: Date.now(),
        incomplete: true,
      });
      conv.status = 'idle';
      await onSave(conversationId);
      safeSend(ws, {
        type: 'result',
        conversationId,
        text: finalText,
        incomplete: true,
      });
      broadcastStatus(conversationId, 'idle');
    }

    if (code !== 0 && !assistantText) {
      conv.status = 'idle';
      safeSend(ws, {
        type: 'error',
        conversationId,
        error: `Claude process exited with code ${code}`,
      });
      broadcastStatus(conversationId, 'idle');
    }
  });

  proc.on('error', (err) => {
    activeProcesses.delete(conversationId);
    conv.status = 'idle';
    safeSend(ws, {
      type: 'error',
      conversationId,
      error: `Failed to spawn claude: ${err.message}`,
    });
    broadcastStatus(conversationId, 'idle');
  });
}

// Maximum length for tool result text before truncation
const TOOL_RESULT_MAX_LENGTH = 500;

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

/**
 * Handle stream_event type (contains inner events for deltas, thinking, tool starts)
 */
function handleStreamEvent(ws, conversationId, conv, event, assistantText) {
  const inner = event.event;

  // Regular text output
  if (inner.type === 'content_block_delta' && inner.delta && inner.delta.type === 'text_delta') {
    assistantText += inner.delta.text;
    safeSend(ws, {
      type: 'delta',
      conversationId,
      text: inner.delta.text,
    });
  }

  // Thinking output (extended thinking)
  if (inner.type === 'content_block_delta' && inner.delta && inner.delta.type === 'thinking_delta') {
    safeSend(ws, {
      type: 'thinking',
      conversationId,
      text: inner.delta.thinking,
    });
  }

  // Content block start - detect tool use
  if (inner.type === 'content_block_start' && inner.content_block) {
    const block = inner.content_block;
    if (block.type === 'tool_use') {
      sendToolStart(ws, conversationId, block.name, block.id);
    }
  }

  // Capture session ID if provided
  if (event.session_id && !conv.claudeSessionId) {
    conv.claudeSessionId = event.session_id;
  }

  return assistantText;
}

/**
 * Handle content_block_start type (some CLI versions send these directly at top level)
 */
function handleContentBlockStart(ws, conversationId, event) {
  const block = event.content_block;
  if (block.type === 'tool_use') {
    sendToolStart(ws, conversationId, block.name, block.id);
  }
}

/**
 * Handle system event type (tool_use and init subtypes)
 */
function handleSystemEvent(ws, conversationId, conv, event) {
  if (event.subtype === 'tool_use') {
    sendToolStart(ws, conversationId, event.tool || 'unknown');
  } else if (event.subtype === 'init') {
    if (event.session_id && !conv.claudeSessionId) {
      conv.claudeSessionId = event.session_id;
    }
  }
}

/**
 * Format tool description for streaming output
 */
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

/**
 * Handle assistant event type (full message content with text and tool use)
 */
function handleAssistantEvent(ws, conversationId, conv, event, assistantText, toolCallsText) {
  if (event.session_id && !conv.claudeSessionId) {
    conv.claudeSessionId = event.session_id;
  }

  if (!event.message || !event.message.content) {
    return { assistantText, toolCallsText };
  }

  let fullText = '';
  for (const block of event.message.content) {
    if (block.type === 'text' && block.text) {
      fullText += block.text;
    }
    // Detect tool use in assistant message - show inline
    if (block.type === 'tool_use' && block.name) {
      sendToolStart(ws, conversationId, block.name, block.id);
      const toolDesc = formatToolDescription(block.name, block.input);
      toolCallsText += toolDesc;
      safeSend(ws, {
        type: 'delta',
        conversationId,
        text: toolDesc,
      });
    }
  }

  // Send any new text as delta
  if (fullText.length > assistantText.length) {
    const newText = fullText.slice(assistantText.length);
    assistantText = fullText;
    safeSend(ws, {
      type: 'delta',
      conversationId,
      text: newText,
    });
  }

  return { assistantText, toolCallsText };
}

/**
 * Handle user event type (tool results)
 */
function handleUserEvent(ws, conversationId, event, toolCallsText) {
  for (const block of event.message.content) {
    if (block.type !== 'tool_result') continue;

    safeSend(ws, {
      type: 'tool_result',
      conversationId,
      toolUseId: block.tool_use_id,
      isError: block.is_error || false,
    });

    // Extract result text from various possible formats
    let resultText = '';
    if (typeof block.content === 'string') {
      resultText = block.content;
    } else if (event.tool_use_result && event.tool_use_result.stdout) {
      resultText = event.tool_use_result.stdout;
    }

    if (resultText) {
      // Truncate long results
      const truncated = resultText.length > TOOL_RESULT_MAX_LENGTH
        ? resultText.slice(0, TOOL_RESULT_MAX_LENGTH) + '...\n(truncated)'
        : resultText;
      const output = block.is_error
        ? `\n\`\`\`\nError: ${truncated}\n\`\`\`\n`
        : `\n\`\`\`\n${truncated}\n\`\`\`\n`;
      toolCallsText += output;
      safeSend(ws, {
        type: 'delta',
        conversationId,
        text: output,
      });
    }
  }

  return toolCallsText;
}

/**
 * Handle result event type (final response with tokens and cost)
 */
function handleResultEvent(ws, conversationId, conv, event, toolCallsText, onSave, broadcastStatus) {
  // Combine accumulated tool calls/results with the final summary
  let resultText = event.result || '';
  if (toolCallsText && event.result) {
    // Both exist: wrap tool calls in collapsible trace section
    resultText = `:::trace\n${toolCallsText}\n:::\n\n${event.result}`;
  } else if (toolCallsText && !event.result) {
    // Only tool calls, no final answer (unusual but handle it)
    resultText = toolCallsText;
  }

  if (event.session_id) {
    conv.claudeSessionId = event.session_id;
  }

  // Extract token counts - try multiple possible field names
  const inputTokens = event.total_input_tokens ?? event.input_tokens ?? event.usage?.input_tokens ?? 0;
  const outputTokens = event.total_output_tokens ?? event.output_tokens ?? event.usage?.output_tokens ?? 0;

  // Calculate per-message cost from token counts (more reliable than cumulative tracking)
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
  onSave(conversationId);

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

/**
 * Main stream event processor - dispatches to appropriate handler based on event type.
 * Returns updated assistantText and toolCallsText accumulators.
 */
function processStreamEvent(ws, conversationId, conv, event, assistantText, toolCallsText, onSave, broadcastStatus) {
  // Debug logging for all events
  debug('EVENT', event);

  // Debug logging for result events (show full details)
  if (event.type === 'result') {
    debug('RESULT_KEYS', Object.keys(event));
    debug('RESULT', event, { pretty: true, truncate: 0 });
  }

  // Dispatch to appropriate handler based on event type
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
      ({ assistantText, toolCallsText } = handleAssistantEvent(ws, conversationId, conv, event, assistantText, toolCallsText));
      break;

    case 'user':
      if (event.message && event.message.content) {
        toolCallsText = handleUserEvent(ws, conversationId, event, toolCallsText);
      }
      break;

    case 'result':
      handleResultEvent(ws, conversationId, conv, event, toolCallsText, onSave, broadcastStatus);
      break;
  }

  return { assistantText, toolCallsText };
}

function cancelProcess(conversationId) {
  const proc = activeProcesses.get(conversationId);
  if (proc) {
    proc.kill('SIGTERM');
    return true;
  }
  return false;
}

// Generate a summary of messages for compression
async function generateSummary(messages, model = 'sonnet', cwd = process.env.HOME) {
  // Build conversation text for summarization
  const conversationText = messages.map(m => {
    const role = m.role === 'user' ? 'User' : 'Claude';
    // Truncate very long messages to keep prompt manageable
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

    // Timeout after 2 minutes
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

function hasActiveProcess(conversationId) {
  return activeProcesses.has(conversationId);
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
