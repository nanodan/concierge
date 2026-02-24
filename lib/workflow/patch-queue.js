const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');

const { DATA_DIR, atomicWrite } = require('../data');
const { normalizeCwd } = require('./locks');

const execFileAsync = promisify(execFile);
const PATCH_QUEUE_FILE = process.env.PATCH_QUEUE_FILE || path.join(DATA_DIR, 'patch-queue.json');
const VALID_STATUSES = new Set(['queued', 'applied', 'conflict', 'rejected']);

function normalizeStatus(status) {
  return VALID_STATUSES.has(status) ? status : 'queued';
}

function normalizePatchItem(item) {
  if (!item || typeof item !== 'object') return null;
  if (!item.id || !item.cwd || !item.diff) return null;
  return {
    id: item.id,
    cwd: normalizeCwd(item.cwd),
    conversationId: item.conversationId || null,
    title: item.title || 'Untitled patch',
    diff: item.diff,
    baseCommit: item.baseCommit || null,
    status: normalizeStatus(item.status),
    createdAt: Number(item.createdAt) || Date.now(),
    updatedAt: Number(item.updatedAt) || Date.now(),
    applyMeta: item.applyMeta && typeof item.applyMeta === 'object' ? item.applyMeta : null,
  };
}

async function loadPatchQueue() {
  try {
    const raw = await fsp.readFile(PATCH_QUEUE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePatchItem).filter(Boolean);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[PATCH_QUEUE] Failed to read queue:', err.message);
    }
    return [];
  }
}

async function savePatchQueue(items) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await atomicWrite(PATCH_QUEUE_FILE, JSON.stringify(items, null, 2));
}

async function getHeadCommit(cwd) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
    return { ok: true, head: stdout.trim() };
  } catch (err) {
    return { ok: false, error: err.stderr || err.message };
  }
}

async function applyDiff(cwd, diff) {
  return new Promise((resolve) => {
    const proc = spawn('git', ['apply', '--3way', '--index', '-'], { cwd });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.stdin.write(diff);
    proc.stdin.end();
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: stderr.trim() || 'Failed to apply patch' });
      }
    });
    proc.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });
  });
}

function sortByNewest(items) {
  return [...items].sort((a, b) => b.createdAt - a.createdAt);
}

async function listPatches(cwd) {
  const items = await loadPatchQueue();
  if (!cwd) return sortByNewest(items);
  const key = normalizeCwd(cwd);
  return sortByNewest(items.filter((item) => item.cwd === key));
}

async function getPatchById(id) {
  const items = await loadPatchQueue();
  return items.find((item) => item.id === id) || null;
}

async function submitPatch({ cwd, conversationId, title, diff, baseCommit }) {
  if (!cwd) {
    return { ok: false, code: 'PATCH_CWD_REQUIRED', error: 'cwd required' };
  }
  if (!diff || typeof diff !== 'string' || !diff.trim()) {
    return { ok: false, code: 'PATCH_DIFF_REQUIRED', error: 'diff required' };
  }

  const items = await loadPatchQueue();
  const now = Date.now();
  const item = {
    id: uuidv4(),
    cwd: normalizeCwd(cwd),
    conversationId: conversationId || null,
    title: (title || 'Untitled patch').trim() || 'Untitled patch',
    diff,
    baseCommit: baseCommit || null,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    applyMeta: null,
  };

  items.push(item);
  await savePatchQueue(items);
  return { ok: true, item };
}

async function rejectPatch(id, { rejectedBy, reason } = {}) {
  const items = await loadPatchQueue();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return { ok: false, code: 'PATCH_NOT_FOUND', error: 'Patch not found' };

  const item = items[index];
  item.status = 'rejected';
  item.updatedAt = Date.now();
  item.applyMeta = {
    action: 'rejected',
    rejectedBy: rejectedBy || null,
    reason: reason || null,
    timestamp: Date.now(),
  };
  await savePatchQueue(items);
  return { ok: true, item };
}

async function applyPatch(id, { appliedBy } = {}) {
  const items = await loadPatchQueue();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return { ok: false, code: 'PATCH_NOT_FOUND', error: 'Patch not found' };

  const item = items[index];
  if (!['queued', 'conflict'].includes(item.status)) {
    return { ok: false, code: 'PATCH_NOT_APPLICABLE', error: `Patch is ${item.status}` };
  }

  if (item.baseCommit) {
    const head = await getHeadCommit(item.cwd);
    if (!head.ok) {
      return { ok: false, code: 'PATCH_HEAD_FAILED', error: head.error || 'Failed to resolve HEAD' };
    }
    if (head.head !== item.baseCommit) {
      item.status = 'conflict';
      item.updatedAt = Date.now();
      item.applyMeta = {
        action: 'apply',
        appliedBy: appliedBy || null,
        reason: 'base_mismatch',
        expectedHead: item.baseCommit,
        currentHead: head.head,
        timestamp: Date.now(),
      };
      await savePatchQueue(items);
      return { ok: false, code: 'PATCH_BASE_MISMATCH', error: 'Patch base commit does not match current HEAD', item };
    }
  }

  const result = await applyDiff(item.cwd, item.diff);
  if (!result.ok) {
    item.status = 'conflict';
    item.updatedAt = Date.now();
    item.applyMeta = {
      action: 'apply',
      appliedBy: appliedBy || null,
      reason: 'git_apply_failed',
      error: result.error,
      timestamp: Date.now(),
    };
    await savePatchQueue(items);
    return { ok: false, code: 'PATCH_APPLY_FAILED', error: result.error || 'Failed to apply patch', item };
  }

  item.status = 'applied';
  item.updatedAt = Date.now();
  item.applyMeta = {
    action: 'apply',
    appliedBy: appliedBy || null,
    timestamp: Date.now(),
  };
  await savePatchQueue(items);
  return { ok: true, item };
}

module.exports = {
  PATCH_QUEUE_FILE,
  loadPatchQueue,
  listPatches,
  getPatchById,
  submitPatch,
  applyPatch,
  rejectPatch,
};
