// --- Git Changes (staging, unstaging, diff view, stash) ---
import { escapeHtml } from '../markdown.js';
import { haptic, showToast, showDialog, apiFetch } from '../utils.js';
import * as state from '../state.js';
import { getIcons, setViewingDiff } from './file-browser.js';
import { ANIMATION_DELAY_SHORT } from '../constants.js';
import { createConversationContext } from '../explorer/context.js';
import { createGitDiffViewer } from '../explorer/git-diff-viewer.js';
import { createGitStashActions } from '../explorer/git-stash-actions.js';
import { createGitChangesController } from '../explorer/git-changes-controller.js';
import {
  createGitChangesRequests,
  createGitStashRequests,
  createWorkflowPatchRequests,
} from '../explorer/git-requests.js';

const context = createConversationContext(() => state.getCurrentConversationId());

// DOM elements (set by init)
let changesList = null;
let commitForm = null;
let commitMessage = null;
let commitBtn = null;
let branchSelector = null;
let aheadBehindBadge = null;
let pushBtn = null;
let pullBtn = null;
let stashBtn = null;
let fileViewer = null;
let fileViewerName = null;
let fileViewerContent = null;
let granularToggleBtn = null;

// Shared controllers
let diffViewer = null;
let stashActions = null;
let changesController = null;

/**
 * Initialize git changes elements
 */
export function initGitChanges(elements) {
  changesList = elements.changesList;
  commitForm = elements.commitForm;
  commitMessage = elements.commitMessage;
  commitBtn = elements.commitBtn;
  branchSelector = elements.branchSelector;
  aheadBehindBadge = elements.aheadBehindBadge;
  pushBtn = elements.pushBtn;
  pullBtn = elements.pullBtn;
  stashBtn = elements.stashBtn;
  fileViewer = elements.fileViewer;
  fileViewerName = elements.fileViewerName;
  fileViewerContent = elements.fileViewerContent;
  granularToggleBtn = elements.diffGranularToggle;

  diffViewer = createGitDiffViewer({
    fileViewer,
    fileViewerName,
    fileViewerContent,
    granularToggleBtn,
    escapeHtml,
    haptic,
    showDialog,
    showToast,
    animationDelayMs: ANIMATION_DELAY_SHORT,
    getNavigationStatus: () => changesController?.getGitStatus(),
    setViewingDiff,
    fetchDiff: async (filePath, staged) => {
      const gitUrl = context.getGitUrl('diff');
      if (!gitUrl) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(gitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, staged }),
        silent: true,
      });
      if (!res) return { ok: false, error: 'Failed to load diff' };

      const data = await res.json();
      if (data.error) return { ok: false, error: data.error };
      return { ok: true, data };
    },
    revertDiffHunk: async (filePath, _hunkIndex, hunk, staged) => {
      const gitUrl = context.getGitUrl('revert-hunk');
      if (!gitUrl) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(gitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, hunk, staged }),
      });
      if (!res) return { ok: false, error: 'Failed to revert hunk' };

      const data = await res.json();
      if (data.error) return { ok: false, error: data.error };
      return { ok: true };
    },
    closeAfterRevert: () => {
      if (!fileViewer) return;
      fileViewer.classList.remove('open');
      setTimeout(() => {
        fileViewer.classList.add('hidden');
      }, ANIMATION_DELAY_SHORT);
    },
    refreshAfterRevert: () => {
      loadGitStatus();
    },
  });

  const stashRequests = createGitStashRequests({
    context,
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
    context,
    apiFetch,
    getDeletePath: (relativePath) => {
      const convId = context.getConversationId();
      const conv = state.conversations.find((c) => c.id === convId);
      const baseCwd = conv?.cwd || '';
      return baseCwd ? `${baseCwd}/${relativePath}` : relativePath;
    },
  });

  const workflowPatchRequests = createWorkflowPatchRequests({
    context,
    apiFetch,
    resolveCwd: () => {
      const convId = context.getConversationId();
      const conv = state.conversations.find((c) => c.id === convId);
      return conv?.cwd || '';
    },
  });

  const icons = getIcons();
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
    icons: {
      error: icons.error,
      checkmark: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    },
    enableUntrackedSelection: true,
    onViewDiff: (filePath, staged) => {
      void viewDiff(filePath, staged);
    },
    requestStashes: stashRequests.requestStashes,
    requestWorkflowPatches: workflowPatchRequests.requestWorkflowPatches,
    requestApplyWorkflowPatch: workflowPatchRequests.requestApplyWorkflowPatch,
    requestRejectWorkflowPatch: workflowPatchRequests.requestRejectWorkflowPatch,
    ...changesRequests,
    stashActions,
  });
}

/**
 * Setup git changes event listeners
 */
export function setupGitChangesEventListeners(loadGitStatusFn, loadBranchesFn, gitRefreshBtn) {
  changesController?.bindActionListeners();

  if (gitRefreshBtn) {
    gitRefreshBtn.addEventListener('click', () => {
      haptic();
      loadGitStatusFn();
      loadBranchesFn();
    });
  }
}

/**
 * Get current git status
 */
export function getGitStatus() {
  return changesController ? changesController.getGitStatus() : null;
}

/**
 * Set current git status
 */
export function setGitStatus(status) {
  changesController?.setGitStatus(status);
}

/**
 * Load git status from server
 */
export async function loadGitStatus() {
  const convId = state.getCurrentConversationId();
  if (!convId || !changesController) return;

  await changesController.loadStatus();
}

// === Diff Viewer ===

async function viewDiff(filePath, staged) {
  await diffViewer?.openDiff(filePath, staged);
}

/**
 * Hide the granular toggle button (called when viewing non-diff files)
 */
export function hideGranularToggle() {
  diffViewer?.hideGranularToggle();
}

/**
 * Render a diff
 */
export function renderDiff(data) {
  diffViewer?.renderDiff(data);
}
