const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MEMORY_PROMPT_FILE = path.join(__dirname, 'memory-prompt.txt');

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
  { id: 'opus', name: 'Opus 4.6', context: 200000 },
  { id: 'claude-opus-4.5', name: 'Opus 4.5', context: 200000 },
  { id: 'sonnet', name: 'Sonnet 4.5', context: 200000 },
];

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
    ws.send(JSON.stringify({ type: 'stderr', conversationId, text: chunk.toString() }));
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
      conv.messages.push({
        role: 'assistant',
        text: assistantText,
        timestamp: Date.now(),
      });
      conv.status = 'idle';
      await onSave(conversationId);
      ws.send(JSON.stringify({
        type: 'result',
        conversationId,
        text: assistantText,
      }));
      broadcastStatus(conversationId, 'idle');
    }

    if (code !== 0 && !assistantText) {
      conv.status = 'idle';
      ws.send(JSON.stringify({
        type: 'error',
        conversationId,
        error: `Claude process exited with code ${code}`,
      }));
      broadcastStatus(conversationId, 'idle');
    }
  });

  proc.on('error', (err) => {
    activeProcesses.delete(conversationId);
    conv.status = 'idle';
    ws.send(JSON.stringify({
      type: 'error',
      conversationId,
      error: `Failed to spawn claude: ${err.message}`,
    }));
    broadcastStatus(conversationId, 'idle');
  });
}

