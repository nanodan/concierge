const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Persistent conversation store — split into index + per-conversation files
const DATA_DIR = path.join(__dirname, '..', 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const CONV_DIR = path.join(DATA_DIR, 'conv');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const LEGACY_FILE = path.join(DATA_DIR, 'conversations.json');

const conversations = new Map(); // id -> { metadata + messages (lazy) }

// Stats cache
let statsCache = null;
let statsCacheTime = 0;
const STATS_CACHE_TTL = 30000; // 30 seconds

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
    pinned: !!conv.pinned,
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
  invalidateStatsCache();
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
  // Clean up uploads
  const uploadDir = path.join(UPLOAD_DIR, id);
  try { await fsp.rm(uploadDir, { recursive: true, force: true }); } catch {}
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

// Stats cache helpers
function getStatsCache() {
  if (statsCache && Date.now() - statsCacheTime < STATS_CACHE_TTL) {
    return statsCache;
  }
  return null;
}

function setStatsCache(data) {
  statsCache = data;
  statsCacheTime = Date.now();
}

function invalidateStatsCache() {
  statsCache = null;
}

module.exports = {
  DATA_DIR,
  INDEX_FILE,
  CONV_DIR,
  UPLOAD_DIR,
  conversations,
  ensureDirs,
  atomicWrite,
  convMeta,
  saveIndex,
  saveConversation,
  loadMessages,
  deleteConversationFiles,
  loadFromDisk,
  ensureMessages,
  getStatsCache,
  setStatsCache,
  invalidateStatsCache,
};
