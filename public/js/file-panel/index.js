// --- File Panel (Project Mode) - Main Module ---
// Orchestrates file browser, git changes, commits, branches, and preview

import { haptic, showToast } from '../utils.js';
import * as state from '../state.js';

// Import submodules
import { isMobile, initGestures, setupDragGesture } from './gestures.js';
import {
  initFileBrowser,
  setupFileBrowserEventListeners,
  loadFileTree,
  viewFile,
  closeFileViewer,
  isFileViewerOpen,
  getCurrentPath,
  setCurrentPath,
  resetSearchState,
} from './file-browser.js';
import {
  initGitChanges,
  setupGitChangesEventListeners,
  loadGitStatus,
  setGitStatus,
} from './git-changes.js';
import { initGitCommits, loadCommits } from './git-commits.js';
import {
  initGitBranches,
  setupGitBranchesEventListeners,
  loadBranches,
  setBranches,
} from './git-branches.js';
import {
  initPreview,
  setupPreviewEventListeners,
  loadPreviewStatus,
} from './preview.js';

// DOM elements
let filePanel = null;
let filePanelBackdrop = null;
let filePanelClose = null;
let chatView = null;

// Tab elements
let filesTab = null;
let changesTab = null;
let historyTab = null;
let previewTab = null;
let filesView = null;
let changesView = null;
let historyView = null;
let previewView = null;
let gitRefreshBtn = null;

// Panel state
let isOpen = false;
let currentTab = 'files'; // 'files' | 'changes' | 'history' | 'preview'

/**
 * Initialize the file panel with all its submodules
 */
