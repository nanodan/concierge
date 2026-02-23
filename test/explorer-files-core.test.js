const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'explorer', 'files-core.js')).href;

describe('explorer files core', async () => {
  const {
    sortEntries,
    getViewableFiles,
    getInlineDownloadUrl,
    fetchDirectoryData,
    deleteFilePath,
    uploadFilesToContext,
  } = await import(moduleUrl);

  it('sortEntries puts directories first then name', () => {
    const entries = [
      { type: 'file', name: 'z.txt' },
      { type: 'directory', name: 'src' },
      { type: 'file', name: 'a.txt' },
      { type: 'directory', name: 'docs' },
    ];
    const sorted = sortEntries(entries);
    assert.deepEqual(
      sorted.map((entry) => `${entry.type}:${entry.name}`),
      ['directory:docs', 'directory:src', 'file:a.txt', 'file:z.txt']
    );
  });

  it('getViewableFiles excludes directories', () => {
    const entries = [
      { type: 'directory', path: 'src' },
      { type: 'file', path: 'README.md' },
      { type: 'file', path: 'src/index.js' },
    ];
    assert.deepEqual(getViewableFiles(entries), ['README.md', 'src/index.js']);
  });

  it('getInlineDownloadUrl requests inline mode', () => {
    const context = {
      getFileDownloadUrl(filePath, options) {
        return `${filePath}:${options.inline ? 'inline' : 'download'}`;
      }
    };
    assert.equal(getInlineDownloadUrl(context, 'a.txt'), 'a.txt:inline');
  });

  it('fetchDirectoryData returns parsed response data', async () => {
    const context = { getFilesUrl: () => '/api/files?path=/tmp' };
    const apiFetch = async () => ({
      async json() {
        return { entries: [{ type: 'file', name: 'a.txt' }] };
      }
    });

    const result = await fetchDirectoryData(context, '/tmp', apiFetch);
    assert.equal(result.ok, true);
    assert.equal(result.data.entries.length, 1);
  });

  it('fetchDirectoryData handles unavailable context and api errors', async () => {
    const unavailable = await fetchDirectoryData({ getFilesUrl: () => null }, '', async () => null);
    assert.equal(unavailable.ok, false);
    assert.equal(unavailable.error, 'Context unavailable');

    const failedRequest = await fetchDirectoryData({ getFilesUrl: () => '/api/files' }, '', async () => null);
    assert.equal(failedRequest.ok, false);
    assert.equal(failedRequest.error, 'Request failed');
  });

  it('deleteFilePath returns success and error shapes', async () => {
    const okFetch = async () => ({
      async json() { return { ok: true }; }
    });
    const okResult = await deleteFilePath('/tmp/a.txt', okFetch);
    assert.equal(okResult.ok, true);

    const errFetch = async () => ({
      async json() { return { error: 'nope' }; }
    });
    const errResult = await deleteFilePath('/tmp/a.txt', errFetch);
    assert.equal(errResult.ok, false);
    assert.equal(errResult.error, 'nope');
  });

  it('uploadFilesToContext tracks uploaded and failed files', async () => {
    const context = {
      getUploadUrl(filename) {
        return filename === 'skip.txt' ? null : `/upload/${filename}`;
      }
    };
    const files = [{ name: 'ok.txt' }, { name: 'fail.txt' }, { name: 'skip.txt' }];
    const apiFetch = async (url) => (url.includes('fail.txt') ? null : { ok: true });

    const result = await uploadFilesToContext(files, context, apiFetch);
    assert.deepEqual(result.uploaded, ['ok.txt']);
    assert.deepEqual(result.failed, ['fail.txt', 'skip.txt']);
  });
});
