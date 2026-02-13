// --- File Panel (Project Mode) ---
import { escapeHtml } from './markdown.js';
import { haptic, showToast } from './utils.js';
import * as state from './state.js';

// DOM elements
let filePanel = null;
let filePanelBackdrop = null;
let filePanelClose = null;
let filePanelUp = null;
let filePanelPath = null;
let fileTree = null;
let fileViewer = null;
let fileViewerName = null;
let fileViewerClose = null;
let fileViewerContent = null;
let chatView = null;

// Panel state
let currentPath = '';
let isOpen = false;
let isDragging = false;
let dragStartY = 0;
let dragStartHeight = 0;

// Snap points for mobile (percentage of viewport height)
const SNAP_POINTS = [30, 60, 90];

// Icons
const ICONS = {
  folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
  code: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  document: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  emptyFolder: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  error: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  openExternal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
};

// Previewable binary files (can open in browser)
const PREVIEWABLE_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);

// File extension categories
const CODE_EXTS = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'php', 'pl', 'sh', 'bash', 'zsh', 'sql', 'html', 'htm', 'xml', 'css', 'scss', 'less', 'sass', 'json', 'yaml', 'yml', 'toml', 'md', 'vue', 'svelte']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);
const DOC_EXTS = new Set(['md', 'txt', 'pdf', 'doc', 'docx', 'rtf']);

function getFileIcon(entry) {
  if (entry.type === 'directory') {
    return { class: 'directory', svg: ICONS.folder };
  }
  if (CODE_EXTS.has(entry.ext)) {
    return { class: 'code', svg: ICONS.code };
  }
  if (IMAGE_EXTS.has(entry.ext)) {
    return { class: 'image', svg: ICONS.image };
  }
  if (DOC_EXTS.has(entry.ext)) {
    return { class: 'document', svg: ICONS.document };
  }
  return { class: '', svg: ICONS.file };
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function isMobile() {
  return window.innerWidth < 768;
}

export function initFilePanel(elements) {
  filePanel = elements.filePanel;
  filePanelBackdrop = elements.filePanelBackdrop;
  filePanelClose = elements.filePanelClose;
  filePanelUp = elements.filePanelUp;
  filePanelPath = elements.filePanelPath;
  fileTree = elements.fileTree;
  fileViewer = elements.fileViewer;
  fileViewerName = elements.fileViewerName;
  fileViewerClose = elements.fileViewerClose;
  fileViewerContent = elements.fileViewerContent;
  chatView = elements.chatView;

  setupEventListeners();
}

function setupEventListeners() {
  // Close button
  if (filePanelClose) {
    filePanelClose.addEventListener('click', () => {
      haptic(10);
      closeFilePanel();
    });
  }

  // Backdrop click (mobile)
  if (filePanelBackdrop) {
    filePanelBackdrop.addEventListener('click', () => {
      haptic(10);
      closeFilePanel();
    });
  }

  // Up button
  if (filePanelUp) {
    filePanelUp.addEventListener('click', () => {
      if (currentPath) {
        const parent = currentPath.split('/').slice(0, -1).join('/');
        loadFileTree(parent);
      }
    });
  }

  // File viewer close
  if (fileViewerClose) {
    fileViewerClose.addEventListener('click', () => {
      haptic(10);
      closeFileViewer();
    });
  }

  // Mobile drag gesture
  if (filePanel && isMobile()) {
    setupDragGesture();
  }

  // Handle resize
  window.addEventListener('resize', () => {
    if (isOpen && isMobile()) {
      setupDragGesture();
    }
  });
}

function setupDragGesture() {
  const header = filePanel.querySelector('.file-panel-header');
  if (!header) return;

  header.addEventListener('touchstart', (e) => {
    isDragging = true;
    dragStartY = e.touches[0].clientY;
    dragStartHeight = filePanel.offsetHeight;
    filePanel.classList.add('dragging');
  }, { passive: true });

  header.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const dy = dragStartY - e.touches[0].clientY;
    const newHeight = Math.max(100, Math.min(window.innerHeight * 0.95, dragStartHeight + dy));
    filePanel.style.height = newHeight + 'px';
  }, { passive: true });

  header.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    filePanel.classList.remove('dragging');

    // Snap to closest point
    const currentHeightVh = (filePanel.offsetHeight / window.innerHeight) * 100;
    let closestSnap = SNAP_POINTS[0];
    let minDist = Math.abs(currentHeightVh - SNAP_POINTS[0]);

    for (const snap of SNAP_POINTS) {
      const dist = Math.abs(currentHeightVh - snap);
      if (dist < minDist) {
        minDist = dist;
        closestSnap = snap;
      }
    }

    // If dragged below minimum, close the panel
    if (currentHeightVh < 20) {
      closeFilePanel();
      return;
    }

    // Apply snap
    filePanel.style.height = '';
    filePanel.classList.remove('snap-30', 'snap-60', 'snap-90');
    filePanel.classList.add(`snap-${closestSnap}`);
  }, { passive: true });
}

