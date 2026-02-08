const express = require('express');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const MODELS = [
  { id: 'opus', name: 'Opus 4.6', context: 200000 },
  { id: 'claude-opus-4-20250514', name: 'Opus 4', context: 200000 },
  { id: 'sonnet', name: 'Sonnet 4.5', context: 200000 },
  { id: 'claude-sonnet-4-20250514', name: 'Sonnet 4', context: 200000 },
  { id: 'haiku', name: 'Haiku 4.5', context: 200000 },
];

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

async function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, filePath);
}

function convMeta(conv) {
  return {
    id: conv.id,
    name: conv.name,
    cwd: conv.cwd,
    status: conv.status,
    archived: !!conv.archived,
    autopilot: conv.autopilot !== false,
    model: conv.model || 'sonnet',
    claudeSessionId: conv.claudeSessionId,
    createdAt: conv.createdAt,
    messageCount: conv.messages ? conv.messages.length : (conv.messageCount || 0),
    lastMessage: conv.messages && conv.messages.length > 0
      ? conv.messages[conv.messages.length - 1]
      : (conv.lastMessage || null),
  };
}

async function saveIndex() {
  ensureDirs();
  const arr = Array.from(conversations.values()).map(convMeta);
  await atomicWrite(INDEX_FILE, JSON.stringify(arr, null, 2));
}

async function saveConversation(id) {
  ensureDirs();
  const conv = conversations.get(id);
  if (!conv) return;
  await atomicWrite(
    path.join(CONV_DIR, `${id}.json`),
    JSON.stringify(conv.messages || [], null, 2)
  );
  await saveIndex();
}

