// --- File utilities (shared) ---
// Common file-related utilities used by file-browser.js and file-panel.js

// SVG icons for different file types
export const FILE_ICONS = {
  folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
  code: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  document: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
};

// File extension categories
export const CODE_EXTS = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java',
  'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'php', 'pl', 'sh', 'bash', 'zsh',
  'sql', 'html', 'htm', 'xml', 'css', 'scss', 'less', 'sass', 'json', 'yaml',
  'yml', 'toml', 'md', 'vue', 'svelte', 'geojson', 'topojson', 'jsonl', 'ndjson',
]);

export const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp',
]);

export const DOC_EXTS = new Set([
  'md', 'txt', 'pdf', 'doc', 'docx', 'rtf',
]);

/**
 * Get file icon class and SVG for a file entry
 * @param {{type: string, ext?: string}} entry - File entry with type and optional ext
 * @returns {{class: string, svg: string}} Icon class and SVG markup
 */
export function getFileIcon(entry) {
  if (entry.type === 'directory') {
    return { class: 'directory', svg: FILE_ICONS.folder };
  }
  if (CODE_EXTS.has(entry.ext)) {
    return { class: 'code', svg: FILE_ICONS.code };
  }
  if (IMAGE_EXTS.has(entry.ext)) {
    return { class: 'image', svg: FILE_ICONS.image };
  }
  if (DOC_EXTS.has(entry.ext)) {
    return { class: 'document', svg: FILE_ICONS.document };
  }
  return { class: '', svg: FILE_ICONS.file };
}