export function openFilePanel() {
  const convId = state.getCurrentConversationId();
  if (!convId) {
    showToast('No conversation selected');
    return;
  }

  isOpen = true;
  currentPath = '';

  // Reset viewer state
  closeFileViewer();

  // Show panel
  filePanel.classList.remove('hidden');
  setTimeout(() => {
    filePanel.classList.add('open');
    if (isMobile()) {
      filePanel.classList.add('snap-60');
      filePanelBackdrop.classList.add('visible');
    } else {
      chatView.classList.add('file-panel-open');
    }
  }, 10);

  // Load root directory
  loadFileTree('');

  haptic(15);
}

export function closeFilePanel() {
  isOpen = false;
  filePanel.classList.remove('open', 'snap-30', 'snap-60', 'snap-90');
  filePanelBackdrop.classList.remove('visible');
  chatView.classList.remove('file-panel-open');

  setTimeout(() => {
    filePanel.classList.add('hidden');
    closeFileViewer();
  }, 300);
}

export function toggleFilePanel() {
  if (isOpen) {
    closeFilePanel();
  } else {
    openFilePanel();
  }
}

export async function loadFileTree(subpath) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  currentPath = subpath;
  filePanelPath.textContent = subpath || '.';
  filePanelUp.disabled = !subpath;

  fileTree.innerHTML = '<div class="file-tree-loading">Loading...</div>';

  try {
    const qs = subpath ? `?path=${encodeURIComponent(subpath)}` : '';
    const res = await fetch(`/api/conversations/${convId}/files${qs}`);
    const data = await res.json();

    if (data.error) {
      fileTree.innerHTML = `
        <div class="file-tree-empty">
          ${ICONS.error}
          <p>${escapeHtml(data.error)}</p>
        </div>`;
      return;
    }

    if (data.entries.length === 0) {
      fileTree.innerHTML = `
        <div class="file-tree-empty">
          ${ICONS.emptyFolder}
          <p>Empty folder</p>
        </div>`;
      return;
    }

    renderFileTree(data.entries);
  } catch (_err) {
    fileTree.innerHTML = `
      <div class="file-tree-empty">
        ${ICONS.error}
        <p>Failed to load files</p>
      </div>`;
  }
}

function renderFileTree(entries) {
  fileTree.innerHTML = entries.map(entry => {
    const icon = getFileIcon(entry);
    const meta = entry.type === 'directory' ? '' : formatFileSize(entry.size);

    return `
      <div class="file-tree-item" data-type="${entry.type}" data-path="${escapeHtml(entry.path)}" data-ext="${entry.ext || ''}">
        <div class="file-tree-icon ${icon.class}">${icon.svg}</div>
        <span class="file-tree-name">${escapeHtml(entry.name)}</span>
        ${meta ? `<span class="file-tree-meta">${meta}</span>` : ''}
      </div>`;
  }).join('');

  // Attach event handlers
  fileTree.querySelectorAll('.file-tree-item').forEach(item => {
    item.addEventListener('click', () => {
      haptic(5);
      const type = item.dataset.type;
      const filePath = item.dataset.path;

      if (type === 'directory') {
        loadFileTree(filePath);
      } else {
        viewFile(filePath);
      }
    });
  });
}

