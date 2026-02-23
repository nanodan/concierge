// --- Git Changes (staging, unstaging, diff view, stash) ---
import { escapeHtml } from '../markdown.js';
import { haptic, showToast, showDialog, apiFetch } from '../utils.js';
import * as state from '../state.js';
import { getIcons, setViewingDiff } from './file-browser.js';
import { ANIMATION_DELAY_SHORT, BUTTON_PROCESSING_TIMEOUT } from '../constants.js';
import { createGitDiffViewer } from '../explorer/git-diff-viewer.js';

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

// State
let gitStatus = null;
let stashes = null;
let untrackedSelectionMode = false;
let selectedUntracked = new Set();
let diffViewer = null;

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
    getNavigationStatus: () => gitStatus,
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
}

/**
 * Setup git changes event listeners
 */
export function setupGitChangesEventListeners(loadGitStatusFn, loadBranchesFn, gitRefreshBtn) {
  // Commit button
  if (commitBtn) {
    commitBtn.addEventListener('click', handleCommit);
  }

  // Refresh button
  if (gitRefreshBtn) {
    gitRefreshBtn.addEventListener('click', () => {
      haptic();
      loadGitStatusFn();
      loadBranchesFn();
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
}

/**
 * Get current git status
 */
export function getGitStatus() {
  return gitStatus;
}

/**
 * Set current git status
 */
export function setGitStatus(status) {
  gitStatus = status;
}

/**
 * Get stashes
 */
export function getStashes() {
  return stashes;
}

/**
 * Load git status from server
 */
export async function loadGitStatus() {
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

/**
 * Load stashes from server
 */
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

/**
 * Render not a git repo message
 */
function renderNotARepo() {
  const ICONS = getIcons();
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
      if (ahead > 0) {
        badgeHtml += `<span class="ahead">\u2191${ahead}</span>`;
      }
      if (behind > 0) {
        badgeHtml += `<span class="behind">\u2193${behind}</span>`;
      }
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

  // Update stash button
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
      <div class="changes-section untracked-section${untrackedSelectionMode ? ' selection-mode' : ''}">
        <div class="changes-section-header">
          <span class="changes-section-title">Untracked Files</span>
          <span class="changes-section-count">${untracked.length}</span>
          ${untrackedSelectionMode
            ? `<button class="changes-section-btn danger" data-action="delete-selected" title="Delete Selected"${selectedUntracked.size === 0 ? ' disabled' : ''}>Delete (${selectedUntracked.size})</button>`
            : `<button class="changes-section-btn" data-action="stage-all-untracked" title="Stage All">+ All</button>`
          }
          <button class="changes-section-btn select-btn${untrackedSelectionMode ? ' active' : ''}" data-action="toggle-select" title="${untrackedSelectionMode ? 'Cancel' : 'Select Multiple'}">
            ${untrackedSelectionMode ? 'Cancel' : 'Select'}
          </button>
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
    'M': 'modified',
    'A': 'added',
    'D': 'deleted',
    'R': 'renamed',
    'C': 'copied',
    '?': 'untracked'
  };
  const statusLabel = statusLabels[file.status] || file.status;
  // Handle directories (paths ending with /) by removing trailing slash first
  const normalizedPath = file.path.replace(/\/$/, '');
  const filename = normalizedPath.split('/').pop() + (file.path.endsWith('/') ? '/' : '');

  const isSelected = type === 'untracked' && selectedUntracked.has(file.path);
  const showCheckbox = type === 'untracked' && untrackedSelectionMode;

  return `
    <div class="changes-item${isSelected ? ' selected' : ''}" data-path="${escapeHtml(file.path)}" data-type="${type}">
      ${showCheckbox ? `
        <span class="changes-item-checkbox${isSelected ? ' checked' : ''}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            ${isSelected ? '<polyline points="20 6 9 17 4 12"/>' : ''}
          </svg>
        </span>
      ` : ''}
      <span class="status-badge status-${file.status.toLowerCase()}" title="${statusLabel}">${file.status}</span>
      <span class="changes-item-name" title="${escapeHtml(file.path)}">${escapeHtml(filename)}</span>
      <span class="changes-item-path">${escapeHtml(file.path)}</span>
      ${!showCheckbox ? `
        <div class="changes-item-actions">
          ${type === 'staged' ? `<button class="changes-action-btn" data-action="unstage" title="Unstage">\u2212</button>` : ''}
          ${type === 'unstaged' ? `<button class="changes-action-btn" data-action="stage" title="Stage">+</button>` : ''}
          ${type === 'unstaged' ? `<button class="changes-action-btn danger" data-action="discard" title="Discard">\u00d7</button>` : ''}
          ${type === 'untracked' ? `<button class="changes-action-btn" data-action="stage" title="Stage">+</button>` : ''}
          ${type === 'untracked' ? `<button class="changes-action-btn danger" data-action="delete" title="Delete">\u00d7</button>` : ''}
        </div>
      ` : ''}
    </div>`;
}

/**
 * Attach change item event listeners
 */
function attachChangeItemListeners() {
  if (!changesList) return;

  // Click on item to view diff (or toggle selection in selection mode)
  changesList.querySelectorAll('.changes-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.changes-action-btn')) return;
      const filePath = item.dataset.path;
      const type = item.dataset.type;

      // In selection mode, toggle selection for untracked files
      if (type === 'untracked' && untrackedSelectionMode) {
        haptic(5);
        toggleUntrackedSelection(filePath);
        return;
      }

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

  // Section buttons (Stage All / Unstage All / Select / Delete Selected)
  changesList.querySelectorAll('.changes-section-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      haptic();

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
      } else if (action === 'toggle-select') {
        if (untrackedSelectionMode) {
          exitUntrackedSelectionMode();
        } else {
          enterUntrackedSelectionMode();
        }
      } else if (action === 'delete-selected') {
        await deleteSelectedUntracked();
      }
    });
  });
}

