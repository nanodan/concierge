import { getInlineDownloadUrl } from './files-core.js';

function defaultNoop() {}

export function renderFileTreeView({
  container,
  entries,
  context,
  getFileIcon,
  formatFileSize,
  imageExts,
  escapeHtml,
  iconTag = 'span',
  includeExtAttr = false,
  getDeletePath = (entry) => entry.path,
  getExtraButtonHtml = () => '',
  extraButtonSelector = null,
  onItemActivate = defaultNoop,
  onDirectoryOpen = defaultNoop,
  onFileOpen = defaultNoop,
  onDelete = defaultNoop,
  onExtra = null,
}) {
  if (!container) return;
  if (!entries || entries.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = entries.map((entry, index) => {
    const isDir = entry.type === 'directory';
    const ext = (entry.ext || entry.name?.split('.').pop() || '').toLowerCase();
    const isImage = !isDir && imageExts.has(ext);
    const icon = getFileIcon({ ...entry, ext });
    const deletePath = getDeletePath(entry);
    const meta = !isDir && entry.size !== undefined
      ? `<span class="file-tree-meta">${formatFileSize(entry.size)}</span>`
      : '';
    const extraButton = getExtraButtonHtml(entry) || '';

    let iconHtml;
    if (isImage) {
      const thumbUrl = getInlineDownloadUrl(context, entry.path);
      iconHtml = `<div class="file-tree-icon thumbnail"><img src="${thumbUrl}" alt="" loading="lazy"></div>`;
    } else {
      iconHtml = `<${iconTag} class="file-tree-icon ${icon.class}">${icon.svg}</${iconTag}>`;
    }

    const extAttr = includeExtAttr ? ` data-ext="${escapeHtml(ext)}"` : '';

    return `
      <div class="file-tree-item" data-index="${index}" data-type="${entry.type}" data-path="${escapeHtml(entry.path)}" data-delete-path="${escapeHtml(deletePath)}"${extAttr}>
        ${iconHtml}
        <span class="file-tree-name">${escapeHtml(entry.name)}</span>
        ${meta}
        ${extraButton}
        <button class="file-tree-delete-btn" title="Delete">\u00d7</button>
      </div>`;
  }).join('');

  container.querySelectorAll('.file-tree-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.file-tree-delete-btn')) return;
      if (extraButtonSelector && e.target.closest(extraButtonSelector)) return;

      const index = parseInt(item.dataset.index, 10);
      const entry = entries[index];
      if (!entry) return;

      onItemActivate();
      if (entry.type === 'directory') {
        onDirectoryOpen(entry.path, entry);
      } else {
        onFileOpen(entry.path, entry);
      }
    });
  });

  container.querySelectorAll('.file-tree-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = btn.closest('.file-tree-item');
      const index = parseInt(item.dataset.index, 10);
      const entry = entries[index];
      if (!entry) return;
      await onDelete(item.dataset.deletePath, entry);
    });
  });

  if (extraButtonSelector && onExtra) {
    container.querySelectorAll(extraButtonSelector).forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = btn.closest('.file-tree-item');
        const index = parseInt(item.dataset.index, 10);
        const entry = entries[index];
        if (!entry) return;
        await onExtra(entry, btn);
      });
    });
  }
}
