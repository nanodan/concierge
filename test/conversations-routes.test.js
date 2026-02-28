const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { requireWithMocks } = require('./helpers/require-with-mocks.cjs');

async function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function stopServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

async function requestJson(baseUrl, method, routePath, body) {
  const response = await fetch(`${baseUrl}${routePath}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

function createConversationRouteFixture() {
  const now = Date.now();
  const conversations = new Map([
    ['conv-1', {
      id: 'conv-1',
      name: 'Existing',
      cwd: '/tmp/project',
      provider: 'claude',
      model: 'claude-sonnet-4.5',
      executionMode: 'patch',
      autopilot: false,
      sandboxed: true,
      claudeSessionId: 'claude-session-root',
      codexSessionId: null,
      messages: [
        { role: 'user', text: 'hello', timestamp: now - 3000 },
        { role: 'assistant', text: 'Needle answer', timestamp: now - 2000, sessionId: 'sess-tip' },
      ],
      status: 'idle',
      createdAt: now - 4000,
      archived: false,
      pinned: false,
    }],
  ]);

  let saveIndexCalls = 0;
  const saveConversationCalls = [];
  const deleteConversationFilesCalls = [];
  const stopPreviewCalls = [];
  const deleteEmbeddingCalls = [];
  const providerCancelCalls = [];
  let forceProviderListFailure = false;
  let semanticResults = [];
  let semanticError = null;
  let embeddingsCount = 0;
  let statsCache = null;
  let generatedSummary = 'summary';

  const dataModule = {
    conversations,
    convMeta(conv) {
      return {
        id: conv.id,
        name: conv.name,
        cwd: conv.cwd,
        status: conv.status,
        archived: !!conv.archived,
        pinned: !!conv.pinned,
        provider: conv.provider || 'claude',
        model: conv.model || 'claude-sonnet-4.5',
        executionMode: conv.executionMode || 'patch',
        autopilot: !!conv.autopilot,
        messageCount: Array.isArray(conv.messages) ? conv.messages.length : 0,
        lastMessage: Array.isArray(conv.messages) && conv.messages.length > 0 ? conv.messages.at(-1) : null,
        createdAt: conv.createdAt,
      };
    },
    async saveIndex() {
      saveIndexCalls += 1;
    },
    async saveConversation(id) {
      saveConversationCalls.push(id);
    },
    async loadMessages(id) {
      return conversations.get(id)?.messages || [];
    },
    async deleteConversationFiles(id) {
      deleteConversationFilesCalls.push(id);
    },
    async ensureMessages(id) {
      return conversations.get(id) || null;
    },
    getStatsCache() {
      return statsCache;
    },
    setStatsCache(value) {
      statsCache = value;
    },
  };

  const providerModule = {
    getAllProviders() {
      if (forceProviderListFailure) {
        throw new Error('providers unavailable');
      }
      return [
        { id: 'claude', name: 'Claude' },
        { id: 'codex', name: 'OpenAI Codex' },
      ];
    },
    getProvider(id) {
      if (id === 'claude') {
        return {
          getModels: async () => [{ id: 'claude-sonnet-4.5', name: 'Sonnet', context: 200000 }],
          cancel: (conversationId) => providerCancelCalls.push({ provider: id, conversationId }),
          generateSummary: async () => generatedSummary,
        };
      }
      if (id === 'codex') {
        return {
          getModels: async () => [{ id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', context: 128000 }],
          cancel: (conversationId) => providerCancelCalls.push({ provider: id, conversationId }),
          generateSummary: async () => generatedSummary,
        };
      }
      throw new Error(`unknown provider ${id}`);
    },
  };

  const executionModeModule = {
    EXECUTION_MODE_VALUES: new Set(['patch', 'autonomous']),
    normalizeExecutionMode(mode) {
      return mode === 'autonomous' ? 'autonomous' : 'patch';
    },
    inferExecutionModeFromLegacyAutopilot(flag) {
      return flag ? 'autonomous' : 'patch';
    },
    resolveConversationExecutionMode(conv) {
      return conv.executionMode || 'patch';
    },
    modeToLegacyAutopilot(mode) {
      return mode === 'autonomous';
    },
    applyExecutionMode(conv, mode) {
      conv.executionMode = mode;
      conv.autopilot = mode === 'autonomous';
    },
  };

  const routeModule = requireWithMocks('../lib/routes/conversations', {
    [require.resolve('../lib/data')]: dataModule,
    [require.resolve('../lib/claude')]: {
      generateSummary: async () => generatedSummary,
      MODELS: [{ id: 'claude-sonnet-4.5', name: 'Sonnet', context: 200000 }],
    },
    [require.resolve('../lib/providers/codex')]: {
      MODELS: [{ id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', context: 128000 }],
    },
    [require.resolve('../lib/providers')]: providerModule,
    [require.resolve('./../lib/routes/helpers')]: {
      withConversation(handler) {
        return async (req, res) => {
          const conv = conversations.get(req.params.id);
          if (!conv) return res.status(404).json({ error: 'Not found' });
          return handler(req, res, conv);
        };
      },
    },
    [require.resolve('../lib/routes/preview')]: {
      stopPreview(id) {
        stopPreviewCalls.push(id);
      },
    },
    [require.resolve('../lib/embeddings')]: {
      async semanticSearch() {
        if (semanticError) throw semanticError;
        return semanticResults;
      },
      deleteEmbedding(id) {
        deleteEmbeddingCalls.push(id);
      },
      getEmbeddingsCount() {
        return embeddingsCount;
      },
    },
    [require.resolve('../lib/workflow/execution-mode')]: executionModeModule,
  }, __filename);

  return {
    setupConversationRoutes: routeModule.setupConversationRoutes,
    state: {
      conversations,
      setProviderListFailure(value) {
        forceProviderListFailure = !!value;
      },
      setSemanticResults(value) {
        semanticResults = Array.isArray(value) ? value : [];
      },
      setSemanticError(err) {
        semanticError = err || null;
      },
      setEmbeddingsCount(value) {
        embeddingsCount = Number(value) || 0;
      },
      setGeneratedSummary(value) {
        generatedSummary = String(value || '');
      },
      getSaveIndexCalls: () => saveIndexCalls,
      getSaveConversationCalls: () => [...saveConversationCalls],
      getDeleteConversationFilesCalls: () => [...deleteConversationFilesCalls],
      getStopPreviewCalls: () => [...stopPreviewCalls],
      getDeleteEmbeddingCalls: () => [...deleteEmbeddingCalls],
      getProviderCancelCalls: () => [...providerCancelCalls],
    },
  };
}

describe('conversation routes', () => {
  let server;
  let baseUrl;
  let state;

  beforeEach(async () => {
    const fixture = createConversationRouteFixture();
    state = fixture.state;
    const app = express();
    app.use(express.json());
    fixture.setupConversationRoutes(app);
    server = await startServer(app);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await stopServer(server);
    server = null;
    baseUrl = null;
    state = null;
  });

  it('falls back to static providers when provider registry is unavailable', async () => {
    state.setProviderListFailure(true);
    const response = await requestJson(baseUrl, 'GET', '/api/providers');
    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.map((item) => item.id),
      ['claude', 'codex', 'ollama']
    );
  });

  it('returns 400 for unknown provider model requests', async () => {
    const response = await requestJson(baseUrl, 'GET', '/api/models?provider=unknown');
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'Unknown provider: unknown');
  });

  it('returns models for known providers', async () => {
    const response = await requestJson(baseUrl, 'GET', '/api/models?provider=codex');
    assert.equal(response.status, 200);
    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].id, 'gpt-5.3-codex');
  });

  it('validates provider on conversation create', async () => {
    const response = await requestJson(baseUrl, 'POST', '/api/conversations', {
      name: 'Bad provider',
      provider: 'not-a-provider',
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'Invalid provider. Valid providers: claude, codex, ollama');
  });

  it('creates a conversation with provider default model and persists it', async () => {
    const response = await requestJson(baseUrl, 'POST', '/api/conversations', {
      name: 'Codex chat',
      provider: 'codex',
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.model, 'gpt-5.3-codex');
    assert.equal(response.body.executionMode, 'patch');
    assert.equal(state.getSaveConversationCalls().length, 1);
  });

  it('rejects invalid provider updates', async () => {
    const response = await requestJson(baseUrl, 'PATCH', '/api/conversations/conv-1', {
      provider: 'invalid-provider',
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'Invalid provider. Valid providers: claude, codex, ollama');
  });

  it('lists conversations and sorts pinned before recency', async () => {
    state.conversations.set('conv-2', {
      id: 'conv-2',
      name: 'Pinned conversation',
      cwd: '/tmp/project',
      provider: 'claude',
      model: 'claude-sonnet-4.5',
      executionMode: 'patch',
      messages: [{ role: 'assistant', text: 'fresh', timestamp: Date.now() }],
      status: 'idle',
      createdAt: Date.now() - 1000,
      archived: false,
      pinned: true,
    });

    const response = await requestJson(baseUrl, 'GET', '/api/conversations');
    assert.equal(response.status, 200);
    assert.equal(response.body.length >= 2, true);
    assert.equal(response.body[0].id, 'conv-2');
  });

  it('searches by text and model filters', async () => {
    const response = await requestJson(baseUrl, 'GET', '/api/conversations/search?q=needle&model=claude-sonnet-4.5');
    assert.equal(response.status, 200);
    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].id, 'conv-1');
    assert.equal(response.body[0].matchingMessages.length, 1);
  });

  it('enriches semantic search results with conversation metadata', async () => {
    state.setSemanticResults([{ id: 'conv-1', score: 0.92, text: 'semantic match text sample' }]);
    const response = await requestJson(baseUrl, 'GET', '/api/conversations/semantic-search?q=match');
    assert.equal(response.status, 200);
    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].id, 'conv-1');
    assert.equal(response.body[0].score, 0.92);
    assert.equal(typeof response.body[0].matchText, 'string');
  });

  it('returns 500 when semantic search throws', async () => {
    state.setSemanticError(new Error('embedding service unavailable'));
    const response = await requestJson(baseUrl, 'GET', '/api/conversations/semantic-search?q=match');
    assert.equal(response.status, 500);
    assert.equal(response.body.error, 'Semantic search failed');
  });

  it('returns embedding stats count', async () => {
    state.setEmbeddingsCount(17);
    const response = await requestJson(baseUrl, 'GET', '/api/embeddings/stats');
    assert.equal(response.status, 200);
    assert.equal(response.body.count, 17);
  });

  it('updates provider and execution mode and resets provider sessions', async () => {
    const conv = state.conversations.get('conv-1');
    conv.claudeSessionId = 'existing-claude-session';
    conv.codexSessionId = 'existing-codex-session';

    const response = await requestJson(baseUrl, 'PATCH', '/api/conversations/conv-1', {
      provider: 'codex',
      executionMode: 'autonomous',
      model: 'gpt-5.3-codex',
      pinned: true,
      useMemory: true,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.provider, 'codex');
    assert.equal(response.body.executionMode, 'autonomous');
    assert.equal(response.body.autopilot, true);
    assert.equal(conv.claudeSessionId, null);
    assert.equal(conv.codexSessionId, null);
    assert.equal(state.getSaveIndexCalls() >= 1, true);
  });

  it('returns conversation details and 404 for missing conversation', async () => {
    const found = await requestJson(baseUrl, 'GET', '/api/conversations/conv-1');
    assert.equal(found.status, 200);
    assert.equal(found.body.id, 'conv-1');

    const missing = await requestJson(baseUrl, 'GET', '/api/conversations/does-not-exist');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'Not found');
  });

  it('computes and caches stats', async () => {
    const first = await requestJson(baseUrl, 'GET', '/api/stats');
    assert.equal(first.status, 200);
    assert.equal(first.body.conversations.total >= 1, true);
    assert.equal(first.body.messages.total >= 1, true);

    const second = await requestJson(baseUrl, 'GET', '/api/stats');
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, first.body);
  });

  it('exports conversation as JSON and markdown', async () => {
    const jsonResponse = await fetch(`${baseUrl}/api/conversations/conv-1/export?format=json`);
    assert.equal(jsonResponse.status, 200);
    const jsonBody = await jsonResponse.json();
    assert.equal(jsonBody.name, 'Existing');
    assert.equal(Array.isArray(jsonBody.messages), true);

    const mdResponse = await fetch(`${baseUrl}/api/conversations/conv-1/export`);
    assert.equal(mdResponse.status, 200);
    const markdown = await mdResponse.text();
    assert.ok(markdown.includes('# Existing'));
    assert.ok(markdown.includes('Assistant'));
  });

  it('validates fork input and creates a same-workspace fork with inherited session context', async () => {
    const invalid = await requestJson(baseUrl, 'POST', '/api/conversations/conv-1/fork', {});
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'fromMessageIndex required');

    const response = await requestJson(baseUrl, 'POST', '/api/conversations/conv-1/fork', {
      fromMessageIndex: 1,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.parentId, 'conv-1');
    assert.equal(response.body.forkIndex, 1);
    assert.equal(response.body.workspaceMode, 'same');
    assert.equal(response.body.claudeForkSessionId, 'sess-tip');
    assert.equal(state.getSaveConversationCalls().length >= 1, true);
  });

  it('compresses a conversation and marks old messages summarized', async () => {
    const conv = state.conversations.get('conv-1');
    conv.messages.push({ role: 'user', text: 'third message', timestamp: Date.now() - 1000 });
    conv.claudeSessionId = 'session-before-compress';
    conv.codexSessionId = 'codex-before-compress';
    state.setGeneratedSummary('Compressed summary');
    const response = await requestJson(baseUrl, 'POST', '/api/conversations/conv-1/compress', {
      threshold: 1,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.messagesSummarized, 3);

    assert.equal(conv.claudeSessionId, null);
    assert.equal(conv.codexSessionId, null);
    assert.equal(conv.messages.some((m) => m.role === 'system' && m.text === 'Compressed summary'), true);
  });

  it('builds a conversation tree with child metadata', async () => {
    state.conversations.set('child-1', {
      id: 'child-1',
      name: 'Forked',
      cwd: '/tmp/project',
      provider: 'claude',
      model: 'claude-sonnet-4.5',
      executionMode: 'patch',
      messages: [{ role: 'assistant', text: 'child' }],
      status: 'idle',
      createdAt: Date.now(),
      parentId: 'conv-1',
      forkIndex: 1,
    });

    const response = await requestJson(baseUrl, 'GET', '/api/conversations/child-1/tree');
    assert.equal(response.status, 200);
    assert.equal(response.body.rootId, 'conv-1');
    assert.equal(response.body.tree.id, 'conv-1');
    assert.equal(response.body.tree.children.length, 1);
    assert.equal(response.body.tree.children[0].id, 'child-1');
  });

  it('deletes conversation and triggers cleanup side effects', async () => {
    const response = await requestJson(baseUrl, 'DELETE', '/api/conversations/conv-1');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(state.conversations.has('conv-1'), false);
    assert.deepEqual(state.getProviderCancelCalls(), [{ provider: 'claude', conversationId: 'conv-1' }]);
    assert.deepEqual(state.getStopPreviewCalls(), ['conv-1']);
    assert.deepEqual(state.getDeleteEmbeddingCalls(), ['conv-1']);
    assert.deepEqual(state.getDeleteConversationFilesCalls(), ['conv-1']);
    assert.equal(state.getSaveIndexCalls(), 1);
  });
});
