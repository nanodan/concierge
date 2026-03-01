const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const stateUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'state.js')).href;
const renderUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'render.js')).href;

describe('render compressed message UI', async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;

  globalThis.localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  };
  globalThis.document = {
    title: 'test',
    getElementById() { return null; },
    createElement() { return {}; },
  };
  globalThis.window = {
    dispatchEvent() {},
    speechSynthesis: null,
  };
  globalThis.navigator = {};

  after(() => {
    globalThis.localStorage = originalLocalStorage;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.navigator = originalNavigator;
  });

  const state = await import(stateUrl);
  const { renderMessageSlice } = await import(renderUrl);

  it('renders compressed section hint and compressed context badge', () => {
    const messages = [
      { role: 'assistant', text: 'older compressed response', summarized: true, timestamp: 1 },
      { role: 'user', text: 'new message', timestamp: 2 },
    ];
    state.setAllMessages(messages);

    const html = renderMessageSlice(messages, 0);

    assert.ok(html.includes('compressed-section-hint'));
    assert.ok(html.includes('Excluded from active context'));
    assert.ok(html.includes('compressed-context-badge'));
    assert.ok(html.includes('Compressed • excluded from active context'));
  });

  it('renders detailed token breakdown when typed/raw/cached values exist', () => {
    const messages = [
      {
        role: 'assistant',
        text: 'token-rich response',
        timestamp: 3,
        inputTokens: 1000,
        netInputTokens: 1000,
        typedInputTokens: 5,
        rawInputTokens: 12000,
        cachedInputTokens: 11000,
        outputTokens: 6900,
      },
    ];
    state.setAllMessages(messages);

    const html = renderMessageSlice(messages, 0);

    assert.ok(html.includes('5 typed'));
    assert.ok(html.includes('1.0k net in'));
    assert.ok(html.includes('12.0k raw'));
    assert.ok(html.includes('11.0k cached'));
    assert.ok(html.includes('6.9k out'));
  });
});
