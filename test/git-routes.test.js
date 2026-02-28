const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('path');

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

function createGitRouteFixture() {
  const conversations = new Map([
    ['conv-auto', { id: 'conv-auto', name: 'Auto', cwd: '/repo', executionMode: 'autonomous' }],
    ['conv-read', { id: 'conv-read', name: 'Read only', cwd: '/repo', executionMode: 'patch' }],
    ['conv-blocker', { id: 'conv-blocker', name: 'Blocker', cwd: '/repo', executionMode: 'autonomous' }],
  ]);

  let gitRepo = true;
  let lock = null;
  const gitCalls = [];
  const gitResults = new Map();

  function setGitResult(args, value) {
    gitResults.set(JSON.stringify(args), value);
  }

  async function runGit(_cwd, args) {
    gitCalls.push(args);
    const key = JSON.stringify(args);
    const configured = gitResults.get(key);
    if (Array.isArray(configured)) {
      if (configured.length === 0) return { ok: true, stdout: '', stderr: '' };
      return configured.shift();
    }
    if (typeof configured === 'function') {
      return configured(args, gitCalls);
    }
    if (configured) return configured;
    return { ok: true, stdout: '', stderr: '' };
  }

  const helpers = {
    withConversation(handler) {
      return async (req, res) => {
        const conv = conversations.get(req.params.id);
        if (!conv) return res.status(404).json({ error: 'Not found' });
        return handler(req, res, conv);
      };
    },
    withGitRepo(handler) {
      return async (req, res) => {
        const conv = conversations.get(req.params.id);
        if (!conv) return res.status(404).json({ error: 'Not found' });
        if (!gitRepo) return res.status(400).json({ error: 'Not a git repository' });
        return handler(req, res, conv, conv.cwd || '/repo');
      };
    },
    withCwd(handler) {
      return async (req, res) => {
        return handler(req, res, '/repo');
      };
    },
    isPathWithinCwd(baseCwd, targetPath) {
      return isInside(baseCwd, targetPath);
    },
    validatePathsWithinCwd(cwd, paths) {
      for (const entry of paths || []) {
        if (!isInside(cwd, path.resolve(cwd, entry))) {
          return { valid: false, invalidPath: entry };
        }
      }
      return { valid: true };
    },
    runGit,
    async isGitRepo() {
      return gitRepo;
    },
  };

  const routeModule = requireWithMocks('../lib/routes/git', {
    [require.resolve('../lib/routes/helpers')]: helpers,
    [require.resolve('../lib/data')]: { conversations },
    [require.resolve('../lib/workflow/execution-mode')]: {
      resolveConversationExecutionMode(conv) {
        return conv.executionMode || 'patch';
      },
    },
    [require.resolve('../lib/workflow/locks')]: {
      canWrite(_cwd, conversationId) {
        if (!lock) return true;
        return lock.writerConversationId === conversationId;
      },
      getLock() {
        return lock;
      },
    },
  }, __filename);

  return {
    setupGitRoutes: routeModule.setupGitRoutes,
    state: {
      setGitRepo(value) {
        gitRepo = !!value;
      },
      setLock(value) {
        lock = value;
      },
      clearGitCalls() {
        gitCalls.length = 0;
      },
      setGitResult,
      getGitCalls() {
        return [...gitCalls];
      },
    },
  };
}