async function loadMessages(id) {
  try {
    const raw = await fsp.readFile(path.join(CONV_DIR, `${id}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function deleteConversationFiles(id) {
  try { await fsp.unlink(path.join(CONV_DIR, `${id}.json`)); } catch {}
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
        fs.writeFileSync(
          path.join(CONV_DIR, `${conv.id}.json`),
          JSON.stringify(conv.messages || [], null, 2)
        );
      }
      // Sync write for migration (one-time startup)
      const indexArr = Array.from(conversations.values()).map(convMeta);
      fs.writeFileSync(INDEX_FILE, JSON.stringify(indexArr, null, 2));
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
async function ensureMessages(id) {
  const conv = conversations.get(id);
  if (!conv) return null;
  if (conv.messages === null) {
    conv.messages = await loadMessages(id);
  }
  return conv;
}

// Active Claude processes per conversation
const activeProcesses = new Map();
const PROCESS_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// --- REST API ---

// Available models
app.get('/api/models', (req, res) => {
  res.json(MODELS);
});

// Browse directories
app.get('/api/browse', async (req, res) => {
  const target = req.query.path || process.env.HOME;
  const resolved = path.resolve(target);
  try {
    const entries = await fsp.readdir(resolved, { withFileTypes: true });
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
app.post('/api/mkdir', async (req, res) => {
  const target = req.body.path;
  if (!target) return res.status(400).json({ error: 'path required' });
  try {
    await fsp.mkdir(target, { recursive: true });
    res.json({ ok: true, path: target });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Create conversation
app.post('/api/conversations', async (req, res) => {
  const { name, cwd, autopilot, model } = req.body;
  const id = uuidv4();
  const conversation = {
    id,
    name: name || 'New Chat',
    cwd: cwd || process.env.HOME,
    claudeSessionId: null,
    messages: [],
    status: 'idle',
    archived: false,
    autopilot: autopilot !== false,
    model: model || 'sonnet',
    createdAt: Date.now(),
  };
  conversations.set(id, conversation);
  await saveConversation(id);
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
app.get('/api/conversations/search', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);

  const results = [];
  for (const c of conversations.values()) {
    const nameMatch = c.name.toLowerCase().includes(q);
    const messages = c.messages !== null ? c.messages : await loadMessages(c.id);
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

// Update conversation (archive, rename, model, autopilot)
app.patch('/api/conversations/:id', async (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  if (req.body.archived !== undefined) conv.archived = !!req.body.archived;
  if (req.body.name !== undefined) conv.name = String(req.body.name).trim() || conv.name;
  if (req.body.model !== undefined) conv.model = String(req.body.model);
  if (req.body.autopilot !== undefined) conv.autopilot = !!req.body.autopilot;
  await saveIndex();
  res.json({ ok: true, id: conv.id, name: conv.name, archived: conv.archived, model: conv.model || 'sonnet', autopilot: conv.autopilot !== false });
});

// Get conversation detail (loads messages into memory)
app.get('/api/conversations/:id', async (req, res) => {
  const conv = await ensureMessages(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  res.json(conv);
});

// Stats
app.get('/api/stats', async (req, res) => {
  let totalMessages = 0, userMessages = 0, assistantMessages = 0;
  let totalCost = 0, totalDuration = 0, totalUserChars = 0, totalAssistantChars = 0;
  let activeCount = 0, archivedCount = 0;
  const dailyCounts = {};
  const hourlyCounts = new Array(24).fill(0);
  const topConversations = [];

  for (const c of conversations.values()) {
    if (c.archived) archivedCount++; else activeCount++;
    const messages = c.messages !== null ? c.messages : await loadMessages(c.id);
    let convMsgCount = 0, convCost = 0;
    for (const m of messages) {
      totalMessages++;
      convMsgCount++;
      if (m.role === 'user') {
        userMessages++;
        totalUserChars += (m.text || '').length;
      } else {
        assistantMessages++;
        totalAssistantChars += (m.text || '').length;
      }
      if (m.cost) { totalCost += m.cost; convCost += m.cost; }
      if (m.duration) totalDuration += m.duration;
      if (m.timestamp) {
        const d = new Date(m.timestamp);
        const day = d.toISOString().slice(0, 10);
        dailyCounts[day] = (dailyCounts[day] || 0) + 1;
        hourlyCounts[d.getHours()]++;
      }
    }
    topConversations.push({ name: c.name, messages: convMsgCount, cost: convCost });
  }

  topConversations.sort((a, b) => b.messages - a.messages);

  // Build daily activity for last 30 days
  const dailyActivity = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailyActivity.push({ date: key, count: dailyCounts[key] || 0 });
  }

  // Streak: consecutive days with messages ending today or yesterday
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (dailyCounts[key]) streak++; else break;
  }

  res.json({
    conversations: { total: activeCount + archivedCount, active: activeCount, archived: archivedCount },
    messages: { total: totalMessages, user: userMessages, assistant: assistantMessages },
    cost: Math.round(totalCost * 10000) / 10000,
    duration: Math.round(totalDuration / 1000),
    characters: { user: totalUserChars, assistant: totalAssistantChars },
    dailyActivity,
    hourlyCounts,
    streak,
    topConversations: topConversations.slice(0, 5),
  });
});

// Delete conversation
app.delete('/api/conversations/:id', async (req, res) => {
  const id = req.params.id;
  const proc = activeProcesses.get(id);
  if (proc) {
    proc.kill('SIGTERM');
    activeProcesses.delete(id);
  }
  conversations.delete(id);
  await deleteConversationFiles(id);
  await saveIndex();
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
    } else if (msg.type === 'cancel') {
      handleCancel(ws, msg);
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

function handleCancel(ws, msg) {
  const { conversationId } = msg;
  const proc = activeProcesses.get(conversationId);
  if (!proc) {
    ws.send(JSON.stringify({ type: 'error', conversationId, error: 'No active process to cancel' }));
    return;
  }
  proc.kill('SIGTERM');
}

async function handleMessage(ws, msg) {
  const { conversationId, text } = msg;
  const conv = await ensureMessages(conversationId);
  if (!conv) {
    ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found' }));
    return;
  }

  if (activeProcesses.has(conversationId)) {
    ws.send(JSON.stringify({ type: 'error', error: 'Conversation is busy' }));
    return;
  }

  conv.messages.push({
    role: 'user',
    text,
    timestamp: Date.now(),
  });
  conv.status = 'thinking';
  await saveConversation(conversationId);
  broadcastStatus(conversationId, 'thinking');

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
      const result = processStreamEvent(ws, conversationId, conv, event, assistantText);
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
        const result = processStreamEvent(ws, conversationId, conv, event, assistantText);
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
      await saveConversation(conversationId);
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

function processStreamEvent(ws, conversationId, conv, event, assistantText) {
  if (event.type === 'stream_event' && event.event) {
    const inner = event.event;
    if (inner.type === 'content_block_delta' && inner.delta && inner.delta.type === 'text_delta') {
      assistantText += inner.delta.text;
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
  } else if (event.type === 'result') {
    const resultText = event.result || assistantText;
    if (event.session_id) {
      conv.claudeSessionId = event.session_id;
    }
    assistantText = resultText;

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
    saveConversation(conversationId);

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

function broadcastStatus(conversationId, status) {
  const msg = JSON.stringify({ type: 'status', conversationId, status });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

// Start server (guarded for testability)
if (require.main === module) {
  loadFromDisk();
  const PORT = process.env.PORT || 3577;
  const proto = server instanceof https.Server ? 'https' : 'http';
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Claude Remote Chat running on ${proto}://0.0.0.0:${PORT}`);
  });
}

module.exports = { convMeta, atomicWrite, processStreamEvent, loadFromDisk, conversations };
