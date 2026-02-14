// --- File Panel (Project Mode) ---
import { escapeHtml } from './markdown.js';
import { haptic, showToast, showDialog, apiFetch } from './utils.js';
import * as state from './state.js';

// DOM elements
let filePanel = null;
let filePanelBackdrop = null;
let filePanelClose = null;
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
let chatView = null;

// Tab elements
let _filePanelTabs = null;
let filesTab = null;
let changesTab = null;
let filesView = null;
let changesView = null;
let changesList = null;
let commitForm = null;
let commitMessage = null;
let commitBtn = null;
let branchSelector = null;
let branchDropdown = null;
let gitRefreshBtn = null;
let pushBtn = null;
let pullBtn = null;
let stashBtn = null;
let aheadBehindBadge = null;

// History tab elements
let historyTab = null;
let historyView = null;
let historyList = null;
let commits = null;
let unpushedCount = 0;

// Panel state
let currentPath = '';
let isOpen = false;
let isDragging = false;
let dragStartY = 0;
let dragStartHeight = 0;
let currentTab = 'files'; // 'files' | 'changes' | 'history'
let gitStatus = null;
let branches = null;
let stashes = null;
let _viewingDiff = null; // { path, staged }

// Search state
let _searchMode = false;
let searchResults = null;
let searchTimeout = null;

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
  fileSearchInput = elements.fileSearchInput;
  filePanelUploadBtn = elements.filePanelUploadBtn;
  filePanelFileInput = elements.filePanelFileInput;
  fileTree = elements.fileTree;
  fileViewer = elements.fileViewer;
  fileViewerName = elements.fileViewerName;
  fileViewerClose = elements.fileViewerClose;
  fileViewerContent = elements.fileViewerContent;
  chatView = elements.chatView;

  // Tab elements
  _filePanelTabs = elements.filePanelTabs;
  filesTab = elements.filesTab;
  changesTab = elements.changesTab;
  filesView = elements.filesView;
  changesView = elements.changesView;
  changesList = elements.changesList;
  commitForm = elements.commitForm;
  commitMessage = elements.commitMessage;
  commitBtn = elements.commitBtn;
  branchSelector = elements.branchSelector;
  branchDropdown = elements.branchDropdown;
  gitRefreshBtn = elements.gitRefreshBtn;
  pushBtn = elements.pushBtn;
  pullBtn = elements.pullBtn;
  stashBtn = elements.stashBtn;
  aheadBehindBadge = elements.aheadBehindBadge;

  // History tab elements
  historyTab = elements.historyTab;
  historyView = elements.historyView;
  historyList = elements.historyList;

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

  // Tab switching
  if (filesTab) {
    filesTab.addEventListener('click', () => switchTab('files'));
  }
  if (changesTab) {
    changesTab.addEventListener('click', () => switchTab('changes'));
  }
  if (historyTab) {
    historyTab.addEventListener('click', () => switchTab('history'));
  }

  // Branch selector
  if (branchSelector) {
    branchSelector.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleBranchDropdown();
    });
  }

  // Close branch dropdown when clicking outside
  document.addEventListener('click', () => {
    if (branchDropdown && !branchDropdown.classList.contains('hidden')) {
      branchDropdown.classList.add('hidden');
    }
  });

  // Commit button
  if (commitBtn) {
    commitBtn.addEventListener('click', handleCommit);
  }

  // Refresh button
  if (gitRefreshBtn) {
    gitRefreshBtn.addEventListener('click', () => {
      haptic(10);
      loadGitStatus();
      loadBranches();
    });
  }

  // Push button
  if (pushBtn) {
    pushBtn.addEventListener('click', handlePush);
  }

  // Pull button
  if (pullBtn) {
    pullBtn.addEventListener('click', handlePull);
  }

  // Stash button
  if (stashBtn) {
    stashBtn.addEventListener('click', handleStash);
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

  // Mobile drag gesture
  if (filePanel && isMobile()) {
    setupDragGesture();
  }

  // Desktop resize
  if (filePanel && !isMobile()) {
    setupDesktopResize();
  }

  // Handle resize
  window.addEventListener('resize', () => {
    if (isOpen && isMobile()) {
      setupDragGesture();
    }
  });

  // Refresh on visibility change (cross-device sync)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isOpen && currentTab === 'changes') {
      loadGitStatus();
      loadBranches();
    }
  });
}

// Desktop resize handle
let resizeHandle = null;
let isResizing = false;
let resizeStartX = 0;
let resizeStartWidth = 0;

