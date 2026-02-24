/**
 * Conversation CRUD, search, export, fork, compress, and tree routes
 */
const { v4: uuidv4 } = require('uuid');
const fsp = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const {
  conversations,
  convMeta,
  saveIndex,
  saveConversation,
  loadMessages,
  deleteConversationFiles,
  ensureMessages,
  getStatsCache,
  setStatsCache,
} = require('../data');

const { generateSummary, MODELS } = require('../claude');
const { MODELS: CODEX_MODELS } = require('../providers/codex');
const { getProvider, getAllProviders } = require('../providers');
const { withConversation } = require('./helpers');
const { stopPreview } = require('./preview');
const { semanticSearch, deleteEmbedding, getEmbeddingsCount } = require('../embeddings');
const {
  EXECUTION_MODE_VALUES,
  normalizeExecutionMode,
  inferExecutionModeFromLegacyAutopilot,
  resolveConversationExecutionMode,
  modeToLegacyAutopilot,
  applyExecutionMode,
} = require('../workflow/execution-mode');
const execFileAsync = promisify(execFile);

/**
 * Get the base name of a conversation, stripping any fork suffix.
 * E.g., "Refactor auth (fork 2)" → "Refactor auth"
 * @param {string} name - The conversation name
 * @returns {string} - The base name without fork suffix
 */
function getBaseName(name) {
  return name.replace(/\s*\(fork(?:\s+\d+)?\)\s*$/, '').trim();
}

/**
 * Count total forks in a fork family (including transitive forks).
 * @param {Map} conversations - The conversations map
 * @param {string} rootId - The root conversation ID
 * @returns {number} - Total number of forks
 */
function countForksInFamily(conversations, rootId) {
  let count = 0;
  for (const conv of conversations.values()) {
    if (conv.parentId) {
      // Walk up to find the root
      let current = conv;
      while (current.parentId) {
        const parent = conversations.get(current.parentId);
        if (!parent) break;
        current = parent;
      }
      if (current.id === rootId) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Find the root conversation ID for a given conversation.
 * @param {Map} conversations - The conversations map
 * @param {string} id - The conversation ID
 * @returns {string} - The root conversation ID
 */
function findRootId(conversations, id) {
  let current = conversations.get(id);
  while (current && current.parentId) {
    const parent = conversations.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current ? current.id : id;
}

// Validation constants
const MAX_NAME_LENGTH = 200;
const VALID_PROVIDERS = new Set(['claude', 'codex', 'ollama']);
const VALID_MODEL_IDS = new Set(MODELS.map(m => m.id));

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

async function runGit(args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd });
    return { ok: true, stdout: stdout || '', stderr: stderr || '' };
  } catch (err) {
    return { ok: false, stdout: err.stdout || '', stderr: err.stderr || err.message };
  }
}

function slugifyWorktreeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'fork';
}

