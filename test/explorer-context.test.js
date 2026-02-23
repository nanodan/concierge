const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'explorer', 'context.js')).href;

describe('explorer context adapters', async () => {
  const {
    buildDeleteFileUrl,
    createConversationContext,
    createCwdContext,
  } = await import(moduleUrl);

  it('builds conversation-scoped file URLs', () => {
    const context = createConversationContext(() => 'conv-123');

    assert.equal(context.getFilesUrl('src'), '/api/conversations/conv-123/files?path=src');
    assert.equal(context.getFilesUrl(''), '/api/conversations/conv-123/files');
    assert.equal(
      context.getFileContentUrl('README.md'),
      '/api/conversations/conv-123/files/content?path=README.md'
    );
    assert.equal(
      context.getFileDownloadUrl('src/a b.txt', { inline: true }),
      '/api/conversations/conv-123/files/download?path=src%2Fa+b.txt&inline=true'
    );
    assert.equal(
      context.getUploadUrl('a b.txt'),
      '/api/conversations/conv-123/upload?filename=a+b.txt'
    );
    assert.equal(
      context.getFileSearchUrl('hello world'),
      '/api/conversations/conv-123/files/search?q=hello+world'
    );
  });

  it('handles unavailable conversation context', () => {
    const context = createConversationContext(() => null);

    assert.equal(context.isAvailable(), false);
    assert.equal(context.getFilesUrl('src'), null);
    assert.equal(context.getGitUrl('status'), null);
  });

  it('builds cwd-scoped file and git URLs', () => {
    const context = createCwdContext(() => '/Users/test/project');

    assert.equal(context.getFilesUrl('/Users/test/project/src'), '/api/files?path=%2FUsers%2Ftest%2Fproject%2Fsrc');
    assert.equal(
      context.getFileContentUrl('/Users/test/project/README.md'),
      '/api/files/content?path=%2FUsers%2Ftest%2Fproject%2FREADME.md'
    );
    assert.equal(
      context.getUploadUrl('hello.txt', '/Users/test/project'),
      '/api/files/upload?path=%2FUsers%2Ftest%2Fproject&filename=hello.txt'
    );
    assert.equal(
      context.getGitUrl('status'),
      '/api/git/status?cwd=%2FUsers%2Ftest%2Fproject'
    );
  });

  it('builds delete URL helper', () => {
    assert.equal(
      buildDeleteFileUrl('/Users/test/project/file.txt'),
      '/api/files?path=%2FUsers%2Ftest%2Fproject%2Ffile.txt'
    );
  });
});