function setupDesktopResize() {
  // Create resize handle if it doesn't exist
  if (!filePanel.querySelector('.file-panel-resize')) {
    resizeHandle = document.createElement('div');
    resizeHandle.className = 'file-panel-resize';
    filePanel.insertBefore(resizeHandle, filePanel.firstChild);
  } else {
    resizeHandle = filePanel.querySelector('.file-panel-resize');
  }

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeStartX = e.clientX;
    resizeStartWidth = filePanel.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const dx = resizeStartX - e.clientX;
    const newWidth = Math.max(280, Math.min(800, resizeStartWidth + dx));
    filePanel.style.width = newWidth + 'px';
    // Update CSS variable for margin adjustments
    document.documentElement.style.setProperty('--file-panel-width', newWidth + 'px');
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
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

  // Reset to files tab
  currentTab = 'files';
  if (filesTab) filesTab.classList.add('active');
  if (changesTab) changesTab.classList.remove('active');
  if (filesView) filesView.classList.remove('hidden');
  if (changesView) changesView.classList.add('hidden');

  // Reset git state
  gitStatus = null;
  branches = null;

  // Reset search state
  _searchMode = false;
  searchResults = null;
  if (fileSearchInput) {
    fileSearchInput.value = '';
  }

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

// Upload files to conversation attachments
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

export async function viewFile(filePath) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const filename = filePath.split('/').pop();
  fileViewerName.textContent = filename;
  fileViewerContent.innerHTML = '<code>Loading...</code>';

  // Show viewer
  fileViewer.classList.remove('hidden');
  setTimeout(() => fileViewer.classList.add('open'), 10);

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

function closeFileViewer() {
  fileViewer.classList.remove('open');
  _viewingDiff = null;
  setTimeout(() => {
    fileViewer.classList.add('hidden');
    fileViewerContent.innerHTML = '<code></code>';
  }, 300);
}

// === File Search ===

function handleSearchInput(e) {
  const query = e.target.value.trim();

  clearTimeout(searchTimeout);

  if (!query) {
    exitSearchMode();
    return;
  }

  searchTimeout = setTimeout(() => searchFiles(query), 300);
}

async function searchFiles(query) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  _searchMode = true;
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
  haptic(10);
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

function exitSearchMode() {
  _searchMode = false;
  searchResults = null;
  if (fileSearchInput) {
    fileSearchInput.value = '';
  }
  loadFileTree(currentPath);
}

// === Tab Switching ===

function switchTab(tab) {
  if (tab === currentTab) return;
  currentTab = tab;
  haptic(5);

  // Update tab buttons
  if (filesTab) filesTab.classList.toggle('active', tab === 'files');
  if (changesTab) changesTab.classList.toggle('active', tab === 'changes');
  if (historyTab) historyTab.classList.toggle('active', tab === 'history');

  // Update views
  if (filesView) filesView.classList.toggle('hidden', tab !== 'files');
  if (changesView) changesView.classList.toggle('hidden', tab !== 'changes');
  if (historyView) historyView.classList.toggle('hidden', tab !== 'history');

  // Reset search state when switching to files tab
  if (tab === 'files') {
    _searchMode = false;
    searchResults = null;
    if (fileSearchInput) {
      fileSearchInput.value = '';
    }
  }

  // Load content
  if (tab === 'files') {
    loadFileTree(currentPath);
  } else if (tab === 'changes') {
    loadGitStatus();
    loadBranches();
  } else if (tab === 'history') {
    loadCommits();
  }
}

// === Git Status ===

async function loadGitStatus() {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  if (changesList) {
    changesList.innerHTML = '<div class="changes-loading">Loading...</div>';
  }
  if (commitForm) {
    commitForm.classList.add('hidden');
  }

  const res = await apiFetch(`/api/conversations/${convId}/git/status`, { silent: true });
  if (!res) {
    if (changesList) {
      changesList.innerHTML = '<div class="changes-empty">Failed to load git status</div>';
    }
    return;
  }
  gitStatus = await res.json();

  if (!gitStatus.isRepo) {
    renderNotARepo();
    return;
  }

  // Load stashes in parallel with rendering
  loadStashes();
  renderChangesView();
}

async function loadStashes() {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/stash`, { silent: true });
  if (!res) {
    stashes = [];
    return;
  }
  const data = await res.json();
  stashes = data.stashes || [];

  // Re-render to show stashes
  if (gitStatus && gitStatus.isRepo) {
    renderChangesView();
  }
}

function renderNotARepo() {
  if (changesList) {
    changesList.innerHTML = `
      <div class="changes-empty">
        ${ICONS.error}
        <p>Not a git repository</p>
      </div>`;
  }
  if (branchSelector) {
    branchSelector.classList.add('hidden');
  }
  if (stashBtn) {
    stashBtn.disabled = true;
  }
  if (pushBtn) {
    pushBtn.disabled = true;
  }
  if (pullBtn) {
    pullBtn.disabled = true;
  }
}

function renderChangesView() {
  if (!gitStatus || !changesList) return;

  const { staged, unstaged, untracked, branch, ahead, behind, hasOrigin, hasUpstream } = gitStatus;
  const hasChanges = staged.length > 0 || unstaged.length > 0 || untracked.length > 0;

  // Update branch selector
  if (branchSelector) {
    branchSelector.classList.remove('hidden');
    branchSelector.querySelector('.branch-name').textContent = branch;
  }

  // Update ahead/behind badge
  if (aheadBehindBadge) {
    if (hasUpstream && (ahead > 0 || behind > 0)) {
      let badgeHtml = '';
      if (ahead > 0) {
        badgeHtml += `<span class="ahead">↑${ahead}</span>`;
      }
      if (behind > 0) {
        badgeHtml += `<span class="behind">↓${behind}</span>`;
      }
      aheadBehindBadge.innerHTML = badgeHtml;
      aheadBehindBadge.classList.remove('hidden');
    } else {
      aheadBehindBadge.classList.add('hidden');
    }
  }

  // Update push/pull buttons
  // Push: enabled if origin exists AND (no upstream yet OR ahead > 0)
  // Pull: enabled if upstream exists AND behind > 0
  if (pushBtn) {
    const canPush = hasOrigin && (!hasUpstream || ahead > 0);
    pushBtn.disabled = !canPush;
    if (!hasUpstream && hasOrigin) {
      pushBtn.title = 'Push and set upstream';
    } else if (ahead > 0) {
      pushBtn.title = `Push ${ahead} commit${ahead > 1 ? 's' : ''} to remote`;
    } else {
      pushBtn.title = 'Push to remote';
    }
  }
  if (pullBtn) {
    pullBtn.disabled = !hasUpstream || behind === 0;
    pullBtn.title = behind > 0 ? `Pull ${behind} commit${behind > 1 ? 's' : ''} from remote` : 'Pull from remote';
  }

  // Update stash button - enabled if there are changes to stash
  if (stashBtn) {
    stashBtn.disabled = !hasChanges;
    stashBtn.title = hasChanges ? 'Stash changes' : 'No changes to stash';
  }

  if (!hasChanges) {
    let cleanHtml = `
      <div class="changes-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <p>Working tree clean</p>
      </div>`;
    // Still show stashes even when working tree is clean
    if (stashes && stashes.length > 0) {
      cleanHtml += renderStashSection();
    }
    changesList.innerHTML = cleanHtml;
    attachStashListeners();
    if (commitForm) commitForm.classList.add('hidden');
    return;
  }

  let html = '';

  // Staged section
  if (staged.length > 0) {
    html += `
      <div class="changes-section">
        <div class="changes-section-header">
          <span class="changes-section-title">Staged Changes</span>
          <span class="changes-section-count">${staged.length}</span>
          <button class="changes-section-btn" data-action="unstage-all" title="Unstage All">− All</button>
        </div>
        ${staged.map(f => renderChangeItem(f, 'staged')).join('')}
      </div>`;
  }

  // Unstaged section
  if (unstaged.length > 0) {
    html += `
      <div class="changes-section">
        <div class="changes-section-header">
          <span class="changes-section-title">Changes</span>
          <span class="changes-section-count">${unstaged.length}</span>
          <button class="changes-section-btn" data-action="stage-all-unstaged" title="Stage All">+ All</button>
        </div>
        ${unstaged.map(f => renderChangeItem(f, 'unstaged')).join('')}
      </div>`;
  }

  // Untracked section
  if (untracked.length > 0) {
    html += `
      <div class="changes-section">
        <div class="changes-section-header">
          <span class="changes-section-title">Untracked Files</span>
          <span class="changes-section-count">${untracked.length}</span>
          <button class="changes-section-btn" data-action="stage-all-untracked" title="Stage All">+ All</button>
        </div>
        ${untracked.map(f => renderChangeItem({ ...f, status: '?' }, 'untracked')).join('')}
      </div>`;
  }

  // Stash section
  if (stashes && stashes.length > 0) {
    html += renderStashSection();
  }

  changesList.innerHTML = html;
  attachChangeItemListeners();
  attachStashListeners();

  // Show commit form if there are staged changes
  if (commitForm) {
    commitForm.classList.toggle('hidden', staged.length === 0);
  }
}

function renderChangeItem(file, type) {
  const statusLabels = {
    'M': 'modified',
    'A': 'added',
    'D': 'deleted',
    'R': 'renamed',
    'C': 'copied',
    '?': 'untracked'
  };
  const statusLabel = statusLabels[file.status] || file.status;
  const filename = file.path.split('/').pop();

  return `
    <div class="changes-item" data-path="${escapeHtml(file.path)}" data-type="${type}">
      <span class="status-badge status-${file.status.toLowerCase()}" title="${statusLabel}">${file.status}</span>
      <span class="changes-item-name" title="${escapeHtml(file.path)}">${escapeHtml(filename)}</span>
      <span class="changes-item-path">${escapeHtml(file.path)}</span>
      <div class="changes-item-actions">
        ${type === 'staged' ? `<button class="changes-action-btn" data-action="unstage" title="Unstage">−</button>` : ''}
        ${type === 'unstaged' ? `<button class="changes-action-btn" data-action="stage" title="Stage">+</button>` : ''}
        ${type === 'unstaged' ? `<button class="changes-action-btn danger" data-action="discard" title="Discard">×</button>` : ''}
        ${type === 'untracked' ? `<button class="changes-action-btn" data-action="stage" title="Stage">+</button>` : ''}
      </div>
    </div>`;
}

function attachChangeItemListeners() {
  if (!changesList) return;

  // Click on item to view diff
  changesList.querySelectorAll('.changes-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.changes-action-btn')) return;
      const filePath = item.dataset.path;
      const type = item.dataset.type;
      if (type !== 'untracked') {
        viewDiff(filePath, type === 'staged');
      }
    });
  });

  // Action buttons - handle both click and touchend for mobile reliability
  changesList.querySelectorAll('.changes-action-btn').forEach(btn => {
    const handleAction = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Prevent double-firing from both touch and click
      if (btn.dataset.processing === 'true') return;
      btn.dataset.processing = 'true';
      setTimeout(() => { btn.dataset.processing = 'false'; }, 300);

      const item = btn.closest('.changes-item');
      const filePath = item.dataset.path;
      const action = btn.dataset.action;
      haptic(10);

      if (action === 'stage') {
        await stageFiles([filePath]);
      } else if (action === 'unstage') {
        await unstageFiles([filePath]);
      } else if (action === 'discard') {
        const confirmed = await showDialog({
          title: 'Discard changes?',
          message: `Discard all changes to ${filePath}?`,
          danger: true,
          confirmLabel: 'Discard'
        });
        if (confirmed) {
          await discardChanges([filePath]);
        }
      }
    };

    btn.addEventListener('click', handleAction);
    btn.addEventListener('touchend', handleAction);
  });

  // Section buttons (Stage All / Unstage All)
  changesList.querySelectorAll('.changes-section-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      haptic(10);

      const action = btn.dataset.action;
      if (action === 'unstage-all' && gitStatus?.staged) {
        const paths = gitStatus.staged.map(f => f.path);
        await unstageFiles(paths);
      } else if (action === 'stage-all-unstaged' && gitStatus?.unstaged) {
        const paths = gitStatus.unstaged.map(f => f.path);
        await stageFiles(paths);
      } else if (action === 'stage-all-untracked' && gitStatus?.untracked) {
        const paths = gitStatus.untracked.map(f => f.path);
        await stageFiles(paths);
      }
    });
  });
}

// === Stash Functions ===

function renderStashSection() {
  if (!stashes || stashes.length === 0) return '';

  return `
    <div class="stash-section">
      <div class="stash-section-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6"/><path d="M9 15h6"/></svg>
        <span class="stash-section-title">Stashes</span>
        <span class="stash-section-count">${stashes.length}</span>
      </div>
      <div class="stash-list">
        ${stashes.map(s => `
          <div class="stash-item" data-index="${s.index}">
            <span class="stash-message">${escapeHtml(s.message)}</span>
            <span class="stash-time">${escapeHtml(s.time)}</span>
            <div class="stash-actions">
              <button class="stash-action-btn" data-action="pop" title="Pop (apply and remove)">↑</button>
              <button class="stash-action-btn" data-action="apply" title="Apply (keep stash)">✓</button>
              <button class="stash-action-btn danger" data-action="drop" title="Drop">×</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function attachStashListeners() {
  if (!changesList) return;

  changesList.querySelectorAll('.stash-action-btn').forEach(btn => {
    const handleAction = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Prevent double-firing from both touch and click
      if (btn.dataset.processing === 'true') return;
      btn.dataset.processing = 'true';
      setTimeout(() => { btn.dataset.processing = 'false'; }, 300);

      const item = btn.closest('.stash-item');
      const index = parseInt(item.dataset.index, 10);
      const action = btn.dataset.action;
      haptic(10);

      if (action === 'pop') {
        await handleStashPop(index);
      } else if (action === 'apply') {
        await handleStashApply(index);
      } else if (action === 'drop') {
        const confirmed = await showDialog({
          title: 'Drop stash?',
          message: 'This will permanently delete the stash. This cannot be undone.',
          danger: true,
          confirmLabel: 'Drop'
        });
        if (confirmed) {
          await handleStashDrop(index);
        }
      }
    };

    btn.addEventListener('click', handleAction);
    btn.addEventListener('touchend', handleAction);
  });
}

async function handleStash() {
  haptic(10);

  const message = await showDialog({
    title: 'Stash changes',
    message: 'Enter an optional message for this stash:',
    input: true,
    inputPlaceholder: 'Stash message (optional)',
    confirmLabel: 'Stash'
  });

  // User cancelled
  if (message === false) return;

  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const body = message ? { message } : {};
  const res = await apiFetch(`/api/conversations/${convId}/git/stash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res) return;

  const data = await res.json();
  if (data.error) {
    showToast(data.error, 'error');
    return;
  }

  showToast('Changes stashed', 'success');
  loadGitStatus();
}

async function handleStashPop(index) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/stash/pop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index })
  });

  if (!res) return;

  const data = await res.json();
  if (data.error) {
    showToast(data.error, 'error');
    return;
  }

  showToast('Stash applied and removed', 'success');
  loadGitStatus();
}

