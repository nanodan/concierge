// --- Standalone Files View ---
// Browse files and git changes without a conversation context

import { escapeHtml, renderMarkdown } from './markdown.js';
import { haptic, showToast, showDialog, apiFetch, formatFileSize } from './utils.js';
import { getFileIcon, IMAGE_EXTS } from './file-utils.js';
import { ANIMATION_DELAY_SHORT, SLIDE_TRANSITION_DURATION, BUTTON_PROCESSING_TIMEOUT } from './constants.js';
import { createCwdContext } from './explorer/context.js';
import { sortEntries } from './explorer/files-core.js';
import { createExplorerShell } from './explorer/shell.js';
import { bindExplorerShellUi } from './explorer/shell-ui-bindings.js';
import { createGitDiffViewer } from './explorer/git-diff-viewer.js';
import { createGitHistoryController } from './explorer/git-history.js';
import { createGitChangesController } from './explorer/git-changes-controller.js';
import { createGitStashActions } from './explorer/git-stash-actions.js';
import { createGitBranchesController } from './explorer/git-branches-controller.js';
import {
  createGitStashRequests,
  createGitChangesRequests,
  createGitHistoryRequests,
  createGitBranchRequests,
  createWorkflowPatchRequests,
} from './explorer/git-requests.js';
import { createExplorerHost } from './explorer/host.js';
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
let fileRefreshBtn = null;
let uploadBtn = null;
let fileInput = null;

// Changes tab elements
let changesList = null;
let commitForm = null;
let commitMessage = null;
let commitBtn = null;
let branchSelector = null;
let branchDropdown = null;
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
let changesController = null;
let historyController = null;
let branchController = null;
let hostController = null;
let _viewingDiff = null;
let explorerShell = null;
let diffViewer = null;
let stashActions = null;

// Icons (minimal set needed here)
const ICONS = createExplorerIcons({
  checkmark: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
});
const standaloneContext = createCwdContext(() => currentPath || rootPath);

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
  fileRefreshBtn = document.getElementById('files-standalone-refresh-btn');
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
    getNavigationStatus: () => changesController?.getGitStatus(),
    setViewingDiff: (diff) => {
      _viewingDiff = diff;
    },
    fetchDiff: async (filePath, staged) => {
      const res = await apiFetch(standaloneContext.getGitUrl('diff'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, staged, cwd: currentPath || rootPath }),
        silent: true,
      });
      if (!res) return { ok: false, error: 'Failed to load diff' };

      const data = await res.json();
      if (data.error) return { ok: false, error: data.error };
      return { ok: true, data };
    },
    revertDiffHunk: async (filePath, _hunkIndex, hunk, staged) => {
      const res = await apiFetch(standaloneContext.getGitUrl('revert-hunk'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, hunk, staged, cwd: currentPath || rootPath }),
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
  branchDropdown = document.getElementById('sa-branch-dropdown');
  aheadBehindBadge = document.getElementById('sa-ahead-behind-badge');
  pushBtn = document.getElementById('sa-push-btn');
  pullBtn = document.getElementById('sa-pull-btn');
  stashBtn = document.getElementById('sa-stash-btn');
  gitRefreshBtn = document.getElementById('sa-git-refresh-btn');

  // History elements
  historyList = document.getElementById('sa-history-list');

  const historyRequests = createGitHistoryRequests({
    context: standaloneContext,
    apiFetch,
  });

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
    ...historyRequests,
    onUndoSuccess: () => {
      loadGitStatus();
    },
    onResetSuccess: () => {
      loadGitStatus();
    },
  });

  const stashRequests = createGitStashRequests({
    context: standaloneContext,
    apiFetch,
  });

  stashActions = createGitStashActions({
    haptic,
    showDialog,
    showToast,
    requestCreate: stashRequests.requestStashCreate,
    requestPop: stashRequests.requestStashPop,
    requestApply: stashRequests.requestStashApply,
    requestDrop: stashRequests.requestStashDrop,
    onStatusChanged: () => {
      loadGitStatus();
    },
  });

  const changesRequests = createGitChangesRequests({
    context: standaloneContext,
    apiFetch,
    getDeletePath: (relativePath) => {
      const basePath = currentPath || rootPath;
      return basePath ? `${basePath}/${relativePath}` : relativePath;
    },
  });

  const workflowPatchRequests = createWorkflowPatchRequests({
    context: standaloneContext,
    apiFetch,
    resolveCwd: () => currentPath || rootPath,
  });

  changesController = createGitChangesController({
    changesList,
    commitForm,
    commitMessage,
    commitBtn,
    branchSelector,
    aheadBehindBadge,
    pushBtn,
    pullBtn,
    stashBtn,
    escapeHtml,
    haptic,
    showDialog,
    showToast,
    buttonProcessingTimeout: BUTTON_PROCESSING_TIMEOUT,
    icons: {
      error: ICONS.error,
      checkmark: ICONS.checkmark,
    },
    onViewDiff: (filePath, staged) => {
      void viewDiff(filePath, staged);
    },
    requestStashes: stashRequests.requestStashes,
    requestWorkflowPatches: workflowPatchRequests.requestWorkflowPatches,
    requestRejectWorkflowPatch: workflowPatchRequests.requestRejectWorkflowPatch,
    canApplyWorkflowPatches: false,
    ...changesRequests,
    stashActions,
  });
  changesController.bindActionListeners();

  const branchRequests = createGitBranchRequests({
    context: standaloneContext,
    apiFetch,
  });

  branchController = createGitBranchesController({
    branchSelector,
    branchDropdown,
    escapeHtml,
    haptic,
    showToast,
    showDialog,
    ...branchRequests,
    onBranchChanged: async () => {
      await loadGitStatus();
    },
  });
  branchController.bindListeners();

  hostController = createExplorerHost({
    tabButtons,
    views: {
      files: filesView,
      changes: changesView,
      history: historyView,
    },
    initialTab: 'files',
    haptic,
    closeViewer: () => {
      if (fileViewer && !fileViewer.classList.contains('hidden')) {
        closeFileViewer();
      }
    },
    onTabSelected: {
      files: async () => {
        await loadDirectory(currentPath);
      },
      changes: async () => {
        await loadGitStatus();
        await branchController?.loadBranches();
      },
      history: async () => {
        await loadCommits();
      },
    },
  });
  hostController.bindTabListeners();

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
    refreshButton: fileRefreshBtn,
    onRefresh: () => {
      haptic();
      loadDirectory(currentPath);
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

  // Git action buttons
  if (gitRefreshBtn) {
    gitRefreshBtn.addEventListener('click', () => {
      haptic();
      loadGitStatus();
      branchController?.loadBranches();
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
  void hostController?.resetToInitial({ closeOpenViewer: false });

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

async function loadGitStatus() {
  await changesController?.loadStatus();
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
