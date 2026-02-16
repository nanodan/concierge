// --- Git Branches (branch dropdown, switching, creating) ---
import { escapeHtml } from '../markdown.js';
import { haptic, showToast, showDialog, apiFetch } from '../utils.js';
import * as state from '../state.js';
import { loadGitStatus } from './git-changes.js';

// DOM elements (set by init)
let branchSelector = null;
let branchDropdown = null;

// State
let branches = null;

/**
 * Initialize git branches elements
 */
export function initGitBranches(elements) {
  branchSelector = elements.branchSelector;
  branchDropdown = elements.branchDropdown;
}

/**
 * Setup git branches event listeners
 */
export function setupGitBranchesEventListeners() {
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
}

/**
 * Get branches state
 */
export function getBranches() {
  return branches;
}

/**
 * Set branches state
 */
export function setBranches(branchesData) {
  branches = branchesData;
}

/**
 * Load branches from server
 */
export async function loadBranches() {
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

/**
 * Toggle branch dropdown visibility
 */
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

/**
 * Render branch dropdown contents
 */
function renderBranchDropdown() {
  if (!branchDropdown || !branches) return;

  let html = '';

  // Local branches
  for (const branch of branches.local) {
    const isCurrent = branch === branches.current;
    html += `
      <div class="branch-item ${isCurrent ? 'current' : ''}" data-branch="${escapeHtml(branch)}">
        ${isCurrent ? '<span class="branch-check">\u2713</span>' : ''}
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

/**
 * Create a new branch
 */
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

/**
 * Checkout a branch
 */
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
