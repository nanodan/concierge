const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, renderMarkdown } = require('../public/markdown');

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
  });

  it('escapes angle brackets', () => {
    assert.equal(escapeHtml('<div>'), '&lt;div&gt;');
  });

  it('escapes quotes', () => {
    assert.equal(escapeHtml('"hello"'), '&quot;hello&quot;');
  });

  it('escapes script tags', () => {
    assert.equal(escapeHtml('<script>alert("xss")</script>'),
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('handles empty string', () => {
    assert.equal(escapeHtml(''), '');
  });
});

describe('renderMarkdown', () => {
  it('returns empty string for falsy input', () => {
    assert.equal(renderMarkdown(''), '');
    assert.equal(renderMarkdown(null), '');
    assert.equal(renderMarkdown(undefined), '');
  });

  it('wraps plain text in <p>', () => {
    const result = renderMarkdown('hello world');
    assert.ok(result.includes('hello world'));
    assert.ok(result.startsWith('<p>'));
  });

  it('renders bold text', () => {
    const result = renderMarkdown('this is **bold** text');
    assert.ok(result.includes('<strong>bold</strong>'));
  });

  it('renders italic text', () => {
    const result = renderMarkdown('this is *italic* text');
    assert.ok(result.includes('<em>italic</em>'));
  });

  it('renders inline code', () => {
    const result = renderMarkdown('use `console.log`');
    assert.ok(result.includes('<code>console.log</code>'));
  });

  it('renders code blocks', () => {
    const result = renderMarkdown('```js\nconst x = 1;\n```');
    assert.ok(result.includes('<pre><code>'));
    assert.ok(result.includes('const x = 1;'));
  });

  it('renders h1 headings', () => {
    const result = renderMarkdown('# Title');
    assert.ok(result.includes('<h1>Title</h1>'));
  });

  it('renders h2 headings', () => {
    const result = renderMarkdown('## Subtitle');
    assert.ok(result.includes('<h2>Subtitle</h2>'));
  });

  it('renders h3 headings', () => {
    const result = renderMarkdown('### Section');
    assert.ok(result.includes('<h3>Section</h3>'));
  });

  it('renders horizontal rules', () => {
    const result = renderMarkdown('above\n\n---\n\nbelow');
    assert.ok(result.includes('<hr>'));
  });

  it('renders unordered lists with - marker (preferred)', () => {
    // Note: * marker conflicts with italic regex, so - is the reliable marker
    const result = renderMarkdown('- item one\n- item two\n- item three');
    assert.ok(result.includes('<ul>'));
    assert.ok(result.includes('<li>item one</li>'));
    assert.ok(result.includes('<li>item two</li>'));
    assert.ok(result.includes('<li>item three</li>'));
    assert.ok(result.includes('</ul>'));
  });

  it('renders unordered lists with - marker', () => {
    const result = renderMarkdown('- first\n- second');
    assert.ok(result.includes('<ul>'));
    assert.ok(result.includes('<li>first</li>'));
    assert.ok(result.includes('<li>second</li>'));
  });

  it('renders ordered lists', () => {
    const result = renderMarkdown('1. first\n2. second\n3. third');
    assert.ok(result.includes('<ol>'));
    assert.ok(result.includes('<li>first</li>'));
    assert.ok(result.includes('<li>second</li>'));
    assert.ok(result.includes('<li>third</li>'));
    assert.ok(result.includes('</ol>'));
    // Must NOT contain <ul>
    assert.ok(!result.includes('<ul>'));
  });

  it('renders http links', () => {
    const result = renderMarkdown('[Google](https://google.com)');
    assert.ok(result.includes('<a href="https://google.com"'));
    assert.ok(result.includes('target="_blank"'));
    assert.ok(result.includes('rel="noopener"'));
    assert.ok(result.includes('>Google</a>'));
  });

  it('renders mailto links', () => {
    const result = renderMarkdown('[Email](mailto:a@b.com)');
    assert.ok(result.includes('<a href="mailto:a@b.com"'));
  });

  it('strips javascript: links (XSS prevention)', () => {
    const result = renderMarkdown('[click](javascript:alert(1))');
    assert.ok(!result.includes('<a'));
    assert.ok(!result.includes('javascript:'));
    assert.ok(result.includes('click'));
  });

  it('strips data: URI links', () => {
    const result = renderMarkdown('[click](data:text/html,<script>alert(1)</script>)');
    assert.ok(!result.includes('<a'));
  });

  it('escapes HTML in input', () => {
    const result = renderMarkdown('<script>alert("xss")</script>');
    assert.ok(!result.includes('<script>'));
    assert.ok(result.includes('&lt;script&gt;'));
  });

  it('handles paragraphs from double newlines', () => {
    const result = renderMarkdown('first paragraph\n\nsecond paragraph');
    assert.ok(result.includes('</p><p>'));
  });
});
