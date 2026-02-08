const express = require('express');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();

// Use HTTPS if certs exist (required for mic access on non-localhost)
const CERT_DIR = path.join(__dirname, 'certs');
let server;
if (fs.existsSync(path.join(CERT_DIR, 'key.pem')) && fs.existsSync(path.join(CERT_DIR, 'cert.pem'))) {
  server = https.createServer({
    key: fs.readFileSync(path.join(CERT_DIR, 'key.pem')),
    cert: fs.readFileSync(path.join(CERT_DIR, 'cert.pem')),
  }, app);
  console.log('HTTPS enabled (self-signed cert)');
} else {
  server = http.createServer(app);
}
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Persistent conversation store — split into index + per-conversation files
const DATA_DIR = path.join(__dirname, 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const CONV_DIR = path.join(DATA_DIR, 'conv');
const LEGACY_FILE = path.join(DATA_DIR, 'conversations.json');
const conversations = new Map(); // id -> { metadata + messages (lazy) }

function ensureDirs() {
  fs.mkdirSync(CONV_DIR, { recursive: true });
}

function convMeta(conv) {
  return {
    id: conv.id,
    name: conv.name,
    cwd: conv.cwd,
    status: conv.status,
    archived: !!conv.archived,
    claudeSessionId: conv.claudeSessionId,
    createdAt: conv.createdAt,
    messageCount: conv.messages ? conv.messages.length : (conv.messageCount || 0),
    lastMessage: conv.messages && conv.messages.length > 0
      ? conv.messages[conv.messages.length - 1]
      : (conv.lastMessage || null),
  };
}

function saveIndex() {
  ensureDirs();
  const arr = Array.from(conversations.values()).map(convMeta);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(arr, null, 2));
}

function saveConversation(id) {
  ensureDirs();
  const conv = conversations.get(id);
  if (!conv) return;
  fs.writeFileSync(
    path.join(CONV_DIR, `${id}.json`),
    JSON.stringify(conv.messages || [], null, 2)
  );
  // Also update index (lastMessage/messageCount may have changed)
  saveIndex();
}