async function handleStashApply(index) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/stash/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index })
  });

  if (!res) return;

  const data = await res.json();
  if (data.error) {
    showToast(data.error, 'error');
    return;
  }

  showToast('Stash applied', 'success');
  loadGitStatus();
}

async function handleStashDrop(index) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/stash/drop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index })
  });

  if (!res) return;

  const data = await res.json();
  if (data.error) {
    showToast(data.error, 'error');
    return;
  }

  showToast('Stash dropped', 'success');
  loadGitStatus();
}

// === Commit Actions ===

function attachCommitActionListeners() {
  if (!historyList) return;

  historyList.querySelectorAll('.commit-action-btn').forEach(btn => {
    const handleAction = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Prevent double-firing from both touch and click
      if (btn.dataset.processing === 'true') return;
      btn.dataset.processing = 'true';
      setTimeout(() => { btn.dataset.processing = 'false'; }, 300);

      const item = btn.closest('.commit-item');
      const hash = item.dataset.hash;
      const action = btn.dataset.action;
      haptic(10);

      if (action === 'undo') {
        await handleUndoCommit();
      } else if (action === 'revert') {
        await handleRevert(hash);
      } else if (action === 'reset') {
        await handleReset(hash);
      }
    };

    btn.addEventListener('click', handleAction);
    btn.addEventListener('touchend', handleAction);
  });
}

