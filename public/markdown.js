(function(exports) {
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderMarkdown(text) {
    if (!text) return '';

    let html = escapeHtml(text);

    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
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

    return html;
  }

  exports.escapeHtml = escapeHtml;
  exports.renderMarkdown = renderMarkdown;
})(typeof module !== 'undefined' ? module.exports : (window.markdown = {}));
