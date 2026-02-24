/**
 * Git integration routes
 */
const path = require('path');
const { spawn } = require('child_process');

const {
  withConversation,
  isPathWithinCwd,
  validatePathsWithinCwd,
  runGit,
  isGitRepo,
  withGitRepo,
  withCwd,
} = require('./helpers');
const { conversations } = require('../data');
const { resolveConversationExecutionMode } = require('../workflow/execution-mode');
const { canWrite, getLock } = require('../workflow/locks');

// Git status parsing constants
const STAGED_STATUS_POS = 0;
const UNSTAGED_STATUS_POS = 1;
const FILENAME_START_POS = 3;
const STATUS_UNTRACKED = '?';
const STATUS_UNCHANGED = ' ';

/**
 * Parse unified diff into hunks
 * @param {string} diffOutput - Raw git diff output
 * @returns {Array} - Array of hunk objects
 */
function parseDiffHunks(diffOutput) {
  const hunks = [];
  let currentHunk = null;
  let currentFileHeaders = [];
  let currentOldPath = '';
  let currentNewPath = '';
  const diffLines = diffOutput.split('\n');

  for (const line of diffLines) {
    if (line.startsWith('diff --git ')) {
      if (currentHunk) {
        hunks.push(currentHunk);
        currentHunk = null;
      }
      currentFileHeaders = [line];
      currentOldPath = '';
      currentNewPath = '';
      continue;
    }

    if (
      line.startsWith('index ')
      || line.startsWith('new file mode ')
      || line.startsWith('deleted file mode ')
      || line.startsWith('similarity index ')
      || line.startsWith('rename from ')
      || line.startsWith('rename to ')
      || line.startsWith('old mode ')
      || line.startsWith('new mode ')
    ) {
      currentFileHeaders.push(line);
      continue;
    }

    if (line.startsWith('--- ')) {
      currentOldPath = line.slice(4).trim();
      currentFileHeaders.push(line);
      continue;
    }

    if (line.startsWith('+++ ')) {
      currentNewPath = line.slice(4).trim();
      currentFileHeaders.push(line);
      continue;
    }

    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: parseInt(hunkMatch[2] || '1', 10),
        newStart: parseInt(hunkMatch[3], 10),
        newLines: parseInt(hunkMatch[4] || '1', 10),
        header: line,
        oldPath: currentOldPath || '',
        newPath: currentNewPath || '',
        fileHeaders: currentFileHeaders.slice(),
        lines: []
      };
      continue;
    }

    if (
      currentHunk
      && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line === '\\ No newline at end of file')
    ) {
      currentHunk.lines.push(line);
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  return hunks;
}

function normalizeHunkAction(staged, action) {
  const isStaged = staged === true || staged === 'true' || staged === 1 || staged === '1';
  const raw = typeof action === 'string' ? action.trim().toLowerCase() : '';
  let normalized = raw;

  if (!normalized) {
    return isStaged ? 'unstage' : 'discard';
  }

  if (normalized === 'accept') {
    normalized = 'stage';
  } else if (normalized === 'reject') {
    normalized = isStaged ? 'unstage' : 'discard';
  }

  const validActions = new Set(['stage', 'discard', 'unstage']);
  if (!validActions.has(normalized)) return null;

  if (isStaged && normalized !== 'unstage') return null;
  if (!isStaged && normalized === 'unstage') return null;

  return normalized;
}

