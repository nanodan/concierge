// --- Standalone Files View ---
// Browse files and git changes without a conversation context

import { escapeHtml, renderMarkdown } from './markdown.js';
import { haptic, showToast, showDialog, apiFetch, formatFileSize } from './utils.js';
import { getFileIcon, IMAGE_EXTS } from './file-utils.js';
import { ANIMATION_DELAY_SHORT, SLIDE_TRANSITION_DURATION, BUTTON_PROCESSING_TIMEOUT } from './constants.js';
import { createCwdContext } from './explorer/context.js';
import { sortEntries, deleteFilePath } from './explorer/files-core.js';
import { createExplorerShell } from './explorer/shell.js';
import { bindExplorerShellUi } from './explorer/shell-ui-bindings.js';
import { createGitDiffViewer } from './explorer/git-diff-viewer.js';
import { createGitHistoryController } from './explorer/git-history.js';
import { renderStashSection as renderSharedStashSection, bindStashListeners } from './explorer/git-stash.js';
import {
  createExplorerIcons,
  createExplorerFeedbackHandlers,
  renderStandardEmpty,
  renderStandardError,
} from './explorer/shell-presets.js';

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
let historyController = null;
let _viewingDiff = null;
let explorerShell = null;
let diffViewer = null;

// Icons (minimal set needed here)
const ICONS = createExplorerIcons({
  checkmark: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
});
const standaloneContext = createCwdContext(() => rootPath);

/**
 * Get git API URL for standalone mode
 */
