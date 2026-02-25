// --- File Browser (file tree, navigation, upload, search) ---
import { escapeHtml, renderMarkdown } from '../markdown.js';
import { haptic, showToast, showDialog, apiFetch, formatFileSize } from '../utils.js';
import * as state from '../state.js';
import { getFileIcon, IMAGE_EXTS } from '../file-utils.js';
import { ANIMATION_DELAY_SHORT, DEBOUNCE_SEARCH, SLIDE_TRANSITION_DURATION } from '../constants.js';
import { hideGranularToggle } from './git-changes.js';
import { createConversationContext } from '../explorer/context.js';
import { createExplorerShell } from '../explorer/shell.js';
import { bindExplorerShellUi } from '../explorer/shell-ui-bindings.js';
import {
  createExplorerIcons,
  createExplorerFeedbackHandlers,
  renderStandardEmpty,
  renderStandardError,
} from '../explorer/shell-presets.js';

// UI-specific icons
const ICONS = createExplorerIcons({
  openExternal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
});

// Data files that can be loaded into DuckDB
const DATA_FILE_EXTS = new Set(['csv', 'tsv', 'parquet', 'json', 'jsonl', 'geojson']);

// Callback for when a file is loaded to data tab (set by data.js)
let onFileLoadedToDataTab = null;
const fileBrowserContext = createConversationContext(() => state.getCurrentConversationId());

/**
 * Set callback for when file is loaded to data tab
 */
export function setOnFileLoadedToDataTab(callback) {
  onFileLoadedToDataTab = callback;
}

/**
 * Load a data file into DuckDB via the Data tab
 */
