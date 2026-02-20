/**
 * Semantic embeddings module using local transformer model.
 * Uses @xenova/transformers with all-MiniLM-L6-v2 for generating embeddings locally.
 */
const { pipeline } = require('@xenova/transformers');
const fsp = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const EMBEDDINGS_FILE = path.join(DATA_DIR, 'embeddings.json');

let embedder = null;
let embeddings = new Map(); // convId -> { text, vector }
let modelLoading = null; // Promise for model loading (prevents duplicate loads)

/**
 * Initialize the embedding pipeline (lazy load on first use).
 * The model (~23MB) downloads automatically on first use and is cached locally.
 */
async function getEmbedder() {
  if (embedder) return embedder;
  if (modelLoading) return modelLoading;

  console.log('[EMBED] Loading embedding model (first time may download ~23MB)...');
  modelLoading = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  embedder = await modelLoading;
  modelLoading = null;
  console.log('[EMBED] Embedding model loaded');
  return embedder;
}

/**
 * Generate embedding vector for text.
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - 384-dimensional normalized vector
 */
async function embed(text) {
  const model = await getEmbedder();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Load embeddings from disk.
 */
async function loadEmbeddings() {
  try {
    const raw = await fsp.readFile(EMBEDDINGS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    // Filter out invalid entries (missing id)
    const valid = arr.filter(e => e.id && e.vector);
    embeddings = new Map(valid.map(e => [e.id, { text: e.text, vector: e.vector }]));
    console.log(`[EMBED] Loaded ${embeddings.size} embeddings from disk`);
    // Clean up file if we filtered any invalid entries
    if (valid.length < arr.length) {
      console.log(`[EMBED] Cleaned ${arr.length - valid.length} invalid entries`);
      await saveEmbeddings();
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[EMBED] Load failed:', err.message);
    }
  }
}

/**
 * Save embeddings to disk.
 */
async function saveEmbeddings() {
  const arr = Array.from(embeddings.entries()).map(([id, data]) => ({
    id,
    text: data.text,
    vector: data.vector,
  }));
  await fsp.writeFile(EMBEDDINGS_FILE, JSON.stringify(arr));
}

/**
 * Generate embedding for a conversation (name + first user message).
 * @param {Object} conv - Conversation object with id, name, and messages
 */
async function embedConversation(conv) {
  // Validate conversation has an id
  if (!conv.id) {
    console.error('[EMBED] Cannot embed conversation without id');
    return;
  }

  const firstUserMsg = conv.messages?.find(m => m.role === 'user');
  // Combine name and first message, truncate to 512 chars for efficiency
  const text = [conv.name, firstUserMsg?.text || ''].join('\n').slice(0, 512);

  try {
    const vector = await embed(text);
    embeddings.set(conv.id, { text, vector });
    await saveEmbeddings();
  } catch (err) {
    console.error(`[EMBED] Failed to embed conversation ${conv.id}:`, err.message);
  }
}

/**
 * Cosine similarity between two normalized vectors.
 * Since vectors are normalized, dot product equals cosine similarity.
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Search by semantic similarity.
 * @param {string} query - Search query
 * @param {number} topK - Maximum number of results
 * @returns {Promise<Array>} - Array of { id, score, text } sorted by similarity
 */
async function semanticSearch(query, topK = 10) {
  const queryVector = await embed(query);
  const results = [];

  for (const [id, data] of embeddings) {
    const score = cosineSimilarity(queryVector, data.vector);
    results.push({ id, score, text: data.text });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * Remove embedding when conversation is deleted.
 * @param {string} convId - Conversation ID to remove
 */
function deleteEmbedding(convId) {
  if (embeddings.has(convId)) {
    embeddings.delete(convId);
    saveEmbeddings().catch(err => {
      console.error('[EMBED] Save failed after delete:', err.message);
    });
  }
}

/**
 * Check if a conversation has an embedding.
 * @param {string} convId - Conversation ID
 * @returns {boolean}
 */
function hasEmbedding(convId) {
  return embeddings.has(convId);
}

/**
 * Backfill embeddings for existing conversations.
 * Runs in background, doesn't block startup.
 * @param {Map} conversations - The conversations map
 * @param {Function} loadMessages - Function to load messages for a conversation
 */
async function backfillEmbeddings(conversations, loadMessages) {
  let count = 0;
  let skipped = 0;

  for (const conv of conversations.values()) {
    // Skip if already embedded
    if (embeddings.has(conv.id)) {
      skipped++;
      continue;
    }

    // Load messages if not already loaded
    const messages = conv.messages ?? await loadMessages(conv.id);

    // Skip empty conversations
    if (!messages || messages.length === 0) {
      continue;
    }

    await embedConversation({ ...conv, messages });
    count++;

    // Log progress every 10 conversations
    if (count % 10 === 0) {
      console.log(`[EMBED] Backfilled ${count} conversations...`);
    }

    // Small delay to prevent blocking the event loop
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  if (count > 0 || skipped > 0) {
    console.log(`[EMBED] Backfill complete: ${count} new, ${skipped} already embedded`);
  }
}

/**
 * Get the number of stored embeddings.
 * @returns {number}
 */
function getEmbeddingsCount() {
  return embeddings.size;
}

module.exports = {
  loadEmbeddings,
  embedConversation,
  semanticSearch,
  deleteEmbedding,
  hasEmbedding,
  backfillEmbeddings,
  getEmbeddingsCount,
};
