// --- Git Commits (commit history, revert, reset) ---
import { escapeHtml } from '../markdown.js';
import { haptic, showToast, showDialog, apiFetch } from '../utils.js';
import * as state from '../state.js';
import { renderDiff, loadGitStatus } from './git-changes.js';
import { ANIMATION_DELAY_SHORT, BUTTON_PROCESSING_TIMEOUT } from '../constants.js';

// DOM elements (set by init)
let historyList = null;
let fileViewer = null;
let fileViewerName = null;
let fileViewerContent = null;

// State
let commits = null;
let unpushedCount = 0;

/**
 * Initialize git commits elements
 */
export function initGitCommits(elements) {
  historyList = elements.historyList;
  fileViewer = elements.fileViewer;
  fileViewerName = elements.fileViewerName;
  fileViewerContent = elements.fileViewerContent;
}

/**
 * Load commits from server
 */
export async function loadCommits() {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  if (historyList) {
    historyList.innerHTML = '<div class="history-loading">Loading...</div>';
  }

  // Fetch commits and status in parallel
  const [commitsRes, statusRes] = await Promise.all([
    apiFetch(`/api/conversations/${convId}/git/commits`, { silent: true }),
    apiFetch(`/api/conversations/${convId}/git/status`, { silent: true })
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

  // Get unpushed count from status
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

/**
 * Render the history view
 */
function renderHistoryView() {
  if (!historyList) return;

  if (!commits || commits.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No commits yet</div>';
    return;
  }

  let html = '';

  // History header with help button
  html += `
    <div class="history-header">
      <span class="history-title">Commits</span>
      <button class="history-help-btn" aria-label="Show action legend" title="Action legend">?</button>
    </div>`;

  // Show unpushed commits header if there are any
  if (unpushedCount > 0) {
    html += `
      <div class="unpushed-header">
        <span class="unpushed-icon">\u2191</span>
        <span>${unpushedCount} unpushed commit${unpushedCount > 1 ? 's' : ''}</span>
      </div>`;
  }

  // Render commits, marking unpushed ones
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

  // Attach help button listener for legend popover
  const helpBtn = historyList.querySelector('.history-help-btn');
  if (helpBtn) {
    helpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showGitLegendPopover(helpBtn);
    });
  }

  // Attach click handlers for viewing diffs
  historyList.querySelectorAll('.commit-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't trigger if clicking action buttons
      if (e.target.closest('.commit-actions')) return;
      viewCommitDiff(item.dataset.hash);
    });
  });

  // Attach commit action listeners
  attachCommitActionListeners();
}

/**
 * Attach commit action event listeners
 */
function attachCommitActionListeners() {
  if (!historyList) return;

  historyList.querySelectorAll('.commit-action-btn').forEach(btn => {
    const handleAction = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Prevent double-firing from both touch and click
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
    message: 'The commit will be removed but changes will remain staged. Use this to amend the last commit or combine with other changes.',
    confirmLabel: 'Undo',
    danger: true
  });

  if (!confirmed) return;

  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/undo-commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
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
    message: `This will create a new commit that undoes the changes from ${hash.slice(0, 7)}. This is safe \u2014 it keeps history intact and can be easily undone.`,
    confirmLabel: 'Revert',
    danger: true
  });

  if (!confirmed) return;

  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/revert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hash })
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
  // Show reset mode selection dialog
  const mode = await showResetModeDialog(hash);
  if (!mode) return;

  // Extra confirmation for hard reset
  if (mode === 'hard') {
    const confirmed = await showDialog({
      title: 'Hard reset?',
      message: 'This will PERMANENTLY DELETE all uncommitted changes \u2014 both staged and unstaged files will be lost. This cannot be undone.',
      danger: true,
      confirmLabel: 'Delete changes and reset'
    });
    if (!confirmed) return;
  }

  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/git/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hash, mode })
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
    // Create dialog overlay
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
                <span class="reset-mode-desc">Moves HEAD back. Changes stay staged, ready to commit again.</span>
              </div>
            </label>
            <label class="reset-mode-option">
              <input type="radio" name="reset-mode" value="mixed">
              <div class="reset-mode-info">
                <span class="reset-mode-name">Mixed</span>
                <span class="reset-mode-desc">Moves HEAD back. Changes become unstaged (in working directory).</span>
              </div>
            </label>
            <label class="reset-mode-option">
              <input type="radio" name="reset-mode" value="hard">
              <div class="reset-mode-info">
                <span class="reset-mode-name">Hard</span>
                <span class="reset-mode-desc danger-text">Moves HEAD back. All changes are permanently deleted.</span>
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

    const cleanup = () => {
      overlay.remove();
    };

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
  // Remove any existing legend popover
  const existing = document.querySelector('.git-legend-popover');
  if (existing) {
    existing.remove();
    return; // Toggle off if already open
  }

  const popover = document.createElement('div');
  popover.className = 'git-legend-popover';
  popover.innerHTML = `
    <div class="git-legend-title">Commit Actions</div>
    <div class="git-legend-item">
      <span class="git-legend-icon">\u21b6</span>
      <div class="git-legend-content">
        <span class="git-legend-name">Undo</span>
        <span class="git-legend-desc">Remove last commit, keep changes staged (soft reset HEAD~1)</span>
      </div>
    </div>
    <div class="git-legend-item">
      <span class="git-legend-icon">\u21a9</span>
      <div class="git-legend-content">
        <span class="git-legend-name">Revert</span>
        <span class="git-legend-desc">Create new commit that undoes changes (safe, keeps history)</span>
      </div>
    </div>
    <div class="git-legend-item">
      <span class="git-legend-icon danger">\u27f2</span>
      <div class="git-legend-content">
        <span class="git-legend-name">Reset</span>
        <span class="git-legend-desc">Move branch to this commit (choose mode)</span>
      </div>
    </div>
  `;

  // Position relative to the anchor button
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

  // Close on outside click
  const handleOutsideClick = (e) => {
    if (!popover.contains(e.target) && e.target !== anchorBtn) {
      closePopover();
    }
  };

  // Close on Escape key (capture phase to intercept before other handlers)
  const handleKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closePopover();
    }
  };

  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleKeydown, true); // capture phase
  }, 0);
}

async function viewCommitDiff(hash) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  haptic();

  // Show loading state in viewer
  fileViewerName.textContent = `${hash.slice(0, 7)}`;
  fileViewerContent.innerHTML = '<code>Loading...</code>';
  fileViewer.classList.remove('hidden');
  setTimeout(() => fileViewer.classList.add('open'), ANIMATION_DELAY_SHORT);

  const res = await apiFetch(`/api/conversations/${convId}/git/commits/${hash}`, { silent: true });
  if (!res) {
    fileViewerContent.innerHTML = '<div class="file-viewer-error"><p>Failed to load commit</p></div>';
    return;
  }

  const data = await res.json();

  if (data.error) {
    fileViewerContent.innerHTML = `<div class="file-viewer-error"><p>${escapeHtml(data.error)}</p></div>`;
    return;
  }

  // Update header with commit info
  fileViewerName.textContent = `${hash.slice(0, 7)} - ${data.message}`;

  // Render the diff
  renderDiff(data);
}