describe('git routes', () => {
  let server;
  let baseUrl;
  let state;

  beforeEach(async () => {
    const fixture = createGitRouteFixture();
    state = fixture.state;
    const app = express();
    app.use(express.json());
    fixture.setupGitRoutes(app);
    server = await startServer(app);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await stopServer(server);
    server = null;
    baseUrl = null;
    state = null;
  });

  it('blocks write routes when conversation execution mode is read-only', async () => {
    const response = await requestJson(baseUrl, 'POST', '/api/conversations/conv-read/git/stage', {
      paths: ['a.txt'],
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'EXECUTION_MODE_READONLY');
    assert.equal(response.body.executionMode, 'patch');
  });

  it('returns lock metadata when another conversation owns the write lock', async () => {
    state.setLock({ cwd: '/repo', writerConversationId: 'conv-blocker' });
    const response = await requestJson(baseUrl, 'POST', '/api/conversations/conv-auto/git/stage', {
      paths: ['a.txt'],
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'WRITE_LOCKED');
    assert.equal(response.body.blockerConversationId, 'conv-blocker');
    assert.equal(response.body.blockerConversationName, 'Blocker');
  });

  it('returns isRepo false on status when cwd is not a git repository', async () => {
    state.setGitRepo(false);
    const response = await requestJson(baseUrl, 'GET', '/api/conversations/conv-auto/git/status');
    assert.equal(response.status, 200);
    assert.equal(response.body.isRepo, false);
  });

  it('parses status output into staged, unstaged, and untracked buckets', async () => {
    state.setGitResult(['rev-parse', '--abbrev-ref', 'HEAD'], { ok: true, stdout: 'feature-x\n', stderr: '' });
    state.setGitResult(['remote', 'get-url', 'origin'], { ok: true, stdout: 'git@github.com:org/repo.git\n', stderr: '' });
    state.setGitResult(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], { ok: true, stdout: '2 1\n', stderr: '' });
    state.setGitResult(['status', '--porcelain=v1'], {
      ok: true,
      stdout: 'M  src/a.js\n M src/b.js\n?? new.txt\n',
      stderr: '',
    });

    const response = await requestJson(baseUrl, 'GET', '/api/conversations/conv-auto/git/status');
    assert.equal(response.status, 200);
    assert.equal(response.body.isRepo, true);
    assert.equal(response.body.branch, 'feature-x');
    assert.equal(response.body.ahead, 2);
    assert.equal(response.body.behind, 1);
    assert.equal(response.body.hasOrigin, true);
    assert.equal(response.body.hasUpstream, true);
    assert.deepEqual(response.body.staged, [{ path: 'src/a.js', status: 'M' }]);
    assert.deepEqual(response.body.unstaged, [{ path: 'src/b.js', status: 'M' }]);
    assert.deepEqual(response.body.untracked, [{ path: 'new.txt' }]);
  });

  it('parses local and remote branches', async () => {
    state.setGitResult(['rev-parse', '--abbrev-ref', 'HEAD'], { ok: true, stdout: 'main\n', stderr: '' });
    state.setGitResult(['branch', '-a'], {
      ok: true,
      stdout: '* main\n  feature/data\n  remotes/origin/main\n  remotes/origin/feature/data\n',
      stderr: '',
    });

    const response = await requestJson(baseUrl, 'GET', '/api/git/branches');
    assert.equal(response.status, 200);
    assert.equal(response.body.current, 'main');
    assert.deepEqual(response.body.local, ['main', 'feature/data']);
    assert.deepEqual(response.body.remote, ['origin/main', 'origin/feature/data']);
  });

  it('validates diff path and blocks traversal', async () => {
    const missingPath = await requestJson(baseUrl, 'POST', '/api/git/diff', {});
    assert.equal(missingPath.status, 400);
    assert.equal(missingPath.body.error, 'path required');

    const denied = await requestJson(baseUrl, 'POST', '/api/git/diff', { path: '../secret.txt' });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'Access denied');
  });

  it('returns parsed hunks for diff requests', async () => {
    state.setGitResult(['diff', '--', 'src/a.js'], {
      ok: true,
      stdout: 'diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-old\n+new\n',
      stderr: '',
    });

    const response = await requestJson(baseUrl, 'POST', '/api/git/diff', { path: 'src/a.js' });
    assert.equal(response.status, 200);
    assert.equal(response.body.path, 'src/a.js');
    assert.equal(response.body.hunks.length, 1);
    assert.equal(response.body.hunks[0].header, '@@ -1 +1 @@');
  });

  it('validates stage request paths', async () => {
    const missingPaths = await requestJson(baseUrl, 'POST', '/api/git/stage', {});
    assert.equal(missingPaths.status, 400);
    assert.equal(missingPaths.body.error, 'paths required');

    const denied = await requestJson(baseUrl, 'POST', '/api/git/stage', { paths: ['../x'] });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'Access denied');
  });

  it('returns commit hash on successful commit', async () => {
    state.setGitResult(['commit', '-m', 'ship it'], { ok: true, stdout: '[main abc1234] ship it\n', stderr: '' });
    state.setGitResult(['rev-parse', '--short', 'HEAD'], { ok: true, stdout: 'abc1234\n', stderr: '' });

    const response = await requestJson(baseUrl, 'POST', '/api/git/commit', { message: 'ship it' });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.hash, 'abc1234');
  });

  it('validates branch name before creating branch', async () => {
    const response = await requestJson(baseUrl, 'POST', '/api/git/branch', { name: 'bad branch name' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'Invalid branch name');
  });

  it('maps push authentication failures to 401', async () => {
    state.setGitResult(['rev-parse', '--abbrev-ref', 'HEAD'], { ok: true, stdout: 'feature\n', stderr: '' });
    state.setGitResult(['rev-parse', '--abbrev-ref', '@{upstream}'], { ok: true, stdout: 'origin/feature\n', stderr: '' });
    state.setGitResult(['push'], { ok: false, stdout: '', stderr: 'fatal: Authentication failed' });

    const response = await requestJson(baseUrl, 'POST', '/api/git/push', {});
    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Authentication failed. Check your credentials.');
  });

  it('uses upstream bootstrap args when branch has no upstream on push', async () => {
    state.setGitResult(['rev-parse', '--abbrev-ref', 'HEAD'], { ok: true, stdout: 'feature\n', stderr: '' });
    state.setGitResult(['rev-parse', '--abbrev-ref', '@{upstream}'], { ok: false, stdout: '', stderr: 'no upstream' });
    state.setGitResult(['push', '-u', 'origin', 'feature'], { ok: true, stdout: 'ok', stderr: '' });

    const response = await requestJson(baseUrl, 'POST', '/api/git/push', {});
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    const calls = state.getGitCalls().map((args) => JSON.stringify(args));
    assert.ok(calls.includes(JSON.stringify(['push', '-u', 'origin', 'feature'])));
  });

  it('maps pull local-changes failures to conflict', async () => {
    state.setGitResult(['pull'], { ok: false, stdout: '', stderr: 'Your local changes would be overwritten by merge' });
    const response = await requestJson(baseUrl, 'POST', '/api/git/pull', {});
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'Commit or stash changes before pulling.');
  });

  it('parses stash list and handles no-op stash creation', async () => {
    state.setGitResult(['stash', 'list', '--format=%gd|%s|%ar'], {
      ok: true,
      stdout: 'stash@{0}|WIP on main|2 hours ago\nstash@{1}|temp fixes|1 day ago\n',
      stderr: '',
    });
    const list = await requestJson(baseUrl, 'GET', '/api/git/stash');
    assert.equal(list.status, 200);
    assert.equal(list.body.stashes.length, 2);
    assert.equal(list.body.stashes[0].index, 0);
    assert.equal(list.body.stashes[1].message, 'temp fixes');

    state.setGitResult(['stash'], { ok: true, stdout: 'No local changes to save\n', stderr: '' });
    const create = await requestJson(baseUrl, 'POST', '/api/git/stash', {});
    assert.equal(create.status, 400);
    assert.equal(create.body.error, 'No local changes to stash');
  });

  it('validates stash index and maps stash conflicts', async () => {
    const badIndex = await requestJson(baseUrl, 'POST', '/api/git/stash/pop', { index: -1 });
    assert.equal(badIndex.status, 400);
    assert.equal(badIndex.body.error, 'Invalid stash index');

    state.setGitResult(['stash', 'pop', 'stash@{0}'], { ok: false, stdout: '', stderr: 'merge conflict' });
    const conflict = await requestJson(baseUrl, 'POST', '/api/git/stash/pop', { index: 0 });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, 'Merge conflict while applying stash');
  });

  it('handles revert conflict by aborting revert state', async () => {
    state.clearGitCalls();
    state.setGitResult(['revert', 'abcdef1', '--no-edit'], { ok: false, stdout: '', stderr: 'conflict' });
    state.setGitResult(['revert', '--abort'], { ok: true, stdout: '', stderr: '' });

    const response = await requestJson(baseUrl, 'POST', '/api/git/revert', { hash: 'abcdef1' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'Conflict while reverting. Revert aborted.');

    const calls = state.getGitCalls().map((args) => JSON.stringify(args));
    assert.ok(calls.includes(JSON.stringify(['revert', '--abort'])));
  });

  it('validates reset mode and undo-commit preconditions', async () => {
    const badMode = await requestJson(baseUrl, 'POST', '/api/git/reset', { hash: 'abcdef1', mode: 'invalid' });
    assert.equal(badMode.status, 400);
    assert.equal(badMode.body.error, 'Invalid reset mode. Must be soft, mixed, or hard.');

    state.setGitResult(['rev-parse', 'HEAD'], { ok: false, stdout: '', stderr: 'no commits' });
    const undo = await requestJson(baseUrl, 'POST', '/api/git/undo-commit', {});
    assert.equal(undo.status, 400);
    assert.equal(undo.body.error, 'No commits to undo');
  });

  it('parses commit list and commit detail payloads', async () => {
    state.setGitResult(['log', '--format=%H|%s|%an|%ar', '-n', '20'], {
      ok: true,
      stdout: 'abc1234|Fix bug|Alex|2 days ago\n',
      stderr: '',
    });
    const commits = await requestJson(baseUrl, 'GET', '/api/git/commits');
    assert.equal(commits.status, 200);
    assert.equal(commits.body.commits.length, 1);
    assert.equal(commits.body.commits[0].hash, 'abc1234');

    state.setGitResult(['log', '--format=%s|%an|%ar', '-n', '1', 'abc1234'], {
      ok: true,
      stdout: 'Fix bug|Alex|2 days ago\n',
      stderr: '',
    });
    state.setGitResult(['show', '--format=', 'abc1234'], {
      ok: true,
      stdout: 'diff --git a/a.js b/a.js\n',
      stderr: '',
    });
    const detail = await requestJson(baseUrl, 'GET', '/api/git/commits/abc1234');
    assert.equal(detail.status, 200);
    assert.equal(detail.body.hash, 'abc1234');
    assert.equal(detail.body.message, 'Fix bug');
    assert.equal(detail.body.author, 'Alex');
    assert.ok(detail.body.raw.includes('diff --git'));
  });

  it('validates hunk action before applying a patch', async () => {
    const response = await requestJson(baseUrl, 'POST', '/api/git/hunk-action', {
      path: 'src/a.js',
      staged: true,
      action: 'stage',
      hunk: {
        header: '@@ -1 +1 @@',
        lines: ['-old', '+new'],
      },
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'INVALID_HUNK_ACTION');
    assert.equal(response.body.error, 'Invalid hunk action for current diff state');
  });
});
