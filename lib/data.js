const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

// Persistent conversation store — split into index + per-conversation files
const DATA_DIR = path.join(__dirname, '..', 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const CONV_DIR = path.join(DATA_DIR, 'conv');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MEMORY_DIR = path.join(DATA_DIR, 'memory');
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
    useMemory: conv.useMemory !== false,
    model: conv.model || 'sonnet',
    claudeSessionId: conv.claudeSessionId,
    createdAt: conv.createdAt,
    messageCount: conv.messages ? conv.messages.length : (conv.messageCount || 0),
    lastMessage: conv.messages && conv.messages.length > 0
      ? conv.messages[conv.messages.length - 1]
      : (conv.lastMessage || null),
    parentId: conv.parentId || null,
    forkIndex: conv.forkIndex != null ? conv.forkIndex : null,
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

// --- Memory storage ---

// Create safe filename from cwd path
function scopeHash(cwd) {
  if (!cwd) return null;
  return crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16);
}

// Load memories for a scope (global + project)
async function loadMemories(scope = null) {
  const memories = [];

  // Load global memories
  const globalPath = path.join(MEMORY_DIR, 'global.json');
  try {
    const raw = await fsp.readFile(globalPath, 'utf8');
    const globalMemories = JSON.parse(raw);
    memories.push(...globalMemories);
  } catch {
    // No global memories yet
  }

  // Load scope-specific memories if scope provided
  if (scope) {
    const hash = scopeHash(scope);
    const scopePath = path.join(MEMORY_DIR, `${hash}.json`);
    try {
      const raw = await fsp.readFile(scopePath, 'utf8');
      const scopeMemories = JSON.parse(raw);
      memories.push(...scopeMemories);
    } catch {
      // No scope-specific memories yet
    }
  }

  return memories;
}

// Save a memory
async function saveMemory(memory) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });

  const isGlobal = memory.scope === 'global';
  const fileName = isGlobal ? 'global.json' : `${scopeHash(memory.scope)}.json`;
  const filePath = path.join(MEMORY_DIR, fileName);

  // Load existing memories for this file
  let memories = [];
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    memories = JSON.parse(raw);
  } catch {
    // File doesn't exist yet
  }

  // Check if updating existing or adding new
  const existingIdx = memories.findIndex(m => m.id === memory.id);
  if (existingIdx >= 0) {
    memories[existingIdx] = memory;
  } else {
    memories.push(memory);
  }

  await atomicWrite(filePath, JSON.stringify(memories, null, 2));
  return memory;
}

// Delete a memory
async function deleteMemory(memoryId, scope) {
  const isGlobal = scope === 'global';
  const fileName = isGlobal ? 'global.json' : `${scopeHash(scope)}.json`;
  const filePath = path.join(MEMORY_DIR, fileName);

  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    let memories = JSON.parse(raw);
    memories = memories.filter(m => m.id !== memoryId);
    await atomicWrite(filePath, JSON.stringify(memories, null, 2));
    return true;
  } catch {
    return false;
  }
}

// Get a single memory by ID
async function getMemory(memoryId, scope) {
  const memories = await loadMemories(scope);
  return memories.find(m => m.id === memoryId) || null;
}

module.exports = {
  DATA_DIR,
  INDEX_FILE,
  CONV_DIR,
  UPLOAD_DIR,
  MEMORY_DIR,
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
  // Memory functions
  scopeHash,
  loadMemories,
  saveMemory,
  deleteMemory,
  getMemory,
};