function loadMessages(id) {
  try {
    const raw = fs.readFileSync(path.join(CONV_DIR, `${id}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function deleteConversationFiles(id) {
  try { fs.unlinkSync(path.join(CONV_DIR, `${id}.json`)); } catch {}
}

function loadFromDisk() {
  ensureDirs();

  // Migrate legacy single-file format
  if (fs.existsSync(LEGACY_FILE)) {
    try {
      const raw = fs.readFileSync(LEGACY_FILE, 'utf8');
      const arr = JSON.parse(raw);
      console.log(`Migrating ${arr.length} conversations from legacy format...`);
      for (const conv of arr) {
        conversations.set(conv.id, conv);
        // Write individual message file
        fs.writeFileSync(
          path.join(CONV_DIR, `${conv.id}.json`),
          JSON.stringify(conv.messages || [], null, 2)
        );
      }
      saveIndex();
      // Rename legacy file so we don't re-migrate
      fs.renameSync(LEGACY_FILE, LEGACY_FILE + '.bak');
      console.log('Migration complete. Old file renamed to conversations.json.bak');
      return;
    } catch (err) {
      console.error('Legacy migration failed:', err.message);
    }
  }

  // Normal load: read index, messages loaded lazily
  try {
    const raw = fs.readFileSync(INDEX_FILE, 'utf8');
    const arr = JSON.parse(raw);
    for (const meta of arr) {
      // Store metadata with a messages placeholder
      conversations.set(meta.id, {
        ...meta,
        messages: null, // lazy — loaded on demand
      });
    }
    console.log(`Loaded index with ${arr.length} conversations`);
  } catch {
    // No index yet — start fresh
  }
}

// Ensure messages are loaded for a conversation
function ensureMessages(id) {
  const conv = conversations.get(id);
  if (!conv) return null;
  if (conv.messages === null) {
    conv.messages = loadMessages(id);
  }
  return conv;
}

loadFromDisk();

// Active Claude processes per conversation
const activeProcesses = new Map();

// --- REST API ---

// Browse directories
app.get('/api/browse', (req, res) => {
  const target = req.query.path || process.env.HOME;
  const resolved = path.resolve(target);
  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    res.json({ path: resolved, dirs, parent: path.dirname(resolved) });
  } catch (err) {
    res.status(400).json({ error: err.message, path: resolved });
  }
});

// Create directory
app.post('/api/mkdir', (req, res) => {
  const target = req.body.path;
  if (!target) return res.status(400).json({ error: 'path required' });
  try {
    fs.mkdirSync(target, { recursive: true });
    res.json({ ok: true, path: target });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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
    archived: false,
    createdAt: Date.now(),
  };
  conversations.set(id, conversation);
  saveConversation(id);
  res.json(conversation);
});

// List conversations (metadata only — no messages loaded)
app.get('/api/conversations', (req, res) => {
  const archived = req.query.archived === 'true';
  const list = Array.from(conversations.values())
    .filter(c => !!(c.archived) === archived)
    .map(c => {
      const meta = convMeta(c);
      return {
        id: meta.id,
        name: meta.name,
        cwd: meta.cwd,
        status: meta.status,
        archived: meta.archived,
        lastMessage: meta.lastMessage,
        messageCount: meta.messageCount,
        createdAt: meta.createdAt,
      };
    });
  list.sort((a, b) => {
    const aTime = a.lastMessage ? a.lastMessage.timestamp : a.createdAt;
    const bTime = b.lastMessage ? b.lastMessage.timestamp : b.createdAt;
    return bTime - aTime;
  });
  res.json(list);
});

// Search conversations (loads messages lazily per conversation)
app.get('/api/conversations/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);

  const results = [];
  for (const c of conversations.values()) {
    const nameMatch = c.name.toLowerCase().includes(q);
    // Load messages from disk if not in memory
    const messages = c.messages !== null ? c.messages : loadMessages(c.id);
    const matchingMessages = [];
    for (const m of messages) {
      if (m.text && m.text.toLowerCase().includes(q)) {
        matchingMessages.push({
          role: m.role,
          text: m.text,
          timestamp: m.timestamp,
        });
      }
    }
    if (nameMatch || matchingMessages.length > 0) {
      const meta = convMeta(c);
      results.push({
        id: meta.id,
        name: meta.name,
        cwd: meta.cwd,
        status: meta.status,
        archived: meta.archived,
        lastMessage: meta.lastMessage,
        messageCount: meta.messageCount,
        createdAt: meta.createdAt,
        nameMatch,
        matchingMessages: matchingMessages.slice(0, 3),
      });
    }
  }
  results.sort((a, b) => {
    const aTime = a.lastMessage ? a.lastMessage.timestamp : a.createdAt;
    const bTime = b.lastMessage ? b.lastMessage.timestamp : b.createdAt;
    return bTime - aTime;
  });
  res.json(results);
});

// Update conversation (archive, rename)
app.patch('/api/conversations/:id', (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  if (req.body.archived !== undefined) conv.archived = !!req.body.archived;
  if (req.body.name !== undefined) conv.name = String(req.body.name).trim() || conv.name;
  saveIndex();
  res.json({ ok: true, id: conv.id, name: conv.name, archived: conv.archived });
});

// Get conversation detail (loads messages into memory)
app.get('/api/conversations/:id', (req, res) => {
  const conv = ensureMessages(req.params.id);
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
  deleteConversationFiles(id);
  saveIndex();
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
  const conv = ensureMessages(conversationId);
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
  saveConversation(conversationId);
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
      saveConversation(conversationId);
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
    saveConversation(conversationId);

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
const proto = server instanceof https.Server ? 'https' : 'http';
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Remote Chat running on ${proto}://0.0.0.0:${PORT}`);
});
