const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fsp = require('fs').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

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
        } catch (_e) {
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
      // Handle permission errors gracefully
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        return res.status(403).json({
          error: 'Permission denied. On macOS, grant Terminal/Node "Full Disk Access" in System Preferences > Privacy & Security.',
          code: err.code
        });
      }
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
    } catch (_err) {
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
      parentId: id,
      forkIndex: fromMessageIndex,
    };
    conversations.set(newId, conversation);
    await saveConversation(newId);
    res.json(conversation);
  });

  // Get conversation tree (ancestors + descendants)
  app.get('/api/conversations/:id/tree', (req, res) => {
    const id = req.params.id;
    const conv = conversations.get(id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    // Find root by traversing up the parent chain
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

    // Build tree starting from root
    function buildNode(nodeId) {
      const c = conversations.get(nodeId);
      if (!c) return null;

      // Find children (conversations that have this as parentId)
      const children = [];
      for (const [cid, child] of conversations) {
        if (child.parentId === nodeId) {
          const childNode = buildNode(cid);
          if (childNode) children.push(childNode);
        }
      }

      // Sort children by creation time
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
        } catch (_e) {
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
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        return res.status(403).json({
          error: 'Permission denied. On macOS, grant Terminal/Node "Full Disk Access" in System Preferences > Privacy & Security.',
          code: err.code
        });
      }
      res.status(400).json({ error: err.message });
    }
  });

  // Get file content as JSON (for file viewer panel)
  app.get('/api/conversations/:id/files/content', async (req, res) => {
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

    const MAX_SIZE = 500 * 1024; // 500KB limit

    // Map extensions to highlight.js language names
    const extToLang = {
      js: 'javascript', mjs: 'javascript', cjs: 'javascript',
      ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
      py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
      java: 'java', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
      cs: 'csharp', swift: 'swift', kt: 'kotlin',
      php: 'php', pl: 'perl', sh: 'bash', bash: 'bash', zsh: 'bash',
      sql: 'sql', html: 'html', htm: 'html', xml: 'xml',
      css: 'css', scss: 'scss', less: 'less', sass: 'scss',
      json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
      md: 'markdown', markdown: 'markdown', txt: 'plaintext',
      dockerfile: 'dockerfile', makefile: 'makefile',
      gitignore: 'plaintext', env: 'plaintext',
    };

    // Binary file extensions that can't be previewed
    const binaryExts = new Set([
      'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg',
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
      'zip', 'tar', 'gz', 'rar', '7z',
      'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv',
      'exe', 'dll', 'so', 'dylib', 'bin',
      'woff', 'woff2', 'ttf', 'otf', 'eot',
    ]);

    try {
      const stat = await fsp.stat(targetPath);
      if (stat.isDirectory()) {
        return res.status(400).json({ error: 'Cannot read directory content' });
      }

      const filename = path.basename(targetPath);
      const ext = path.extname(filename).toLowerCase().slice(1);

      // Check for binary files
      if (binaryExts.has(ext)) {
        return res.json({
          path: filePath,
          name: filename,
          ext,
          size: stat.size,
          mtime: stat.mtime.getTime(),
          binary: true,
        });
      }

      // Check file size
      if (stat.size > MAX_SIZE) {
        return res.json({
          path: filePath,
          name: filename,
          ext,
          size: stat.size,
          mtime: stat.mtime.getTime(),
          truncated: true,
        });
      }

      const content = await fsp.readFile(targetPath, 'utf-8');
      const language = extToLang[ext] || extToLang[filename.toLowerCase()] || '';

      res.json({
        path: filePath,
        name: filename,
        ext,
        content,
        size: stat.size,
        mtime: stat.mtime.getTime(),
        language,
      });
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        return res.status(403).json({ error: 'Permission denied' });
      }
      res.status(404).json({ error: 'File not found' });
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
    } catch (_err) {
      res.status(404).json({ error: 'File not found' });
    }
  });

  // === Git Integration ===

  // Helper to run git commands in conversation's cwd
  async function runGit(cwd, args) {
    try {
      const { stdout, stderr } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
      return { stdout, stderr, ok: true };
    } catch (err) {
      return { stdout: '', stderr: err.stderr || err.message, ok: false, code: err.code };
    }
  }

  // Check if directory is a git repo
  async function isGitRepo(cwd) {
    const result = await runGit(cwd, ['rev-parse', '--git-dir']);
    return result.ok;
  }

  // Get git status
  app.get('/api/conversations/:id/git/status', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const cwd = conv.cwd || process.env.HOME;

    if (!(await isGitRepo(cwd))) {
      return res.json({ isRepo: false });
    }

    // Get current branch
    const branchResult = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = branchResult.ok ? branchResult.stdout.trim() : 'unknown';

    // Check if origin remote exists
    const originResult = await runGit(cwd, ['remote', 'get-url', 'origin']);
    const hasOrigin = originResult.ok;

    // Get ahead/behind count relative to upstream
    let ahead = 0;
    let behind = 0;
    let hasUpstream = false;
    const aheadBehindResult = await runGit(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
    if (aheadBehindResult.ok) {
      hasUpstream = true;
      const parts = aheadBehindResult.stdout.trim().split(/\s+/);
      ahead = parseInt(parts[0], 10) || 0;
      behind = parseInt(parts[1], 10) || 0;
    }

    // Get status with porcelain v1 format
    const statusResult = await runGit(cwd, ['status', '--porcelain=v1']);
    if (!statusResult.ok) {
      return res.status(500).json({ error: statusResult.stderr });
    }

    const staged = [];
    const unstaged = [];
    const untracked = [];

    for (const line of statusResult.stdout.split('\n')) {
      if (!line) continue;
      const x = line[0]; // staged status
      const y = line[1]; // unstaged status
      const filePath = line.slice(3);

      // Untracked files
      if (x === '?' && y === '?') {
        untracked.push({ path: filePath });
        continue;
      }

      // Staged changes
      if (x !== ' ' && x !== '?') {
        staged.push({ path: filePath, status: x });
      }

      // Unstaged changes
      if (y !== ' ' && y !== '?') {
        unstaged.push({ path: filePath, status: y });
      }
    }

    res.json({ isRepo: true, branch, ahead, behind, hasOrigin, hasUpstream, staged, unstaged, untracked });
  });

  // Get branches
  app.get('/api/conversations/:id/git/branches', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const cwd = conv.cwd || process.env.HOME;

    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }

    // Get current branch
    const currentResult = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const current = currentResult.ok ? currentResult.stdout.trim() : '';

    // Get all branches
    const branchResult = await runGit(cwd, ['branch', '-a']);
    if (!branchResult.ok) {
      return res.status(500).json({ error: branchResult.stderr });
    }

    const local = [];
    const remote = [];

    for (const line of branchResult.stdout.split('\n')) {
      if (!line.trim()) continue;
      const name = line.replace(/^\*?\s+/, '').trim();
      if (name.startsWith('remotes/')) {
        // Skip HEAD pointer
        if (!name.includes('HEAD')) {
          remote.push(name.replace('remotes/', ''));
        }
      } else {
        local.push(name);
      }
    }

    res.json({ current, local, remote });
  });

  // Get diff for a file
  app.post('/api/conversations/:id/git/diff', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const { path: filePath, staged } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const cwd = conv.cwd || process.env.HOME;

    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }

    // Validate path is within cwd
    const resolvedPath = path.resolve(cwd, filePath);
    if (!resolvedPath.startsWith(cwd)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const args = staged ? ['diff', '--cached', '--', filePath] : ['diff', '--', filePath];
    const diffResult = await runGit(cwd, args);

    if (!diffResult.ok) {
      return res.status(500).json({ error: diffResult.stderr });
    }

    // Parse unified diff into hunks
    const hunks = [];
    let currentHunk = null;
    const diffLines = diffResult.stdout.split('\n');

    for (const line of diffLines) {
      // Hunk header: @@ -start,count +start,count @@
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldLines: parseInt(hunkMatch[2] || '1', 10),
          newStart: parseInt(hunkMatch[3], 10),
          newLines: parseInt(hunkMatch[4] || '1', 10),
          header: line,
          lines: []
        };
        continue;
      }

      if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
        currentHunk.lines.push(line);
      }
    }
    if (currentHunk) hunks.push(currentHunk);

    res.json({ path: filePath, hunks, raw: diffResult.stdout });
  });

  // Stage files
  app.post('/api/conversations/:id/git/stage', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const { paths } = req.body;
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ error: 'paths required' });
    }

    const cwd = conv.cwd || process.env.HOME;

    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }

    // Validate all paths are within cwd
    for (const p of paths) {
      const resolved = path.resolve(cwd, p);
      if (!resolved.startsWith(cwd)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const result = await runGit(cwd, ['add', '--', ...paths]);
    if (!result.ok) {
      return res.status(500).json({ error: result.stderr });
    }

    res.json({ ok: true });
  });

  // Unstage files
  app.post('/api/conversations/:id/git/unstage', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const { paths } = req.body;
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ error: 'paths required' });
    }

    const cwd = conv.cwd || process.env.HOME;

    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }

    // Validate all paths are within cwd
    for (const p of paths) {
      const resolved = path.resolve(cwd, p);
      if (!resolved.startsWith(cwd)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const result = await runGit(cwd, ['restore', '--staged', '--', ...paths]);
    if (!result.ok) {
      return res.status(500).json({ error: result.stderr });
    }

    res.json({ ok: true });
  });

  // Discard changes (restore file)
  app.post('/api/conversations/:id/git/discard', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const { paths } = req.body;
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ error: 'paths required' });
    }

    const cwd = conv.cwd || process.env.HOME;

    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }

    // Validate all paths are within cwd
    for (const p of paths) {
      const resolved = path.resolve(cwd, p);
      if (!resolved.startsWith(cwd)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const result = await runGit(cwd, ['checkout', '--', ...paths]);
    if (!result.ok) {
      return res.status(500).json({ error: result.stderr });
    }

    res.json({ ok: true });
  });

  // Commit changes
  app.post('/api/conversations/:id/git/commit', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message required' });
    }

    const cwd = conv.cwd || process.env.HOME;

    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }

    const result = await runGit(cwd, ['commit', '-m', message.trim()]);
    if (!result.ok) {
      return res.status(500).json({ error: result.stderr });
    }

    // Get the new commit hash
    const hashResult = await runGit(cwd, ['rev-parse', '--short', 'HEAD']);
    const hash = hashResult.ok ? hashResult.stdout.trim() : '';

    res.json({ ok: true, hash, output: result.stdout });
  });

  // Create branch
  app.post('/api/conversations/:id/git/branch', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const { name, checkout } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name required' });
    }

    // Validate branch name (basic validation)
    const branchName = name.trim();
    if (!/^[\w\-./]+$/.test(branchName)) {
      return res.status(400).json({ error: 'Invalid branch name' });
    }

    const cwd = conv.cwd || process.env.HOME;

    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }

    // Create the branch
    const createResult = await runGit(cwd, ['branch', branchName]);
    if (!createResult.ok) {
      return res.status(500).json({ error: createResult.stderr });
    }

    // Optionally checkout the branch
    if (checkout) {
      const checkoutResult = await runGit(cwd, ['checkout', branchName]);
      if (!checkoutResult.ok) {
        return res.status(500).json({ error: checkoutResult.stderr });
      }
    }

    res.json({ ok: true, branch: branchName, checkedOut: !!checkout });
  });

  // Checkout branch
  app.post('/api/conversations/:id/git/checkout', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const { branch } = req.body;
    if (!branch || typeof branch !== 'string' || !branch.trim()) {
      return res.status(400).json({ error: 'branch required' });
    }

    const cwd = conv.cwd || process.env.HOME;

    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }

    const result = await runGit(cwd, ['checkout', branch.trim()]);
    if (!result.ok) {
      return res.status(500).json({ error: result.stderr });
    }

    res.json({ ok: true, branch: branch.trim() });
  });

  // Push to remote
  app.post('/api/conversations/:id/git/push', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const cwd = conv.cwd || process.env.HOME;

    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }

    // Get current branch
    const branchResult = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = branchResult.ok ? branchResult.stdout.trim() : '';

    // Check if upstream exists
    const upstreamResult = await runGit(cwd, ['rev-parse', '--abbrev-ref', '@{upstream}']);
    const hasUpstream = upstreamResult.ok;

    // Push with or without setting upstream
    const pushArgs = hasUpstream ? ['push'] : ['push', '-u', 'origin', branch];
    const result = await runGit(cwd, pushArgs);

    if (!result.ok) {
      const stderr = result.stderr.toLowerCase();
      // Provide user-friendly error messages
      if (stderr.includes('authentication') || stderr.includes('permission denied') || stderr.includes('could not read')) {
        return res.status(401).json({ error: 'Authentication failed. Check your credentials.' });
      }
      if (stderr.includes('non-fast-forward') || stderr.includes('fetch first') || stderr.includes('rejected')) {
        return res.status(409).json({ error: 'Push rejected. Pull first to merge remote changes.' });
      }
      if (stderr.includes('no configured push destination') || stderr.includes('does not appear to be a git repository')) {
        return res.status(400).json({ error: 'No remote configured for this branch.' });
      }
      return res.status(500).json({ error: result.stderr });
    }

    res.json({ ok: true, output: result.stdout + result.stderr });
  });

  // Pull from remote
  app.post('/api/conversations/:id/git/pull', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const cwd = conv.cwd || process.env.HOME;

    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }

    const result = await runGit(cwd, ['pull']);

    if (!result.ok) {
      const stderr = result.stderr.toLowerCase();
      // Provide user-friendly error messages
      if (stderr.includes('authentication') || stderr.includes('permission denied') || stderr.includes('could not read')) {
        return res.status(401).json({ error: 'Authentication failed. Check your credentials.' });
      }
      if (stderr.includes('conflict') || stderr.includes('merge conflict')) {
        return res.status(409).json({ error: 'Merge conflict. Resolve conflicts and commit.' });
      }
      if (stderr.includes('uncommitted changes') || stderr.includes('local changes') || stderr.includes('overwritten by merge')) {
        return res.status(409).json({ error: 'Commit or stash changes before pulling.' });
      }
      if (stderr.includes('no tracking information') || stderr.includes('no remote')) {
        return res.status(400).json({ error: 'No remote configured for this branch.' });
      }
      return res.status(500).json({ error: result.stderr });
    }

    res.json({ ok: true, output: result.stdout + result.stderr });
  });

  // Get recent commits
  app.get('/api/conversations/:id/git/commits', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const cwd = conv.cwd || process.env.HOME;

    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }

    const result = await runGit(cwd, ['log', '--format=%H|%s|%an|%ar', '-n', '20']);

    if (!result.ok) {
      return res.status(500).json({ error: result.stderr });
    }

    const commits = result.stdout.trim().split('\n')
      .filter(line => line.includes('|'))
      .map(line => {
        const [hash, message, author, time] = line.split('|');
        return { hash, message, author, time };
      });

    res.json({ commits });
  });

  // Get single commit diff
  app.get('/api/conversations/:id/git/commits/:hash', async (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const cwd = conv.cwd || process.env.HOME;
    const hash = req.params.hash;

    // Validate hash format to prevent command injection
    if (!/^[a-f0-9]{7,40}$/i.test(hash)) {
      return res.status(400).json({ error: 'Invalid commit hash' });
    }

    if (!(await isGitRepo(cwd))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }

    // Get commit info
    const infoResult = await runGit(cwd, ['log', '--format=%s|%an|%ar', '-n', '1', hash]);
    if (!infoResult.ok) {
      return res.status(404).json({ error: 'Commit not found' });
    }

    const [message, author, time] = infoResult.stdout.trim().split('|');

    // Get commit diff
    const diffResult = await runGit(cwd, ['show', '--format=', hash]);
    if (!diffResult.ok) {
      return res.status(500).json({ error: diffResult.stderr });
    }

    res.json({ hash, message, author, time, raw: diffResult.stdout });
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
