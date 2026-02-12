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

  // General file browser (list files and directories)
  app.get('/api/files', async (req, res) => {
    const targetPath = req.query.path || process.env.HOME;
    const resolved = path.resolve(targetPath);

    try {
      const stat = await fsp.stat(resolved);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Not a directory' });
      }

      const entries = await fsp.readdir(resolved, { withFileTypes: true });
      const files = [];
      const dirs = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;

        const entryPath = path.join(resolved, entry.name);
        try {
          const entryStat = await fsp.stat(entryPath);
          const item = {
            name: entry.name,
            path: entryPath,
            size: entryStat.size,
            mtime: entryStat.mtime.getTime(),
          };

          if (entry.isDirectory()) {
            item.type = 'directory';
            dirs.push(item);
          } else {
            item.type = 'file';
            item.ext = path.extname(entry.name).toLowerCase().slice(1);
            files.push(item);
          }
        } catch (e) {
          // Skip files we can't stat
        }
      }

      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));

      res.json({
        path: resolved,
        parent: path.dirname(resolved) !== resolved ? path.dirname(resolved) : null,
        entries: [...dirs, ...files],
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // General file download
  app.get('/api/files/download', async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const resolved = path.resolve(filePath);

    try {
      const stat = await fsp.stat(resolved);
      if (stat.isDirectory()) {
        return res.status(400).json({ error: 'Cannot download directory' });
      }

      const filename = path.basename(resolved);
      const ext = path.extname(filename).toLowerCase();

      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.py': 'text/plain',
        '.ts': 'text/plain',
        '.tsx': 'text/plain',
        '.jsx': 'text/plain',
      };

      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stat.size);

      const inline = req.query.inline === 'true';
      if (!inline) {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      }

      const { createReadStream } = require('fs');
      createReadStream(resolved).pipe(res);
    } catch (err) {
      res.status(404).json({ error: 'File not found' });
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
          pinned: !!meta.pinned,
          lastMessage: meta.lastMessage,
          messageCount: meta.messageCount,
          createdAt: meta.createdAt,
        };
      });
    list.sort((a, b) => {
      // Pinned conversations first
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
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

  // Update conversation (archive, rename, model, autopilot, pinned)
  app.patch('/api/conversations/:id', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    if (req.body.archived !== undefined) conv.archived = !!req.body.archived;
    if (req.body.name !== undefined) conv.name = String(req.body.name).trim() || conv.name;
    if (req.body.model !== undefined) conv.model = String(req.body.model);
    if (req.body.autopilot !== undefined) conv.autopilot = !!req.body.autopilot;
    if (req.body.pinned !== undefined) conv.pinned = !!req.body.pinned;
    await saveIndex();
    res.json({ ok: true, id: conv.id, name: conv.name, archived: conv.archived, pinned: !!conv.pinned, model: conv.model || 'sonnet', autopilot: conv.autopilot !== false });
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

  // List files in conversation's working directory
  app.get('/api/conversations/:id/files', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const subpath = req.query.path || '';
    const baseCwd = conv.cwd || process.env.HOME;

    // Resolve and validate path (prevent traversal)
    const targetPath = path.resolve(baseCwd, subpath);
    if (!targetPath.startsWith(baseCwd)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      const stat = await fsp.stat(targetPath);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Not a directory' });
      }

      const entries = await fsp.readdir(targetPath, { withFileTypes: true });
      const files = [];
      const dirs = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue; // Skip hidden files

        const entryPath = path.join(targetPath, entry.name);
        try {
          const entryStat = await fsp.stat(entryPath);
          const item = {
            name: entry.name,
            path: path.relative(baseCwd, entryPath),
            size: entryStat.size,
            mtime: entryStat.mtime.getTime(),
          };

          if (entry.isDirectory()) {
            item.type = 'directory';
            dirs.push(item);
          } else {
            item.type = 'file';
            item.ext = path.extname(entry.name).toLowerCase().slice(1);
            files.push(item);
          }
        } catch (e) {
          // Skip files we can't stat
        }
      }

      // Sort: directories first, then files, alphabetically
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));

      res.json({
        cwd: baseCwd,
        path: subpath || '.',
        fullPath: targetPath,
        parent: subpath ? path.dirname(subpath) || null : null,
        entries: [...dirs, ...files],
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Download file from conversation's working directory
  app.get('/api/conversations/:id/files/download', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const baseCwd = conv.cwd || process.env.HOME;
    const targetPath = path.resolve(baseCwd, filePath);

    // Prevent path traversal
    if (!targetPath.startsWith(baseCwd)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      const stat = await fsp.stat(targetPath);
      if (stat.isDirectory()) {
        return res.status(400).json({ error: 'Cannot download directory' });
      }

      const filename = path.basename(targetPath);
      const ext = path.extname(filename).toLowerCase();

      // Set content type based on extension
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.py': 'text/plain',
        '.ts': 'text/plain',
        '.tsx': 'text/plain',
        '.jsx': 'text/plain',
      };

      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stat.size);

      // For inline viewing vs download
      const inline = req.query.inline === 'true';
      if (!inline) {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      }

      const { createReadStream } = require('fs');
      createReadStream(targetPath).pipe(res);
    } catch (err) {
      res.status(404).json({ error: 'File not found' });
    }
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