async function handleUndoCommit() {
  const confirmed = await showDialog({
    title: 'Undo last commit?',
    message: 'The commit will be removed but changes will remain staged.',
    confirmLabel: 'Undo',
    danger: true
  });

  if (!confirmed) return;

  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/undo-commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res) return;

  const data = await res.json();
  if (data.error) {
    showToast(data.error, 'error');
    return;
  }

  showToast('Commit undone', 'success');
  loadGitStatus();
  loadCommits();
}

async function handleRevert(hash) {
  const confirmed = await showDialog({
    title: 'Revert commit?',
    message: `This will create a new commit that undoes the changes from ${hash.slice(0, 7)}.`,
    confirmLabel: 'Revert',
    danger: true
  });

  if (!confirmed) return;

  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/revert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hash })
  });

  if (!res) return;

  const data = await res.json();
  if (data.error) {
    showToast(data.error, 'error');
    return;
  }

  showToast('Commit reverted', 'success');
  loadCommits();
}

async function handleReset(hash) {
  // Show reset mode selection dialog
  const mode = await showResetModeDialog(hash);
  if (!mode) return;

  // Extra confirmation for hard reset
  if (mode === 'hard') {
    const confirmed = await showDialog({
      title: 'Hard reset?',
      message: 'This will PERMANENTLY DELETE all uncommitted changes. This cannot be undone.',
      danger: true,
      confirmLabel: 'Delete changes and reset'
    });
    if (!confirmed) return;
  }

  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hash, mode })
  });

  if (!res) return;

  const data = await res.json();
  if (data.error) {
    showToast(data.error, 'error');
    return;
  }

  showToast(`Reset to ${hash.slice(0, 7)} (${mode})`, 'success');
  loadGitStatus();
  loadCommits();
}

