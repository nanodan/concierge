const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'ui', 'context-bar.js')).href;

describe('context bar token calculation', async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  globalThis.localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  };
  globalThis.document = {
    title: 'test',
    getElementById() { return null; },
  };
  globalThis.window = {
    dispatchEvent() {},
  };

  after(() => {
    globalThis.localStorage = originalLocalStorage;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  });

  const { calculateCumulativeTokens } = await import(moduleUrl);

  it('uses the latest assistant token counts when no compression exists', () => {
    const messages = [
      { role: 'assistant', inputTokens: 120, outputTokens: 40, timestamp: 100 },
      { role: 'assistant', inputTokens: 360, outputTokens: 90, timestamp: 200 },
    ];

    assert.deepEqual(
      calculateCumulativeTokens(messages),
      { inputTokens: 360, outputTokens: 90 }
    );
  });

  it('falls back to estimated tokens when the latest assistant counts predate compression', () => {
    const messages = [
      { role: 'user', text: 'x'.repeat(20), summarized: true, timestamp: 100 },
      { role: 'assistant', text: 'y'.repeat(20), summarized: true, inputTokens: 500, outputTokens: 100, timestamp: 200 },
      { role: 'system', text: 's'.repeat(8), compressionMeta: { compressedAt: 1000 }, timestamp: 1000 },
      { role: 'assistant', text: 'a'.repeat(16), inputTokens: 300, outputTokens: 80, timestamp: 900 },
      { role: 'user', text: 'b'.repeat(12), timestamp: 950 },
    ];

    // Unsummarized estimate: 8/4 + 16/4 + 12/4 = 2 + 4 + 3 = 9
    assert.deepEqual(
      calculateCumulativeTokens(messages),
      { inputTokens: 9, outputTokens: 0 }
    );
  });

  it('uses assistant token counts again after a post-compression response', () => {
    const messages = [
      { role: 'system', text: 'summary', compressionMeta: { compressedAt: 1000 }, timestamp: 1000 },
      { role: 'assistant', text: 'new', inputTokens: 42, outputTokens: 8, timestamp: 1500 },
    ];

    assert.deepEqual(
      calculateCumulativeTokens(messages),
      { inputTokens: 42, outputTokens: 8 }
    );
  });
});