function getGitApiUrl(endpoint) {
  return standaloneContext.getGitUrl(endpoint);
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
  diffViewer = createGitDiffViewer({
    fileViewer,
    fileViewerName,
    fileViewerContent,
    granularToggleBtn: document.getElementById('sa-diff-granular-toggle'),
    escapeHtml,
    haptic,
    showDialog,
    showToast,
    animationDelayMs: ANIMATION_DELAY_SHORT,
    getNavigationStatus: () => gitStatus,
    setViewingDiff: (diff) => { _viewingDiff = diff; },
    fetchDiff: async (filePath, staged) => {
      const res = await apiFetch(getGitApiUrl('diff'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, staged, cwd: rootPath }),
        silent: true,
      });
      if (!res) return { ok: false, error: 'Failed to load diff' };

      const data = await res.json();
      if (data.error) return { ok: false, error: data.error };
      return { ok: true, data };
    },
    revertDiffHunk: async (filePath, _hunkIndex, hunk, staged) => {
      const res = await apiFetch(getGitApiUrl('revert-hunk'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, hunk, staged, cwd: rootPath }),
      });
      if (!res) return { ok: false, error: 'Failed to revert hunk' };

      const data = await res.json();
      if (data.error) return { ok: false, error: data.error };
      return { ok: true };
    },
    closeAfterRevert: () => {
      closeFileViewer();
    },
    refreshAfterRevert: () => {
      loadGitStatus();
    },
  });
  const feedbackHandlers = createExplorerFeedbackHandlers({
    haptic,
    showDialog,
    showToast,
  });
  explorerShell = createExplorerShell({
    context: standaloneContext,
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
    transformEntries: (entries) => sortEntries(entries || []),
    onItemActivate: haptic,
    onDirectoryPathChanged: (path) => {
      currentPath = path;

      if (pathEl) {
        const displayPath = path.replace(/^\/(?:Users|home)\/[^/]+\/?/, '');
        pathEl.textContent = displayPath || '/';
      }
      if (upBtn) {
        upBtn.disabled = !path || path === rootPath;
      }
    },
    renderEmpty: (container) => renderStandardEmpty(container, ICONS),
    renderError: (container, message, esc) => renderStandardError(container, message, esc, ICONS, 'Failed to load directory'),
    ...feedbackHandlers,
    resolveUploadTargetPath: (path) => path,
    onViewerWillOpen: () => {
      if (granularToggleBtn) granularToggleBtn.classList.add('hidden');
    },
    onViewerWillClose: () => {
      diffViewer?.clearDiffState();
      if (granularToggleBtn) granularToggleBtn.classList.add('hidden');
    },
    isNavigationBlocked: () => _viewingDiff,
    onNavigateHaptic: haptic,
  });

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

  historyController = createGitHistoryController({
    historyList,
    fileViewer,
    fileViewerName,
    fileViewerContent,
    escapeHtml,
    renderDiff,
    haptic,
    showToast,
    showDialog,
    buttonProcessingTimeout: BUTTON_PROCESSING_TIMEOUT,
    animationDelayMs: ANIMATION_DELAY_SHORT,
    requestCommits: async () => {
      const res = await apiFetch(getGitApiUrl('commits'), { silent: true });
      if (!res) return { ok: false, error: 'Failed to load commits' };
      return { ok: true, data: await res.json() };
    },
    requestStatus: async () => {
      const res = await apiFetch(getGitApiUrl('status'), { silent: true });
      if (!res) return { ok: false, error: 'Failed to load git status' };
      return { ok: true, data: await res.json() };
    },
    requestUndoCommit: async () => {
      const res = await apiFetch(getGitApiUrl('undo-commit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: rootPath }),
      });
      if (!res) return { ok: false, error: 'Failed to undo commit' };
      return { ok: true, data: await res.json() };
    },
    requestRevertCommit: async (hash) => {
      const res = await apiFetch(getGitApiUrl('revert'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash, cwd: rootPath }),
      });
      if (!res) return { ok: false, error: 'Failed to revert commit' };
      return { ok: true, data: await res.json() };
    },
    requestResetCommit: async (hash, mode) => {
      const res = await apiFetch(getGitApiUrl('reset'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash, mode, cwd: rootPath }),
      });
      if (!res) return { ok: false, error: 'Failed to reset commit' };
      return { ok: true, data: await res.json() };
    },
    requestCommitDiff: async (hash) => {
      const res = await apiFetch(getGitApiUrl(`commits/${hash}`), { silent: true });
      if (!res) return { ok: false, error: 'Failed to load commit' };
      return { ok: true, data: await res.json() };
    },
    onUndoSuccess: () => {
      loadGitStatus();
    },
    onResetSuccess: () => {
      loadGitStatus();
    },
  });

  // Granular toggle
  granularToggleBtn = document.getElementById('sa-diff-granular-toggle');

  // Back button
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      haptic();
      closeStandaloneFiles();
    });
  }

  bindExplorerShellUi({
    upButton: upBtn,
    onUp: () => {
      if (!currentPath || currentPath === rootPath) return;
      const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
      loadDirectory(parent);
    },
    uploadButton: uploadBtn,
    fileInput,
    onUploadFiles: (files) => {
      haptic();
      uploadFiles(files);
    },
    dropZone: filesView,
    onDropFiles: (files) => uploadFiles(files),
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
  await explorerShell?.loadDirectory(path);
}

/**
 * Upload files to current directory
 */
async function uploadFiles(files) {
  if (!currentPath) return;
  await explorerShell?.uploadFiles(files);
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
  return renderSharedStashSection(stashes, escapeHtml);
}

function attachStashListeners() {
  bindStashListeners({
    changesList,
    haptic,
    showDialog,
    buttonProcessingTimeout: BUTTON_PROCESSING_TIMEOUT,
    onPop: handleStashPop,
    onApply: handleStashApply,
    onDrop: handleStashDrop,
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
  const result = await deleteFilePath(fullPath, apiFetch);
  if (!result.ok) {
    showToast(result.error || 'Delete failed', { variant: 'error' });
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
  await diffViewer?.openDiff(filePath, staged);
}

function renderDiff(data) {
  diffViewer?.renderDiff(data);
}

// === History Tab ===

async function loadCommits() {
  await historyController?.loadCommits();
}

// === File Viewer ===

/**
 * Close the file viewer
 */
function closeFileViewer() {
  if (!fileViewer) return;
  explorerShell?.closeViewer();
}
