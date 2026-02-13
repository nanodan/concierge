const { spawn } = require('child_process');
const path = require('path');

const MODELS = [
  { id: 'opus', name: 'Opus 4.6', context: 200000 },
  { id: 'claude-opus-4-20250514', name: 'Opus 4', context: 200000 },
  { id: 'sonnet', name: 'Sonnet 4.5', context: 200000 },
];

// Active Claude processes per conversation
const activeProcesses = new Map();
const PROCESS_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function spawnClaude(ws, conversationId, conv, text, attachments, uploadDir, callbacks) {
  const { onSave, broadcastStatus } = callbacks;

  const args = [
    '-p', text,
    '--output-format', 'stream-json',
    '--verbose',
    '--model', conv.model || 'sonnet',
    '--include-partial-messages',
  ];

  if (conv.autopilot !== false) {
    args.push('--dangerously-skip-permissions');
  }

  if (conv.claudeSessionId) {
    args.push('--resume', conv.claudeSessionId);
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
      const result = processStreamEvent(ws, conversationId, conv, event, assistantText, onSave, broadcastStatus);
      assistantText = result.assistantText;
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
        const result = processStreamEvent(ws, conversationId, conv, event, assistantText, onSave, broadcastStatus);
        assistantText = result.assistantText;
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

function processStreamEvent(ws, conversationId, conv, event, assistantText, onSave, broadcastStatus) {
  // Debug: log all events to see what Claude CLI sends
  if (process.env.DEBUG_CLAUDE) {
    console.error('[CLAUDE EVENT]', JSON.stringify(event).slice(0, 500));
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
          // Inject tool call into the stream AND accumulate for saving
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
          assistantText += toolDesc;  // Accumulate for saving
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
          assistantText += output;  // Accumulate for saving
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
    // assistantText has the tool calls we showed during streaming
    // event.result has the actual final answer
    let resultText = event.result || '';
    if (assistantText && event.result) {
      // Both exist: wrap tool calls in collapsible section, then show final answer
      resultText = `:::trace\n${assistantText}\n:::\n\n${event.result}`;
    } else if (assistantText) {
      resultText = assistantText;
    }
    if (event.session_id) {
      conv.claudeSessionId = event.session_id;
    }

    conv.messages.push({
      role: 'assistant',
      text: resultText,
      timestamp: Date.now(),
      cost: event.total_cost_usd,
      duration: event.duration_ms,
      sessionId: event.session_id,
      inputTokens: event.total_input_tokens,
      outputTokens: event.total_output_tokens,
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
      inputTokens: event.total_input_tokens,
      outputTokens: event.total_output_tokens,
    }));
    broadcastStatus(conversationId, 'idle');
  }

  return { assistantText };
}

function cancelProcess(conversationId) {
  const proc = activeProcesses.get(conversationId);
  if (proc) {
    proc.kill('SIGTERM');
    return true;
  }
  return false;
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
};
