const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'explorer', 'git-requests.js')).href;

describe('explorer git request adapters', async () => {
  const {
    createGitStashRequests,
    createGitChangesRequests,
    createGitHistoryRequests,
    createGitBranchRequests,
  } = await import(moduleUrl);

  it('adds cwd to mutating bodies for cwd contexts', async () => {
    const calls = [];
    const context = {
      kind: 'cwd',
      getCwd: () => '/repo',
      getGitUrl: (endpoint) => `/api/git/${endpoint}?cwd=%2Frepo`,
    };
    const apiFetch = async (url, options = {}) => {
      calls.push({ url, options });
      return { async json() { return { ok: true }; } };
    };

    const requests = createGitChangesRequests({
      context,
      apiFetch,
      getDeletePath: (p) => `/repo/${p}`,
    });

    await requests.requestStage(['a.txt']);
    await requests.requestHunkAction('a.txt', { header: '@@ -1 +1 @@', lines: ['-a', '+b'] }, false, 'stage');
    await requests.requestDeleteUntracked('tmp.log');

    const stageBody = JSON.parse(calls[0].options.body);
    assert.equal(stageBody.cwd, '/repo');
    assert.deepEqual(stageBody.paths, ['a.txt']);
    const hunkBody = JSON.parse(calls[1].options.body);
    assert.equal(calls[1].url, '/api/git/hunk-action?cwd=%2Frepo');
    assert.equal(hunkBody.cwd, '/repo');
    assert.equal(hunkBody.path, 'a.txt');
    assert.equal(hunkBody.action, 'stage');
    assert.equal(calls[2].url, '/api/files?path=%2Frepo%2Ftmp.log');
  });

  it('does not add cwd to conversation payloads', async () => {
    const calls = [];
    const context = {
      kind: 'conversation',
      getGitUrl: (endpoint) => `/api/conversations/c1/git/${endpoint}`,
    };
    const apiFetch = async (url, options = {}) => {
      calls.push({ url, options });
      return { async json() { return { ok: true }; } };
    };

    const requests = createGitChangesRequests({ context, apiFetch });
    await requests.requestCommit('hello');

    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.cwd, undefined);
    assert.equal(body.message, 'hello');
  });

  it('returns empty stashes when stash list request fails', async () => {
    const context = {
      kind: 'conversation',
      getGitUrl: (endpoint) => `/api/conversations/c1/git/${endpoint}`,
    };
    const requests = createGitStashRequests({ context, apiFetch: async () => null });

    const result = await requests.requestStashes();
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { stashes: [] });
  });

  it('builds history and branch requests through context git URLs', async () => {
    const calls = [];
    const context = {
      kind: 'conversation',
      getGitUrl: (endpoint) => `/api/conversations/c2/git/${endpoint}`,
    };
    const apiFetch = async (url, options = {}) => {
      calls.push({ url, options });
      return { async json() { return { ok: true }; } };
    };

    const history = createGitHistoryRequests({ context, apiFetch });
    const branches = createGitBranchRequests({ context, apiFetch });

    await history.requestCommitDiff('abc1234');
    await branches.requestCheckoutBranch('feature/x');

    assert.equal(calls[0].url, '/api/conversations/c2/git/commits/abc1234');
    assert.equal(calls[1].url, '/api/conversations/c2/git/checkout');
    const checkoutBody = JSON.parse(calls[1].options.body);
    assert.equal(checkoutBody.branch, 'feature/x');
  });
});