function showResetModeDialog(hash) {
  return new Promise((resolve) => {
    // Create dialog overlay
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog-title">Reset to ${hash.slice(0, 7)}?</div>
        <div class="dialog-body">
          <div class="reset-mode-options">
            <label class="reset-mode-option">
              <input type="radio" name="reset-mode" value="soft" checked>
              <div class="reset-mode-info">
                <span class="reset-mode-name">Soft</span>
                <span class="reset-mode-desc">Keep changes staged</span>
              </div>
            </label>
            <label class="reset-mode-option">
              <input type="radio" name="reset-mode" value="mixed">
              <div class="reset-mode-info">
                <span class="reset-mode-name">Mixed</span>
                <span class="reset-mode-desc">Keep changes unstaged</span>
              </div>
            </label>
            <label class="reset-mode-option">
              <input type="radio" name="reset-mode" value="hard">
              <div class="reset-mode-info">
                <span class="reset-mode-name">Hard</span>
                <span class="reset-mode-desc danger-text">Discard all changes</span>
              </div>
            </label>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn-secondary dialog-cancel">Cancel</button>
          <button class="btn-primary dialog-ok">Reset</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cleanup = () => {
      overlay.remove();
    };

    overlay.querySelector('.dialog-cancel').addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    overlay.querySelector('.dialog-ok').addEventListener('click', () => {
      const selected = overlay.querySelector('input[name="reset-mode"]:checked');
      const mode = selected ? selected.value : 'soft';
      cleanup();
      resolve(mode);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });
  });
}

