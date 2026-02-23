// --- Git Changes (staging, unstaging, diff view, stash) ---
import { escapeHtml } from '../markdown.js';
import { haptic, showToast, showDialog, apiFetch } from '../utils.js';
import * as state from '../state.js';
import { getIcons, setViewingDiff } from './file-browser.js';
import { ANIMATION_DELAY_SHORT } from '../constants.js';
import { createGitDiffViewer } from '../explorer/git-diff-viewer.js';
import { createGitStashActions } from '../explorer/git-stash-actions.js';
import { createGitChangesController } from '../explorer/git-changes-controller.js';

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
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(`/api/conversations/${convId}/git/diff`, {
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
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(`/api/conversations/${convId}/git/revert-hunk`, {
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

  stashActions = createGitStashActions({
    haptic,
    showDialog,
    showToast,
    requestCreate: async (body) => {
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(`/api/conversations/${convId}/git/stash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      if (!res) return { ok: false, error: 'Failed to stash changes' };
      return { ok: true, data: await res.json() };
    },
    requestPop: async (index) => {
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(`/api/conversations/${convId}/git/stash/pop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      if (!res) return { ok: false, error: 'Failed to apply stash' };
      return { ok: true, data: await res.json() };
    },
    requestApply: async (index) => {
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(`/api/conversations/${convId}/git/stash/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      if (!res) return { ok: false, error: 'Failed to apply stash' };
      return { ok: true, data: await res.json() };
    },
    requestDrop: async (index) => {
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(`/api/conversations/${convId}/git/stash/drop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      if (!res) return { ok: false, error: 'Failed to drop stash' };
      return { ok: true, data: await res.json() };
    },
    onStatusChanged: () => {
      loadGitStatus();
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
    requestStatus: async () => {
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(`/api/conversations/${convId}/git/status`, { silent: true });
      if (!res) return { ok: false, error: 'Failed to load git status' };
      return { ok: true, data: await res.json() };
    },
    requestStashes: async () => {
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(`/api/conversations/${convId}/git/stash`, { silent: true });
      if (!res) return { ok: true, data: { stashes: [] } };
      return { ok: true, data: await res.json() };
    },
    requestStage: async (paths) => {
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(`/api/conversations/${convId}/git/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      if (!res) return { ok: false, error: 'Failed to stage files' };
      return { ok: true, data: await res.json() };
    },
    requestUnstage: async (paths) => {
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(`/api/conversations/${convId}/git/unstage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      if (!res) return { ok: false, error: 'Failed to unstage files' };
      return { ok: true, data: await res.json() };
    },
    requestDiscard: async (paths) => {
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(`/api/conversations/${convId}/git/discard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      if (!res) return { ok: false, error: 'Failed to discard changes' };
      return { ok: true, data: await res.json() };
    },
    requestDeleteUntracked: async (relativePath) => {
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const conv = state.conversations.find((c) => c.id === convId);
      const baseCwd = conv?.cwd || '';
      const fullPath = baseCwd ? `${baseCwd}/${relativePath}` : relativePath;

      const res = await apiFetch(`/api/files?path=${encodeURIComponent(fullPath)}`, {
        method: 'DELETE',
      });
      if (!res) return { ok: false, error: 'Failed to delete file' };
      return { ok: true, data: await res.json() };
    },
    requestCommit: async (message) => {
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(`/api/conversations/${convId}/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!res) return { ok: false, error: 'Failed to commit changes' };
      return { ok: true, data: await res.json() };
    },
    requestPush: async () => {
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(`/api/conversations/${convId}/git/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res) return { ok: false, error: 'Failed to push' };
      return { ok: true, data: await res.json() };
    },
    requestPull: async () => {
      const convId = state.getCurrentConversationId();
      if (!convId) return { ok: false, error: 'No conversation selected' };

      const res = await apiFetch(`/api/conversations/${convId}/git/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res) return { ok: false, error: 'Failed to pull' };
      return { ok: true, data: await res.json() };
    },
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
 * Get stashes
 */
export function getStashes() {
  return changesController ? changesController.getStashes() : [];
}

/**
 * Load git status from server
 */
export async function loadGitStatus() {
  const convId = state.getCurrentConversationId();
  if (!convId || !changesController) return;

  await changesController.loadStatus();
}

export async function stageFiles(paths) {
  await changesController?.stagePaths(paths);
}

export async function unstageFiles(paths) {
  await changesController?.unstagePaths(paths);
}

export async function discardChanges(paths) {
  await changesController?.discardPaths(paths);
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
