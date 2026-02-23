// --- Git Commits (commit history, revert, reset) ---
import { escapeHtml } from '../markdown.js';
import { haptic, showToast, showDialog, apiFetch } from '../utils.js';
import * as state from '../state.js';
import { renderDiff, loadGitStatus } from './git-changes.js';
import { ANIMATION_DELAY_SHORT, BUTTON_PROCESSING_TIMEOUT } from '../constants.js';
import { createGitHistoryController } from '../explorer/git-history.js';
import { createConversationContext } from '../explorer/context.js';
import { createGitHistoryRequests } from '../explorer/git-requests.js';

const context = createConversationContext(() => state.getCurrentConversationId());

// DOM elements (set by init)
let historyList = null;
let fileViewer = null;
let fileViewerName = null;
let fileViewerContent = null;

// Shared controller
let historyController = null;

/**
 * Initialize git commits elements
 */
export function initGitCommits(elements) {
  historyList = elements.historyList;
  fileViewer = elements.fileViewer;
  fileViewerName = elements.fileViewerName;
  fileViewerContent = elements.fileViewerContent;

  const historyRequests = createGitHistoryRequests({
    context,
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
    copy: {
      helpTitle: 'Action legend',
      undoMessage: 'The commit will be removed but changes will remain staged. Use this to amend the last commit or combine with other changes.',
      revertMessage: (hash) => `This will create a new commit that undoes the changes from ${hash.slice(0, 7)}. This is safe - it keeps history intact and can be easily undone.`,
      legendUndoDesc: 'Remove last commit, keep changes staged (soft reset HEAD~1)',
      legendRevertDesc: 'Create new commit that undoes changes (safe, keeps history)',
      legendResetDesc: 'Move branch to this commit (choose mode)',
      resetModeSoftDesc: 'Moves HEAD back. Changes stay staged, ready to commit again.',
      resetModeMixedDesc: 'Moves HEAD back. Changes become unstaged (in working directory).',
      resetModeHardDesc: 'Moves HEAD back. All changes are permanently deleted.',
    },
  });
}

/**
 * Load commits from server
 */
export async function loadCommits() {
  const convId = state.getCurrentConversationId();
  if (!convId || !historyController) return;

  await historyController.loadCommits();
}
