const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fsp = require('fs').promises;

const {
  UPLOAD_DIR,
  conversations,
  convMeta,
  saveIndex,
  saveConversation,
  loadMessages,
  deleteConversationFiles,
  ensureMessages,
  getStatsCache,
  setStatsCache,
} = require('./data');

const { MODELS, activeProcesses } = require('./claude');

function setupRoutes(app) {
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
  // Supports optional filters: dateFrom, dateTo (ISO), model
  app.get('/api/conversations/search', async (req, res) => {
    const q = (req.query.q || '').toLowerCase().trim();
    const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom).getTime() : null;
    const dateTo = req.query.dateTo ? new Date(req.query.dateTo).getTime() : null;
    const modelFilter = req.query.model || null;

    if (!q && !dateFrom && !dateTo && !modelFilter) return res.json([]);

    const results = [];
    for (const c of conversations.values()) {
      // Apply metadata filters first (skip loading messages if they don't match)
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
      // If text query is provided, require a match; otherwise metadata filters are enough
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

  // Stats (cached)
  app.get('/api/stats', async (req, res) => {
    const cached = getStatsCache();
    if (cached) {
      return res.json(cached);
    }

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

    // Markdown
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

  // Upload file for attachments
  app.post('/api/conversations/:id/upload', async (req, res) => {
    const convId = req.params.id;
    if (!conversations.has(convId)) return res.status(404).json({ error: 'Not found' });

    const filename = req.query.filename || `upload-${Date.now()}`;
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uploadDir = path.join(UPLOAD_DIR, convId);
    await fsp.mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, safeName);

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        await fsp.writeFile(filePath, Buffer.concat(chunks));
        res.json({ path: filePath, filename: safeName, url: `/uploads/${convId}/${safeName}` });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    req.on('error', (err) => {
      res.status(500).json({ error: err.message });
    });
  });

  // Fork conversation from a specific message
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
    // Find sessionId from the last assistant message at/before fork point
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
    };
    conversations.set(newId, conversation);
    await saveConversation(newId);
    res.json(conversation);
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

module.exports = { setupRoutes };
