// --- File Browser (file tree, navigation, upload, search) ---
import { escapeHtml } from '../markdown.js';
import { haptic, showToast, apiFetch, formatFileSize } from '../utils.js';
import * as state from '../state.js';
import { getFileIcon, FILE_ICONS, IMAGE_EXTS } from '../file-utils.js';
import { ANIMATION_DELAY_SHORT, DEBOUNCE_SEARCH, SLIDE_TRANSITION_DURATION } from '../constants.js';
import { hideGranularToggle } from './git-changes.js';

// UI-specific icons
const ICONS = {
  ...FILE_ICONS,
  emptyFolder: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  error: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  openExternal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
};

// Previewable binary files (can open in browser)
const PREVIEWABLE_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);

// DOM elements (set by init)
let filePanelUp = null;
let filePanelPath = null;
let fileSearchInput = null;
let filePanelUploadBtn = null;
let filePanelFileInput = null;
let fileTree = null;
let fileViewer = null;
let fileViewerName = null;
let fileViewerClose = null;
let fileViewerContent = null;
let filesView = null;

// State
let currentPath = '';
let searchMode = false;
let searchResults = null;
let searchTimeout = null;
let viewingDiff = null;

/**
 * Initialize file browser elements
 */
export function initFileBrowser(elements) {
  filePanelUp = elements.filePanelUp;
  filePanelPath = elements.filePanelPath;
  fileSearchInput = elements.fileSearchInput;
  filePanelUploadBtn = elements.filePanelUploadBtn;
  filePanelFileInput = elements.filePanelFileInput;
  fileTree = elements.fileTree;
  fileViewer = elements.fileViewer;
  fileViewerName = elements.fileViewerName;
  fileViewerClose = elements.fileViewerClose;
  fileViewerContent = elements.fileViewerContent;
  filesView = elements.filesView;
}

/**
 * Setup file browser event listeners
 */
export function setupFileBrowserEventListeners() {
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
      haptic();
      closeFileViewer();
    });
  }

  // File search input
  if (fileSearchInput) {
    fileSearchInput.addEventListener('input', handleSearchInput);
    fileSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        fileSearchInput.value = '';
        exitSearchMode();
        fileSearchInput.blur();
      }
    });
  }

  // Upload button
  if (filePanelUploadBtn) {
    filePanelUploadBtn.addEventListener('click', () => {
      if (filePanelFileInput) filePanelFileInput.click();
    });
  }

  if (filePanelFileInput) {
    filePanelFileInput.addEventListener('change', () => {
      if (filePanelFileInput.files.length) {
        uploadToFilePanel(filePanelFileInput.files);
        filePanelFileInput.value = '';
      }
    });
  }

  // Drag-and-drop for file panel
  if (filesView) {
    filesView.addEventListener('dragover', (e) => {
      e.preventDefault();
      filesView.classList.add('drag-over');
    });
    filesView.addEventListener('dragleave', (e) => {
      if (!filesView.contains(e.relatedTarget)) {
        filesView.classList.remove('drag-over');
      }
    });
    filesView.addEventListener('drop', (e) => {
      e.preventDefault();
      filesView.classList.remove('drag-over');
      if (e.dataTransfer.files.length) {
        uploadToFilePanel(e.dataTransfer.files);
      }
    });
  }
}

/**
 * Get the current path
 */
export function getCurrentPath() {
  return currentPath;
}

/**
 * Set the current path
 */
export function setCurrentPath(path) {
  currentPath = path;
}

/**
 * Load the file tree for a given path
 */
export async function loadFileTree(subpath) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  currentPath = subpath;
  filePanelPath.textContent = subpath || '.';
  filePanelUp.disabled = !subpath;

  fileTree.innerHTML = '<div class="file-tree-loading">Loading...</div>';

  const qs = subpath ? `?path=${encodeURIComponent(subpath)}` : '';
  const res = await apiFetch(`/api/conversations/${convId}/files${qs}`, { silent: true });
  if (!res) {
    fileTree.innerHTML = `
      <div class="file-tree-empty">
        ${ICONS.error}
        <p>Failed to load files</p>
      </div>`;
    return;
  }
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
}

/**
 * Render the file tree
 */