function buildHunkPatchContent(filePath, hunk) {
  const headers = Array.isArray(hunk.fileHeaders) ? hunk.fileHeaders.filter(Boolean) : [];
  const patchHeaders = headers.filter((line) =>
    line.startsWith('diff --git ')
    || line.startsWith('index ')
    || line.startsWith('new file mode ')
    || line.startsWith('deleted file mode ')
    || line.startsWith('similarity index ')
    || line.startsWith('rename from ')
    || line.startsWith('rename to ')
    || line.startsWith('old mode ')
    || line.startsWith('new mode ')
    || line.startsWith('--- ')
    || line.startsWith('+++ ')
  );

  const fallbackOldPath = `a/${filePath}`;
  const fallbackNewPath = `b/${filePath}`;
  const hasOld = patchHeaders.some((line) => line.startsWith('--- '));
  const hasNew = patchHeaders.some((line) => line.startsWith('+++ '));
  if (!hasOld) patchHeaders.push(`--- ${hunk.oldPath || fallbackOldPath}`);
  if (!hasNew) patchHeaders.push(`+++ ${hunk.newPath || fallbackNewPath}`);

  return [...patchHeaders, hunk.header, ...(hunk.lines || [])].join('\n') + '\n';
}

function getHunkApplyArgs(action) {
  if (action === 'stage') return ['apply', '--cached', '-'];
  if (action === 'discard') return ['apply', '--reverse', '-'];
  if (action === 'unstage') return ['apply', '--reverse', '--cached', '-'];
  return null;
}

async function applyHunkPatch(cwd, patchContent, action) {
  const args = getHunkApplyArgs(action);
  if (!args) return { ok: false, status: 400, code: 'INVALID_HUNK_ACTION', error: 'Invalid hunk action' };

  const gitProcess = spawn('git', args, { cwd });
  let stderr = '';

  gitProcess.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  gitProcess.stdin.write(patchContent);
  gitProcess.stdin.end();

  const exitCode = await new Promise((resolve) => {
    gitProcess.on('close', resolve);
  });

  if (exitCode === 0) return { ok: true };

  const lower = (stderr || '').toLowerCase();
  if (
    lower.includes('patch does not apply')
    || lower.includes('does not match index')
    || lower.includes('patch failed')
    || lower.includes('corrupt patch')
  ) {
    return {
      ok: false,
      status: 409,
      code: 'HUNK_OUTDATED',
      error: 'Chunk no longer matches the current file. Refresh and retry.',
    };
  }

  return { ok: false, status: 500, code: 'HUNK_APPLY_FAILED', error: stderr || 'Failed to apply patch' };
}

// === Core Handler Functions ===
// These take cwd directly and can be used by both conversation-based and standalone routes

