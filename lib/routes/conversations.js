/**
 * Conversation CRUD, search, export, fork, compress, and tree routes
 */
const { v4: uuidv4 } = require('uuid');
const fsp = require('fs').promises;

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

const { activeProcesses, generateSummary, MODELS } = require('../claude');
const { withConversation } = require('./helpers');

// Validation constants
const MAX_NAME_LENGTH = 200;
const VALID_MODEL_IDS = new Set(MODELS.map(m => m.id));

/**
 * Validate conversation creation payload.
 * @param {Object} body - Request body
 * @returns {{valid: boolean, error?: string}}
 */
async function validateConversationCreate(body) {
  const { name, cwd, model } = body;

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

  // Validate model (if provided)
  if (model && !VALID_MODEL_IDS.has(model)) {
    return { valid: false, error: `Invalid model. Valid models: ${Array.from(VALID_MODEL_IDS).join(', ')}` };
  }

  return { valid: true };
}

function setupConversationRoutes(app) {
  // Available models
  app.get('/api/models', (_req, res) => {
    res.json(MODELS);
  });

  // Create conversation
  app.post('/api/conversations', async (req, res) => {
    const validation = await validateConversationCreate(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

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
          lastMessage: meta.lastMessage,
          messageCount: meta.messageCount,
          createdAt: meta.createdAt,
        };
      });
    list.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      const aTime = a.lastMessage ? a.lastMessage.timestamp : a.createdAt;
      const bTime = b.lastMessage ? b.lastMessage.timestamp : b.createdAt;
      return bTime - aTime;
    });
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
    results.sort((a, b) => {
      const aTime = a.lastMessage ? a.lastMessage.timestamp : a.createdAt;
      const bTime = b.lastMessage ? b.lastMessage.timestamp : b.createdAt;
      return bTime - aTime;
    });
    res.json(results);
  });

  // Update conversation
  app.patch('/api/conversations/:id', withConversation(async (req, res, conv) => {
    if (req.body.archived !== undefined) conv.archived = !!req.body.archived;
    if (req.body.name !== undefined) conv.name = String(req.body.name).trim() || conv.name;
    if (req.body.model !== undefined) conv.model = String(req.body.model);
    if (req.body.autopilot !== undefined) conv.autopilot = !!req.body.autopilot;
    if (req.body.pinned !== undefined) conv.pinned = !!req.body.pinned;
    if (req.body.useMemory !== undefined) conv.useMemory = !!req.body.useMemory;
    await saveIndex();
    res.json({
      ok: true,
      id: conv.id,
      name: conv.name,
      archived: conv.archived,
      pinned: !!conv.pinned,
      model: conv.model || 'sonnet',
      autopilot: conv.autopilot !== false,
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
      const role = m.role === 'user' ? 'You' : 'Claude';
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
    const source = await ensureMessages(id);
    if (!source) return res.status(404).json({ error: 'Not found' });
    if (typeof fromMessageIndex !== 'number' || fromMessageIndex < 0) {
      return res.status(400).json({ error: 'fromMessageIndex required' });
    }

    const newId = uuidv4();
    const messages = source.messages.slice(0, fromMessageIndex + 1);
    let forkSessionId = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sessionId) { forkSessionId = messages[i].sessionId; break; }
    }
    const conversation = {
      id: newId,
      name: `${source.name} (fork)`,
      cwd: source.cwd,
      claudeSessionId: forkSessionId,
      messages,
      status: 'idle',
      archived: false,
      autopilot: source.autopilot,
      model: source.model,
      createdAt: Date.now(),
      parentId: id,
      forkIndex: fromMessageIndex,
    };
    conversations.set(newId, conversation);
    await saveConversation(newId);
    res.json(conversation);
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
      const summary = await generateSummary(toCompress, conv.model || 'sonnet', conv.cwd);
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
  app.get('/api/conversations/:id/tree', (req, res) => {
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

    function buildNode(nodeId) {
      const c = conversations.get(nodeId);
      if (!c) return null;

      const children = [];
      for (const [cid, child] of conversations) {
        if (child.parentId === nodeId) {
          const childNode = buildNode(cid);
          if (childNode) children.push(childNode);
        }
      }
      children.sort((a, b) => a.createdAt - b.createdAt);

      return {
        id: c.id,
        name: c.name,
        messageCount: c.messages ? c.messages.length : (c.messageCount || 0),
        createdAt: c.createdAt,
        parentId: c.parentId || null,
        forkIndex: c.forkIndex != null ? c.forkIndex : null,
        children,
      };
    }

    const tree = buildNode(rootId);
    res.json({
      currentId: id,
      rootId,
      ancestors: ancestors.length > 0 ? ancestors : [rootId],
      tree,
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
}

module.exports = { setupConversationRoutes };