function renderFileTree(entries) {
  const convId = state.getCurrentConversationId();
  fileTree.innerHTML = entries.map(entry => {
    const icon = getFileIcon(entry);
    const meta = entry.type === 'directory' ? '' : formatFileSize(entry.size);
    const isImage = IMAGE_EXTS.has(entry.ext);

    // For images, show actual thumbnail instead of icon
    let iconHtml;
    if (isImage && convId) {
      const thumbUrl = `/api/conversations/${convId}/files/download?path=${encodeURIComponent(entry.path)}&inline=true`;
      iconHtml = `<div class="file-tree-icon thumbnail"><img src="${thumbUrl}" alt="" loading="lazy" /></div>`;
    } else {
      iconHtml = `<div class="file-tree-icon ${icon.class}">${icon.svg}</div>`;
    }

    return `
      <div class="file-tree-item" data-type="${entry.type}" data-path="${escapeHtml(entry.path)}" data-ext="${entry.ext || ''}">
        ${iconHtml}
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

/**
 * Upload files to conversation attachments
 */
async function uploadToFilePanel(files) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  for (const file of files) {
    const url = `/api/conversations/${convId}/upload?filename=${encodeURIComponent(file.name)}`;
    const resp = await apiFetch(url, { method: 'POST', body: file });
    if (!resp) continue;
    showToast(`Uploaded ${file.name}`);
  }

  // Refresh file list
  loadFileTree(currentPath);
}

/**
 * View a file
 */
export async function viewFile(filePath) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  // Hide granular toggle since this is not a diff view
  hideGranularToggle();

  const filename = filePath.split('/').pop();
  fileViewerName.textContent = filename;
  fileViewerContent.innerHTML = '<code>Loading...</code>';

  // Show viewer
  fileViewer.classList.remove('hidden');
  setTimeout(() => fileViewer.classList.add('open'), ANIMATION_DELAY_SHORT);

  const res = await apiFetch(`/api/conversations/${convId}/files/content?path=${encodeURIComponent(filePath)}`, { silent: true });
  if (!res) {
    fileViewerContent.innerHTML = `
      <div class="file-viewer-error">
        ${ICONS.error}
        <p>Failed to load file</p>
      </div>`;
    return;
  }
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
          ${ICONS.document || ICONS.file}
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
        ${ICONS.document || ICONS.file}
        <p>File too large to preview</p>
        <p style="font-size: 12px; opacity: 0.7;">${formatFileSize(data.size)} (max 500KB)</p>
      </div>`;
    return;
  }

  const fileUrl = `/api/conversations/${convId}/files/download?path=${encodeURIComponent(filePath)}&inline=true`;

  // Render content with syntax highlighting + button to open in new tab
  const langClass = data.language ? `language-${data.language}` : '';
  fileViewerContent.innerHTML = `
    <code class="${langClass}">${escapeHtml(data.content)}</code>
    <button class="file-viewer-open-tab-btn" title="Open in new tab">
      ${ICONS.openExternal}
    </button>`;

  // Apply syntax highlighting
  const codeEl = fileViewerContent.querySelector('code');
  if (window.hljs && data.language && !codeEl.dataset.highlighted) {
    hljs.highlightElement(codeEl);
  }

  // Attach click handler for open in tab button
  const openBtn = fileViewerContent.querySelector('.file-viewer-open-tab-btn');
  if (openBtn) {
    openBtn.addEventListener('click', () => window.open(fileUrl, '_blank'));
  }
}

/**
 * Close the file viewer
 */
export function closeFileViewer() {
  fileViewer.classList.remove('open');
  viewingDiff = null;
  hideGranularToggle();
  setTimeout(() => {
    fileViewer.classList.add('hidden');
    fileViewerContent.innerHTML = '<code></code>';
  }, SLIDE_TRANSITION_DURATION);
}

/**
 * Check if file viewer is open
 */
export function isFileViewerOpen() {
  return fileViewer && fileViewer.classList.contains('open');
}

/**
 * Set viewing diff state
 */
export function setViewingDiff(diff) {
  viewingDiff = diff;
}

/**
 * Get viewing diff state
 */
export function getViewingDiff() {
  return viewingDiff;
}

// === File Search ===

function handleSearchInput(e) {
  const query = e.target.value.trim();

  clearTimeout(searchTimeout);

  if (!query) {
    exitSearchMode();
    return;
  }

  searchTimeout = setTimeout(() => searchFiles(query), DEBOUNCE_SEARCH);
}

async function searchFiles(query) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  searchMode = true;
  fileTree.innerHTML = '<div class="file-tree-loading">Searching...</div>';

  const res = await apiFetch(
    `/api/conversations/${convId}/files/search?q=${encodeURIComponent(query)}`,
    { silent: true }
  );

  if (!res) {
    fileTree.innerHTML = `
      <div class="file-tree-empty">
        ${ICONS.error}
        <p>Search failed</p>
      </div>`;
    return;
  }

  const data = await res.json();

  if (data.error) {
    fileTree.innerHTML = `
      <div class="file-tree-empty">
        ${ICONS.error}
        <p>${escapeHtml(data.error)}</p>
      </div>`;
    return;
  }

  searchResults = data.results;
  renderSearchResults();
}

function renderSearchResults() {
  if (!searchResults || searchResults.length === 0) {
    fileTree.innerHTML = `<div class="file-tree-empty">No matches found</div>`;
    return;
  }

  fileTree.innerHTML = searchResults.map(r => `
    <div class="search-result-item" data-path="${escapeHtml(r.path)}" data-line="${r.line}">
      <div class="search-result-location">
        <span class="search-result-path">${escapeHtml(r.path)}</span>
        <span class="search-result-line">:${r.line}</span>
      </div>
      <div class="search-result-content">${escapeHtml(r.content.trim())}</div>
    </div>
  `).join('');

  // Attach click handlers
  fileTree.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      openFileAtLine(item.dataset.path, parseInt(item.dataset.line, 10));
    });
  });
}

async function openFileAtLine(filePath, line) {
  haptic();
  await viewFile(filePath);

  // Scroll to line after content loads
  setTimeout(() => {
    const codeEl = fileViewerContent.querySelector('code');
    if (!codeEl) return;

    // Split by newlines to find the target line
    const lines = codeEl.innerHTML.split('\n');
    if (line > 0 && line <= lines.length) {
      // Highlight the line
      lines[line - 1] = `<span class="highlight-line">${lines[line - 1]}</span>`;
      codeEl.innerHTML = lines.join('\n');

      // Scroll to highlighted line
      const highlighted = codeEl.querySelector('.highlight-line');
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'center' });
      }
    }
  }, 150);
}

/**
 * Exit search mode and return to normal file tree
 */
export function exitSearchMode() {
  searchMode = false;
  searchResults = null;
  if (fileSearchInput) {
    fileSearchInput.value = '';
  }
  loadFileTree(currentPath);
}

/**
 * Check if in search mode
 */
export function isSearchMode() {
  return searchMode;
}

/**
 * Reset search state (called when opening panel)
 */
export function resetSearchState() {
  searchMode = false;
  searchResults = null;
  if (fileSearchInput) {
    fileSearchInput.value = '';
  }
}

/**
 * Get icons object for use in other modules
 */
export function getIcons() {
  return ICONS;
}
