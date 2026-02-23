// --- Standalone Files View ---
// Browse files and git changes without a conversation context

import { escapeHtml } from './markdown.js';
import { haptic, showToast, showDialog, apiFetch, formatFileSize } from './utils.js';
import { getFileIcon, IMAGE_EXTS } from './file-utils.js';
import { ANIMATION_DELAY_SHORT, SLIDE_TRANSITION_DURATION, BUTTON_PROCESSING_TIMEOUT } from './constants.js';

// DOM elements
let filesStandaloneView = null;
let listView = null;
let backBtn = null;
let titleEl = null;

// Tabs
let tabButtons = null;
let filesView = null;
let changesView = null;
let historyView = null;

// Files tab elements
let upBtn = null;
let pathEl = null;
let fileTree = null;
let uploadBtn = null;
let fileInput = null;

// Changes tab elements
let changesList = null;
let commitForm = null;
let commitMessage = null;
let commitBtn = null;
let branchSelector = null;
let aheadBehindBadge = null;
let pushBtn = null;
let pullBtn = null;
let stashBtn = null;
let gitRefreshBtn = null;

// History tab elements
let historyList = null;

// File viewer elements
let fileViewer = null;
let fileViewerName = null;
let fileViewerClose = null;
let fileViewerContent = null;
let granularToggleBtn = null;

// State
let currentPath = '';
let rootPath = '';
let _currentTab = 'files';
let gitStatus = null;
let stashes = null;
let commits = null;
let unpushedCount = 0;
let granularMode = localStorage.getItem('gitGranularMode') === 'true';
let currentDiffData = null;
let _viewingDiff = null;

// File navigation state
let viewableFiles = []; // List of files that can be viewed (non-directories)
let currentFileIndex = -1; // Index of currently viewed file
let touchStartX = 0;
let touchStartY = 0;
let touchMoveX = 0;
const SWIPE_THRESHOLD = 50; // Minimum swipe distance

// Icons (minimal set needed here)
const ICONS = {
  emptyFolder: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  error: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  checkmark: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
};

/**
 * Get git API URL for standalone mode
 */
function getGitApiUrl(endpoint) {
  return `/api/git/${endpoint}?cwd=${encodeURIComponent(rootPath)}`;
}

/**
 * Initialize the standalone files view
 */
export function initStandaloneFiles(elements) {
  filesStandaloneView = elements.filesStandaloneView;
  listView = elements.listView;
  backBtn = elements.backBtn;
  titleEl = elements.titleEl;
  upBtn = elements.upBtn;
  pathEl = elements.pathEl;
  fileTree = elements.fileTree;
  uploadBtn = document.getElementById('files-standalone-upload-btn');
  fileInput = document.getElementById('files-standalone-file-input');
  fileViewer = elements.fileViewer;
  fileViewerName = elements.fileViewerName;
  fileViewerClose = elements.fileViewerClose;
  fileViewerContent = elements.fileViewerContent;

  // Get tab elements
  tabButtons = document.querySelectorAll('#sa-file-panel-tabs .file-panel-tab');
  filesView = document.getElementById('sa-files-view');
  changesView = document.getElementById('sa-changes-view');
  historyView = document.getElementById('sa-history-view');

  // Git changes elements
  changesList = document.getElementById('sa-changes-list');
  commitForm = document.getElementById('sa-commit-form');
  commitMessage = document.getElementById('sa-commit-message');
  commitBtn = document.getElementById('sa-commit-btn');
  branchSelector = document.getElementById('sa-branch-selector');
  aheadBehindBadge = document.getElementById('sa-ahead-behind-badge');
  pushBtn = document.getElementById('sa-push-btn');
  pullBtn = document.getElementById('sa-pull-btn');
  stashBtn = document.getElementById('sa-stash-btn');
  gitRefreshBtn = document.getElementById('sa-git-refresh-btn');

  // History elements
  historyList = document.getElementById('sa-history-list');

  // Granular toggle
  granularToggleBtn = document.getElementById('sa-diff-granular-toggle');

  // Back button
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      haptic();
      closeStandaloneFiles();
    });
  }

  // Up button
  if (upBtn) {
    upBtn.addEventListener('click', () => {
      if (currentPath && currentPath !== rootPath) {
        const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
        loadDirectory(parent);
      }
    });
  }

  // Upload button
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => {
      haptic();
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) {
        uploadFiles(fileInput.files);
        fileInput.value = '';
      }
    });
  }

  // Drag and drop on files view
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
        uploadFiles(e.dataTransfer.files);
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

  // File viewer navigation - keyboard
  document.addEventListener('keydown', handleFileViewerKeydown);

  // File viewer navigation - swipe gestures
  if (fileViewer) {
    fileViewer.addEventListener('touchstart', handleFileViewerTouchStart, { passive: true });
    fileViewer.addEventListener('touchmove', handleFileViewerTouchMove, { passive: true });
    fileViewer.addEventListener('touchend', handleFileViewerTouchEnd, { passive: true });
  }

  // Tab switching
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  // Git action buttons
  if (gitRefreshBtn) {
    gitRefreshBtn.addEventListener('click', () => {
      haptic();
      loadGitStatus();
    });
  }

  if (commitBtn) {
    commitBtn.addEventListener('click', handleCommit);
  }

  if (pushBtn) {
    pushBtn.addEventListener('click', handlePush);
  }

  if (pullBtn) {
    pullBtn.addEventListener('click', handlePull);
  }

  if (stashBtn) {
    stashBtn.addEventListener('click', handleStash);
  }

  // Granular toggle
  if (granularToggleBtn) {
    granularToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      haptic();
      toggleGranularMode();
    });
  }

  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && filesStandaloneView && filesStandaloneView.classList.contains('slide-in')) {
      e.stopPropagation();
      if (fileViewer && !fileViewer.classList.contains('hidden')) {
        closeFileViewer();
      } else {
        closeStandaloneFiles();
      }
    }
  });
}