async function handleGitStatus(req, res, cwd) {
  if (!(await isGitRepo(cwd))) {
    return res.json({ isRepo: false });
  }

  const branchResult = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchResult.ok ? branchResult.stdout.trim() : 'unknown';

  const originResult = await runGit(cwd, ['remote', 'get-url', 'origin']);
  const hasOrigin = originResult.ok;

  let ahead = 0, behind = 0, hasUpstream = false;
  const aheadBehindResult = await runGit(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  if (aheadBehindResult.ok) {
    hasUpstream = true;
    const parts = aheadBehindResult.stdout.trim().split(/\s+/);
    ahead = parseInt(parts[0], 10) || 0;
    behind = parseInt(parts[1], 10) || 0;
  }

  const statusResult = await runGit(cwd, ['status', '--porcelain=v1']);
  if (!statusResult.ok) {
    return res.status(500).json({ error: statusResult.stderr });
  }

  const staged = [], unstaged = [], untracked = [];

  for (const line of statusResult.stdout.split('\n')) {
    if (!line) continue;
    const stagedStatus = line[STAGED_STATUS_POS];
    const unstagedStatus = line[UNSTAGED_STATUS_POS];
    const filePath = line.slice(FILENAME_START_POS);

    if (stagedStatus === STATUS_UNTRACKED && unstagedStatus === STATUS_UNTRACKED) {
      untracked.push({ path: filePath });
      continue;
    }

    if (stagedStatus !== STATUS_UNCHANGED && stagedStatus !== STATUS_UNTRACKED) {
      staged.push({ path: filePath, status: stagedStatus });
    }

    if (unstagedStatus !== STATUS_UNCHANGED && unstagedStatus !== STATUS_UNTRACKED) {
      unstaged.push({ path: filePath, status: unstagedStatus });
    }
  }

  res.json({ isRepo: true, branch, ahead, behind, hasOrigin, hasUpstream, staged, unstaged, untracked });
}

async function handleGitBranches(req, res, cwd) {
  const currentResult = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const current = currentResult.ok ? currentResult.stdout.trim() : '';

  const branchResult = await runGit(cwd, ['branch', '-a']);
  if (!branchResult.ok) {
    return res.status(500).json({ error: branchResult.stderr });
  }

  const local = [], remote = [];
  for (const line of branchResult.stdout.split('\n')) {
    if (!line.trim()) continue;
    const name = line.replace(/^\*?\s+/, '').trim();
    if (name.startsWith('remotes/')) {
      if (!name.includes('HEAD')) {
        remote.push(name.replace('remotes/', ''));
      }
    } else {
      local.push(name);
    }
  }

  res.json({ current, local, remote });
}

async function handleGitDiff(req, res, cwd) {
  const { path: filePath, staged } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path required' });

  if (!isPathWithinCwd(cwd, path.resolve(cwd, filePath))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const args = staged ? ['diff', '--cached', '--', filePath] : ['diff', '--', filePath];
  const diffResult = await runGit(cwd, args);

  if (!diffResult.ok) {
    return res.status(500).json({ error: diffResult.stderr });
  }

  const hunks = parseDiffHunks(diffResult.stdout);
  res.json({ path: filePath, hunks, raw: diffResult.stdout });
}

async function handleGitStage(req, res, cwd) {
  const { paths } = req.body;
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'paths required' });
  }

  const validation = validatePathsWithinCwd(cwd, paths);
  if (!validation.valid) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const result = await runGit(cwd, ['add', '--', ...paths]);
  if (!result.ok) {
    return res.status(500).json({ error: result.stderr });
  }

  res.json({ ok: true });
}

async function handleGitUnstage(req, res, cwd) {
  const { paths } = req.body;
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'paths required' });
  }

  const validation = validatePathsWithinCwd(cwd, paths);
  if (!validation.valid) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const result = await runGit(cwd, ['restore', '--staged', '--', ...paths]);
  if (!result.ok) {
    return res.status(500).json({ error: result.stderr });
  }

  res.json({ ok: true });
}

async function handleGitDiscard(req, res, cwd) {
  const { paths } = req.body;
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'paths required' });
  }

  const validation = validatePathsWithinCwd(cwd, paths);
  if (!validation.valid) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const result = await runGit(cwd, ['checkout', '--', ...paths]);
  if (!result.ok) {
    return res.status(500).json({ error: result.stderr });
  }

  res.json({ ok: true });
}

async function handleGitCommit(req, res, cwd) {
  const { message } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message required' });
  }

  const result = await runGit(cwd, ['commit', '-m', message.trim()]);
  if (!result.ok) {
    return res.status(500).json({ error: result.stderr });
  }

  const hashResult = await runGit(cwd, ['rev-parse', '--short', 'HEAD']);
  const hash = hashResult.ok ? hashResult.stdout.trim() : '';

  res.json({ ok: true, hash, output: result.stdout });
}

async function handleGitBranch(req, res, cwd) {
  const { name, checkout } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name required' });
  }

  const branchName = name.trim();
  if (!/^[\w\-./]+$/.test(branchName)) {
    return res.status(400).json({ error: 'Invalid branch name' });
  }

  const createResult = await runGit(cwd, ['branch', branchName]);
  if (!createResult.ok) {
    return res.status(500).json({ error: createResult.stderr });
  }

  if (checkout) {
    const checkoutResult = await runGit(cwd, ['checkout', branchName]);
    if (!checkoutResult.ok) {
      return res.status(500).json({ error: checkoutResult.stderr });
    }
  }

  res.json({ ok: true, branch: branchName, checkedOut: !!checkout });
}