// === Diff Viewer ===

async function viewDiff(filePath, staged) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const filename = filePath.split('/').pop();
  fileViewerName.textContent = filename;
  fileViewerContent.innerHTML = '<code>Loading diff...</code>';
  _viewingDiff = { path: filePath, staged };

  // Show viewer
  fileViewer.classList.remove('hidden');
  setTimeout(() => fileViewer.classList.add('open'), 10);

  const res = await apiFetch(`/api/conversations/${convId}/git/diff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, staged }),
    silent: true,
  });
  if (!res) {
    fileViewerContent.innerHTML = `<div class="file-viewer-error"><p>Failed to load diff</p></div>`;
    return;
  }
  const data = await res.json();

  if (data.error) {
    fileViewerContent.innerHTML = `<div class="file-viewer-error"><p>${escapeHtml(data.error)}</p></div>`;
    return;
  }

  if (!data.raw || data.raw.trim() === '') {
    fileViewerContent.innerHTML = `<div class="file-viewer-error"><p>No changes to display</p></div>`;
    return;
  }

  renderDiff(data);
}

function renderDiff(data) {
  const lines = data.raw.split('\n');
  let html = '';

  for (const line of lines) {
    let className = 'diff-context';
    if (line.startsWith('+') && !line.startsWith('+++')) {
      className = 'diff-add';
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      className = 'diff-del';
    } else if (line.startsWith('@@')) {
      className = 'diff-hunk-header';
    } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
      className = 'diff-meta';
    }

    html += `<div class="${className}">${escapeHtml(line)}</div>`;
  }

  fileViewerContent.innerHTML = `<code class="diff-view">${html}</code>`;
}

// === Commit History ===

async function loadCommits() {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  if (historyList) {
    historyList.innerHTML = '<div class="history-loading">Loading...</div>';
  }

  // Fetch commits and status in parallel
  const [commitsRes, statusRes] = await Promise.all([
    apiFetch(`/api/conversations/${convId}/git/commits`, { silent: true }),
    apiFetch(`/api/conversations/${convId}/git/status`, { silent: true })
  ]);

  if (!commitsRes) {
    if (historyList) {
      historyList.innerHTML = '<div class="history-empty">Failed to load commits</div>';
    }
    return;
  }

  const data = await commitsRes.json();

  if (data.error) {
    if (historyList) {
      historyList.innerHTML = `<div class="history-empty">${escapeHtml(data.error)}</div>`;
    }
    return;
  }

  // Get unpushed count from status
  unpushedCount = 0;
  if (statusRes) {
    const statusData = await statusRes.json();
    if (statusData.isRepo && statusData.hasUpstream) {
      unpushedCount = statusData.ahead || 0;
    }
  }

  commits = data.commits;
  renderHistoryView();
}

function renderHistoryView() {
  if (!historyList) return;

  if (!commits || commits.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No commits yet</div>';
    return;
  }

  let html = '';

  // Show unpushed commits header if there are any
  if (unpushedCount > 0) {
    html += `
      <div class="unpushed-header">
        <span class="unpushed-icon">↑</span>
        <span>${unpushedCount} unpushed commit${unpushedCount > 1 ? 's' : ''}</span>
      </div>`;
  }

  // Render commits, marking unpushed ones
  html += commits.map((c, i) => {
    const isUnpushed = i < unpushedCount;
    return `
    <div class="commit-item${isUnpushed ? ' unpushed' : ''}" data-hash="${c.hash}">
      <div class="commit-header">
        <span class="commit-hash">${c.hash.slice(0, 7)}</span>
        ${isUnpushed ? '<span class="unpushed-badge">unpushed</span>' : ''}
        <span class="commit-time">${escapeHtml(c.time)}</span>
      </div>
      <div class="commit-message">${escapeHtml(c.message)}</div>
      <div class="commit-footer">
        <span class="commit-author">${escapeHtml(c.author)}</span>
        <div class="commit-actions">
          ${i === 0 ? '<button class="commit-action-btn" data-action="undo" title="Undo last commit (soft reset)">↶</button>' : ''}
          <button class="commit-action-btn" data-action="revert" title="Revert this commit">↩</button>
          <button class="commit-action-btn danger" data-action="reset" title="Reset to this commit">⟲</button>
        </div>
      </div>
    </div>`;
  }).join('');

  historyList.innerHTML = html;

  // Attach click handlers for viewing diffs
  historyList.querySelectorAll('.commit-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't trigger if clicking action buttons
      if (e.target.closest('.commit-actions')) return;
      viewCommitDiff(item.dataset.hash);
    });
  });

  // Attach commit action listeners
  attachCommitActionListeners();
}

async function viewCommitDiff(hash) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  haptic(10);

  // Show loading state in viewer
  fileViewerName.textContent = `${hash.slice(0, 7)}`;
  fileViewerContent.innerHTML = '<code>Loading...</code>';
  fileViewer.classList.remove('hidden');
  setTimeout(() => fileViewer.classList.add('open'), 10);

  const res = await apiFetch(`/api/conversations/${convId}/git/commits/${hash}`, { silent: true });
  if (!res) {
    fileViewerContent.innerHTML = '<div class="file-viewer-error"><p>Failed to load commit</p></div>';
    return;
  }

  const data = await res.json();

  if (data.error) {
    fileViewerContent.innerHTML = `<div class="file-viewer-error"><p>${escapeHtml(data.error)}</p></div>`;
    return;
  }

  // Update header with commit info
  fileViewerName.textContent = `${hash.slice(0, 7)} - ${data.message}`;

  // Render the diff
  renderDiff(data);
}

// === Git Operations ===

async function stageFiles(paths) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/stage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  if (!res) return;
  const data = await res.json();

  if (data.error) {
    showToast(data.error, { variant: 'error' });
    return;
  }

  showToast('Staged');
  loadGitStatus();
}

async function unstageFiles(paths) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/unstage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  if (!res) return;
  const data = await res.json();

  if (data.error) {
    showToast(data.error, { variant: 'error' });
    return;
  }

  showToast('Unstaged');
  loadGitStatus();
}

async function discardChanges(paths) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/discard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  if (!res) return;
  const data = await res.json();

  if (data.error) {
    showToast(data.error, { variant: 'error' });
    return;
  }

  showToast('Changes discarded');
  loadGitStatus();
}

async function handleCommit() {
  const convId = state.getCurrentConversationId();
  if (!convId || !commitMessage) return;

  const message = commitMessage.value.trim();
  if (!message) {
    showToast('Enter a commit message');
    return;
  }

  commitBtn.disabled = true;
  haptic(15);

  const res = await apiFetch(`/api/conversations/${convId}/git/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  commitBtn.disabled = false;
  if (!res) return;
  const data = await res.json();

  if (data.error) {
    showToast(data.error, { variant: 'error' });
    return;
  }

  showToast(`Committed ${data.hash}`);
  commitMessage.value = '';
  loadGitStatus();
}

