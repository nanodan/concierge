const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeScopePath,
  getScopePathspecArgs,
  parseLocalOnlyStatusEntries,
} = require('../lib/routes/conversations')._private;

describe('conversation worktree helpers', () => {
  it('normalizes scope paths relative to repo root', () => {
    assert.equal(normalizeScopePath('/repo', '/repo'), '');
    assert.equal(normalizeScopePath('/repo/src', '/repo'), 'src');
    assert.equal(normalizeScopePath('/repo/src/nested', '/repo'), 'src/nested');
  });

  it('returns empty scope when source path is outside repo root', () => {
    assert.equal(normalizeScopePath('/other/place', '/repo'), '');
  });

  it('builds git pathspec args for scoped and unscoped paths', () => {
    assert.deepEqual(getScopePathspecArgs(''), []);
    assert.deepEqual(getScopePathspecArgs('src'), ['--', 'src']);
  });

  it('parses local-only paths from porcelain output', () => {
    const output = [
      ' M tracked.js',
      '?? notes.txt',
      '!! data/raw.csv',
      'R  old.js',
      'new.js',
      '?? notes.txt',
      '?? .git/should-not-copy',
    ].join('\0');

    const paths = parseLocalOnlyStatusEntries(output);
    assert.deepEqual(paths, ['notes.txt', 'data/raw.csv']);
  });
});
