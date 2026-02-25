const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const previewRoutes = require('../lib/routes/preview');

describe('preview route helpers', () => {
  const { detectProjectType, buildPreviewUrl } = previewRoutes._private;

  it('prefers static preview when html files exist and only npm start is present', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-route-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'dashboard.html'), '<!doctype html><h1>hi</h1>');
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test-app',
        scripts: {
          start: 'node server.js'
        }
      }));

      const result = await detectProjectType(tmpDir);
      assert.equal(result?.type, 'static');
      assert.equal(result?.entryFile, 'dashboard.html');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('prefers npm dev when frontend dev script exists', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-route-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'index.html'), '<!doctype html><h1>hi</h1>');
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test-app',
        scripts: {
          dev: 'vite',
          start: 'node server.js'
        }
      }));

      const result = await detectProjectType(tmpDir);
      assert.equal(result?.type, 'npm');
      assert.deepEqual(result?.args, ['run', 'dev']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('encodes html file paths when building preview urls', () => {
    const url = buildPreviewUrl(3602, 'my dashboard.html');
    assert.equal(url, 'http://localhost:3602/my%20dashboard.html');
  });
});
