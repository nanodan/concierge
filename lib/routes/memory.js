/**
 * Memory API routes
 */
const { v4: uuidv4 } = require('uuid');

const {
  loadMemories,
  saveMemory,
  deleteMemory,
  getMemory,
} = require('../data');

function setupMemoryRoutes(app) {
  // List memories (global + project scope)
  app.get('/api/memory', async (req, res) => {
    const scope = req.query.scope || null;
    const memories = await loadMemories(scope);
    res.json(memories);
  });

  // Create a new memory
  app.post('/api/memory', async (req, res) => {
    const { text, scope, category, source } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    if (!scope) {
      return res.status(400).json({ error: 'scope is required (use "global" or a cwd path)' });
    }

    const memory = {
      id: `mem_${uuidv4().slice(0, 8)}`,
      text: text.trim(),
      scope,
      category: category || null,
      enabled: true,
      source: source || null,
      createdAt: Date.now(),
    };

    await saveMemory(memory);
    res.json(memory);
  });

  // Update a memory
  app.patch('/api/memory/:id', async (req, res) => {
    const { id } = req.params;
    const { scope } = req.body;

    if (!scope) {
      return res.status(400).json({ error: 'scope is required to locate memory' });
    }

    const memory = await getMemory(id, scope);
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    if (req.body.enabled !== undefined) memory.enabled = !!req.body.enabled;
    if (req.body.text !== undefined) memory.text = String(req.body.text).trim();
    if (req.body.category !== undefined) memory.category = req.body.category || null;

    await saveMemory(memory);
    res.json(memory);
  });

  // Delete a memory
  app.delete('/api/memory/:id', async (req, res) => {
    const { id } = req.params;
    const scope = req.query.scope;

    if (!scope) {
      return res.status(400).json({ error: 'scope query param is required' });
    }

    const deleted = await deleteMemory(id, scope);
    if (!deleted) {
      return res.status(404).json({ error: 'Memory not found' });
    }
    res.json({ ok: true });
  });
}

module.exports = { setupMemoryRoutes };