/**
 * Open the standalone files view for a given path
 */
export function openStandaloneFiles(path) {
  if (!filesStandaloneView) return;

  rootPath = path;
  currentPath = path;

  // Update title (show just the folder name)
  const folderName = path.split('/').pop() || 'Files';
  if (titleEl) {
    titleEl.textContent = folderName;
  }

  // Reset to files tab
  switchTab('files');

  // Push history state for Android back button
  history.pushState({ view: 'files-standalone' }, '', '#files');

  // Show view - use slide-in class which enables transform and pointer-events
  listView.classList.add('slide-out');
  filesStandaloneView.classList.add('slide-in');

  setTimeout(() => {
    listView.classList.remove('slide-out');
  }, 300);

  // Load directory
  loadDirectory(path);
}

/**
 * Close the standalone files view
 * @param {boolean} skipHistoryUpdate - If true, don't update browser history (used when triggered by popstate)
 */
export function closeStandaloneFiles(skipHistoryUpdate = false) {
  if (!filesStandaloneView) return;
  if (!filesStandaloneView.classList.contains('slide-in')) return; // Already closed

  // Close file viewer if open
  if (fileViewer && !fileViewer.classList.contains('hidden')) {
    fileViewer.classList.remove('open');
    fileViewer.classList.add('hidden');
  }

  // Remove slide-in to trigger transition back off-screen
  filesStandaloneView.classList.remove('slide-in');

  // Update history (unless triggered by popstate)
  if (!skipHistoryUpdate && history.state?.view === 'files-standalone') {
    history.back();
  }
}

/**
 * Switch between tabs
 */
function switchTab(tab) {
  _currentTab = tab;
  haptic();

  // Update tab button states
  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Show/hide views
  if (filesView) filesView.classList.toggle('hidden', tab !== 'files');
  if (changesView) changesView.classList.toggle('hidden', tab !== 'changes');
  if (historyView) historyView.classList.toggle('hidden', tab !== 'history');

  // Close file viewer when switching tabs
  if (fileViewer && !fileViewer.classList.contains('hidden')) {
    closeFileViewer();
  }

  // Load content for the tab
  if (tab === 'changes') {
    loadGitStatus();
  } else if (tab === 'history') {
    loadCommits();
  }
}

// === Files Tab ===

/**
 * Load a directory
 */
async function loadDirectory(path) {
  if (!fileTree) return;

  currentPath = path;
  fileTree.innerHTML = '<div class="file-tree-loading">Loading...</div>';

  // Update path display (show relative path from root, no ~ prefix)
  if (pathEl) {
    const displayPath = path.replace(/^\/(?:Users|home)\/[^/]+\/?/, '');
    pathEl.textContent = displayPath || '/';
  }

  // Update up button
  if (upBtn) {
    upBtn.disabled = !path || path === rootPath;
  }

  const res = await apiFetch(`/api/files?path=${encodeURIComponent(path)}`, { silent: true });
  if (!res) {
    fileTree.innerHTML = '<div class="file-tree-empty"><p>Failed to load directory</p></div>';
    return;
  }

  const data = await res.json();
  if (data.error) {
    fileTree.innerHTML = `<div class="file-tree-empty"><p>${escapeHtml(data.error)}</p></div>`;
    return;
  }

  renderFileTree(data.entries || []);
}

/**
 * Render the file tree
 */
