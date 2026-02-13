// --- Markdown module (ES module wrapper) ---
// This wraps the original markdown.js which attaches to window.markdown

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  if (!text) return '';

  // Extract trace blocks (tool calls) before escaping - they become collapsible
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

  html = html.replace(/^[*-] (.+)$/gm, '<ul-li>$1</ul-li>');
  html = html.replace(/(<ul-li>.*<\/ul-li>\n?)+/g, (m) => '<ul>' + m + '</ul>');
  html = html.replace(/<\/?ul-li>/g, (t) => t === '<ul-li>' ? '<li>' : '</li>');

  html = html.replace(/^\d+\. (.+)$/gm, '<ol-li>$1</ol-li>');
  html = html.replace(/(<ol-li>.*<\/ol-li>\n?)+/g, (m) => '<ol>' + m + '</ol>');
  html = html.replace(/<\/?ol-li>/g, (t) => t === '<ol-li>' ? '<li>' : '</li>');

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

  return html;
}

export { escapeHtml, renderMarkdown };