export function initFilePanel(elements) {
  // Store main panel elements
  filePanel = elements.filePanel;
  filePanelBackdrop = elements.filePanelBackdrop;
  filePanelClose = elements.filePanelClose;
  chatView = elements.chatView;

  // Tab elements
  filesTab = elements.filesTab;
  changesTab = elements.changesTab;
  historyTab = elements.historyTab;
  previewTab = elements.previewTab;
  filesView = elements.filesView;
  changesView = elements.changesView;
  historyView = elements.historyView;
  previewView = elements.previewView;
  gitRefreshBtn = elements.gitRefreshBtn;

  // Initialize submodules
  initFileBrowser({
    filePanelUp: elements.filePanelUp,
    filePanelPath: elements.filePanelPath,
    fileSearchInput: elements.fileSearchInput,
    filePanelUploadBtn: elements.filePanelUploadBtn,
    filePanelFileInput: elements.filePanelFileInput,
    fileTree: elements.fileTree,
    fileViewer: elements.fileViewer,
    fileViewerName: elements.fileViewerName,
    fileViewerClose: elements.fileViewerClose,
    fileViewerContent: elements.fileViewerContent,
    filesView: elements.filesView,
  });

  initGitChanges({
    changesList: elements.changesList,
    commitForm: elements.commitForm,
    commitMessage: elements.commitMessage,
    commitBtn: elements.commitBtn,
    branchSelector: elements.branchSelector,
    aheadBehindBadge: elements.aheadBehindBadge,
    pushBtn: elements.pushBtn,
    pullBtn: elements.pullBtn,
    stashBtn: elements.stashBtn,
    fileViewer: elements.fileViewer,
    fileViewerName: elements.fileViewerName,
    fileViewerContent: elements.fileViewerContent,
    diffGranularToggle: elements.diffGranularToggle,
  });

  initGitCommits({
    historyList: elements.historyList,
    fileViewer: elements.fileViewer,
    fileViewerName: elements.fileViewerName,
    fileViewerContent: elements.fileViewerContent,
  });

  initGitBranches({
    branchSelector: elements.branchSelector,
    branchDropdown: elements.branchDropdown,
  });

  initPreview({
    previewTab: elements.previewTab,
    previewView: elements.previewView,
    previewEmpty: elements.previewEmpty,
    previewRunning: elements.previewRunning,
    previewMessage: elements.previewMessage,
    previewStartBtn: elements.previewStartBtn,
    previewType: elements.previewType,
    previewUrl: elements.previewUrl,
    previewOpenBtn: elements.previewOpenBtn,
    previewStopBtn: elements.previewStopBtn,
  });

  setupEventListeners();
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
  // Close button
  if (filePanelClose) {
    filePanelClose.addEventListener('click', () => {
      haptic();
      closeFilePanel();
    });
  }

  // Backdrop click (mobile)
  if (filePanelBackdrop) {
    filePanelBackdrop.addEventListener('click', () => {
      haptic();
      closeFilePanel();
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
  if (previewTab) {
    previewTab.addEventListener('click', () => switchTab('preview'));
  }

  // Setup submodule event listeners
  setupFileBrowserEventListeners();
  setupGitChangesEventListeners(loadGitStatus, loadBranches, gitRefreshBtn);
  setupGitBranchesEventListeners();
  setupPreviewEventListeners();

  // Initialize gestures (handles both mobile drag and desktop resize)
  if (filePanel) {
    initGestures(filePanel, closeFilePanel);
  }

  // Handle resize
  window.addEventListener('resize', () => {
    if (isOpen && isMobile()) {
      setupDragGesture(closeFilePanel);
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

/**
 * Open the file panel
 */
export function openFilePanel() {
  const convId = state.getCurrentConversationId();
  if (!convId) {
    showToast('No conversation selected');
    return;
  }

  isOpen = true;
  setCurrentPath('');

  // Reset to files tab
  currentTab = 'files';
  if (filesTab) filesTab.classList.add('active');
  if (changesTab) changesTab.classList.remove('active');
  if (historyTab) historyTab.classList.remove('active');
  if (previewTab) previewTab.classList.remove('active');
  if (filesView) filesView.classList.remove('hidden');
  if (changesView) changesView.classList.add('hidden');
  if (historyView) historyView.classList.add('hidden');
  if (previewView) previewView.classList.add('hidden');

  // Reset git state
  setGitStatus(null);
  setBranches(null);

  // Reset search state
  resetSearchState();

  // Reset viewer state
  closeFileViewer();

  // Show panel
  filePanel.classList.remove('hidden');

  // Preserve scroll position when panel opens (desktop only)
  const messages = document.getElementById('messages');
  const distanceFromBottom = messages ? messages.scrollHeight - messages.scrollTop : 0;

  setTimeout(() => {
    filePanel.classList.add('open');
    if (isMobile()) {
      filePanel.classList.add('snap-60');
      filePanelBackdrop.classList.add('visible');
    } else {
      chatView.classList.add('file-panel-open');
      // After layout change, restore scroll position based on distance from bottom
      if (messages) {
        requestAnimationFrame(() => {
          messages.scrollTop = messages.scrollHeight - distanceFromBottom;
        });
      }
    }
  }, 10);

  // Load root directory
  loadFileTree('');

  haptic(15);
}

/**
 * Close the file panel
 */
export function closeFilePanel() {
  isOpen = false;
  filePanel.classList.remove('open', 'snap-30', 'snap-60', 'snap-90');
  filePanelBackdrop.classList.remove('visible');

  // Preserve scroll position when panel closes (desktop only)
  const messages = document.getElementById('messages');
  const distanceFromBottom = messages ? messages.scrollHeight - messages.scrollTop : 0;

  chatView.classList.remove('file-panel-open');

  // Restore scroll position after layout change
  if (messages && !isMobile()) {
    requestAnimationFrame(() => {
      messages.scrollTop = messages.scrollHeight - distanceFromBottom;
    });
  }

  setTimeout(() => {
    filePanel.classList.add('hidden');
    closeFileViewer();
  }, 300);
}

/**
 * Toggle the file panel
 */
export function toggleFilePanel() {
  if (isOpen) {
    closeFilePanel();
  } else {
    openFilePanel();
  }
}

/**
 * Check if the file panel is open
 */
export function isFilePanelOpen() {
  return isOpen;
}

/**
 * Switch to a different tab
 */
function switchTab(tab) {
  if (tab === currentTab) return;
  currentTab = tab;
  haptic(5);

  // Update tab buttons
  if (filesTab) filesTab.classList.toggle('active', tab === 'files');
  if (changesTab) changesTab.classList.toggle('active', tab === 'changes');
  if (historyTab) historyTab.classList.toggle('active', tab === 'history');
  if (previewTab) previewTab.classList.toggle('active', tab === 'preview');

  // Update views
  if (filesView) filesView.classList.toggle('hidden', tab !== 'files');
  if (changesView) changesView.classList.toggle('hidden', tab !== 'changes');
  if (historyView) historyView.classList.toggle('hidden', tab !== 'history');
  if (previewView) previewView.classList.toggle('hidden', tab !== 'preview');

  // Reset search state when switching to files tab
  if (tab === 'files') {
    resetSearchState();
  }

  // Load content
  if (tab === 'files') {
    loadFileTree(getCurrentPath());
  } else if (tab === 'changes') {
    loadGitStatus();
    loadBranches();
  } else if (tab === 'history') {
    loadCommits();
  } else if (tab === 'preview') {
    loadPreviewStatus();
  }
}

// Re-export functions from submodules for backward compatibility
export { loadFileTree, viewFile, closeFileViewer, isFileViewerOpen };