function renderFileTree(entries) {
  // Reset viewable files list
  viewableFiles = [];
  currentFileIndex = -1;

  if (!entries || entries.length === 0) {
    fileTree.innerHTML = `
      <div class="file-tree-empty">
        ${ICONS.emptyFolder}
        <p>Empty folder</p>
      </div>`;
    return;
  }

  // Sort: directories first, then by name
  entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  // Build list of viewable (non-directory) files
  viewableFiles = entries.filter(e => e.type !== 'directory').map(e => e.path);

  fileTree.innerHTML = entries.map(entry => {
    const isDir = entry.type === 'directory';
    const ext = entry.name.split('.').pop()?.toLowerCase();
    const isImage = !isDir && IMAGE_EXTS.has(ext);

    // For images, show thumbnail
    if (isImage) {
      const imgUrl = `/api/files/download?path=${encodeURIComponent(entry.path)}&inline=true`;
      return `
        <div class="file-tree-item" data-path="${escapeHtml(entry.path)}" data-type="${entry.type}">
          <div class="file-tree-icon thumbnail"><img src="${imgUrl}" alt="" loading="lazy"></div>
          <span class="file-tree-name">${escapeHtml(entry.name)}</span>
          ${entry.size !== undefined ? `<span class="file-tree-meta">${formatFileSize(entry.size)}</span>` : ''}
          <button class="file-tree-delete-btn" data-path="${escapeHtml(entry.path)}" title="Delete">\u00d7</button>
        </div>`;
    }

    // Get icon using the proper API
    const iconInfo = getFileIcon({ type: entry.type, ext });

    return `
      <div class="file-tree-item" data-path="${escapeHtml(entry.path)}" data-type="${entry.type}">
        <span class="file-tree-icon ${iconInfo.class}">${iconInfo.svg}</span>
        <span class="file-tree-name">${escapeHtml(entry.name)}</span>
        ${!isDir && entry.size !== undefined ? `<span class="file-tree-meta">${formatFileSize(entry.size)}</span>` : ''}
        <button class="file-tree-delete-btn" data-path="${escapeHtml(entry.path)}" title="Delete">\u00d7</button>
      </div>`;
  }).join('');

  // Attach click handlers
  fileTree.querySelectorAll('.file-tree-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't navigate if clicking delete button
      if (e.target.closest('.file-tree-delete-btn')) return;
      haptic();
      const itemPath = item.dataset.path;
      const type = item.dataset.type;

      if (type === 'directory') {
        loadDirectory(itemPath);
      } else {
        viewFile(itemPath);
      }
    });
  });

  // Attach delete handlers
  fileTree.querySelectorAll('.file-tree-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const filePath = btn.dataset.path;
      const filename = filePath.split('/').pop();
      haptic();

      const confirmed = await showDialog({
        title: 'Delete file?',
        message: `Delete "${filename}"? This cannot be undone.`,
        danger: true,
        confirmLabel: 'Delete'
      });

      if (confirmed) {
        await deleteFile(filePath);
      }
    });
  });
}

/**
 * Delete a file or directory
 */
async function deleteFile(filePath) {
  const res = await apiFetch(`/api/files?path=${encodeURIComponent(filePath)}`, {
    method: 'DELETE'
  });

  if (!res) return;

  const data = await res.json();
  if (data.error) {
    showToast(data.error, { variant: 'error' });
    return;
  }

  showToast('Deleted');
  loadDirectory(currentPath);
}

/**
 * Upload files to current directory
 */
async function uploadFiles(files) {
  if (!currentPath) return;

  for (const file of files) {
    const url = `/api/files/upload?path=${encodeURIComponent(currentPath)}&filename=${encodeURIComponent(file.name)}`;
    const resp = await apiFetch(url, { method: 'POST', body: file });
    if (!resp) continue;
    showToast(`Uploaded ${file.name}`);
  }

  // Refresh directory to show new files
  loadDirectory(currentPath);
}

// === Changes Tab ===

/**
 * Load git status from server
 */
