// CommonJS wrapper for utils functions (for testing)
// Duplicated from public/js/utils.js to avoid ES module issues

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  if (isToday) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTokens(count) {
  if (count == null) return '0';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'k';
  return String(count);
}

function truncate(text, len) {
  if (!text) return '';
  return text.length > len ? text.slice(0, len) + '...' : text;
}

module.exports = { formatTime, formatTokens, truncate };
