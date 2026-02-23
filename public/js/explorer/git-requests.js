import { buildDeleteFileUrl } from './context.js';

function withCwdBody(context, body = {}) {
  if (context?.kind !== 'cwd') return body;
  const cwd = context.getCwd?.();
  if (!cwd) return body;
  return { ...body, cwd };
}

async function jsonResult(res, fallbackError) {
  if (!res) return { ok: false, error: fallbackError };
  return { ok: true, data: await res.json() };
}

export function createGitStashRequests({
  context,
  apiFetch,
}) {
  return {
    requestStashes: async () => {
      const res = await apiFetch(context.getGitUrl('stash'), { silent: true });
      if (!res) return { ok: true, data: { stashes: [] } };
      return { ok: true, data: await res.json() };
    },

    requestStashCreate: async (body) => {
      const res = await apiFetch(context.getGitUrl('stash'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context, body || {})),
      });
      return jsonResult(res, 'Failed to stash changes');
    },

    requestStashPop: async (index) => {
      const res = await apiFetch(context.getGitUrl('stash/pop'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context, { index })),
      });
      return jsonResult(res, 'Failed to apply stash');
    },

    requestStashApply: async (index) => {
      const res = await apiFetch(context.getGitUrl('stash/apply'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context, { index })),
      });
      return jsonResult(res, 'Failed to apply stash');
    },

    requestStashDrop: async (index) => {
      const res = await apiFetch(context.getGitUrl('stash/drop'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context, { index })),
      });
      return jsonResult(res, 'Failed to drop stash');
    },
  };
}

export function createGitChangesRequests({
  context,
  apiFetch,
  getDeletePath,
}) {
  return {
    requestStatus: async () => {
      const res = await apiFetch(context.getGitUrl('status'), { silent: true });
      return jsonResult(res, 'Failed to load git status');
    },

    requestStage: async (paths) => {
      const res = await apiFetch(context.getGitUrl('stage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context, { paths })),
      });
      return jsonResult(res, 'Failed to stage files');
    },

    requestUnstage: async (paths) => {
      const res = await apiFetch(context.getGitUrl('unstage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context, { paths })),
      });
      return jsonResult(res, 'Failed to unstage files');
    },

    requestDiscard: async (paths) => {
      const res = await apiFetch(context.getGitUrl('discard'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context, { paths })),
      });
      return jsonResult(res, 'Failed to discard changes');
    },

    requestDeleteUntracked: async (relativePath) => {
      const resolvedPath = getDeletePath ? getDeletePath(relativePath) : relativePath;
      const res = await apiFetch(buildDeleteFileUrl(resolvedPath), { method: 'DELETE' });
      return jsonResult(res, 'Failed to delete file');
    },

    requestCommit: async (message) => {
      const res = await apiFetch(context.getGitUrl('commit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context, { message })),
      });
      return jsonResult(res, 'Failed to commit changes');
    },

    requestPush: async () => {
      const res = await apiFetch(context.getGitUrl('push'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context)),
      });
      return jsonResult(res, 'Failed to push');
    },

    requestPull: async () => {
      const res = await apiFetch(context.getGitUrl('pull'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context)),
      });
      return jsonResult(res, 'Failed to pull');
    },
  };
}

export function createGitHistoryRequests({
  context,
  apiFetch,
}) {
  return {
    requestCommits: async () => {
      const res = await apiFetch(context.getGitUrl('commits'), { silent: true });
      return jsonResult(res, 'Failed to load commits');
    },

    requestStatus: async () => {
      const res = await apiFetch(context.getGitUrl('status'), { silent: true });
      return jsonResult(res, 'Failed to load git status');
    },

    requestUndoCommit: async () => {
      const res = await apiFetch(context.getGitUrl('undo-commit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context)),
      });
      return jsonResult(res, 'Failed to undo commit');
    },

    requestRevertCommit: async (hash) => {
      const res = await apiFetch(context.getGitUrl('revert'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context, { hash })),
      });
      return jsonResult(res, 'Failed to revert commit');
    },

    requestResetCommit: async (hash, mode) => {
      const res = await apiFetch(context.getGitUrl('reset'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context, { hash, mode })),
      });
      return jsonResult(res, 'Failed to reset commit');
    },

    requestCommitDiff: async (hash) => {
      const res = await apiFetch(context.getGitUrl(`commits/${hash}`), { silent: true });
      return jsonResult(res, 'Failed to load commit');
    },
  };
}

export function createGitBranchRequests({
  context,
  apiFetch,
}) {
  return {
    requestBranches: async () => {
      const res = await apiFetch(context.getGitUrl('branches'), { silent: true });
      return jsonResult(res, 'Failed to load branches');
    },

    requestCreateBranch: async (name, checkout) => {
      const res = await apiFetch(context.getGitUrl('branch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context, { name, checkout })),
      });
      return jsonResult(res, 'Failed to create branch');
    },

    requestCheckoutBranch: async (branch) => {
      const res = await apiFetch(context.getGitUrl('checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withCwdBody(context, { branch })),
      });
      return jsonResult(res, 'Failed to checkout branch');
    },
  };
}