// === Untracked Selection Mode Functions ===

function enterUntrackedSelectionMode() {
  untrackedSelectionMode = true;
  selectedUntracked.clear();
  renderChangesView();
}

function exitUntrackedSelectionMode() {
  untrackedSelectionMode = false;
  selectedUntracked.clear();
  renderChangesView();
}

function toggleUntrackedSelection(path) {
  if (selectedUntracked.has(path)) {
    selectedUntracked.delete(path);
  } else {
    selectedUntracked.add(path);
  }
  renderChangesView();
}

async function deleteSelectedUntracked() {
  if (selectedUntracked.size === 0) return;

  const count = selectedUntracked.size;
  const confirmed = await showDialog({
    title: `Delete ${count} file${count > 1 ? 's' : ''}?`,
    message: `This will permanently delete ${count} untracked file${count > 1 ? 's' : ''}. This cannot be undone.`,
    danger: true,
    confirmLabel: 'Delete All'
  });

  if (!confirmed) return;

  const paths = Array.from(selectedUntracked);
  for (const path of paths) {
    await deleteUntrackedFile(path, true); // silent mode
  }

  showToast(`Deleted ${count} file${count > 1 ? 's' : ''}`);
  untrackedSelectionMode = false;
  selectedUntracked.clear();
  loadGitStatus(); // Refresh from server to show files are gone
}

// === Stash Functions ===

/**
 * Render stash section
 */
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

/**
 * Attach stash event listeners
 */
function attachStashListeners() {
  if (!changesList) return;

  changesList.querySelectorAll('.stash-action-btn').forEach(btn => {
    const handleAction = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Prevent double-firing from both touch and click
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

// === Git Operations ===

export async function stageFiles(paths) {
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

export async function unstageFiles(paths) {
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

export async function discardChanges(paths) {
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

async function deleteUntrackedFile(relativePath, silent = false) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  // Get conversation cwd to build full path
  const conv = state.conversations.find(c => c.id === convId);
  const baseCwd = conv?.cwd || '';
  const fullPath = baseCwd ? `${baseCwd}/${relativePath}` : relativePath;

  const res = await apiFetch(`/api/files?path=${encodeURIComponent(fullPath)}`, {
    method: 'DELETE'
  });
  if (!res) return;
  const data = await res.json();

  if (data.error) {
    showToast(data.error, { variant: 'error' });
    return;
  }

  if (!silent) {
    showToast('File deleted');
    loadGitStatus();
  }
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
