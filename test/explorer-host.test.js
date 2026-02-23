const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'explorer', 'host.js')).href;

function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
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
    contains(name) {
      return set.has(name);
    },
  };
}

function makeButton(tab) {
  return {
    dataset: { tab },
    classList: makeClassList(),
    addEventListener(_evt, fn) {
      this._handler = fn;
    },
    click() {
      this._handler?.();
    },
  };
}

describe('explorer host controller', async () => {
  const { createExplorerHost } = await import(moduleUrl);

  it('switches tabs, updates classes, and runs loaders', async () => {
    const filesBtn = makeButton('files');
    const changesBtn = makeButton('changes');
    const filesView = { classList: makeClassList() };
    const changesView = { classList: makeClassList(['hidden']) };
    const loaded = [];

    const host = createExplorerHost({
      tabButtons: [filesBtn, changesBtn],
      views: { files: filesView, changes: changesView },
      initialTab: 'files',
      onTabSelected: {
        changes: async () => {
          loaded.push('changes');
        },
      },
    });

    host.bindTabListeners();
    changesBtn.click();

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(host.getCurrentTab(), 'changes');
    assert.equal(filesBtn.classList.contains('active'), false);
    assert.equal(changesBtn.classList.contains('active'), true);
    assert.equal(filesView.classList.contains('hidden'), true);
    assert.equal(changesView.classList.contains('hidden'), false);
    assert.deepEqual(loaded, ['changes']);
  });

  it('resets to initial tab with forced update', async () => {
    const filesBtn = makeButton('files');
    const historyBtn = makeButton('history');
    const filesView = { classList: makeClassList(['hidden']) };
    const historyView = { classList: makeClassList() };

    const host = createExplorerHost({
      tabButtons: [filesBtn, historyBtn],
      views: { files: filesView, history: historyView },
      initialTab: 'files',
    });

    host.setCurrentTab('history');
    await host.resetToInitial();

    assert.equal(host.getCurrentTab(), 'files');
    assert.equal(filesBtn.classList.contains('active'), true);
    assert.equal(historyBtn.classList.contains('active'), false);
    assert.equal(filesView.classList.contains('hidden'), false);
    assert.equal(historyView.classList.contains('hidden'), true);
  });
});
