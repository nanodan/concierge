const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'explorer', 'shell.js')).href;

function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(name) {
      set.add(name);
    },
    remove(name) {
      set.delete(name);
    },
    contains(name) {
      return set.has(name);
    },
    toggle(name, force) {
      if (force === undefined) {
        if (set.has(name)) {
          set.delete(name);
          return false;
        }
        set.add(name);
        return true;
      }
      if (force) set.add(name);
      else set.delete(name);
      return set.has(name);
    },
  };
}

function makeViewerContent() {
  return {
    innerHTML: '',
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function makeViewer() {
  const prevBtn = { disabled: false };
  const nextBtn = { disabled: false };
  const counter = { textContent: '' };
  const nav = {
    classList: makeClassList(['hidden']),
    querySelector(selector) {
      if (selector === '.file-nav-prev') return prevBtn;
      if (selector === '.file-nav-next') return nextBtn;
      if (selector === '.file-nav-counter') return counter;
      return null;
    },
  };

  return {
    classList: makeClassList(['hidden']),
    querySelector(selector) {
      if (selector === '.file-viewer-nav') return nav;
      return null;
    },
  };
}

describe('explorer shell refresh behavior', async () => {
  const { createExplorerShell } = await import(moduleUrl);
  const previousWindow = globalThis.window;
  globalThis.window = {};

  after(() => {
    if (previousWindow === undefined) {
      delete globalThis.window;
      return;
    }
    globalThis.window = previousWindow;
  });

  it('refreshes the currently open file', async () => {
    const requested = [];
    const shell = createExplorerShell({
      context: {
        isAvailable: () => true,
        getFileContentUrl: (filePath) => `/content?path=${encodeURIComponent(filePath)}`,
        getFileDownloadUrl: (filePath) => `/download?path=${encodeURIComponent(filePath)}`,
      },
      apiFetch: async (url) => {
        requested.push(url);
        return {
          json: async () => ({
            name: 'notes.md',
            content: '# title',
            size: 7,
            language: 'markdown',
          }),
        };
      },
      treeContainer: {},
      viewer: makeViewer(),
      viewerName: { textContent: '' },
      viewerContent: makeViewerContent(),
      escapeHtml: (value) => String(value),
      renderMarkdown: (value) => String(value),
      formatFileSize: () => '7B',
      getFileIcon: () => '',
      imageExts: new Set(),
      animationDelayMs: 0,
      closeDelayMs: 0,
    });

    const opened = await shell.viewFile('maps/notes.md');
    assert.equal(opened, true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const refreshed = await shell.refreshOpenFile();
    assert.equal(refreshed, true);
    assert.equal(requested.length, 2);
    assert.match(requested[0], /maps%2Fnotes\.md/);
    assert.match(requested[1], /maps%2Fnotes\.md/);
  });

  it('does not refresh when no file viewer is open', async () => {
    const shell = createExplorerShell({
      context: {
        isAvailable: () => true,
        getFileContentUrl: () => '/content',
        getFileDownloadUrl: () => '/download',
      },
      apiFetch: async () => ({
        json: async () => ({
          name: 'notes.md',
          content: '# title',
          size: 7,
          language: 'markdown',
        }),
      }),
      treeContainer: {},
      viewer: makeViewer(),
      viewerName: { textContent: '' },
      viewerContent: makeViewerContent(),
      escapeHtml: (value) => String(value),
      renderMarkdown: (value) => String(value),
      formatFileSize: () => '7B',
      getFileIcon: () => '',
      imageExts: new Set(),
    });

    const refreshed = await shell.refreshOpenFile();
    assert.equal(refreshed, false);
  });
});
