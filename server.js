const express = require('express');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { setupRoutes } = require('./lib/routes/index');
const {
  UPLOAD_DIR,
  conversations,
  convMeta,
  atomicWrite,
  saveConversation,
  loadFromDisk,
  ensureMessages,
  loadMemories,
} = require('./lib/data');
const {
  spawnClaude,
  processStreamEvent,
  cancelProcess,
  hasActiveProcess,
} = require('./lib/claude');

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

// Serve uploaded files
app.use('/uploads', express.static(UPLOAD_DIR));

// Setup REST API routes
setupRoutes(app);

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
    } else if (msg.type === 'regenerate') {
      handleRegenerate(ws, msg);
    } else if (msg.type === 'edit') {
      handleEdit(ws, msg);
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

async function loadConversationMemories(conv) {
  if (conv.useMemory === false) return [];
  return loadMemories(conv.cwd);
}

function handleCancel(ws, msg) {
  const { conversationId } = msg;
  if (!cancelProcess(conversationId)) {
    ws.send(JSON.stringify({ type: 'error', conversationId, error: 'No active process to cancel' }));
  }
}

/**
 * Reset conversation status to idle on error.
 * Best-effort save and broadcast - if save fails, we still try to broadcast.
 * @param {string} conversationId - The conversation ID to reset
 */
async function resetConversationOnError(conversationId) {
  const conv = conversations.get(conversationId);
  if (conv) {
    conv.status = 'idle';
    try {
      await saveConversation(conversationId);
    } catch (saveErr) {
      console.error('[WS] Failed to save conversation state after error:', saveErr);
    }
    broadcastStatus(conversationId, 'idle');
  }
}

async function handleMessage(ws, msg) {
  const { conversationId, text, attachments } = msg;
  try {
    const conv = await ensureMessages(conversationId);
    if (!conv) {
      ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found' }));
      return;
    }

    if (hasActiveProcess(conversationId)) {
      ws.send(JSON.stringify({ type: 'error', error: 'Conversation is busy' }));
      return;
    }

    conv.messages.push({
      role: 'user',
      text,
      attachments: attachments || undefined,
      timestamp: Date.now(),
    });
    conv.status = 'thinking';
    await saveConversation(conversationId);
    broadcastStatus(conversationId, 'thinking');

    const memories = await loadConversationMemories(conv);
    spawnClaude(ws, conversationId, conv, text, attachments, UPLOAD_DIR, {
      onSave: saveConversation,
      broadcastStatus,
    }, memories);
  } catch (err) {
    console.error('[WS] handleMessage error:', err);
    ws.send(JSON.stringify({ type: 'error', conversationId, error: 'Internal server error' }));
    await resetConversationOnError(conversationId);
  }
}

async function handleRegenerate(ws, msg) {
  const { conversationId } = msg;
  try {
    const conv = await ensureMessages(conversationId);
    if (!conv) {
      ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found' }));
      return;
    }

    if (hasActiveProcess(conversationId)) {
      ws.send(JSON.stringify({ type: 'error', conversationId, error: 'Conversation is busy' }));
      return;
    }

    // Remove last assistant message
    if (conv.messages.length > 0 && conv.messages[conv.messages.length - 1].role === 'assistant') {
      conv.messages.pop();
    }

    const lastUserMsg = [...conv.messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) {
      ws.send(JSON.stringify({ type: 'error', conversationId, error: 'No user message to regenerate from' }));
      return;
    }

    // Reset session for fresh response
    conv.claudeSessionId = null;
    conv.status = 'thinking';
    await saveConversation(conversationId);
    broadcastStatus(conversationId, 'thinking');

    const memories = await loadConversationMemories(conv);
    spawnClaude(ws, conversationId, conv, lastUserMsg.text, lastUserMsg.attachments, UPLOAD_DIR, {
      onSave: saveConversation,
      broadcastStatus,
    }, memories);
  } catch (err) {
    console.error('[WS] handleRegenerate error:', err);
    ws.send(JSON.stringify({ type: 'error', conversationId, error: 'Internal server error' }));
    await resetConversationOnError(conversationId);
  }
}

async function handleEdit(ws, msg) {
  const { conversationId, messageIndex, text } = msg;
  let newId = null; // Track the forked conversation ID for error cleanup
  try {
    const conv = await ensureMessages(conversationId);
    if (!conv) {
      ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found' }));
      return;
    }

    if (hasActiveProcess(conversationId)) {
      ws.send(JSON.stringify({ type: 'error', conversationId, error: 'Conversation is busy' }));
      return;
    }

    if (messageIndex < 0 || messageIndex >= conv.messages.length) {
      ws.send(JSON.stringify({ type: 'error', conversationId, error: 'Invalid message index' }));
      return;
    }

    if (conv.messages[messageIndex].role !== 'user') {
      ws.send(JSON.stringify({ type: 'error', conversationId, error: 'Can only edit user messages' }));
      return;
    }

    // Auto-fork: create a new conversation instead of truncating
    newId = uuidv4();
    const messages = conv.messages.slice(0, messageIndex + 1).map(m => ({ ...m }));

    // Update the edited message in the fork
    messages[messageIndex].text = text;
    messages[messageIndex].timestamp = Date.now();

    const forkedConv = {
      id: newId,
      name: `${conv.name} (edit)`,
      cwd: conv.cwd,
      claudeSessionId: null, // Fresh session for the edit
      messages,
      status: 'thinking',
      archived: false,
      pinned: false,
      autopilot: conv.autopilot,
      model: conv.model,
      createdAt: Date.now(),
      parentId: conversationId,
      forkIndex: messageIndex,
    };

    conversations.set(newId, forkedConv);
    await saveConversation(newId);

    // Notify client of the fork and switch to it
    ws.send(JSON.stringify({
      type: 'edit_forked',
      originalConversationId: conversationId,
      conversationId: newId,
      conversation: convMeta(forkedConv),
    }));

    broadcastStatus(newId, 'thinking');

    const memories = await loadConversationMemories(forkedConv);
    const userMsg = messages[messageIndex];
    spawnClaude(ws, newId, forkedConv, userMsg.text, userMsg.attachments, UPLOAD_DIR, {
      onSave: saveConversation,
      broadcastStatus,
    }, memories);
  } catch (err) {
    console.error('[WS] handleEdit error:', err);
    const errorConvId = newId || conversationId;
    ws.send(JSON.stringify({ type: 'error', conversationId: errorConvId, error: 'Internal server error' }));
    await resetConversationOnError(errorConvId);
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