async function handleGitCheckout(req, res, cwd) {
  const { branch } = req.body;
  if (!branch || typeof branch !== 'string' || !branch.trim()) {
    return res.status(400).json({ error: 'branch required' });
  }

  const result = await runGit(cwd, ['checkout', branch.trim()]);
  if (!result.ok) {
    return res.status(500).json({ error: result.stderr });
  }

  res.json({ ok: true, branch: branch.trim() });
}

async function handleGitPush(req, res, cwd) {
  const branchResult = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchResult.ok ? branchResult.stdout.trim() : '';

  const upstreamResult = await runGit(cwd, ['rev-parse', '--abbrev-ref', '@{upstream}']);
  const hasUpstream = upstreamResult.ok;

  const pushArgs = hasUpstream ? ['push'] : ['push', '-u', 'origin', branch];
  const result = await runGit(cwd, pushArgs);

  if (!result.ok) {
    const stderr = result.stderr.toLowerCase();
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
}

async function handleGitPull(req, res, cwd) {
  const result = await runGit(cwd, ['pull']);

  if (!result.ok) {
    const stderr = result.stderr.toLowerCase();
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
}

// === Stash handlers ===

async function handleGitStashList(req, res, cwd) {
  const result = await runGit(cwd, ['stash', 'list', '--format=%gd|%s|%ar']);
  if (!result.ok) {
    return res.status(500).json({ error: result.stderr });
  }

  const stashes = result.stdout.trim().split('\n')
    .filter(line => line.includes('|'))
    .map(line => {
      const [ref, message, time] = line.split('|');
      const indexMatch = ref.match(/\{(\d+)\}/);
      const index = indexMatch ? parseInt(indexMatch[1], 10) : 0;
      return { index, ref, message, time };
    });

  res.json({ stashes });
}

async function handleGitStashCreate(req, res, cwd) {
  const { message } = req.body;
  const args = message ? ['stash', 'push', '-m', message] : ['stash'];
  const result = await runGit(cwd, args);

  if (!result.ok) {
    return res.status(500).json({ error: result.stderr });
  }

  const output = result.stdout + result.stderr;
  if (output.includes('No local changes to save')) {
    return res.status(400).json({ error: 'No local changes to stash' });
  }

  res.json({ ok: true, message: output.trim() });
}

async function handleGitStashPop(req, res, cwd) {
  const { index } = req.body;
  if (typeof index !== 'number' || index < 0) {
    return res.status(400).json({ error: 'Invalid stash index' });
  }

  const result = await runGit(cwd, ['stash', 'pop', `stash@{${index}}`]);

  if (!result.ok) {
    const stderr = result.stderr.toLowerCase();
    if (stderr.includes('conflict')) {
      return res.status(409).json({ error: 'Merge conflict while applying stash' });
    }
    return res.status(500).json({ error: result.stderr });
  }

  res.json({ ok: true, output: result.stdout + result.stderr });
}

async function handleGitStashApply(req, res, cwd) {
  const { index } = req.body;
  if (typeof index !== 'number' || index < 0) {
    return res.status(400).json({ error: 'Invalid stash index' });
  }

  const result = await runGit(cwd, ['stash', 'apply', `stash@{${index}}`]);

  if (!result.ok) {
    const stderr = result.stderr.toLowerCase();
    if (stderr.includes('conflict')) {
      return res.status(409).json({ error: 'Merge conflict while applying stash' });
    }
    return res.status(500).json({ error: result.stderr });
  }

  res.json({ ok: true, output: result.stdout + result.stderr });
}

async function handleGitStashDrop(req, res, cwd) {
  const { index } = req.body;
  if (typeof index !== 'number' || index < 0) {
    return res.status(400).json({ error: 'Invalid stash index' });
  }

  const result = await runGit(cwd, ['stash', 'drop', `stash@{${index}}`]);

  if (!result.ok) {
    return res.status(500).json({ error: result.stderr });
  }

  res.json({ ok: true, output: result.stdout + result.stderr });
}

// === History handlers ===

async function handleGitRevert(req, res, cwd) {
  const { hash } = req.body;
  if (!hash || !/^[a-f0-9]{7,40}$/i.test(hash)) {
    return res.status(400).json({ error: 'Invalid commit hash' });
  }

  const result = await runGit(cwd, ['revert', hash, '--no-edit']);

  if (!result.ok) {
    const stderr = result.stderr.toLowerCase();
    if (stderr.includes('conflict')) {
      await runGit(cwd, ['revert', '--abort']);
      return res.status(409).json({ error: 'Conflict while reverting. Revert aborted.' });
    }
    return res.status(500).json({ error: result.stderr });
  }

  res.json({ ok: true });
}

async function handleGitReset(req, res, cwd) {
  const { hash, mode } = req.body;
  if (!hash || !/^[a-f0-9]{7,40}$/i.test(hash)) {
    return res.status(400).json({ error: 'Invalid commit hash' });
  }

  const validModes = ['soft', 'mixed', 'hard'];
  if (!mode || !validModes.includes(mode)) {
    return res.status(400).json({ error: 'Invalid reset mode. Must be soft, mixed, or hard.' });
  }

  const result = await runGit(cwd, ['reset', `--${mode}`, hash]);

  if (!result.ok) {
    return res.status(500).json({ error: result.stderr });
  }

  res.json({ ok: true });
}

async function handleGitUndoCommit(req, res, cwd) {
  const logResult = await runGit(cwd, ['rev-parse', 'HEAD']);
  if (!logResult.ok) {
    return res.status(400).json({ error: 'No commits to undo' });
  }

  const result = await runGit(cwd, ['reset', '--soft', 'HEAD~1']);

  if (!result.ok) {
    return res.status(500).json({ error: result.stderr });
  }

  res.json({ ok: true });
}

async function handleGitCommits(req, res, cwd) {
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
}

async function handleGitRevertHunk(req, res, cwd) {
  req.body = {
    ...(req.body || {}),
    action: req.body?.staged ? 'unstage' : 'discard',
  };
  return handleGitHunkAction(req, res, cwd);
}

async function handleGitHunkAction(req, res, cwd) {
  const { path: filePath, hunk, staged, action } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: 'path required' });
  }
  if (!hunk || !hunk.header || !Array.isArray(hunk.lines)) {
    return res.status(400).json({ error: 'hunk with header and lines required' });
  }

  if (!isPathWithinCwd(cwd, path.resolve(cwd, filePath))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const normalizedAction = normalizeHunkAction(staged, action);
  if (!normalizedAction) {
    return res.status(400).json({
      error: 'Invalid hunk action for current diff state',
      code: 'INVALID_HUNK_ACTION',
    });
  }

  const patchContent = buildHunkPatchContent(filePath, hunk);
  const applied = await applyHunkPatch(cwd, patchContent, normalizedAction);
  if (!applied.ok) {
    return res.status(applied.status || 500).json({
      error: applied.error || 'Failed to apply hunk action',
      code: applied.code || 'HUNK_APPLY_FAILED',
    });
  }

  res.json({ ok: true, action: normalizedAction });
}