async function loadGitStatus() {
  if (changesList) {
    changesList.innerHTML = '<div class="changes-loading">Loading...</div>';
  }
  if (commitForm) {
    commitForm.classList.add('hidden');
  }

  const res = await apiFetch(getGitApiUrl('status'), { silent: true });
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

/**
 * Load stashes from server
 */
async function loadStashes() {
  const res = await apiFetch(getGitApiUrl('stash'), { silent: true });
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

/**
 * Render not a git repo message
 */
function renderNotARepo() {
  if (changesList) {
    changesList.innerHTML = `
      <div class="changes-empty">
        ${ICONS.error}
        <p>Not a git repository</p>
      </div>`;
  }
  if (branchSelector) branchSelector.classList.add('hidden');
  if (stashBtn) stashBtn.disabled = true;
  if (pushBtn) pushBtn.disabled = true;
  if (pullBtn) pullBtn.disabled = true;
}

/**
 * Render the changes view
 */
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
      if (ahead > 0) badgeHtml += `<span class="ahead">\u2191${ahead}</span>`;
      if (behind > 0) badgeHtml += `<span class="behind">\u2193${behind}</span>`;
      aheadBehindBadge.innerHTML = badgeHtml;
      aheadBehindBadge.classList.remove('hidden');
    } else {
      aheadBehindBadge.classList.add('hidden');
    }
  }

  // Update push/pull buttons
  if (pushBtn) {
    const canPush = hasOrigin && (!hasUpstream || ahead > 0);
    pushBtn.disabled = !canPush;
    pushBtn.title = !hasUpstream && hasOrigin ? 'Push and set upstream' :
      ahead > 0 ? `Push ${ahead} commit${ahead > 1 ? 's' : ''} to remote` : 'Push to remote';
  }
  if (pullBtn) {
    pullBtn.disabled = !hasUpstream || behind === 0;
    pullBtn.title = behind > 0 ? `Pull ${behind} commit${behind > 1 ? 's' : ''} from remote` : 'Pull from remote';
  }

  // Update stash button
  if (stashBtn) {
    stashBtn.disabled = !hasChanges;
    stashBtn.title = hasChanges ? 'Stash changes' : 'No changes to stash';
  }

  if (!hasChanges) {
    let cleanHtml = `
      <div class="changes-empty">
        ${ICONS.checkmark}
        <p>Working tree clean</p>
      </div>`;
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
          <button class="changes-section-btn" data-action="unstage-all" title="Unstage All">\u2212 All</button>
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

/**
 * Render a change item
 */
function renderChangeItem(file, type) {
  const statusLabels = {
    'M': 'modified', 'A': 'added', 'D': 'deleted',
    'R': 'renamed', 'C': 'copied', '?': 'untracked'
  };
  const statusLabel = statusLabels[file.status] || file.status;
  const normalizedPath = file.path.replace(/\/$/, '');
  const filename = normalizedPath.split('/').pop() + (file.path.endsWith('/') ? '/' : '');

  return `
    <div class="changes-item" data-path="${escapeHtml(file.path)}" data-type="${type}">
      <span class="status-badge status-${file.status.toLowerCase()}" title="${statusLabel}">${file.status}</span>
      <span class="changes-item-name" title="${escapeHtml(file.path)}">${escapeHtml(filename)}</span>
      <span class="changes-item-path">${escapeHtml(file.path)}</span>
      <div class="changes-item-actions">
        ${type === 'staged' ? `<button class="changes-action-btn" data-action="unstage" title="Unstage">\u2212</button>` : ''}
        ${type === 'unstaged' ? `<button class="changes-action-btn" data-action="stage" title="Stage">+</button>` : ''}
        ${type === 'unstaged' ? `<button class="changes-action-btn danger" data-action="discard" title="Discard">\u00d7</button>` : ''}
        ${type === 'untracked' ? `<button class="changes-action-btn" data-action="stage" title="Stage">+</button>` : ''}
        ${type === 'untracked' ? `<button class="changes-action-btn danger" data-action="delete" title="Delete">\u00d7</button>` : ''}
      </div>
    </div>`;
}

/**
 * Attach change item event listeners
 */
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

  // Action buttons
  changesList.querySelectorAll('.changes-action-btn').forEach(btn => {
    const handleAction = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (btn.dataset.processing === 'true') return;
      btn.dataset.processing = 'true';
      setTimeout(() => { btn.dataset.processing = 'false'; }, BUTTON_PROCESSING_TIMEOUT);

      const item = btn.closest('.changes-item');
      const filePath = item.dataset.path;
      const action = btn.dataset.action;
      haptic();

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
      } else if (action === 'delete') {
        const filename = filePath.split('/').pop();
        const confirmed = await showDialog({
          title: 'Delete file?',
          message: `Delete "${filename}"? This cannot be undone.`,
          danger: true,
          confirmLabel: 'Delete'
        });
        if (confirmed) {
          await deleteUntrackedFile(filePath);
        }
      }
    };

    btn.addEventListener('click', handleAction);
    btn.addEventListener('touchend', handleAction);
  });

  // Section buttons
  changesList.querySelectorAll('.changes-section-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      haptic();

      const action = btn.dataset.action;
      if (action === 'unstage-all' && gitStatus?.staged) {
        await unstageFiles(gitStatus.staged.map(f => f.path));
      } else if (action === 'stage-all-unstaged' && gitStatus?.unstaged) {
        await stageFiles(gitStatus.unstaged.map(f => f.path));
      } else if (action === 'stage-all-untracked' && gitStatus?.untracked) {
        await stageFiles(gitStatus.untracked.map(f => f.path));
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
              <button class="stash-action-btn" data-action="pop" title="Pop (apply and remove)">\u2191</button>
              <button class="stash-action-btn" data-action="apply" title="Apply (keep stash)">\u2713</button>
              <button class="stash-action-btn danger" data-action="drop" title="Drop">\u00d7</button>
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

      if (btn.dataset.processing === 'true') return;
      btn.dataset.processing = 'true';
      setTimeout(() => { btn.dataset.processing = 'false'; }, BUTTON_PROCESSING_TIMEOUT);

      const item = btn.closest('.stash-item');
      const index = parseInt(item.dataset.index, 10);
      const action = btn.dataset.action;
      haptic();

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
  haptic();

  const message = await showDialog({
    title: 'Stash changes',
    message: 'Enter an optional message for this stash:',
    input: true,
    inputPlaceholder: 'Stash message (optional)',
    confirmLabel: 'Stash'
  });

  if (message === false) return;

  const body = message ? { message } : {};
  const res = await apiFetch(getGitApiUrl('stash'), {
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
  const res = await apiFetch(getGitApiUrl('stash/pop'), {
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
  const res = await apiFetch(getGitApiUrl('stash/apply'), {
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
  const res = await apiFetch(getGitApiUrl('stash/drop'), {
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

// === Git Operations ===

async function stageFiles(paths) {
  const res = await apiFetch(getGitApiUrl('stage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, cwd: rootPath }),
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
  const res = await apiFetch(getGitApiUrl('unstage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, cwd: rootPath }),
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
  const res = await apiFetch(getGitApiUrl('discard'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, cwd: rootPath }),
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

async function deleteUntrackedFile(relativePath) {
  // Build full path from rootPath + relativePath
  const fullPath = `${rootPath}/${relativePath}`;
  const res = await apiFetch(`/api/files?path=${encodeURIComponent(fullPath)}`, {
    method: 'DELETE'
  });
  if (!res) return;
  const data = await res.json();

  if (data.error) {
    showToast(data.error, { variant: 'error' });
    return;
  }

  showToast('File deleted');
  loadGitStatus();
}

async function handleCommit() {
  if (!commitMessage) return;

  const message = commitMessage.value.trim();
  if (!message) {
    showToast('Enter a commit message');
    return;
  }

  commitBtn.disabled = true;
  haptic(15);

  const res = await apiFetch(getGitApiUrl('commit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, cwd: rootPath }),
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

async function handlePush() {
  haptic(15);
  pushBtn.disabled = true;

  const res = await apiFetch(getGitApiUrl('push'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: rootPath }),
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
  haptic(15);
  pullBtn.disabled = true;

  const res = await apiFetch(getGitApiUrl('pull'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: rootPath }),
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

// === Diff Viewer ===

async function viewDiff(filePath, staged) {
  const filename = filePath.split('/').pop();
  fileViewerName.textContent = filename;
  fileViewerContent.innerHTML = '<code>Loading diff...</code>';
  _viewingDiff = { path: filePath, staged };

  // Show viewer
  fileViewer.classList.remove('hidden');
  setTimeout(() => fileViewer.classList.add('open'), ANIMATION_DELAY_SHORT);

  const res = await apiFetch(getGitApiUrl('diff'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, staged, cwd: rootPath }),
    silent: true,
  });
  if (!res) {
    fileViewerContent.innerHTML = `<div class="file-viewer-error"><p>Failed to load diff</p></div>`;
    currentDiffData = null;
    return;
  }
  const data = await res.json();

  if (data.error) {
    fileViewerContent.innerHTML = `<div class="file-viewer-error"><p>${escapeHtml(data.error)}</p></div>`;
    currentDiffData = null;
    return;
  }

  if (!data.raw || data.raw.trim() === '') {
    fileViewerContent.innerHTML = `<div class="file-viewer-error"><p>No changes to display</p></div>`;
    currentDiffData = null;
    return;
  }

  currentDiffData = { ...data, path: filePath, staged };
  renderDiff(currentDiffData);
}

function toggleGranularMode() {
  granularMode = !granularMode;
  localStorage.setItem('gitGranularMode', granularMode.toString());
  updateGranularToggleState();
  if (currentDiffData) {
    renderDiff(currentDiffData);
  }
}

function updateGranularToggleState() {
  if (granularToggleBtn) {
    granularToggleBtn.classList.toggle('active', granularMode);
    granularToggleBtn.title = granularMode ? 'Switch to simple view' : 'Switch to granular view (per-hunk revert)';
  }
}

function renderDiff(data) {
  const { hunks, raw, path, staged } = data;
  const hasHunks = hunks && hunks.length > 0;

  if (granularToggleBtn) {
    granularToggleBtn.classList.toggle('hidden', !hasHunks);
    updateGranularToggleState();
  }

  if (granularMode && hasHunks) {
    renderHunksView(hunks, path, staged);
  } else {
    renderSimpleView(raw);
  }
}

function renderSimpleView(raw) {
  const lines = raw.split('\n');
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

function renderHunksView(hunks, filePath, staged) {
  let html = '';

  hunks.forEach((hunk, index) => {
    const headerMatch = hunk.header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)?/);
    const context = headerMatch && headerMatch[5] ? headerMatch[5].trim() : '';
    const lineInfo = `Lines ${hunk.oldStart}-${hunk.oldStart + hunk.oldLines - 1}`;

    let additions = 0, deletions = 0;
    for (const line of hunk.lines) {
      if (line.startsWith('+')) additions++;
      else if (line.startsWith('-')) deletions++;
    }

    html += `
      <div class="diff-hunk" data-hunk-index="${index}">
        <div class="diff-hunk-toolbar">
          <div class="diff-hunk-info">
            <span class="diff-hunk-lines">${lineInfo}</span>
            ${context ? `<span class="diff-hunk-context">${escapeHtml(context)}</span>` : ''}
            <span class="diff-hunk-stats">
              ${additions > 0 ? `<span class="diff-stat-add">+${additions}</span>` : ''}
              ${deletions > 0 ? `<span class="diff-stat-del">-${deletions}</span>` : ''}
            </span>
          </div>
          <button class="diff-hunk-revert-btn" data-hunk-index="${index}" title="Revert this change">
            Revert
          </button>
        </div>
        <code class="diff-hunk-code">`;

    for (const line of hunk.lines) {
      let className = 'diff-context';
      if (line.startsWith('+')) className = 'diff-add';
      else if (line.startsWith('-')) className = 'diff-del';
      html += `<div class="${className}">${escapeHtml(line)}</div>`;
    }

    html += `</code></div>`;
  });

  fileViewerContent.innerHTML = `<div class="diff-hunks-view">${html}</div>`;

  // Attach revert button listeners
  fileViewerContent.querySelectorAll('.diff-hunk-revert-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      haptic();

      const hunkIndex = parseInt(btn.dataset.hunkIndex, 10);
      const hunk = hunks[hunkIndex];
      await revertHunk(filePath, hunkIndex, hunk, staged);
    });
  });
}

async function revertHunk(filePath, hunkIndex, hunk, staged) {
  const confirmed = await showDialog({
    title: 'Revert this change?',
    message: 'This will undo just this section of changes.',
    danger: true,
    confirmLabel: 'Revert'
  });
  if (!confirmed) return;

  const res = await apiFetch(getGitApiUrl('revert-hunk'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, hunk, staged, cwd: rootPath })
  });

  if (!res) return;

  const data = await res.json();
  if (data.error) {
    showToast(data.error, 'error');
    return;
  }

  showToast('Change reverted');

  // Close the diff viewer and refresh git status
  closeFileViewer();
  loadGitStatus();
}

// === History Tab ===

async function loadCommits() {
  if (historyList) {
    historyList.innerHTML = '<div class="history-loading">Loading...</div>';
  }

  const [commitsRes, statusRes] = await Promise.all([
    apiFetch(getGitApiUrl('commits'), { silent: true }),
    apiFetch(getGitApiUrl('status'), { silent: true })
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

  html += `
    <div class="history-header">
      <span class="history-title">Commits</span>
      <button class="history-help-btn" aria-label="Show action legend" title="Action legend">?</button>
    </div>`;

  if (unpushedCount > 0) {
    html += `
      <div class="unpushed-header">
        <span class="unpushed-icon">\u2191</span>
        <span>${unpushedCount} unpushed commit${unpushedCount > 1 ? 's' : ''}</span>
      </div>`;
  }

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
          ${i === 0 ? '<button class="commit-action-btn" data-action="undo" title="Undo last commit (soft reset)">\u21b6</button>' : ''}
          <button class="commit-action-btn" data-action="revert" title="Revert this commit">\u21a9</button>
          <button class="commit-action-btn danger" data-action="reset" title="Reset to this commit">\u27f2</button>
        </div>
      </div>
    </div>`;
  }).join('');

  historyList.innerHTML = html;

  // Help button listener
  const helpBtn = historyList.querySelector('.history-help-btn');
  if (helpBtn) {
    helpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showGitLegendPopover(helpBtn);
    });
  }

  // Click handlers for viewing diffs
  historyList.querySelectorAll('.commit-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.commit-actions')) return;
      viewCommitDiff(item.dataset.hash);
    });
  });

  attachCommitActionListeners();
}

function attachCommitActionListeners() {
  if (!historyList) return;

  historyList.querySelectorAll('.commit-action-btn').forEach(btn => {
    const handleAction = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (btn.dataset.processing === 'true') return;
      btn.dataset.processing = 'true';
      setTimeout(() => { btn.dataset.processing = 'false'; }, BUTTON_PROCESSING_TIMEOUT);

      const item = btn.closest('.commit-item');
      const hash = item.dataset.hash;
      const action = btn.dataset.action;
      haptic();

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

  const res = await apiFetch(getGitApiUrl('undo-commit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: rootPath })
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

  const res = await apiFetch(getGitApiUrl('revert'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hash, cwd: rootPath })
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
  const mode = await showResetModeDialog(hash);
  if (!mode) return;

  if (mode === 'hard') {
    const confirmed = await showDialog({
      title: 'Hard reset?',
      message: 'This will PERMANENTLY DELETE all uncommitted changes.',
      danger: true,
      confirmLabel: 'Delete changes and reset'
    });
    if (!confirmed) return;
  }

  const res = await apiFetch(getGitApiUrl('reset'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hash, mode, cwd: rootPath })
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
                <span class="reset-mode-desc">Changes stay staged.</span>
              </div>
            </label>
            <label class="reset-mode-option">
              <input type="radio" name="reset-mode" value="mixed">
              <div class="reset-mode-info">
                <span class="reset-mode-name">Mixed</span>
                <span class="reset-mode-desc">Changes become unstaged.</span>
              </div>
            </label>
            <label class="reset-mode-option">
              <input type="radio" name="reset-mode" value="hard">
              <div class="reset-mode-info">
                <span class="reset-mode-name">Hard</span>
                <span class="reset-mode-desc danger-text">All changes deleted.</span>
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

    const cleanup = () => overlay.remove();

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

function showGitLegendPopover(anchorBtn) {
  const existing = document.querySelector('.git-legend-popover');
  if (existing) {
    existing.remove();
    return;
  }

  const popover = document.createElement('div');
  popover.className = 'git-legend-popover';
  popover.innerHTML = `
    <div class="git-legend-title">Commit Actions</div>
    <div class="git-legend-item">
      <span class="git-legend-icon">\u21b6</span>
      <div class="git-legend-content">
        <span class="git-legend-name">Undo</span>
        <span class="git-legend-desc">Remove last commit, keep changes staged</span>
      </div>
    </div>
    <div class="git-legend-item">
      <span class="git-legend-icon">\u21a9</span>
      <div class="git-legend-content">
        <span class="git-legend-name">Revert</span>
        <span class="git-legend-desc">Create new commit that undoes changes</span>
      </div>
    </div>
    <div class="git-legend-item">
      <span class="git-legend-icon danger">\u27f2</span>
      <div class="git-legend-content">
        <span class="git-legend-name">Reset</span>
        <span class="git-legend-desc">Move branch to this commit</span>
      </div>
    </div>
  `;

  const rect = anchorBtn.getBoundingClientRect();
  popover.style.top = `${rect.bottom + 4}px`;
  popover.style.right = `${window.innerWidth - rect.right}px`;

  document.body.appendChild(popover);
  anchorBtn.classList.add('active');

  const closePopover = () => {
    popover.remove();
    anchorBtn.classList.remove('active');
    document.removeEventListener('click', handleOutsideClick);
    document.removeEventListener('keydown', handleKeydown, true);
  };

  const handleOutsideClick = (e) => {
    if (!popover.contains(e.target) && e.target !== anchorBtn) {
      closePopover();
    }
  };

  const handleKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closePopover();
    }
  };

  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleKeydown, true);
  }, 0);
}

async function viewCommitDiff(hash) {
  haptic();

  fileViewerName.textContent = `${hash.slice(0, 7)}`;
  fileViewerContent.innerHTML = '<code>Loading...</code>';
  fileViewer.classList.remove('hidden');
  setTimeout(() => fileViewer.classList.add('open'), ANIMATION_DELAY_SHORT);

  const res = await apiFetch(getGitApiUrl(`commits/${hash}`), { silent: true });
  if (!res) {
    fileViewerContent.innerHTML = '<div class="file-viewer-error"><p>Failed to load commit</p></div>';
    return;
  }

  const data = await res.json();

  if (data.error) {
    fileViewerContent.innerHTML = `<div class="file-viewer-error"><p>${escapeHtml(data.error)}</p></div>`;
    return;
  }

  fileViewerName.textContent = `${hash.slice(0, 7)} - ${data.message}`;
  renderDiff(data);
}

// === File Viewer ===

async function viewFile(filePath) {
  if (!fileViewer) return;

  // Hide granular toggle for file views
  if (granularToggleBtn) {
    granularToggleBtn.classList.add('hidden');
  }

  // Track current file index for navigation
  currentFileIndex = viewableFiles.indexOf(filePath);

  const filename = filePath.split('/').pop();
  fileViewerName.textContent = filename;
  fileViewerContent.innerHTML = '<code>Loading...</code>';

  // Update navigation UI
  updateFileNavigation();

  // Show viewer
  fileViewer.classList.remove('hidden');
  setTimeout(() => fileViewer.classList.add('open'), ANIMATION_DELAY_SHORT);

  // Check if it's an image
  const ext = filename.split('.').pop()?.toLowerCase();
  if (IMAGE_EXTS.has(ext)) {
    const imgUrl = `/api/files/download?path=${encodeURIComponent(filePath)}&inline=true`;
    fileViewerContent.innerHTML = `
      <div class="file-viewer-preview">
        <img class="file-viewer-image" src="${imgUrl}" alt="${escapeHtml(filename)}">
      </div>`;
    return;
  }

  // Fetch file content
  const res = await apiFetch(`/api/files/download?path=${encodeURIComponent(filePath)}&inline=true`, { silent: true });
  if (!res) {
    fileViewerContent.innerHTML = '<div class="file-viewer-error"><p>Failed to load file</p></div>';
    return;
  }

  const contentType = res.headers.get('content-type') || '';

  // Binary file
  if (!contentType.includes('text') && !contentType.includes('json') && !contentType.includes('javascript')) {
    const downloadUrl = `/api/files/download?path=${encodeURIComponent(filePath)}`;
    fileViewerContent.innerHTML = `
      <div class="file-viewer-error">
        <p>Binary file</p>
        <a href="${downloadUrl}" class="file-viewer-open-btn" download="${escapeHtml(filename)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download
        </a>
      </div>`;
    return;
  }

  // Text file
  const text = await res.text();
  fileViewerContent.innerHTML = `<code>${escapeHtml(text)}</code>`;
}

// === File Navigation ===

/**
 * Update navigation UI (prev/next buttons, counter)
 */
function updateFileNavigation() {
  // Get or create navigation container
  let navContainer = fileViewer.querySelector('.file-viewer-nav');
  if (!navContainer) {
    navContainer = document.createElement('div');
    navContainer.className = 'file-viewer-nav';
    navContainer.innerHTML = `
      <button class="file-nav-btn file-nav-prev" aria-label="Previous file">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="file-nav-counter"></span>
      <button class="file-nav-btn file-nav-next" aria-label="Next file">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    `;
    // Insert after the header
    const header = fileViewer.querySelector('.file-viewer-header');
    if (header) {
      header.after(navContainer);
    }

    // Attach click handlers
    navContainer.querySelector('.file-nav-prev').addEventListener('click', (e) => {
      e.stopPropagation();
      haptic();
      navigateFile(-1);
    });
    navContainer.querySelector('.file-nav-next').addEventListener('click', (e) => {
      e.stopPropagation();
      haptic();
      navigateFile(1);
    });
  }

  // Update state
  const hasPrev = currentFileIndex > 0;
  const hasNext = currentFileIndex < viewableFiles.length - 1;
  const total = viewableFiles.length;

  navContainer.querySelector('.file-nav-prev').disabled = !hasPrev;
  navContainer.querySelector('.file-nav-next').disabled = !hasNext;
  navContainer.querySelector('.file-nav-counter').textContent = total > 1 ? `${currentFileIndex + 1} / ${total}` : '';

  // Show/hide based on whether there are multiple files
  navContainer.classList.toggle('hidden', total <= 1);
}

/**
 * Navigate to adjacent file
 * @param {number} direction - -1 for previous, 1 for next
 */
function navigateFile(direction) {
  const newIndex = currentFileIndex + direction;
  if (newIndex < 0 || newIndex >= viewableFiles.length) return;

  const newPath = viewableFiles[newIndex];
  viewFile(newPath);
}

/**
 * Handle keyboard navigation in file viewer
 */
function handleFileViewerKeydown(e) {
  if (!fileViewer || fileViewer.classList.contains('hidden')) return;
  if (_viewingDiff) return; // Don't navigate during diff view

  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    navigateFile(-1);
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    navigateFile(1);
  }
}

/**
 * Handle touch start for swipe navigation
 */
function handleFileViewerTouchStart(e) {
  if (_viewingDiff) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchMoveX = touchStartX;
}

/**
 * Handle touch move for swipe navigation
 */
function handleFileViewerTouchMove(e) {
  if (_viewingDiff) return;
  touchMoveX = e.touches[0].clientX;
}

/**
 * Handle touch end for swipe navigation
 */
function handleFileViewerTouchEnd(e) {
  if (_viewingDiff) return;
  if (!fileViewer || fileViewer.classList.contains('hidden')) return;

  const deltaX = touchMoveX - touchStartX;
  const deltaY = e.changedTouches[0].clientY - touchStartY;

  // Only trigger if horizontal swipe is greater than vertical (avoid scroll interference)
  if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
    haptic();
    if (deltaX > 0) {
      // Swipe right = previous
      navigateFile(-1);
    } else {
      // Swipe left = next
      navigateFile(1);
    }
  }

  touchStartX = 0;
  touchStartY = 0;
  touchMoveX = 0;
}

/**
 * Close the file viewer
 */
function closeFileViewer() {
  if (!fileViewer) return;

  fileViewer.classList.remove('open');
  _viewingDiff = null;
  currentDiffData = null;
  currentFileIndex = -1;
  if (granularToggleBtn) {
    granularToggleBtn.classList.add('hidden');
  }
  setTimeout(() => {
    fileViewer.classList.add('hidden');
    fileViewerContent.innerHTML = '<code></code>';
  }, SLIDE_TRANSITION_DURATION);
}
