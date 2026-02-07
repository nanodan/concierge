const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory conversation store
const conversations = new Map();

// Active Claude processes per conversation
const activeProcesses = new Map();

// --- REST API ---

// Create conversation
app.post('/api/conversations', (req, res) => {
  const { name, cwd } = req.body;
  const id = uuidv4();
  const conversation = {
    id,
    name: name || 'New Chat',
    cwd: cwd || process.env.HOME,
    claudeSessionId: null,
    messages: [],
    status: 'idle',
    createdAt: Date.now(),
  };
  conversations.set(id, conversation);
  res.json(conversation);
});

// List conversations
app.get('/api/conversations', (req, res) => {
  const list = Array.from(conversations.values()).map(c => ({
    id: c.id,
    name: c.name,
    cwd: c.cwd,
    status: c.status,
    lastMessage: c.messages.length > 0 ? c.messages[c.messages.length - 1] : null,
    messageCount: c.messages.length,
    createdAt: c.createdAt,
  }));
  list.sort((a, b) => {
    const aTime = a.lastMessage ? a.lastMessage.timestamp : a.createdAt;
    const bTime = b.lastMessage ? b.lastMessage.timestamp : b.createdAt;
    return bTime - aTime;
  });
  res.json(list);
});

// Get conversation detail
app.get('/api/conversations/:id', (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  res.json(conv);
});

// Delete conversation
app.delete('/api/conversations/:id', (req, res) => {
  const id = req.params.id;
  // Kill any active process
  const proc = activeProcesses.get(id);
  if (proc) {
    proc.kill('SIGTERM');
    activeProcesses.delete(id);
  }
  conversations.delete(id);
  res.json({ ok: true });
});

// --- WebSocket ---

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
      return;
    }

    if (msg.type === 'message') {
      handleMessage(ws, msg);
    }
  });
});

// Heartbeat to detect dead connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

function handleMessage(ws, msg) {
  const { conversationId, text } = msg;
  const conv = conversations.get(conversationId);
  if (!conv) {
    ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found' }));
    return;
  }

  // Don't allow concurrent messages to same conversation
  if (activeProcesses.has(conversationId)) {
    ws.send(JSON.stringify({ type: 'error', error: 'Conversation is busy' }));
    return;
  }

  // Add user message
  conv.messages.push({
    role: 'user',
    text,
    timestamp: Date.now(),
  });
  conv.status = 'thinking';
  broadcastStatus(conversationId, 'thinking');

  // Build claude CLI args
  const args = [
    '-p', text,
    '--output-format', 'stream-json',
    '--verbose',
    '--model', 'sonnet',
    '--dangerously-skip-permissions',
    '--include-partial-messages',
  ];

  if (conv.claudeSessionId) {
    args.push('--resume', conv.claudeSessionId);
  }

  args.push('--add-dir', conv.cwd);

  const proc = spawn('claude', args, {
    cwd: conv.cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  activeProcesses.set(conversationId, proc);

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
      processStreamEvent(ws, conversationId, conv, event, { assistantText }, (state) => {
        assistantText = state.assistantText;
      });
    }
  });

  proc.stderr.on('data', (chunk) => {
    ws.send(JSON.stringify({ type: 'stderr', conversationId, text: chunk.toString() }));
  });

  proc.on('close', (code) => {
    activeProcesses.delete(conversationId);

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        processStreamEvent(ws, conversationId, conv, event, { assistantText }, (state) => {
          assistantText = state.assistantText;
        });
      } catch {
        // ignore
      }
    }

    // If we got assistant text but no result event, finalize anyway
    if (assistantText && conv.status === 'thinking') {
      conv.messages.push({
        role: 'assistant',
        text: assistantText,
        timestamp: Date.now(),
      });
      conv.status = 'idle';
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

function processStreamEvent(ws, conversationId, conv, event, state, updateState) {
  if (event.type === 'stream_event' && event.event) {
    const inner = event.event;
    if (inner.type === 'content_block_delta' && inner.delta && inner.delta.type === 'text_delta') {
      state.assistantText += inner.delta.text;
      updateState(state);
      ws.send(JSON.stringify({
        type: 'delta',
        conversationId,
        text: inner.delta.text,
      }));
    }
    if (event.session_id && !conv.claudeSessionId) {
      conv.claudeSessionId = event.session_id;
    }
  } else if (event.type === 'assistant') {
    if (event.session_id && !conv.claudeSessionId) {
      conv.claudeSessionId = event.session_id;
    }
    if (event.message && event.message.content) {
      let fullText = '';
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text) {
          fullText += block.text;
        }
      }
      if (fullText.length > state.assistantText.length) {
        const newText = fullText.slice(state.assistantText.length);
        state.assistantText = fullText;
        updateState(state);
        ws.send(JSON.stringify({
          type: 'delta',
          conversationId,
          text: newText,
        }));
      }
    }
  } else if (event.type === 'result') {
    const resultText = event.result || state.assistantText;
    if (event.session_id) {
      conv.claudeSessionId = event.session_id;
    }
    state.assistantText = resultText;
    updateState(state);

    conv.messages.push({
      role: 'assistant',
      text: resultText,
      timestamp: Date.now(),
      cost: event.total_cost_usd,
      duration: event.duration_ms,
      sessionId: event.session_id,
    });
    conv.status = 'idle';

    ws.send(JSON.stringify({
      type: 'result',
      conversationId,
      text: resultText,
      cost: event.total_cost_usd,
      duration: event.duration_ms,
      sessionId: event.session_id,
    }));
    broadcastStatus(conversationId, 'idle');
  }
}

function broadcastStatus(conversationId, status) {
  const msg = JSON.stringify({ type: 'status', conversationId, status });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

// Start server
const PORT = process.env.PORT || 3577;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Remote Chat running on http://0.0.0.0:${PORT}`);
});