async function ensureUniquePath(basePath) {
  for (let i = 0; i < 200; i++) {
    const candidate = i === 0 ? basePath : `${basePath}-${i + 1}`;
    try {
      await fsp.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error('Unable to allocate unique worktree path');
}

async function createForkWorktree(sourceCwd, branchHint) {
  const rootResult = await runGit(['rev-parse', '--show-toplevel'], sourceCwd);
  if (!rootResult.ok) {
    return { ok: false, error: 'Folder is not inside a git repository' };
  }

  const repoRoot = rootResult.stdout.trim();
  const repoParent = path.dirname(repoRoot);
  const repoName = path.basename(repoRoot);
  const branchName = `fork/${slugifyWorktreeName(branchHint)}`;
  const worktreePathBase = path.join(repoParent, `${repoName}-${slugifyWorktreeName(branchHint)}`);
  const worktreePath = await ensureUniquePath(worktreePathBase);

  const addResult = await runGit(['worktree', 'add', '-b', branchName, worktreePath], repoRoot);
  if (!addResult.ok) {
    return { ok: false, error: addResult.stderr || 'Failed to create worktree' };
  }

  return { ok: true, cwd: worktreePath, branch: branchName };
}

/**
 * Comparator for sorting conversations by most recent activity.
 * Optionally respects pinned status (pinned conversations come first).
 * @param {Object} a - First conversation
 * @param {Object} b - Second conversation
 * @param {Object} options - Options
 * @param {boolean} [options.respectPinned=false] - Whether to sort pinned items first
 * @returns {number} - Comparison result
 */
function compareConversations(a, b, options = {}) {
  const { respectPinned = false } = options;

  // Pinned items first (if enabled)
  if (respectPinned) {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
  }

  // Then by most recent activity
  const aTime = a.lastMessage ? a.lastMessage.timestamp : a.createdAt;
  const bTime = b.lastMessage ? b.lastMessage.timestamp : b.createdAt;
  return bTime - aTime;
}

/**
 * Validate conversation creation payload.
 * @param {Object} body - Request body
 * @returns {{valid: boolean, error?: string}}
 */
async function validateConversationCreate(body) {
  const { name, cwd, model, provider, executionMode } = body;

  // Validate name length
  if (name && name.length > MAX_NAME_LENGTH) {
    return { valid: false, error: `Name must be ${MAX_NAME_LENGTH} characters or less` };
  }

  // Validate cwd exists (if provided)
  if (cwd) {
    try {
      const stat = await fsp.stat(cwd);
      if (!stat.isDirectory()) {
        return { valid: false, error: 'cwd must be a directory' };
      }
    } catch (_err) {
      return { valid: false, error: 'cwd does not exist or is not accessible' };
    }
  }

  // Validate provider (if provided)
  if (provider && !VALID_PROVIDERS.has(provider)) {
    return { valid: false, error: `Invalid provider. Valid providers: ${Array.from(VALID_PROVIDERS).join(', ')}` };
  }

  // Validate model based on provider
  // For Claude, validate against known models; for Codex/Ollama, accept any model
  const effectiveProvider = provider || 'claude';
  if (model && effectiveProvider === 'claude' && !VALID_MODEL_IDS.has(model)) {
    return { valid: false, error: `Invalid model. Valid models: ${Array.from(VALID_MODEL_IDS).join(', ')}` };
  }

  if (executionMode !== undefined && !EXECUTION_MODE_VALUES.has(executionMode)) {
    return { valid: false, error: `Invalid executionMode. Valid modes: ${Array.from(EXECUTION_MODE_VALUES).join(', ')}` };
  }

  return { valid: true };
}

function setupConversationRoutes(app) {
  // Available providers
  app.get('/api/providers', (_req, res) => {
    try {
      res.json(getAllProviders());
    } catch {
      // Providers not initialized yet, return static list
      res.json([
        { id: 'claude', name: 'Claude' },
        { id: 'codex', name: 'OpenAI Codex' },
        { id: 'ollama', name: 'Ollama' },
      ]);
    }
  });

  // Available models (optionally filtered by provider)
  app.get('/api/models', async (req, res) => {
    const providerId = req.query.provider || 'claude';

    try {
      const provider = getProvider(providerId);
      const models = await provider.getModels();
      res.json(models);
    } catch {
      // Fallback for initialization or unknown provider
      if (providerId === 'claude') {
        res.json(MODELS);
      } else if (providerId === 'codex') {
        res.json(CODEX_MODELS);
      } else {
        res.status(400).json({ error: `Unknown provider: ${providerId}` });
      }
    }
  });

  // Create conversation
  app.post('/api/conversations', async (req, res) => {
    const validation = await validateConversationCreate(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const { name, cwd, autopilot, model, sandboxed, provider, executionMode } = req.body;
    const id = uuidv4();
    const effectiveProvider = provider || 'claude';

    // Set default model based on provider
    const effectiveModel = model || defaultModelForProvider(effectiveProvider);

    let effectiveExecutionMode = executionMode !== undefined
      ? normalizeExecutionMode(executionMode)
      : (autopilot !== undefined
          ? inferExecutionModeFromLegacyAutopilot(autopilot)
          : 'patch');

    const effectiveCwd = cwd || process.env.HOME;

    const conversation = {
      id,
      name: name || 'New Chat',
      cwd: effectiveCwd,
      claudeSessionId: null,
      codexSessionId: null,
      messages: [],
      status: 'idle',
      archived: false,
      executionMode: effectiveExecutionMode,
      autopilot: modeToLegacyAutopilot(effectiveExecutionMode),
      sandboxed: sandboxed !== false, // Default true for new conversations (safer)
      provider: effectiveProvider,
      model: effectiveModel,
      createdAt: Date.now(),
    };
    conversations.set(id, conversation);
    await saveConversation(id);
    res.json(conversation);
  });

  // List conversations (metadata only)
  app.get('/api/conversations', (_req, res) => {
    const archived = _req.query.archived === 'true';
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
          pinned: !!meta.pinned,
          provider: meta.provider || 'claude',
          model: meta.model,
          executionMode: meta.executionMode,
          parentId: c.parentId || null,
          lastMessage: meta.lastMessage,
          messageCount: meta.messageCount,
          createdAt: meta.createdAt,
        };
      });
    list.sort((a, b) => compareConversations(a, b, { respectPinned: true }));
    res.json(list);
  });

  // Search conversations
  app.get('/api/conversations/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase().trim();
    const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom).getTime() : null;
    const dateTo = req.query.dateTo ? new Date(req.query.dateTo).getTime() : null;
    const modelFilter = req.query.model || null;

    if (!q && !dateFrom && !dateTo && !modelFilter) return res.json([]);

    const results = [];
    for (const c of conversations.values()) {
      if (dateFrom && c.createdAt < dateFrom) continue;
      if (dateTo && c.createdAt > dateTo) continue;
      if (modelFilter && (c.model || 'sonnet') !== modelFilter) continue;

      const nameMatch = q ? c.name.toLowerCase().includes(q) : false;
      let matchingMessages = [];
      if (q) {
        const messages = c.messages !== null ? c.messages : await loadMessages(c.id);
        for (const m of messages) {
          if (m.text && m.text.toLowerCase().includes(q)) {
            matchingMessages.push({
              role: m.role,
              text: m.text,
              timestamp: m.timestamp,
            });
          }
        }
      }
      if (q && !nameMatch && matchingMessages.length === 0) continue;

      const meta = convMeta(c);
      results.push({
        id: meta.id,
        name: meta.name,
        cwd: meta.cwd,
        model: meta.model,
        status: meta.status,
        archived: meta.archived,
        lastMessage: meta.lastMessage,
        messageCount: meta.messageCount,
        createdAt: meta.createdAt,
        nameMatch,
        matchingMessages: matchingMessages.slice(0, 3),
      });
    }
    results.sort(compareConversations);
    res.json(results);
  });

  // Semantic search - find conversations by meaning
  app.get('/api/conversations/semantic-search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);

    try {
      const results = await semanticSearch(q, 20);

      // Enrich with conversation metadata
      const enriched = results
        .map(r => {
          const conv = conversations.get(r.id);
          if (!conv) return null;
          return {
            ...convMeta(conv),
            score: r.score,
            matchText: r.text.slice(0, 100),
          };
        })
        .filter(Boolean);

      res.json(enriched);
    } catch (err) {
      console.error('[SEMANTIC] Search failed:', err.message);
      res.status(500).json({ error: 'Semantic search failed' });
    }
  });

  // Get embedding stats
  app.get('/api/embeddings/stats', (_req, res) => {
    res.json({
      count: getEmbeddingsCount(),
    });
  });

  // Update conversation
  app.patch('/api/conversations/:id', withConversation(async (req, res, conv) => {
    let requestedMode = null;
    if (req.body.executionMode !== undefined) {
      const mode = String(req.body.executionMode);
      if (!EXECUTION_MODE_VALUES.has(mode)) {
        return res.status(400).json({ error: `Invalid executionMode. Valid modes: ${Array.from(EXECUTION_MODE_VALUES).join(', ')}` });
      }
      requestedMode = mode;
    } else if (req.body.autopilot !== undefined) {
      requestedMode = inferExecutionModeFromLegacyAutopilot(!!req.body.autopilot);
    }

    if (req.body.archived !== undefined) conv.archived = !!req.body.archived;
    if (req.body.name !== undefined) conv.name = String(req.body.name).trim() || conv.name;

    // Update provider (also reset session since it's provider-specific)
    if (req.body.provider !== undefined) {
      const provider = String(req.body.provider);
      if (!VALID_PROVIDERS.has(provider)) {
        return res.status(400).json({ error: `Invalid provider. Valid providers: ${Array.from(VALID_PROVIDERS).join(', ')}` });
      }
      if (provider !== conv.provider) {
        conv.provider = provider;
        conv.claudeSessionId = null; // Reset session when switching providers
        conv.codexSessionId = null;
      }
    }

    // Update model (validate based on provider)
    if (req.body.model !== undefined) {
      const model = String(req.body.model);
      const currentProvider = conv.provider || 'claude';
      // Only validate Claude models; accept any model for Codex/Ollama
      if (currentProvider === 'claude' && !VALID_MODEL_IDS.has(model)) {
        return res.status(400).json({ error: `Invalid model. Valid models: ${Array.from(VALID_MODEL_IDS).join(', ')}` });
      }
      conv.model = model;
    }

    if (requestedMode !== null) {
      applyExecutionMode(conv, requestedMode);
    }
    if (req.body.sandboxed !== undefined) conv.sandboxed = !!req.body.sandboxed;
    if (req.body.pinned !== undefined) conv.pinned = !!req.body.pinned;
    if (req.body.useMemory !== undefined) conv.useMemory = !!req.body.useMemory;
    await saveIndex();

    res.json({
      ok: true,
      id: conv.id,
      name: conv.name,
      archived: conv.archived,
      pinned: !!conv.pinned,
      provider: conv.provider || 'claude',
      model: conv.model || defaultModelForProvider(conv.provider || 'claude'),
      executionMode: resolveConversationExecutionMode(conv),
      autopilot: modeToLegacyAutopilot(resolveConversationExecutionMode(conv)),
      sandboxed: conv.sandboxed !== false,
      useMemory: conv.useMemory !== false,
    });
  }));

  // Get conversation detail
  app.get('/api/conversations/:id', async (req, res) => {
    const conv = await ensureMessages(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    res.json(conv);
  });

  // Stats
  app.get('/api/stats', async (_req, res) => {
    const cached = getStatsCache();
    if (cached) return res.json(cached);

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
      // For forked conversations, skip messages up to forkIndex to avoid double-counting
      // (those messages are already counted in the parent conversation)
      const startIndex = (c.parentId && c.forkIndex != null) ? c.forkIndex + 1 : 0;
      for (let i = startIndex; i < messages.length; i++) {
        const m = messages[i];
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

    const dailyActivity = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dailyActivity.push({ date: key, count: dailyCounts[key] || 0 });
    }

    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      if (dailyCounts[key]) streak++; else break;
    }

    const result = {
      conversations: { total: activeCount + archivedCount, active: activeCount, archived: archivedCount },
      messages: { total: totalMessages, user: userMessages, assistant: assistantMessages },
      cost: Math.round(totalCost * 10000) / 10000,
      duration: Math.round(totalDuration / 1000),
      characters: { user: totalUserChars, assistant: totalAssistantChars },
      dailyActivity,
      hourlyCounts,
      streak,
      topConversations: topConversations.slice(0, 5),
    };

    setStatsCache(result);
    res.json(result);
  });

  // Export conversation
  app.get('/api/conversations/:id/export', async (req, res) => {
    const conv = await ensureMessages(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const format = req.query.format || 'markdown';
    const safeName = (conv.name || 'conversation').replace(/[^a-zA-Z0-9 _-]/g, '');

    if (format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.json"`);
      return res.json({
        name: conv.name,
        model: conv.model,
        cwd: conv.cwd,
        createdAt: conv.createdAt,
        messages: conv.messages,
      });
    }

    let md = `# ${conv.name}\n\n`;
    md += `**Model:** ${conv.model || 'sonnet'} | **Created:** ${new Date(conv.createdAt).toLocaleDateString()}\n\n---\n\n`;
    for (const m of conv.messages) {
      const role = m.role === 'user' ? 'You' : 'Assistant';
      md += `**${role}:**\n\n${m.text}\n\n---\n\n`;
    }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.md"`);
    res.send(md);
  });

  // Fork conversation
  app.post('/api/conversations/:id/fork', async (req, res) => {
    const id = req.params.id;
    const { fromMessageIndex } = req.body;
    const forkWorkspaceMode = req.body?.forkWorkspaceMode === 'worktree' ? 'worktree' : 'same';
    const source = await ensureMessages(id);
    if (!source) return res.status(404).json({ error: 'Not found' });
    if (typeof fromMessageIndex !== 'number' || fromMessageIndex < 0) {
      return res.status(400).json({ error: 'fromMessageIndex required' });
    }

    const newId = uuidv4();
    const messages = source.messages.slice(0, fromMessageIndex + 1);
    const sourceProvider = source.provider || 'claude';
    let forkSessionId = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sessionId) { forkSessionId = messages[i].sessionId; break; }
    }
    if (!forkSessionId) {
      forkSessionId = sourceProvider === 'codex' ? source.codexSessionId : source.claudeSessionId;
    }

    // Generate numbered fork name
    const rootId = findRootId(conversations, id);
    const rootConv = conversations.get(rootId);
    const baseName = getBaseName(rootConv ? rootConv.name : source.name);
    const forkCount = countForksInFamily(conversations, rootId);
    const forkName = `${baseName} (fork ${forkCount + 1})`;

    let forkCwd = source.cwd;
    let worktreeInfo = null;
    if (forkWorkspaceMode === 'worktree') {
      worktreeInfo = await createForkWorktree(source.cwd, `${baseName}-${newId.slice(0, 8)}`);
      if (!worktreeInfo.ok) {
        return res.status(400).json({ error: worktreeInfo.error || 'Failed to create worktree' });
      }
      forkCwd = worktreeInfo.cwd;
    }
    if (forkCwd !== source.cwd) {
      // Provider sessions are cwd-scoped; resuming across worktrees can yield empty turns.
      forkSessionId = null;
    }

    const conversation = {
      id: newId,
      name: forkName,
      cwd: forkCwd,
      claudeSessionId: sourceProvider === 'claude' ? forkSessionId : null,
      codexSessionId: sourceProvider === 'codex' ? forkSessionId : null,
      messages,
      status: 'idle',
      archived: false,
      executionMode: resolveConversationExecutionMode(source),
      autopilot: modeToLegacyAutopilot(resolveConversationExecutionMode(source)),
      sandboxed: source.sandboxed,
      provider: source.provider || 'claude',
      model: source.model,
      createdAt: Date.now(),
      parentId: id,
      forkIndex: fromMessageIndex,
    };
    conversations.set(newId, conversation);
    await saveConversation(newId);
    res.json({
      ...conversation,
      workspaceMode: forkWorkspaceMode,
      worktreeBranch: worktreeInfo?.branch || null,
    });
  });

  // Compress conversation
  app.post('/api/conversations/:id/compress', async (req, res) => {
    const conv = await ensureMessages(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const { threshold = 0.5 } = req.body;
    const splitIndex = Math.floor(conv.messages.length * threshold);
    if (splitIndex < 2) {
      return res.status(400).json({ error: 'Not enough messages to compress' });
    }

    const toCompress = conv.messages.slice(0, splitIndex);
    const toKeep = conv.messages.slice(splitIndex);

    if (toCompress.some(m => m.summarized)) {
      return res.status(400).json({ error: 'Some messages already compressed' });
    }

    try {
      // Use the conversation's provider for summary generation
      const providerId = conv.provider || 'claude';
      const modelId = conv.model || defaultModelForProvider(providerId);
      let summary;
      try {
        const provider = getProvider(providerId);
        summary = await provider.generateSummary(toCompress, modelId, conv.cwd);
      } catch {
        // Fallback to default generateSummary
        summary = await generateSummary(toCompress, modelId, conv.cwd);
      }
      const originalTokens = toCompress.reduce((sum, m) => {
        return sum + Math.ceil((m.text || '').length / 4);
      }, 0);

      for (let i = 0; i < splitIndex; i++) {
        conv.messages[i].summarized = true;
      }

      const summaryMessage = {
        role: 'system',
        text: summary,
        timestamp: Date.now(),
        compressionMeta: {
          messagesSummarized: splitIndex,
          originalTokens,
          compressedAt: Date.now(),
        }
      };

      conv.messages = [...conv.messages.slice(0, splitIndex), summaryMessage, ...toKeep];
      conv.claudeSessionId = null;
      conv.codexSessionId = null;

      if (!conv.compressions) conv.compressions = [];
      conv.compressions.push({
        timestamp: Date.now(),
        messagesSummarized: splitIndex,
        tokensSaved: originalTokens,
      });

      await saveConversation(conv.id);
      res.json({
        success: true,
        messagesSummarized: splitIndex,
        estimatedTokensSaved: originalTokens
      });
    } catch (err) {
      console.error('Compression failed:', err);
      res.status(500).json({ error: err.message || 'Compression failed' });
    }
  });

  // Get conversation tree
  app.get('/api/conversations/:id/tree', async (req, res) => {
    const id = req.params.id;
    const conv = conversations.get(id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    let rootId = id;
    const ancestors = [];
    while (true) {
      const current = conversations.get(rootId);
      if (!current || !current.parentId) break;
      ancestors.unshift(rootId);
      rootId = current.parentId;
    }
    if (ancestors.length > 0 || rootId !== id) {
      ancestors.unshift(rootId);
    }

    const rootConv = conversations.get(rootId);
    const rootCwd = rootConv?.cwd || '';

    async function buildNode(nodeId) {
      const c = conversations.get(nodeId);
      if (!c) return null;

      // Ensure messages are loaded for fork preview
      const messages = c.messages !== null ? c.messages : await loadMessages(c.id);

      const children = [];
      for (const [cid, child] of conversations) {
        if (child.parentId === nodeId) {
          const childNode = await buildNode(cid);
          if (childNode) {
            // Add fork preview from parent's messages
            if (child.forkIndex != null && messages && messages[child.forkIndex]) {
              const forkMsg = messages[child.forkIndex];
              const text = forkMsg.text || forkMsg.content || '';
              childNode.forkPreview = text.slice(0, 50) + (text.length > 50 ? '...' : '');
            }
            children.push(childNode);
          }
        }
      }
      // Sort by fork index (earlier forks first) for better visual hierarchy
      children.sort((a, b) => (a.forkIndex || 0) - (b.forkIndex || 0));

      return {
        id: c.id,
        name: c.name,
        cwd: c.cwd || '',
        workspaceKind: c.cwd && rootCwd && c.cwd !== rootCwd ? 'worktree' : 'shared',
        messageCount: messages ? messages.length : (c.messageCount || 0),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt || c.createdAt,
        parentId: c.parentId || null,
        forkIndex: c.forkIndex != null ? c.forkIndex : null,
        children,
      };
    }

    const tree = await buildNode(rootId);
    res.json({
      currentId: id,
      rootId,
      rootCwd,
      ancestors: ancestors.length > 0 ? ancestors : [rootId],
      tree,
    });
  });

  // Delete conversation
  app.delete('/api/conversations/:id', async (req, res) => {
    const id = req.params.id;
    const conv = conversations.get(id);
    const providerId = conv?.provider || 'claude';
    try {
      const provider = getProvider(providerId);
      provider.cancel(id);
    } catch {
      // Ignore provider lookup/cancel failures during deletion
    }
    // Stop any preview server for this conversation
    stopPreview(id);
    // Delete embedding for this conversation
    deleteEmbedding(id);
    conversations.delete(id);
    await deleteConversationFiles(id);
    await saveIndex();
    res.json({ ok: true });
  });
}

module.exports = { setupConversationRoutes };
