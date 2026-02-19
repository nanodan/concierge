// --- Markdown module (ES module wrapper) ---
// This wraps the original markdown.js which attaches to window.markdown

// Cache for rendered markdown (content hash -> HTML)
const markdownCache = new Map();
const MAX_CACHE_SIZE = 500; // ~500 messages worth

// Simple FNV-1a hash - fast and good distribution
function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(36);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(text, { skipCache = false } = {}) {
  if (!text) return '';

  // Check cache first (unless skipping for streaming)
  const cacheKey = skipCache ? null : hashString(text);
  if (cacheKey && markdownCache.has(cacheKey)) {
    return markdownCache.get(cacheKey);
  }

  // Extract trace blocks (tool calls) before escaping - they become collapsible
  // First, combine consecutive trace blocks (only whitespace between them) into one
  const mergePattern = /:::trace\n([\s\S]*?)\n:::\s*:::trace\n/g;
  let prevText;
  do {
    prevText = text;
    text = text.replace(mergePattern, ':::trace\n$1\n\n');
  } while (text !== prevText);

  const traceBlocks = [];
  text = text.replace(/:::trace\n([\s\S]*?)\n:::/g, (_, content) => {
    traceBlocks.push(content);
    return `\x00TRACE${traceBlocks.length - 1}\x00`;
  });

  let html = escapeHtml(text);

  // Extract code blocks into placeholders to protect from subsequent regexes
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const cls = lang ? ` class="language-${lang}"` : '';
    codeBlocks.push(`<pre><code${cls}>${code.trim()}</code></pre>`);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  html = html.replace(/^---$/gm, '<hr>');

  // Process ordered lists first
  html = html.replace(/^\d+\. (.+)$/gm, '<ol-li>$1</ol-li>');

  // Convert dash lines that follow ol-li into part of the list item (not separate ul items)
  // This handles patterns like: "1. Item\n- Desc", "1. Item\n\n- Desc", "1. Item\n   - Desc"
  // Keep applying until no more matches (handles multiple consecutive dash lines)
  let prevHtml;
  do {
    prevHtml = html;
    html = html.replace(/(<ol-li>.*?)(<\/ol-li>)\s*\n\s*- (.+)$/gm, '$1<br><span class="list-desc">— $3</span>$2');
  } while (html !== prevHtml);

  // Group consecutive ol-li items
  html = html.replace(/(<ol-li>.*?<\/ol-li>\s*)+/g, (m) => '<ol>' + m.replace(/\s*(<ol-li>)/g, '$1') + '</ol>\n');
  html = html.replace(/<\/?ol-li>/g, (t) => t === '<ol-li>' ? '<li>' : '</li>');

  // Process unordered lists (remaining dash/asterisk lines)
  html = html.replace(/^[*-] (.+)$/gm, '<ul-li>$1</ul-li>');
  html = html.replace(/(<ul-li>.*<\/ul-li>\s*)+/g, (m) => '<ul>' + m.replace(/\s*(<ul-li>)/g, '$1') + '</ul>\n');
  html = html.replace(/<\/?ul-li>/g, (t) => t === '<ul-li>' ? '<li>' : '</li>');

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const decoded = url.replace(/&amp;/g, '&');
    if (/^(https?:\/\/|mailto:)/i.test(decoded)) {
      return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
    }
    return text;
  });

  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';

  html = html.replace(/(?<!<\/?\w+[^>]*)\n(?!<\/?(?:pre|code|ul|ol|li|h[1-3]|p|hr))/g, '<br>');

  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>\s*(<(?:pre|h[1-3]|ul|ol|hr))/g, '$1');
  html = html.replace(/(<\/(?:pre|h[1-3]|ul|ol|hr)>)\s*<\/p>/g, '$1');

  // Restore code blocks
  html = html.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[i]);

  // Restore trace blocks as collapsible details
  html = html.replace(/\x00TRACE(\d+)\x00/g, (_, i) => {
    const traceContent = renderMarkdown(traceBlocks[i]);
    return `<details class="tool-trace"><summary>Show tool calls</summary><div class="trace-content">${traceContent}</div></details>`;
  });

  // Cache result (with LRU eviction)
  if (cacheKey) {
    if (markdownCache.size >= MAX_CACHE_SIZE) {
      // Evict oldest entry (first key in Map iteration order)
      const firstKey = markdownCache.keys().next().value;
      markdownCache.delete(firstKey);
    }
    markdownCache.set(cacheKey, html);
  }

  return html;
}

// Export cache control for testing/debugging
function clearMarkdownCache() {
  markdownCache.clear();
}

function getMarkdownCacheSize() {
  return markdownCache.size;
}

export { escapeHtml, renderMarkdown, clearMarkdownCache, getMarkdownCacheSize };