function processStreamEvent(ws, conversationId, conv, event, assistantText, toolCallsText, onSave, broadcastStatus) {
  // Debug: log all events to see what Claude CLI sends
  if (process.env.DEBUG_CLAUDE) {
    console.error('[CLAUDE EVENT]', JSON.stringify(event).slice(0, 500));
  }

  // Debug: log result events specifically to check token field names
  if (event.type === 'result' && process.env.DEBUG_CLAUDE) {
    console.error('[RESULT EVENT KEYS]', Object.keys(event));
    console.error('[RESULT EVENT]', JSON.stringify(event, null, 2));
  }

  if (event.type === 'stream_event' && event.event) {
    const inner = event.event;

    // Regular text output
    if (inner.type === 'content_block_delta' && inner.delta && inner.delta.type === 'text_delta') {
      assistantText += inner.delta.text;
      ws.send(JSON.stringify({
        type: 'delta',
        conversationId,
        text: inner.delta.text,
      }));
    }

    // Thinking output (extended thinking)
    if (inner.type === 'content_block_delta' && inner.delta && inner.delta.type === 'thinking_delta') {
      ws.send(JSON.stringify({
        type: 'thinking',
        conversationId,
        text: inner.delta.thinking,
      }));
    }

    // Content block start - detect tool use
    if (inner.type === 'content_block_start' && inner.content_block) {
      const block = inner.content_block;
      if (block.type === 'tool_use') {
        ws.send(JSON.stringify({
          type: 'tool_start',
          conversationId,
          tool: block.name,
          id: block.id,
        }));
      }
    }

    if (event.session_id && !conv.claudeSessionId) {
      conv.claudeSessionId = event.session_id;
    }
  }

  // Handle top-level content_block_start (some CLI versions send these directly)
  if (event.type === 'content_block_start' && event.content_block) {
    const block = event.content_block;
    if (block.type === 'tool_use') {
      ws.send(JSON.stringify({
        type: 'tool_start',
        conversationId,
        tool: block.name,
        id: block.id,
      }));
    }
  }

  // Handle system events that indicate tool execution
  if (event.type === 'system' && event.subtype === 'tool_use') {
    ws.send(JSON.stringify({
      type: 'tool_start',
      conversationId,
      tool: event.tool || 'unknown',
    }));
  }

  // Handle system init event
  if (event.type === 'system' && event.subtype === 'init') {
    if (event.session_id && !conv.claudeSessionId) {
      conv.claudeSessionId = event.session_id;
    }
  }

  if (event.type === 'assistant') {
    if (event.session_id && !conv.claudeSessionId) {
      conv.claudeSessionId = event.session_id;
    }
    if (event.message && event.message.content) {
      let fullText = '';
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text) {
          fullText += block.text;
        }
        // Detect tool use in assistant message - show inline
        if (block.type === 'tool_use' && block.name) {
          ws.send(JSON.stringify({
            type: 'tool_start',
            conversationId,
            tool: block.name,
            id: block.id,
          }));
          // Inject tool call into the stream AND accumulate for tool calls section
          let toolDesc = `\n\n**Using ${block.name}**`;
          if (block.input) {
            if (block.input.command) {
              toolDesc += `: \`${block.input.command}\``;
            } else if (block.input.file_path) {
              toolDesc += `: \`${block.input.file_path}\``;
            } else if (block.input.pattern) {
              toolDesc += `: \`${block.input.pattern}\``;
            }
          }
          toolDesc += '\n';
          toolCallsText += toolDesc;  // Accumulate tool calls separately
          ws.send(JSON.stringify({
            type: 'delta',
            conversationId,
            text: toolDesc,
          }));
        }
      }
      if (fullText.length > assistantText.length) {
        const newText = fullText.slice(assistantText.length);
        assistantText = fullText;
        ws.send(JSON.stringify({
          type: 'delta',
          conversationId,
          text: newText,
        }));
      }
    }
  } else if (event.type === 'user' && event.message && event.message.content) {
    // Tool result - show in stream
    for (const block of event.message.content) {
      if (block.type === 'tool_result') {
        ws.send(JSON.stringify({
          type: 'tool_result',
          conversationId,
          toolUseId: block.tool_use_id,
          isError: block.is_error || false,
        }));
        // Inject truncated result into stream
        let resultText = '';
        if (typeof block.content === 'string') {
          resultText = block.content;
        } else if (event.tool_use_result && event.tool_use_result.stdout) {
          resultText = event.tool_use_result.stdout;
        }
        if (resultText) {
          // Truncate long results
          const maxLen = 500;
          const truncated = resultText.length > maxLen
            ? resultText.slice(0, maxLen) + '...\n(truncated)'
            : resultText;
          const output = block.is_error
            ? `\n\`\`\`\nError: ${truncated}\n\`\`\`\n`
            : `\n\`\`\`\n${truncated}\n\`\`\`\n`;
          toolCallsText += output;  // Accumulate tool results separately
          ws.send(JSON.stringify({
            type: 'delta',
            conversationId,
            text: output,
          }));
        }
      }
    }
  } else if (event.type === 'result') {
    // Combine accumulated tool calls/results with the final summary
    // toolCallsText has only the tool calls we showed during streaming
    // event.result has the actual final answer
    let resultText = event.result || '';
    if (toolCallsText && event.result) {
      // Both exist: wrap tool calls in collapsible section, then show final answer
      resultText = `:::trace\n${toolCallsText}\n:::\n\n${event.result}`;
    } else if (toolCallsText && !event.result) {
      // Only tool calls, no final answer (unusual but handle it)
      resultText = toolCallsText;
    }
    // If no tool calls, just use event.result as-is (no trace block)
    if (event.session_id) {
      conv.claudeSessionId = event.session_id;
    }

    // Extract token counts - try multiple possible field names
    const inputTokens = event.total_input_tokens ?? event.input_tokens ?? event.usage?.input_tokens ?? 0;
    const outputTokens = event.total_output_tokens ?? event.output_tokens ?? event.usage?.output_tokens ?? 0;

    conv.messages.push({
      role: 'assistant',
      text: resultText,
      timestamp: Date.now(),
      cost: event.total_cost_usd,
      duration: event.duration_ms,
      sessionId: event.session_id,
      inputTokens,
      outputTokens,
    });
    conv.status = 'idle';
    onSave(conversationId);

    ws.send(JSON.stringify({
      type: 'result',
      conversationId,
      text: resultText,
      cost: event.total_cost_usd,
      duration: event.duration_ms,
      sessionId: event.session_id,
      inputTokens,
      outputTokens,
    }));
    broadcastStatus(conversationId, 'idle');
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