async function loadFileToDataTab(filePath) {
  if (!fileBrowserContext.isAvailable()) {
    showToast('No conversation selected');
    return;
  }

  const body = fileBrowserContext.getDuckDbLoadBody(filePath);
  const res = await apiFetch('/api/duckdb/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res) return;

  const data = await res.json();
  if (data.error) {
    showToast(data.error, { variant: 'error' });
    return;
  }

  const rowCountStr = data.rowCount?.toLocaleString() || '0';
  showToast(`Loaded ${data.tableName} (${rowCountStr} rows)`);

  // Notify data tab to refresh
  if (onFileLoadedToDataTab) {
    onFileLoadedToDataTab(data);
  }
}

// DOM elements (set by init)
let filePanelUp = null;
let filePanelPath = null;
let fileSearchInput = null;
let filePanelRefreshBtn = null;
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
let explorerShell = null;

/**
 * Initialize file browser elements
 */
export function initFileBrowser(elements) {
  filePanelUp = elements.filePanelUp;
  filePanelPath = elements.filePanelPath;
  fileSearchInput = elements.fileSearchInput;
  filePanelRefreshBtn = elements.filePanelRefreshBtn;
  filePanelUploadBtn = elements.filePanelUploadBtn;
  filePanelFileInput = elements.filePanelFileInput;
  fileTree = elements.fileTree;
  fileViewer = elements.fileViewer;
  fileViewerName = elements.fileViewerName;
  fileViewerClose = elements.fileViewerClose;
  fileViewerContent = elements.fileViewerContent;
  filesView = elements.filesView;
  const feedbackHandlers = createExplorerFeedbackHandlers({
    haptic,
    showDialog,
    showToast,
  });

  explorerShell = createExplorerShell({
    context: fileBrowserContext,
    apiFetch,
    treeContainer: fileTree,
    viewer: fileViewer,
    viewerName: fileViewerName,
    viewerContent: fileViewerContent,
    escapeHtml,
    renderMarkdown,
    formatFileSize,
    getFileIcon,
    imageExts: IMAGE_EXTS,
    icons: ICONS,
    animationDelayMs: ANIMATION_DELAY_SHORT,
    closeDelayMs: SLIDE_TRANSITION_DURATION,
    iconTag: 'div',
    includeExtAttr: true,
    getDeletePath: (entry) => {
      const convId = state.getCurrentConversationId();
      const conv = state.conversations.find((c) => c.id === convId);
      const baseCwd = conv?.cwd || '';
      return baseCwd ? `${baseCwd}/${entry.path}` : entry.path;
    },
    getExtraButtonHtml: (entry) => {
      const isDataFile = entry.type === 'file' && DATA_FILE_EXTS.has(entry.ext);
      if (!isDataFile) return '';
      return `<button class="file-tree-load-data-btn" title="Load to Data tab">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6"/><path d="M9 15h6"/><path d="M9 12h6"/></svg>
      </button>`;
    },
    extraButtonSelector: '.file-tree-load-data-btn',
    onExtra: async (entry) => {
      haptic();
      await loadFileToDataTab(entry.path);
    },
    onItemActivate: () => haptic(5),
    onDirectoryPathChanged: (path) => {
      currentPath = path;
      if (filePanelPath) filePanelPath.textContent = path || '.';
      if (filePanelUp) filePanelUp.disabled = !path;
    },
    renderEmpty: (container) => renderStandardEmpty(container, ICONS),
    renderError: (container, message, esc) => renderStandardError(container, message, esc, ICONS),
    ...feedbackHandlers,
    resolveUploadTargetPath: () => '',
    onViewerWillOpen: () => hideGranularToggle(),
    onViewerWillClose: () => {
      viewingDiff = null;
      hideGranularToggle();
    },
    isNavigationBlocked: () => viewingDiff,
    onNavigateHaptic: haptic,
  });
}

/**
 * Setup file browser event listeners
 */
export function setupFileBrowserEventListeners() {
  bindExplorerShellUi({
    upButton: filePanelUp,
    onUp: () => {
      if (!currentPath) return;
      const parent = currentPath.split('/').slice(0, -1).join('/');
      loadFileTree(parent);
    },
    refreshButton: filePanelRefreshBtn,
    onRefresh: async () => {
      haptic();
      await loadFileTree(currentPath);
      await explorerShell?.refreshOpenFile();
    },
    uploadButton: filePanelUploadBtn,
    fileInput: filePanelFileInput,
    onUploadFiles: (files) => uploadToFilePanel(files),
    dropZone: filesView,
    onDropFiles: (files) => uploadToFilePanel(files),
    viewerCloseButton: fileViewerClose,
    onViewerClose: () => {
      haptic();
      closeFileViewer();
    },
    viewer: fileViewer,
    onViewerKeydown: (e) => explorerShell?.handleViewerKeydown(e),
    onViewerTouchStart: (e) => explorerShell?.handleViewerTouchStart(e),
    onViewerTouchMove: (e) => explorerShell?.handleViewerTouchMove(e),
    onViewerTouchEnd: (e) => explorerShell?.handleViewerTouchEnd(e),
  });

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
  explorerShell?.setCurrentPath(path);
}

/**
 * Load the file tree for a given path
 */
export async function loadFileTree(subpath) {
  if (!fileBrowserContext.isAvailable()) return;
  await explorerShell?.loadDirectory(subpath);
}

/**
 * Upload files to conversation attachments
 */
async function uploadToFilePanel(files) {
  if (!fileBrowserContext.isAvailable()) return;
  await explorerShell?.uploadFiles(files);
}

/**
 * View a file
 */
export async function viewFile(filePath) {
  if (!fileBrowserContext.isAvailable()) return;
  await explorerShell?.viewFile(filePath);
}

/**
 * Close the file viewer
 */
export function closeFileViewer() {
  viewingDiff = null;
  explorerShell?.closeViewer();
}

/**
 * Check if file viewer is open
 */
export function isFileViewerOpen() {
  return explorerShell?.isViewerOpen() || false;
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
  if (!fileBrowserContext.isAvailable()) return;

  searchMode = true;
  fileTree.innerHTML = '<div class="file-tree-loading">Searching...</div>';

  const res = await apiFetch(fileBrowserContext.getFileSearchUrl(query), { silent: true });

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
