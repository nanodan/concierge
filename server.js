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
  loadMessages,
} = require('./lib/data');
const {
  loadEmbeddings,
  backfillEmbeddings,
} = require('./lib/embeddings');
const {
  processStreamEvent,
  cancelProcess,
} = require('./lib/claude');
const { initProviders, getProvider } = require('./lib/providers');
const { resolveConversationExecutionMode, modeToLegacyAutopilot } = require('./lib/workflow/execution-mode');
const { acquireLock, releaseLock } = require('./lib/workflow/locks');

const app = express();
const RUN_LOCK_HEARTBEAT_MS = 20_000;
const activeRunLocks = new Map();

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
    } else if (msg.type === 'resend') {
      handleResend(ws, msg);
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

function ensureWriteAccess(
  ws,
  conv,
  actorConversationId,
  errorConversationId = actorConversationId,
  metadata = {}
) {
  if (!conv) return false;
  const executionMode = resolveConversationExecutionMode(conv);
  if (executionMode !== 'autonomous') return true;

  const lockResult = acquireLock(conv.cwd, actorConversationId);
  if (lockResult.ok) {
    startRunLockHeartbeat(ws, conv.cwd, actorConversationId, errorConversationId);
    return true;
  }

  const conflict = buildLockConflictPayload(lockResult.lock, lockResult.error);

  ws.send(JSON.stringify({
    type: 'error',
    conversationId: errorConversationId,
    code: lockResult.code || conflict.code,
    lock: conflict.lock,
    blockerConversationId: conflict.blockerConversationId,
    blockerConversationName: conflict.blockerConversationName,
    error: conflict.error,
    ...metadata,
  }));
  return false;
}

function buildLockConflictPayload(lock, fallbackError = 'Repository is locked by another conversation') {
  const blockerConversationId = lock?.writerConversationId || null;
  const blockerConversationName = blockerConversationId
    ? (conversations.get(blockerConversationId)?.name || null)
    : null;
  const error = blockerConversationName
    ? `Repository is locked by "${blockerConversationName}"`
    : fallbackError;
  return {
    code: 'WRITE_LOCKED',
    lock: lock || null,
    blockerConversationId,
    blockerConversationName,
    error,
  };
}

function stopRunLockHeartbeat(conversationId, { release = true, cwd = null } = {}) {
  const active = activeRunLocks.get(conversationId);
  if (active?.timer) {
    clearInterval(active.timer);
  }
  if (active) {
    activeRunLocks.delete(conversationId);
  }

  const releaseCwd = cwd || active?.cwd;
  if (release && releaseCwd) {
    releaseLock(releaseCwd, conversationId);
  }
}

function startRunLockHeartbeat(ws, cwd, conversationId, errorConversationId = conversationId) {
  stopRunLockHeartbeat(conversationId, { release: false });
  const lockCwd = cwd || process.env.HOME;

  const timer = setInterval(async () => {
    const renewResult = acquireLock(lockCwd, conversationId);
    if (renewResult.ok) return;

    stopRunLockHeartbeat(conversationId, { release: false, cwd: lockCwd });

    const conv = conversations.get(conversationId);
    const providerId = conv?.provider || 'claude';
    try {
      const provider = getProvider(providerId);
      provider.cancel(conversationId);
    } catch {
      cancelProcess(conversationId);
    }

    const conflict = buildLockConflictPayload(renewResult.lock, renewResult.error);
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'error',
        conversationId: errorConversationId,
        code: conflict.code,
        lock: conflict.lock,
        blockerConversationId: conflict.blockerConversationId,
        blockerConversationName: conflict.blockerConversationName,
        error: conflict.error,
      }));
    }

    await resetConversationOnError(conversationId);
  }, RUN_LOCK_HEARTBEAT_MS);

  activeRunLocks.set(conversationId, { timer, cwd: lockCwd });
}

function getProviderSessionField(providerId) {
  return providerId === 'codex' ? 'codexSessionId' : 'claudeSessionId';
}

function getLatestSessionId(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sessionId) return messages[i].sessionId;
  }
  return null;
}

function setConversationSession(conv, providerId, sessionId) {
  conv.claudeSessionId = null;
  conv.codexSessionId = null;
  if (providerId === 'claude') {
    conv.claudeForkSessionId = null;
  }
  if (!sessionId) return;
  conv[getProviderSessionField(providerId)] = sessionId;
}

function hydrateSessionFromMessages(conv, providerId) {
  if (providerId === 'claude' && conv.claudeForkSessionId) return;
  const key = getProviderSessionField(providerId);
  if (conv[key]) return;
  const sessionId = getLatestSessionId(conv.messages);
  if (sessionId) conv[key] = sessionId;
}

function stripSessionIdsFromMessages(messages = []) {
  let changed = false;
  const next = messages.map((msg) => {
    if (!msg || typeof msg !== 'object' || !msg.sessionId) return msg;
    changed = true;
    const { sessionId, ...rest } = msg;
    return rest;
  });
  return { messages: changed ? next : messages, changed };
}