export async function viewFile(filePath) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const filename = filePath.split('/').pop();
  fileViewerName.textContent = filename;
  fileViewerContent.innerHTML = '<code>Loading...</code>';

  // Show viewer
  fileViewer.classList.remove('hidden');
  setTimeout(() => fileViewer.classList.add('open'), 10);

  try {
    const res = await fetch(`/api/conversations/${convId}/files/content?path=${encodeURIComponent(filePath)}`);
    const data = await res.json();

    if (data.error) {
      fileViewerContent.innerHTML = `
        <div class="file-viewer-error">
          ${ICONS.error}
          <p>${escapeHtml(data.error)}</p>
        </div>`;
      return;
    }

    if (data.binary) {
      const fileUrl = `/api/conversations/${convId}/files/download?path=${encodeURIComponent(filePath)}&inline=true`;

      // Check if it's an image - render inline with option to open full size
      if (IMAGE_EXTS.has(data.ext)) {
        fileViewerContent.innerHTML = `
          <div class="file-viewer-preview">
            <img src="${fileUrl}" alt="${escapeHtml(data.name)}" class="file-viewer-image" title="Click to open full size" />
            <button class="file-viewer-fullsize-btn" title="Open full size">
              ${ICONS.openExternal}
            </button>
          </div>`;
        // Click handlers for opening full size
        const img = fileViewerContent.querySelector('.file-viewer-image');
        const btn = fileViewerContent.querySelector('.file-viewer-fullsize-btn');
        const openFullSize = () => window.open(fileUrl, '_blank');
        img.addEventListener('click', openFullSize);
        btn.addEventListener('click', openFullSize);
        return;
      }

      // Check if it's previewable in browser (PDF, etc.)
      if (PREVIEWABLE_EXTS.has(data.ext)) {
        fileViewerContent.innerHTML = `
          <div class="file-viewer-error">
            ${ICONS.document}
            <p>${escapeHtml(data.name)}</p>
            <p style="font-size: 12px; opacity: 0.7; margin-bottom: 12px;">${formatFileSize(data.size)}</p>
            <button class="file-viewer-open-btn" onclick="window.open('${fileUrl}', '_blank')">
              ${ICONS.openExternal} Open in new tab
            </button>
          </div>`;
        return;
      }

      // Non-previewable binary
      fileViewerContent.innerHTML = `
        <div class="file-viewer-error">
          ${ICONS.file}
          <p>Binary file cannot be previewed</p>
          <p style="font-size: 12px; opacity: 0.7; margin-bottom: 12px;">${formatFileSize(data.size)}</p>
          <button class="file-viewer-open-btn" onclick="window.open('/api/conversations/${convId}/files/download?path=${encodeURIComponent(filePath)}', '_blank')">
            ${ICONS.openExternal} Download
          </button>
        </div>`;
      return;
    }

    if (data.truncated) {
      fileViewerContent.innerHTML = `
        <div class="file-viewer-error">
          ${ICONS.document}
          <p>File too large to preview</p>
          <p style="font-size: 12px; opacity: 0.7;">${formatFileSize(data.size)} (max 500KB)</p>
        </div>`;
      return;
    }

    // Render content with syntax highlighting
    const langClass = data.language ? `language-${data.language}` : '';
    fileViewerContent.innerHTML = `<code class="${langClass}">${escapeHtml(data.content)}</code>`;

    // Apply syntax highlighting
    const codeEl = fileViewerContent.querySelector('code');
    if (window.hljs && data.language && !codeEl.dataset.highlighted) {
      hljs.highlightElement(codeEl);
    }
  } catch (_err) {
    fileViewerContent.innerHTML = `
      <div class="file-viewer-error">
        ${ICONS.error}
        <p>Failed to load file</p>
      </div>`;
  }
}

function closeFileViewer() {
  fileViewer.classList.remove('open');
  setTimeout(() => {
    fileViewer.classList.add('hidden');
    fileViewerContent.innerHTML = '<code></code>';
  }, 300);
}

export function isFilePanelOpen() {
  return isOpen;
}
