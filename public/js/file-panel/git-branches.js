// --- Git Branches (branch dropdown, switching, creating) ---
import { escapeHtml } from '../markdown.js';
import { haptic, showToast, showDialog, apiFetch } from '../utils.js';
import * as state from '../state.js';
import { createConversationContext } from '../explorer/context.js';
import { createGitBranchRequests } from '../explorer/git-requests.js';
import { createGitBranchesController } from '../explorer/git-branches-controller.js';
import { loadGitStatus } from './git-changes.js';

const context = createConversationContext(() => state.getCurrentConversationId());

let branchesController = null;

/**
 * Initialize git branches elements
 */
export function initGitBranches(elements) {
  const branchRequests = createGitBranchRequests({
    context,
    apiFetch,
  });

  branchesController = createGitBranchesController({
    branchSelector: elements.branchSelector,
    branchDropdown: elements.branchDropdown,
    escapeHtml,
    haptic,
    showToast,
    showDialog,
    ...branchRequests,
    onBranchChanged: async () => {
      await loadGitStatus();
    },
  });
}

/**
 * Setup git branches event listeners
 */
export function setupGitBranchesEventListeners() {
  branchesController?.bindListeners();
}

export function resetBranches() {
  branchesController?.resetBranches();
}

/**
 * Load branches from server
 */
export async function loadBranches() {
  if (!state.getCurrentConversationId() || !branchesController) return;
  await branchesController.loadBranches();
}
