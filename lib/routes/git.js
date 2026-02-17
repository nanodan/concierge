/**
 * Git integration routes
 */
const path = require('path');

const {
  withConversation,
  isPathWithinCwd,
  validatePathsWithinCwd,
  runGit,
  isGitRepo,
  withGitRepo,
} = require('./helpers');

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
  const diffLines = diffOutput.split('\n');

  for (const line of diffLines) {
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

  return hunks;
}

function setupGitRoutes(app) {
  // Get git status
  app.get('/api/conversations/:id/git/status', withConversation(async (req, res, conv) => {
    const cwd = conv.cwd || process.env.HOME;

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
  }));

  // Get branches
  app.get('/api/conversations/:id/git/branches', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Get diff for a file
  app.post('/api/conversations/:id/git/diff', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Stage files
  app.post('/api/conversations/:id/git/stage', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Unstage files
  app.post('/api/conversations/:id/git/unstage', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Discard changes
  app.post('/api/conversations/:id/git/discard', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Commit changes
  app.post('/api/conversations/:id/git/commit', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Create branch
  app.post('/api/conversations/:id/git/branch', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Checkout branch
  app.post('/api/conversations/:id/git/checkout', withGitRepo(async (req, res, conv, cwd) => {
    const { branch } = req.body;
    if (!branch || typeof branch !== 'string' || !branch.trim()) {
      return res.status(400).json({ error: 'branch required' });
    }

    const result = await runGit(cwd, ['checkout', branch.trim()]);
    if (!result.ok) {
      return res.status(500).json({ error: result.stderr });
    }

    res.json({ ok: true, branch: branch.trim() });
  }));

  // Push to remote
  app.post('/api/conversations/:id/git/push', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Pull from remote
  app.post('/api/conversations/:id/git/pull', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // === Stash routes ===

  // List stashes
  app.get('/api/conversations/:id/git/stash', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Create stash
  app.post('/api/conversations/:id/git/stash', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Pop stash
  app.post('/api/conversations/:id/git/stash/pop', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Apply stash
  app.post('/api/conversations/:id/git/stash/apply', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Drop stash
  app.post('/api/conversations/:id/git/stash/drop', withGitRepo(async (req, res, conv, cwd) => {
    const { index } = req.body;
    if (typeof index !== 'number' || index < 0) {
      return res.status(400).json({ error: 'Invalid stash index' });
    }

    const result = await runGit(cwd, ['stash', 'drop', `stash@{${index}}`]);

    if (!result.ok) {
      return res.status(500).json({ error: result.stderr });
    }

    res.json({ ok: true, output: result.stdout + result.stderr });
  }));

  // === History routes ===

  // Revert a commit
  app.post('/api/conversations/:id/git/revert', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Reset to a commit
  app.post('/api/conversations/:id/git/reset', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Undo last commit
  app.post('/api/conversations/:id/git/undo-commit', withGitRepo(async (req, res, conv, cwd) => {
    const logResult = await runGit(cwd, ['rev-parse', 'HEAD']);
    if (!logResult.ok) {
      return res.status(400).json({ error: 'No commits to undo' });
    }

    const result = await runGit(cwd, ['reset', '--soft', 'HEAD~1']);

    if (!result.ok) {
      return res.status(500).json({ error: result.stderr });
    }

    res.json({ ok: true });
  }));

  // Get recent commits
  app.get('/api/conversations/:id/git/commits', withGitRepo(async (req, res, conv, cwd) => {
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
  }));

  // Revert a single hunk
  app.post('/api/conversations/:id/git/revert-hunk', withGitRepo(async (req, res, conv, cwd) => {
    const { path: filePath, hunk, staged } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'path required' });
    }
    if (!hunk || !hunk.header || !Array.isArray(hunk.lines)) {
      return res.status(400).json({ error: 'hunk with header and lines required' });
    }

    if (!isPathWithinCwd(cwd, path.resolve(cwd, filePath))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Build a minimal patch file from the hunk
    // The patch needs the file header lines and the hunk
    const patchLines = [
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      hunk.header,
      ...hunk.lines
    ];
    const patchContent = patchLines.join('\n') + '\n';

    // Apply the patch in reverse to undo the changes
    // For staged changes, we need to apply to the index
    const applyArgs = staged
      ? ['apply', '--reverse', '--cached', '-']
      : ['apply', '--reverse', '-'];

    const { spawn } = require('child_process');
    const gitProcess = spawn('git', applyArgs, { cwd });

    let stderr = '';
    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.stdin.write(patchContent);
    gitProcess.stdin.end();

    const exitCode = await new Promise((resolve) => {
      gitProcess.on('close', resolve);
    });

    if (exitCode !== 0) {
      return res.status(500).json({ error: stderr || 'Failed to apply reverse patch' });
    }

    res.json({ ok: true });
  }));

  // Get single commit diff
  app.get('/api/conversations/:id/git/commits/:hash', withGitRepo(async (req, res, conv, cwd) => {
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
  }));
}

module.exports = { setupGitRoutes };
