const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseDiffHunks,
  normalizeHunkAction,
  buildHunkPatchContent,
} = require('../lib/routes/git');

describe('git hunk helpers', () => {
  it('normalizes accept/reject intent by staged state', () => {
    assert.equal(normalizeHunkAction(false, 'accept'), 'stage');
    assert.equal(normalizeHunkAction(false, 'reject'), 'discard');
    assert.equal(normalizeHunkAction(true, 'reject'), 'unstage');
    assert.equal(normalizeHunkAction(true, ''), 'unstage');
    assert.equal(normalizeHunkAction(false, ''), 'discard');
  });

  it('rejects invalid action/state combinations', () => {
    assert.equal(normalizeHunkAction(true, 'stage'), null);
    assert.equal(normalizeHunkAction(false, 'unstage'), null);
    assert.equal(normalizeHunkAction(false, 'nope'), null);
  });

  it('parses file headers and hunk lines including no-newline marker', () => {
    const raw = [
      'diff --git a/a.txt b/a.txt',
      'index 1111111..2222222 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-hello',
      '+hello world',
      '\\ No newline at end of file',
      '',
    ].join('\n');

    const hunks = parseDiffHunks(raw);
    assert.equal(hunks.length, 1);
    assert.equal(hunks[0].header, '@@ -1 +1 @@');
    assert.ok(Array.isArray(hunks[0].fileHeaders));
    assert.ok(hunks[0].fileHeaders.some((line) => line.startsWith('diff --git')));
    assert.ok(hunks[0].lines.includes('\\ No newline at end of file'));
  });

  it('builds patch content with existing headers', () => {
    const hunk = {
      header: '@@ -1 +1 @@',
      lines: ['-a', '+b'],
      fileHeaders: [
        'diff --git a/a.txt b/a.txt',
        'index 1111111..2222222 100644',
        '--- a/a.txt',
        '+++ b/a.txt',
      ],
    };
    const patch = buildHunkPatchContent('a.txt', hunk);
    assert.ok(patch.includes('diff --git a/a.txt b/a.txt'));
    assert.ok(patch.includes('@@ -1 +1 @@'));
  });
});
