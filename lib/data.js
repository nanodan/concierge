const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { resolveConversationExecutionMode, modeToLegacyAutopilot } = require('./workflow/execution-mode');

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

function defaultModelForProvider(provider) {
  switch (provider) {
    case 'claude':
      return 'claude-sonnet-4.5';
    case 'codex':
      return 'gpt-5.3-codex';
    case 'ollama':
    default:
      return 'llama3.2';
  }
}

function ensureDirs() {
  fs.mkdirSync(CONV_DIR, { recursive: true });
}

async function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, filePath);
}

function convMeta(conv) {
  const provider = conv.provider || 'claude';
  const executionMode = resolveConversationExecutionMode(conv);
  return {
    id: conv.id,
    name: conv.name,
    cwd: conv.cwd,
    status: conv.status,
    archived: !!conv.archived,
    pinned: !!conv.pinned,
    executionMode,
    autopilot: modeToLegacyAutopilot(executionMode),
    sandboxed: conv.sandboxed !== false, // Default true for safety
    useMemory: conv.useMemory !== false,
    provider, // Default to Claude
    model: conv.model || defaultModelForProvider(provider),
    claudeSessionId: conv.claudeSessionId,
    codexSessionId: conv.codexSessionId,
    claudeForkSessionId: conv.claudeForkSessionId || null,
    createdAt: conv.createdAt,
    messageCount: conv.messages ? conv.messages.length : (conv.messageCount || 0),
    lastMessage: conv.messages && conv.messages.length > 0
      ? conv.messages[conv.messages.length - 1]
      : (conv.lastMessage || null),
    parentId: conv.parentId || null,
    forkIndex: conv.forkIndex != null ? conv.forkIndex : null,
    forkSourceCwd: conv.forkSourceCwd || null,
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
  } catch (err) {
    // ENOENT is expected for new conversations; log unexpected errors
    if (err.code !== 'ENOENT') {
      console.error(`[DATA] Failed to load messages for ${id}:`, err.message);
    }
    return [];
  }
}

async function deleteConversationFiles(id) {
  try {
    await fsp.unlink(path.join(CONV_DIR, `${id}.json`));
  } catch (err) {
    // ENOENT is expected if file was already deleted; log unexpected errors
    if (err.code !== 'ENOENT') {
      console.error(`[DATA] Failed to delete conversation file ${id}:`, err.message);
    }
  }
  // Clean up uploads
  const uploadDir = path.join(UPLOAD_DIR, id);
  try {
    await fsp.rm(uploadDir, { recursive: true, force: true });
  } catch (err) {
    // ENOENT is expected if no uploads; log unexpected errors
    if (err.code !== 'ENOENT') {
      console.error(`[DATA] Failed to delete upload dir ${id}:`, err.message);
    }
  }
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
    let staleCount = 0;
    for (const meta of arr) {
      // Reset stale "thinking" status - no processes survive server restart
      if (meta.status === 'thinking') {
        meta.status = 'idle';
        staleCount++;
      }
      conversations.set(meta.id, {
        ...meta,
        messages: null, // lazy — loaded on demand
      });
    }
    console.log(`Loaded index with ${arr.length} conversations`);
    if (staleCount > 0) {
      console.log(`Reset ${staleCount} stale "thinking" conversation(s) to idle`);
      // Persist the cleanup
      const cleanedArr = Array.from(conversations.values()).map(convMeta);
      fs.writeFileSync(INDEX_FILE, JSON.stringify(cleanedArr, null, 2));
    }
  } catch (err) {
    // ENOENT is expected for fresh installs; log unexpected errors
    if (err.code !== 'ENOENT') {
      console.error('[DATA] Failed to load index:', err.message);
    }
    // Start fresh
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
  } catch (err) {
    // ENOENT is expected when no global memories exist; log unexpected errors
    if (err.code !== 'ENOENT') {
      console.error('[DATA] Failed to load global memories:', err.message);
    }
  }

  // Load scope-specific memories if scope provided
  if (scope) {
    const hash = scopeHash(scope);
    const scopePath = path.join(MEMORY_DIR, `${hash}.json`);
    try {
      const raw = await fsp.readFile(scopePath, 'utf8');
      const scopeMemories = JSON.parse(raw);
      memories.push(...scopeMemories);
    } catch (err) {
      // ENOENT is expected when no scope memories exist; log unexpected errors
      if (err.code !== 'ENOENT') {
        console.error(`[DATA] Failed to load scope memories for ${scope}:`, err.message);
      }
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
  } catch (err) {
    // ENOENT is expected for new memory files; log unexpected errors
    if (err.code !== 'ENOENT') {
      console.error(`[DATA] Failed to load memory file ${filePath}:`, err.message);
    }
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
  } catch (err) {
    // ENOENT means memory file doesn't exist, which is expected for invalid IDs
    if (err.code !== 'ENOENT') {
      console.error(`[DATA] Failed to delete memory ${memoryId}:`, err.message);
    }
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