async function handleGitCommitDetail(req, res, cwd) {
  const hash = req.params.hash;
  if (!/^[a-f0-9]{7,40}$/i.test(hash)) {
    return res.status(400).json({ error: 'Invalid commit hash' });
  }

  const infoResult = await runGit(cwd, ['log', '--format=%s|%an|%ar', '-n', '1', hash]);
  if (!infoResult.ok) {
    return res.status(404).json({ error: 'Commit not found' });
  }

  const [message, author, time] = infoResult.stdout.trim().split('|');

  const diffResult = await runGit(cwd, ['show', '--format=', hash]);
  if (!diffResult.ok) {
    return res.status(500).json({ error: diffResult.stderr });
  }

  res.json({ hash, message, author, time, raw: diffResult.stdout });
}

function setupGitRoutes(app) {
  const withConversationWrite = (handler) => withGitRepo(async (req, res, conv, cwd) => {
    const executionMode = resolveConversationExecutionMode(conv);
    if (executionMode !== 'autonomous') {
      return res.status(403).json({
        error: 'Conversation mode is read-only for repository writes',
        code: 'EXECUTION_MODE_READONLY',
        executionMode,
      });
    }
    if (!canWrite(cwd, conv.id)) {
      const lock = getLock(cwd);
      const blockerConversationId = lock?.writerConversationId || null;
      const blockerConversationName = blockerConversationId
        ? (conversations.get(blockerConversationId)?.name || null)
        : null;
      return res.status(409).json({
        error: blockerConversationName
          ? `Repository is locked by "${blockerConversationName}"`
          : 'Repository is locked by another conversation',
        code: 'WRITE_LOCKED',
        lock,
        blockerConversationId,
        blockerConversationName,
      });
    }
    return handler(req, res, conv, cwd);
  });

  // === Conversation-based routes (existing) ===

  // Get git status (special case: uses withConversation for non-repo check)
  app.get('/api/conversations/:id/git/status', withConversation(async (req, res, conv) => {
    const cwd = conv.cwd || process.env.HOME;
    return handleGitStatus(req, res, cwd);
  }));

  // Get branches
  app.get('/api/conversations/:id/git/branches', withGitRepo(async (req, res, conv, cwd) => {
    return handleGitBranches(req, res, cwd);
  }));

  // Get diff for a file
  app.post('/api/conversations/:id/git/diff', withGitRepo(async (req, res, conv, cwd) => {
    return handleGitDiff(req, res, cwd);
  }));

  // Stage files
  app.post('/api/conversations/:id/git/stage', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitStage(req, res, cwd);
  }));

  // Unstage files
  app.post('/api/conversations/:id/git/unstage', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitUnstage(req, res, cwd);
  }));

  // Discard changes
  app.post('/api/conversations/:id/git/discard', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitDiscard(req, res, cwd);
  }));

  // Commit changes
  app.post('/api/conversations/:id/git/commit', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitCommit(req, res, cwd);
  }));

  // Create branch
  app.post('/api/conversations/:id/git/branch', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitBranch(req, res, cwd);
  }));

  // Checkout branch
  app.post('/api/conversations/:id/git/checkout', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitCheckout(req, res, cwd);
  }));

  // Push to remote
  app.post('/api/conversations/:id/git/push', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitPush(req, res, cwd);
  }));

  // Pull from remote
  app.post('/api/conversations/:id/git/pull', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitPull(req, res, cwd);
  }));

  // Stash routes
  app.get('/api/conversations/:id/git/stash', withGitRepo(async (req, res, conv, cwd) => {
    return handleGitStashList(req, res, cwd);
  }));

  app.post('/api/conversations/:id/git/stash', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitStashCreate(req, res, cwd);
  }));

  app.post('/api/conversations/:id/git/stash/pop', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitStashPop(req, res, cwd);
  }));

  app.post('/api/conversations/:id/git/stash/apply', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitStashApply(req, res, cwd);
  }));

  app.post('/api/conversations/:id/git/stash/drop', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitStashDrop(req, res, cwd);
  }));

  // History routes
  app.post('/api/conversations/:id/git/revert', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitRevert(req, res, cwd);
  }));

  app.post('/api/conversations/:id/git/reset', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitReset(req, res, cwd);
  }));

  app.post('/api/conversations/:id/git/undo-commit', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitUndoCommit(req, res, cwd);
  }));

  app.get('/api/conversations/:id/git/commits', withGitRepo(async (req, res, conv, cwd) => {
    return handleGitCommits(req, res, cwd);
  }));

  app.post('/api/conversations/:id/git/revert-hunk', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitRevertHunk(req, res, cwd);
  }));
  app.post('/api/conversations/:id/git/hunk-action', withConversationWrite(async (req, res, conv, cwd) => {
    return handleGitHunkAction(req, res, cwd);
  }));

  app.get('/api/conversations/:id/git/commits/:hash', withGitRepo(async (req, res, conv, cwd) => {
    return handleGitCommitDetail(req, res, cwd);
  }));

  // === Standalone routes (cwd from query param) ===

  app.get('/api/git/status', withCwd(async (req, res, cwd) => {
    return handleGitStatus(req, res, cwd);
  }));

  app.get('/api/git/branches', withCwd(async (req, res, cwd) => {
    return handleGitBranches(req, res, cwd);
  }));

  app.post('/api/git/diff', withCwd(async (req, res, cwd) => {
    return handleGitDiff(req, res, cwd);
  }));

  app.post('/api/git/stage', withCwd(async (req, res, cwd) => {
    return handleGitStage(req, res, cwd);
  }));

  app.post('/api/git/unstage', withCwd(async (req, res, cwd) => {
    return handleGitUnstage(req, res, cwd);
  }));

  app.post('/api/git/discard', withCwd(async (req, res, cwd) => {
    return handleGitDiscard(req, res, cwd);
  }));

  app.post('/api/git/commit', withCwd(async (req, res, cwd) => {
    return handleGitCommit(req, res, cwd);
  }));

  app.post('/api/git/branch', withCwd(async (req, res, cwd) => {
    return handleGitBranch(req, res, cwd);
  }));

  app.post('/api/git/checkout', withCwd(async (req, res, cwd) => {
    return handleGitCheckout(req, res, cwd);
  }));

  app.post('/api/git/push', withCwd(async (req, res, cwd) => {
    return handleGitPush(req, res, cwd);
  }));

  app.post('/api/git/pull', withCwd(async (req, res, cwd) => {
    return handleGitPull(req, res, cwd);
  }));

  app.get('/api/git/stash', withCwd(async (req, res, cwd) => {
    return handleGitStashList(req, res, cwd);
  }));

  app.post('/api/git/stash', withCwd(async (req, res, cwd) => {
    return handleGitStashCreate(req, res, cwd);
  }));

  app.post('/api/git/stash/pop', withCwd(async (req, res, cwd) => {
    return handleGitStashPop(req, res, cwd);
  }));

  app.post('/api/git/stash/apply', withCwd(async (req, res, cwd) => {
    return handleGitStashApply(req, res, cwd);
  }));

  app.post('/api/git/stash/drop', withCwd(async (req, res, cwd) => {
    return handleGitStashDrop(req, res, cwd);
  }));

  app.post('/api/git/revert', withCwd(async (req, res, cwd) => {
    return handleGitRevert(req, res, cwd);
  }));

  app.post('/api/git/reset', withCwd(async (req, res, cwd) => {
    return handleGitReset(req, res, cwd);
  }));

  app.post('/api/git/undo-commit', withCwd(async (req, res, cwd) => {
    return handleGitUndoCommit(req, res, cwd);
  }));

  app.get('/api/git/commits', withCwd(async (req, res, cwd) => {
    return handleGitCommits(req, res, cwd);
  }));

  app.post('/api/git/revert-hunk', withCwd(async (req, res, cwd) => {
    return handleGitRevertHunk(req, res, cwd);
  }));
  app.post('/api/git/hunk-action', withCwd(async (req, res, cwd) => {
    return handleGitHunkAction(req, res, cwd);
  }));

  app.get('/api/git/commits/:hash', withCwd(async (req, res, cwd) => {
    return handleGitCommitDetail(req, res, cwd);
  }));
}

module.exports = {
  setupGitRoutes,
  parseDiffHunks,
  normalizeHunkAction,
  buildHunkPatchContent,
};