// === Push/Pull Operations ===

async function handlePush() {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  haptic(15);
  pushBtn.disabled = true;

  const res = await apiFetch(`/api/conversations/${convId}/git/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res) {
    pushBtn.disabled = false;
    return;
  }

  const data = await res.json();

  if (data.error) {
    showToast(data.error, { variant: 'error' });
    pushBtn.disabled = false;
    return;
  }

  showToast('Pushed successfully');
  loadGitStatus();
}

async function handlePull() {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  haptic(15);
  pullBtn.disabled = true;

  const res = await apiFetch(`/api/conversations/${convId}/git/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res) {
    pullBtn.disabled = false;
    return;
  }

  const data = await res.json();

  if (data.error) {
    showToast(data.error, { variant: 'error' });
    pullBtn.disabled = false;
    return;
  }

  showToast('Pulled successfully');
  loadGitStatus();
}

// === Branch Management ===

async function loadBranches() {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/branches`, { silent: true });
  if (!res) {
    branches = null;
    return;
  }
  branches = await res.json();

  if (branches.error) {
    branches = null;
  }
}

async function toggleBranchDropdown() {
  if (!branchDropdown) return;
  haptic(5);

  const isHidden = branchDropdown.classList.contains('hidden');
  if (isHidden) {
    // Load branches if not already loaded
    if (!branches) {
      branchDropdown.innerHTML = '<div class="branch-item">Loading...</div>';
      branchDropdown.classList.remove('hidden');
      await loadBranches();
      if (!branches) {
        branchDropdown.innerHTML = '<div class="branch-item">Failed to load branches</div>';
        return;
      }
    }
    renderBranchDropdown();
    branchDropdown.classList.remove('hidden');
  } else {
    branchDropdown.classList.add('hidden');
  }
}

function renderBranchDropdown() {
  if (!branchDropdown || !branches) return;

  let html = '';

  // Local branches
  for (const branch of branches.local) {
    const isCurrent = branch === branches.current;
    html += `
      <div class="branch-item ${isCurrent ? 'current' : ''}" data-branch="${escapeHtml(branch)}">
        ${isCurrent ? '<span class="branch-check">✓</span>' : ''}
        <span class="branch-name">${escapeHtml(branch)}</span>
      </div>`;
  }

  // Remote branches (excluding those that match local)
  const remoteOnly = branches.remote.filter(r => {
    const shortName = r.split('/').slice(1).join('/');
    return !branches.local.includes(shortName);
  });

  if (remoteOnly.length > 0) {
    html += '<div class="branch-divider"></div>';
    for (const branch of remoteOnly) {
      html += `
        <div class="branch-item remote" data-branch="${escapeHtml(branch)}">
          <span class="branch-name">${escapeHtml(branch)}</span>
        </div>`;
    }
  }

  // New branch option
  html += `
    <div class="branch-divider"></div>
    <div class="branch-item new-branch" data-action="new">
      <span class="branch-name">+ New branch</span>
    </div>`;

  branchDropdown.innerHTML = html;

  // Attach listeners
  branchDropdown.querySelectorAll('.branch-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      branchDropdown.classList.add('hidden');

      if (item.dataset.action === 'new') {
        const name = await showDialog({
          title: 'New branch',
          message: 'Enter branch name:',
          input: true,
          placeholder: 'feature/my-branch'
        });
        if (name) {
          await createBranch(name, true);
        }
      } else if (!item.classList.contains('current')) {
        const branch = item.dataset.branch;
        await checkoutBranch(branch);
      }
    });
  });
}

async function createBranch(name, checkout) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/branch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, checkout }),
  });
  if (!res) return;
  const data = await res.json();

  if (data.error) {
    showToast(data.error, { variant: 'error' });
    return;
  }

  showToast(`Created ${name}`);
  loadGitStatus();
  loadBranches();
}

async function checkoutBranch(branch) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  });
  if (!res) return;
  const data = await res.json();

  if (data.error) {
    showToast(data.error, { variant: 'error' });
    return;
  }

  showToast(`Switched to ${branch}`);
  loadGitStatus();
  loadBranches();
}

export function isFilePanelOpen() {
  return isOpen;
}

export function isFileViewerOpen() {
  return fileViewer && fileViewer.classList.contains('open');
}

export { closeFileViewer };
