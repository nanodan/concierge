const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;

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

function isInside(baseCwd, targetPath) {
  const rel = path.relative(path.resolve(baseCwd), path.resolve(targetPath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function createFileRouteFixture() {
  const conversations = new Map([
    ['conv-1', { id: 'conv-1', cwd: '/workspace/project' }],
  ]);

  let directoryError = null;
  let isRepo = true;
  let gitResult = { ok: true, stdout: '', stderr: '' };
  const downloads = [];

  const helpers = {
    withConversation(handler) {
      return async (req, res) => {
        const conv = conversations.get(req.params.id);
        if (!conv) return res.status(404).json({ error: 'Not found' });
        return handler(req, res, conv);
      };
    },
    sanitizeFilename(name) {
      return String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    },
    handleFileUpload(_req, res, filePath, formatter) {
      const response = formatter ? formatter(filePath, path.basename(filePath)) : { path: filePath };
      res.json(response);
    },
    isPathWithinCwd(baseCwd, targetPath) {
      return isInside(baseCwd, targetPath);
    },
    async listDirectory(_resolved, _opts) {
      if (directoryError) return directoryError;
      return {
        entries: [
          { name: 'a.txt', isDirectory: false },
          { name: 'subdir', isDirectory: true },
        ],
      };
    },
    async isGitRepo() {
      return isRepo;
    },
    async runGit(_cwd, _args) {
      return gitResult;
    },
    async sendFileDownload(res, filePath, { inline }) {
      downloads.push({ filePath, inline });
      res.json({ ok: true, filePath, inline });
    },
  };

  const routeModule = requireWithMocks('../lib/routes/files', {
    [require.resolve('../lib/data')]: {
      UPLOAD_DIR: '/tmp/uploads',
    },
    [require.resolve('../lib/constants')]: {
      MAX_UPLOAD_SIZE: 16 * 1024,
    },
    [require.resolve('../lib/routes/helpers')]: helpers,
  }, __filename);

  return {
    setupFileRoutes: routeModule.setupFileRoutes,
    state: {
      setDirectoryError(err) {
        directoryError = err;
      },
      setIsRepo(value) {
        isRepo = !!value;
      },
      setGitResult(value) {
        gitResult = value;
      },
      getDownloads() {
        return [...downloads];
      },
      setConversationCwd(cwd) {
        const conv = conversations.get('conv-1');
        if (conv) conv.cwd = cwd;
      },
    },
  };
}

describe('file routes', () => {
  let server;
  let baseUrl;
  let state;
  let tmpRoot;

  beforeEach(async () => {
    const fixture = createFileRouteFixture();
    state = fixture.state;
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'concierge-files-routes-'));
    const app = express();
    app.use(express.json());
    fixture.setupFileRoutes(app);
    server = await startServer(app);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await stopServer(server);
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
    await fs.rm('/tmp/uploads/conv-1', { recursive: true, force: true });
    server = null;
    baseUrl = null;
    state = null;
    tmpRoot = null;
  });

  it('returns listDirectory errors for /api/files', async () => {
    state.setDirectoryError({ status: 403, error: 'Access denied', code: 'ACCESS_DENIED' });
    const response = await requestJson(baseUrl, 'GET', '/api/files?path=/restricted');
    assert.equal(response.status, 403);
    assert.equal(response.body.error, 'Access denied');
    assert.equal(response.body.code, 'ACCESS_DENIED');
  });

  it('returns directory entries for /api/files', async () => {
    const response = await requestJson(baseUrl, 'GET', '/api/files?path=/workspace/project');
    assert.equal(response.status, 200);
    assert.equal(response.body.path, '/workspace/project');
    assert.equal(response.body.entries.length, 2);
  });

  it('denies traversal outside cwd for conversation file list', async () => {
    const response = await requestJson(baseUrl, 'GET', '/api/conversations/conv-1/files?path=../secrets');
    assert.equal(response.status, 403);
    assert.equal(response.body.error, 'Access denied');
  });

  it('validates required q parameter on conversation file search', async () => {
    const response = await requestJson(baseUrl, 'GET', '/api/conversations/conv-1/files/search');
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'q parameter required');
  });

  it('requires git repository for conversation file search', async () => {
    state.setIsRepo(false);
    const response = await requestJson(baseUrl, 'GET', '/api/conversations/conv-1/files/search?q=hello');
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'Search requires a git repository');
  });

  it('parses git grep output into structured search results', async () => {
    state.setGitResult({
      ok: true,
      stdout: 'src/a.js:10:const value = 1\nsrc/b.js:3:hello world\n',
      stderr: '',
    });

    const response = await requestJson(baseUrl, 'GET', '/api/conversations/conv-1/files/search?q=hello');
    assert.equal(response.status, 200);
    assert.equal(response.body.results.length, 2);
    assert.deepEqual(response.body.results[0], { path: 'src/a.js', line: 10, content: 'const value = 1' });
  });

  it('validates required path for general download endpoint', async () => {
    const response = await requestJson(baseUrl, 'GET', '/api/files/download');
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'path required');
  });

  it('validates required path for file content endpoints', async () => {
    const general = await requestJson(baseUrl, 'GET', '/api/files/content');
    assert.equal(general.status, 400);
    assert.equal(general.body.error, 'path required');

    const convo = await requestJson(baseUrl, 'GET', '/api/conversations/conv-1/files/content');
    assert.equal(convo.status, 400);
    assert.equal(convo.body.error, 'path required');
  });

  it('blocks traversal for conversation file content endpoint', async () => {
    const response = await requestJson(baseUrl, 'GET', '/api/conversations/conv-1/files/content?path=../secret.txt');
    assert.equal(response.status, 403);
    assert.equal(response.body.error, 'Access denied');
  });

  it('validates upload filename for generic upload route', async () => {
    const response = await requestJson(baseUrl, 'POST', '/api/files/upload?path=/workspace/project');
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'filename required');
  });

  it('returns conversation upload URL and sanitizes filename', async () => {
    const response = await requestJson(baseUrl, 'POST', '/api/conversations/conv-1/upload?filename=../../unsafe name.txt');
    assert.equal(response.status, 200);
    assert.ok(response.body.filename.includes('_'));
    assert.ok(response.body.url.startsWith('/uploads/conv-1/'));
  });

  it('attaches existing conversation cwd files into uploads', async () => {
    state.setConversationCwd(tmpRoot);
    await fs.mkdir(path.join(tmpRoot, 'images'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'images', 'plot.png'), 'image-bytes');

    const response = await requestJson(baseUrl, 'POST', '/api/conversations/conv-1/attachments/from-files', {
      paths: ['images/plot.png'],
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.attachments.length, 1);
    assert.equal(response.body.failed.length, 0);
    assert.equal(response.body.attachments[0].filename, 'plot.png');
    assert.ok(response.body.attachments[0].url.startsWith('/uploads/conv-1/'));
    const copied = await fs.stat(response.body.attachments[0].path);
    assert.equal(copied.isFile(), true);
  });

  it('returns partial success for attachment copy failures', async () => {
    state.setConversationCwd(tmpRoot);
    await fs.writeFile(path.join(tmpRoot, 'ok.txt'), 'ok');

    const response = await requestJson(baseUrl, 'POST', '/api/conversations/conv-1/attachments/from-files', {
      paths: ['ok.txt', 'missing.txt'],
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.attachments.length, 1);
    assert.equal(response.body.failed.length, 1);
    assert.equal(response.body.failed[0].path, 'missing.txt');
  });

  it('blocks traversal for attach-existing endpoint', async () => {
    state.setConversationCwd(tmpRoot);
    const response = await requestJson(baseUrl, 'POST', '/api/conversations/conv-1/attachments/from-files', {
      paths: ['../outside.txt'],
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.attachments.length, 0);
    assert.equal(response.body.failed[0].error, 'Access denied');
  });

  it('rejects non-file and oversized entries for attach-existing endpoint', async () => {
    state.setConversationCwd(tmpRoot);
    await fs.mkdir(path.join(tmpRoot, 'folder'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'large.bin'), Buffer.alloc(20 * 1024));

    const response = await requestJson(baseUrl, 'POST', '/api/conversations/conv-1/attachments/from-files', {
      paths: ['folder', 'large.bin'],
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.attachments.length, 0);
    assert.equal(response.body.failed.length, 2);
    assert.equal(response.body.failed[0].error, 'Path is not a file');
    assert.match(response.body.failed[1].error, /File too large/);
  });

  it('returns browse error for invalid directory path', async () => {
    const response = await requestJson(baseUrl, 'GET', '/api/browse?path=/definitely/not/a/real/path');
    assert.equal(response.status, 400);
    assert.equal(typeof response.body.error, 'string');
  });

  it('validates browse search parameters', async () => {
    const missingBase = await requestJson(baseUrl, 'GET', '/api/browse/search?q=data');
    assert.equal(missingBase.status, 400);
    assert.equal(missingBase.body.error, 'base required');

    const missingQuery = await requestJson(baseUrl, 'GET', `/api/browse/search?base=${encodeURIComponent(tmpRoot)}`);
    assert.equal(missingQuery.status, 400);
    assert.equal(missingQuery.body.error, 'q required');
  });

  it('returns recursive directory search matches', async () => {
    await fs.mkdir(path.join(tmpRoot, 'datasets', 'raw-data'), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, 'datasets', 'processed-data'), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, 'reports'), { recursive: true });

    const response = await requestJson(
      baseUrl,
      'GET',
      `/api/browse/search?base=${encodeURIComponent(tmpRoot)}&q=${encodeURIComponent('data')}&depth=4&limit=10`
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.base, tmpRoot);
    assert.equal(Array.isArray(response.body.results), true);
    assert.equal(response.body.results.length >= 2, true);

    const relPaths = response.body.results.map((item) => item.relPath);
    assert.equal(relPaths.includes('datasets/raw-data'), true);
    assert.equal(relPaths.includes('datasets/processed-data'), true);
  });

  it('skips hidden and heavy directories in browse search', async () => {
    await fs.mkdir(path.join(tmpRoot, '.git', 'data-hidden'), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, 'node_modules', 'data-packages'), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, 'safe-data'), { recursive: true });

    const response = await requestJson(
      baseUrl,
      'GET',
      `/api/browse/search?base=${encodeURIComponent(tmpRoot)}&q=${encodeURIComponent('data')}&depth=4&limit=20`
    );
    assert.equal(response.status, 200);
    const relPaths = response.body.results.map((item) => item.relPath);
    assert.equal(relPaths.includes('safe-data'), true);
    assert.equal(relPaths.some((relPath) => relPath.includes('.git')), false);
    assert.equal(relPaths.some((relPath) => relPath.includes('node_modules')), false);
  });

  it('enforces search result limits and marks truncation', async () => {
    for (let i = 0; i < 8; i++) {
      await fs.mkdir(path.join(tmpRoot, `data-${i}`), { recursive: true });
    }

    const response = await requestJson(
      baseUrl,
      'GET',
      `/api/browse/search?base=${encodeURIComponent(tmpRoot)}&q=${encodeURIComponent('data')}&depth=2&limit=3`
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.results.length <= 3, true);
    assert.equal(response.body.truncated, true);
  });

  it('creates a directory through mkdir endpoint', async () => {
    const target = path.join(tmpRoot, 'nested', 'folder');
    const response = await requestJson(baseUrl, 'POST', '/api/mkdir', { path: target });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    const stat = await fs.stat(target);
    assert.equal(stat.isDirectory(), true);
  });

  it('validates and handles delete endpoint errors', async () => {
    const missingParam = await requestJson(baseUrl, 'DELETE', '/api/files');
    assert.equal(missingParam.status, 400);
    assert.equal(missingParam.body.error, 'path required');

    const missingFile = await requestJson(baseUrl, 'DELETE', `/api/files?path=${encodeURIComponent(path.join(tmpRoot, 'missing.txt'))}`);
    assert.equal(missingFile.status, 404);
    assert.equal(missingFile.body.error, 'File not found');
  });

  it('rejects conversation file download outside cwd', async () => {
    const response = await requestJson(baseUrl, 'GET', '/api/conversations/conv-1/files/download?path=../../passwd');
    assert.equal(response.status, 403);
    assert.equal(response.body.error, 'Access denied');
    assert.equal(state.getDownloads().length, 0);
  });
});