async function clearInheritedForkSessionIfNeeded(conv, conversationId, providerId) {
  if (!conv?.parentId) return;

  const createdAt = Number(conv.createdAt) || 0;
  let latestSessionTimestamp = 0;
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const msg = conv.messages[i];
    if (msg?.sessionId) {
      latestSessionTimestamp = Number(msg.timestamp) || 0;
      break;
    }
  }

  // If latest session marker is newer than fork creation, this fork already has its own session.
  if (latestSessionTimestamp && latestSessionTimestamp >= createdAt) return;

  let changed = false;
  if (conv.claudeSessionId || conv.codexSessionId) {
    setConversationSession(conv, providerId, null);
    changed = true;
  }
  const stripped = stripSessionIdsFromMessages(conv.messages);
  if (stripped.changed) {
    conv.messages = stripped.messages;
    changed = true;
  }
  if (changed) {
    await saveConversation(conversationId);
  }
}

async function handleCancel(ws, msg) {
  const { conversationId } = msg;

  // Try to get the conversation to determine the provider
  const conv = conversations.get(conversationId);
  const providerId = conv?.provider || 'claude';

  let cancelled = false;
  try {
    const provider = getProvider(providerId);
    cancelled = provider.cancel(conversationId);
  } catch {
    // Fallback to legacy cancel
    cancelled = cancelProcess(conversationId);
  }

  if (!cancelled) {
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
    conv.thinkingStartTime = null;
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

    // Get the correct provider for this conversation
    const providerId = conv.provider || 'claude';
    let provider;
    try {
      provider = getProvider(providerId);
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: `Unknown provider: ${providerId}` }));
      return;
    }

    if (provider.isActive(conversationId)) {
      ws.send(JSON.stringify({ type: 'error', error: 'Conversation is busy' }));
      return;
    }

    await clearInheritedForkSessionIfNeeded(conv, conversationId, providerId);

    // Persist user input first so it is never lost, even when AUTO is lock-blocked.
    conv.messages.push({
      role: 'user',
      text,
      attachments: attachments || undefined,
      timestamp: Date.now(),
    });
    await saveConversation(conversationId);

    if (!ensureWriteAccess(ws, conv, conversationId, conversationId, { messageSaved: true })) {
      return;
    }

    hydrateSessionFromMessages(conv, providerId);

    conv.status = 'thinking';
    conv.thinkingStartTime = Date.now();
    await saveConversation(conversationId);
    broadcastStatus(conversationId, 'thinking', conv.thinkingStartTime);

    const memories = await loadConversationMemories(conv);
    provider.chat(ws, conversationId, conv, text, attachments, UPLOAD_DIR, {
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

    // Get the correct provider for this conversation
    const providerId = conv.provider || 'claude';
    let provider;
    try {
      provider = getProvider(providerId);
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: `Unknown provider: ${providerId}` }));
      return;
    }

    if (provider.isActive(conversationId)) {
      ws.send(JSON.stringify({ type: 'error', conversationId, error: 'Conversation is busy' }));
      return;
    }

    await clearInheritedForkSessionIfNeeded(conv, conversationId, providerId);

    if (!ensureWriteAccess(ws, conv, conversationId)) {
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
    setConversationSession(conv, providerId, null);
    conv.status = 'thinking';
    conv.thinkingStartTime = Date.now();
    await saveConversation(conversationId);
    broadcastStatus(conversationId, 'thinking', conv.thinkingStartTime);

    const memories = await loadConversationMemories(conv);
    provider.chat(ws, conversationId, conv, lastUserMsg.text, lastUserMsg.attachments, UPLOAD_DIR, {
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

    // Get the correct provider for this conversation
    const providerId = conv.provider || 'claude';
    let provider;
    try {
      provider = getProvider(providerId);
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: `Unknown provider: ${providerId}` }));
      return;
    }

    if (provider.isActive(conversationId)) {
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
    const messages = conv.messages.slice(0, messageIndex + 1).map((m) => {
      const { sessionId, ...rest } = m || {};
      return { ...rest };
    });

    // Update the edited message in the fork
    messages[messageIndex].text = text;
    messages[messageIndex].timestamp = Date.now();

    const thinkingStartTime = Date.now();
    const forkedConv = {
      id: newId,
      name: `${conv.name} (edit)`,
      cwd: conv.cwd,
      claudeSessionId: null,
      codexSessionId: null,
      messages,
      status: 'thinking',
      thinkingStartTime,
      archived: false,
      pinned: false,
      executionMode: resolveConversationExecutionMode(conv),
      autopilot: modeToLegacyAutopilot(resolveConversationExecutionMode(conv)),
      provider: conv.provider || 'claude',
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

    if (!ensureWriteAccess(ws, forkedConv, newId)) {
      forkedConv.status = 'idle';
      forkedConv.thinkingStartTime = null;
      await saveConversation(newId);
      broadcastStatus(newId, 'idle');
      return;
    }

    broadcastStatus(newId, 'thinking', thinkingStartTime);

    const memories = await loadConversationMemories(forkedConv);
    const userMsg = messages[messageIndex];
    provider.chat(ws, newId, forkedConv, userMsg.text, userMsg.attachments, UPLOAD_DIR, {
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

async function handleResend(ws, msg) {
  const { conversationId, messageIndex } = msg;
  let newId = null;

  try {
    const conv = await ensureMessages(conversationId);
    if (!conv) {
      ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found' }));
      return;
    }

    // Get the correct provider for this conversation
    const providerId = conv.provider || 'claude';
    let provider;
    try {
      provider = getProvider(providerId);
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: `Unknown provider: ${providerId}` }));
      return;
    }

    if (provider.isActive(conversationId)) {
      ws.send(JSON.stringify({ type: 'error', conversationId, error: 'Conversation is busy' }));
      return;
    }

    await clearInheritedForkSessionIfNeeded(conv, conversationId, providerId);

    if (typeof messageIndex !== 'number' || messageIndex < 0 || messageIndex >= conv.messages.length) {
      ws.send(JSON.stringify({ type: 'error', conversationId, error: 'Invalid message index' }));
      return;
    }

    const targetMsg = conv.messages[messageIndex];
    if (targetMsg.role !== 'user') {
      ws.send(JSON.stringify({ type: 'error', conversationId, error: 'Can only resend user messages' }));
      return;
    }

    const isLastMessage = messageIndex === conv.messages.length - 1;

    if (isLastMessage) {
      if (!ensureWriteAccess(ws, conv, conversationId)) {
        return;
      }

      // Resend in place - just spawn provider on this message
      hydrateSessionFromMessages(conv, providerId);
      conv.status = 'thinking';
      conv.thinkingStartTime = Date.now();
      await saveConversation(conversationId);
      broadcastStatus(conversationId, 'thinking', conv.thinkingStartTime);

      const memories = await loadConversationMemories(conv);
      provider.chat(ws, conversationId, conv, targetMsg.text, targetMsg.attachments, UPLOAD_DIR, {
        onSave: saveConversation,
        broadcastStatus,
      }, memories);
    } else {
      // Fork from this message and spawn provider on the fork
      newId = uuidv4();
      const messages = conv.messages.slice(0, messageIndex + 1).map((m) => {
        const { sessionId, ...rest } = m || {};
        return { ...rest };
      });

      const thinkingStartTime = Date.now();
      const forkedConv = {
        id: newId,
        name: `${conv.name} (resend)`,
        cwd: conv.cwd,
        claudeSessionId: null,
        codexSessionId: null,
        messages,
        status: 'thinking',
        thinkingStartTime,
        archived: false,
        pinned: false,
        executionMode: resolveConversationExecutionMode(conv),
        autopilot: modeToLegacyAutopilot(resolveConversationExecutionMode(conv)),
        provider: conv.provider || 'claude',
        model: conv.model,
        createdAt: Date.now(),
        parentId: conversationId,
        forkIndex: messageIndex,
      };
      conversations.set(newId, forkedConv);
      await saveConversation(newId);

      // Notify client of the fork
      ws.send(JSON.stringify({
        type: 'resend_forked',
        originalConversationId: conversationId,
        conversationId: newId,
        conversation: convMeta(forkedConv),
      }));

      if (!ensureWriteAccess(ws, forkedConv, newId)) {
        forkedConv.status = 'idle';
        forkedConv.thinkingStartTime = null;
        await saveConversation(newId);
        broadcastStatus(newId, 'idle');
        return;
      }

      broadcastStatus(newId, 'thinking', thinkingStartTime);

      const memories = await loadConversationMemories(forkedConv);
      provider.chat(ws, newId, forkedConv, targetMsg.text, targetMsg.attachments, UPLOAD_DIR, {
        onSave: saveConversation,
        broadcastStatus,
      }, memories);
    }
  } catch (err) {
    console.error('[WS] handleResend error:', err);
    const errorConvId = newId || conversationId;
    ws.send(JSON.stringify({ type: 'error', conversationId: errorConvId, error: 'Internal server error' }));
    await resetConversationOnError(errorConvId);
  }
}

function broadcastStatus(conversationId, status, thinkingStartTime) {
  if (status !== 'thinking') {
    stopRunLockHeartbeat(conversationId, { release: true });
  }

  const payload = { type: 'status', conversationId, status };
  if (thinkingStartTime) payload.thinkingStartTime = thinkingStartTime;
  const msg = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

// Start server (guarded for testability)
if (require.main === module) {
  // Initialize providers first
  initProviders();

  loadFromDisk();

  // Load embeddings and start backfill in background (non-blocking)
  loadEmbeddings().then(() => {
    // Run backfill after embeddings are loaded
    backfillEmbeddings(conversations, loadMessages).catch(err => {
      console.error('[EMBED] Backfill error:', err.message);
    });
  }).catch(err => {
    console.error('[EMBED] Failed to load embeddings:', err.message);
  });

  const PORT = process.env.PORT || 3577;
  const proto = server instanceof https.Server ? 'https' : 'http';
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Concierge running on ${proto}://0.0.0.0:${PORT}`);
  });
}

module.exports = { convMeta, atomicWrite, processStreamEvent, loadFromDisk, conversations };
