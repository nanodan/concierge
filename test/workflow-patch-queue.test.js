const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const modulePath = require.resolve('../lib/workflow/patch-queue');

let tmpDir = null;
let queue = null;

function loadQueueModule() {
  delete require.cache[modulePath];
  queue = require('../lib/workflow/patch-queue');
}

describe('workflow patch queue', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-queue-test-'));
    process.env.PATCH_QUEUE_FILE = path.join(tmpDir, 'queue.json');
    loadQueueModule();
  });

  afterEach(() => {
    delete process.env.PATCH_QUEUE_FILE;
    delete require.cache[modulePath];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('submits and lists patches by cwd', async () => {
    const first = await queue.submitPatch({
      cwd: '/tmp/project-a',
      conversationId: 'conv-1',
      title: 'Patch A',
      diff: 'diff --git a/a.txt b/a.txt\n',
      baseCommit: null,
    });
    assert.equal(first.ok, true);

    const second = await queue.submitPatch({
      cwd: '/tmp/project-b',
      conversationId: 'conv-2',
      title: 'Patch B',
      diff: 'diff --git a/b.txt b/b.txt\n',
      baseCommit: null,
    });
    assert.equal(second.ok, true);

    const all = await queue.listPatches();
    assert.equal(all.length, 2);

    const onlyA = await queue.listPatches('/tmp/project-a');
    assert.equal(onlyA.length, 1);
    assert.equal(onlyA[0].title, 'Patch A');
  });

  it('rejects invalid submissions', async () => {
    const missingCwd = await queue.submitPatch({ diff: 'x' });
    assert.equal(missingCwd.ok, false);
    assert.equal(missingCwd.code, 'PATCH_CWD_REQUIRED');

    const missingDiff = await queue.submitPatch({ cwd: '/tmp/project-a' });
    assert.equal(missingDiff.ok, false);
    assert.equal(missingDiff.code, 'PATCH_DIFF_REQUIRED');
  });

  it('rejects a patch and stores metadata', async () => {
    const created = await queue.submitPatch({
      cwd: '/tmp/project-a',
      conversationId: 'conv-1',
      title: 'Patch A',
      diff: 'diff --git a/a.txt b/a.txt\n',
    });
    assert.equal(created.ok, true);

    const rejected = await queue.rejectPatch(created.item.id, {
      rejectedBy: 'conv-9',
      reason: 'superseded',
    });
    assert.equal(rejected.ok, true);
    assert.equal(rejected.item.status, 'rejected');
    assert.equal(rejected.item.applyMeta.rejectedBy, 'conv-9');
    assert.equal(rejected.item.applyMeta.reason, 'superseded');
  });
});
