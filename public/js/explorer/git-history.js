function noop() {}

const DEFAULT_COPY = {
  loadFailed: 'Failed to load commits',
  noCommits: 'No commits yet',
  headerTitle: 'Commits',
  helpTitle: 'Action legend',
  unpushedLabel: (count) => `${count} unpushed commit${count > 1 ? 's' : ''}`,
  undoTitle: 'Undo last commit?',
  undoMessage: 'The commit will be removed but changes will remain staged.',
  undoConfirm: 'Undo',
  undoSuccess: 'Commit undone',
  revertTitle: 'Revert commit?',
  revertMessage: (hash) => `This will create a new commit that undoes the changes from ${hash.slice(0, 7)}.`,
  revertConfirm: 'Revert',
  revertSuccess: 'Commit reverted',
  resetTitle: (hash) => `Reset to ${hash.slice(0, 7)}?`,
  resetConfirm: 'Reset',
  resetSuccess: (hash, mode) => `Reset to ${hash.slice(0, 7)} (${mode})`,
  hardResetTitle: 'Hard reset?',
  hardResetMessage: 'This will PERMANENTLY DELETE all uncommitted changes.',
  hardResetConfirm: 'Delete changes and reset',
  diffLoadFailed: 'Failed to load commit',
  legendTitle: 'Commit Actions',
  legendUndoDesc: 'Remove last commit, keep changes staged',
  legendRevertDesc: 'Create new commit that undoes changes',
  legendResetDesc: 'Move branch to this commit',
  resetModeSoftName: 'Soft',
  resetModeSoftDesc: 'Changes stay staged.',
  resetModeMixedName: 'Mixed',
  resetModeMixedDesc: 'Changes become unstaged.',
  resetModeHardName: 'Hard',
  resetModeHardDesc: 'All changes deleted.',
};

function ensureResult(result, fallbackError) {
  if (!result) return { ok: false, error: fallbackError };
  if (typeof result.ok === 'boolean') return result;
  return { ok: true, data: result };
}

export function createGitHistoryController({
  historyList,
  fileViewer,
  fileViewerName,
  fileViewerContent,
  escapeHtml,
  renderDiff,
  haptic = noop,
  showToast = noop,
  showDialog = async () => true,
  buttonProcessingTimeout = 250,
  animationDelayMs = 0,
  requestCommits = async () => ({ ok: false, error: 'Not implemented' }),
  requestStatus = async () => ({ ok: false, error: 'Not implemented' }),
  requestUndoCommit = async () => ({ ok: false, error: 'Not implemented' }),
  requestRevertCommit = async () => ({ ok: false, error: 'Not implemented' }),
  requestResetCommit = async () => ({ ok: false, error: 'Not implemented' }),
  requestCommitDiff = async () => ({ ok: false, error: 'Not implemented' }),
  onUndoSuccess = noop,
  onRevertSuccess = noop,
  onResetSuccess = noop,
  copy = {},
}) {
  const text = { ...DEFAULT_COPY, ...copy };
  let commits = null;
  let unpushedCount = 0;

  async function loadCommits() {
    if (historyList) {
      historyList.innerHTML = '<div class="history-loading">Loading...</div>';
    }

    const [commitsResultRaw, statusResultRaw] = await Promise.all([
      requestCommits(),
      requestStatus(),
    ]);
    const commitsResult = ensureResult(commitsResultRaw, text.loadFailed);
    const statusResult = ensureResult(statusResultRaw, '');

    if (!commitsResult.ok) {
      if (historyList) {
        historyList.innerHTML = `<div class="history-empty">${escapeHtml(commitsResult.error || text.loadFailed)}</div>`;
      }
      return;
    }

    const commitsData = commitsResult.data || {};
    if (commitsData.error) {
      if (historyList) {
        historyList.innerHTML = `<div class="history-empty">${escapeHtml(commitsData.error)}</div>`;
      }
      return;
    }

    unpushedCount = 0;
    const statusData = statusResult.data || {};
    if (statusResult.ok && statusData.isRepo && statusData.hasUpstream) {
      unpushedCount = statusData.ahead || 0;
    }

    commits = commitsData.commits || [];
    renderHistoryView();
  }

  function renderHistoryView() {
    if (!historyList) return;

    if (!commits || commits.length === 0) {
      historyList.innerHTML = `<div class="history-empty">${escapeHtml(text.noCommits)}</div>`;
      return;
    }

    let html = `
      <div class="history-header">
        <span class="history-title">${escapeHtml(text.headerTitle)}</span>
        <button class="history-help-btn" aria-label="${escapeHtml(text.helpTitle)}" title="${escapeHtml(text.helpTitle)}">?</button>
      </div>`;

    if (unpushedCount > 0) {
      html += `
        <div class="unpushed-header">
          <span class="unpushed-icon">\u2191</span>
          <span>${escapeHtml(text.unpushedLabel(unpushedCount))}</span>
        </div>`;
    }

    html += commits.map((commit, i) => {
      const isUnpushed = i < unpushedCount;
      return `
        <div class="commit-item${isUnpushed ? ' unpushed' : ''}" data-hash="${commit.hash}">
          <div class="commit-header">
            <span class="commit-hash">${commit.hash.slice(0, 7)}</span>
            ${isUnpushed ? '<span class="unpushed-badge">unpushed</span>' : ''}
            <span class="commit-time">${escapeHtml(commit.time)}</span>
          </div>
          <div class="commit-message">${escapeHtml(commit.message)}</div>
          <div class="commit-footer">
            <span class="commit-author">${escapeHtml(commit.author)}</span>
            <div class="commit-actions">
              ${i === 0 ? '<button class="commit-action-btn" data-action="undo" title="Undo last commit (soft reset)">\u21b6</button>' : ''}
              <button class="commit-action-btn" data-action="revert" title="Revert this commit">\u21a9</button>
              <button class="commit-action-btn danger" data-action="reset" title="Reset to this commit">\u27f2</button>
            </div>
          </div>
        </div>`;
    }).join('');

    historyList.innerHTML = html;

    const helpBtn = historyList.querySelector('.history-help-btn');
    if (helpBtn) {
      helpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showGitLegendPopover(helpBtn);
      });
    }

    historyList.querySelectorAll('.commit-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.commit-actions')) return;
        viewCommitDiff(item.dataset.hash);
      });
    });

    attachCommitActionListeners();
  }

  function attachCommitActionListeners() {
    if (!historyList) return;

    historyList.querySelectorAll('.commit-action-btn').forEach((btn) => {
      const handleAction = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (btn.dataset.processing === 'true') return;
        btn.dataset.processing = 'true';
        setTimeout(() => { btn.dataset.processing = 'false'; }, buttonProcessingTimeout);

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
      title: text.undoTitle,
      message: text.undoMessage,
      confirmLabel: text.undoConfirm,
      danger: true,
    });
    if (!confirmed) return;

    const result = ensureResult(await requestUndoCommit(), text.undoTitle);
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || text.loadFailed, { variant: 'error' });
      return;
    }

    showToast(text.undoSuccess, 'success');
    onUndoSuccess();
    await loadCommits();
  }

  async function handleRevert(hash) {
    const confirmed = await showDialog({
      title: text.revertTitle,
      message: text.revertMessage(hash),
      confirmLabel: text.revertConfirm,
      danger: true,
    });
    if (!confirmed) return;

    const result = ensureResult(await requestRevertCommit(hash), text.revertTitle);
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || text.loadFailed, { variant: 'error' });
      return;
    }

    showToast(text.revertSuccess, 'success');
    onRevertSuccess();
    await loadCommits();
  }

  async function handleReset(hash) {
    const mode = await showResetModeDialog(hash);
    if (!mode) return;

    if (mode === 'hard') {
      const confirmed = await showDialog({
        title: text.hardResetTitle,
        message: text.hardResetMessage,
        danger: true,
        confirmLabel: text.hardResetConfirm,
      });
      if (!confirmed) return;
    }

    const result = ensureResult(await requestResetCommit(hash, mode), text.resetTitle(hash));
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || text.loadFailed, { variant: 'error' });
      return;
    }

    showToast(text.resetSuccess(hash, mode), 'success');
    onResetSuccess();
    await loadCommits();
  }

  function showResetModeDialog(hash) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';
      overlay.innerHTML = `
        <div class="dialog">
          <div class="dialog-title">${escapeHtml(text.resetTitle(hash))}</div>
          <div class="dialog-body">
            <div class="reset-mode-options">
              <label class="reset-mode-option">
                <input type="radio" name="reset-mode" value="soft" checked>
                <div class="reset-mode-info">
                  <span class="reset-mode-name">${escapeHtml(text.resetModeSoftName)}</span>
                  <span class="reset-mode-desc">${escapeHtml(text.resetModeSoftDesc)}</span>
                </div>
              </label>
              <label class="reset-mode-option">
                <input type="radio" name="reset-mode" value="mixed">
                <div class="reset-mode-info">
                  <span class="reset-mode-name">${escapeHtml(text.resetModeMixedName)}</span>
                  <span class="reset-mode-desc">${escapeHtml(text.resetModeMixedDesc)}</span>
                </div>
              </label>
              <label class="reset-mode-option">
                <input type="radio" name="reset-mode" value="hard">
                <div class="reset-mode-info">
                  <span class="reset-mode-name">${escapeHtml(text.resetModeHardName)}</span>
                  <span class="reset-mode-desc danger-text">${escapeHtml(text.resetModeHardDesc)}</span>
                </div>
              </label>
            </div>
          </div>
          <div class="dialog-actions">
            <button class="btn-secondary dialog-cancel">Cancel</button>
            <button class="btn-primary dialog-ok">${escapeHtml(text.resetConfirm)}</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);
      const cleanup = () => overlay.remove();

      overlay.querySelector('.dialog-cancel').addEventListener('click', () => {
        cleanup();
        resolve(null);
      });

      overlay.querySelector('.dialog-ok').addEventListener('click', () => {
        const selected = overlay.querySelector('input[name="reset-mode"]:checked');
        cleanup();
        resolve(selected ? selected.value : 'soft');
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
    const existing = document.querySelector('.git-legend-popover');
    if (existing) {
      existing.remove();
      return;
    }

    const popover = document.createElement('div');
    popover.className = 'git-legend-popover';
    popover.innerHTML = `
      <div class="git-legend-title">${escapeHtml(text.legendTitle)}</div>
      <div class="git-legend-item">
        <span class="git-legend-icon">\u21b6</span>
        <div class="git-legend-content">
          <span class="git-legend-name">Undo</span>
          <span class="git-legend-desc">${escapeHtml(text.legendUndoDesc)}</span>
        </div>
      </div>
      <div class="git-legend-item">
        <span class="git-legend-icon">\u21a9</span>
        <div class="git-legend-content">
          <span class="git-legend-name">Revert</span>
          <span class="git-legend-desc">${escapeHtml(text.legendRevertDesc)}</span>
        </div>
      </div>
      <div class="git-legend-item">
        <span class="git-legend-icon danger">\u27f2</span>
        <div class="git-legend-content">
          <span class="git-legend-name">Reset</span>
          <span class="git-legend-desc">${escapeHtml(text.legendResetDesc)}</span>
        </div>
      </div>`;

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

    const handleOutsideClick = (e) => {
      if (!popover.contains(e.target) && e.target !== anchorBtn) {
        closePopover();
      }
    };

    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closePopover();
      }
    };

    setTimeout(() => {
      document.addEventListener('click', handleOutsideClick);
      document.addEventListener('keydown', handleKeydown, true);
    }, 0);
  }

  async function viewCommitDiff(hash) {
    haptic();
    if (fileViewerName) fileViewerName.textContent = `${hash.slice(0, 7)}`;
    if (fileViewerContent) fileViewerContent.innerHTML = '<code>Loading...</code>';
    if (fileViewer) {
      fileViewer.classList.remove('hidden');
      setTimeout(() => fileViewer.classList.add('open'), animationDelayMs);
    }

    const result = ensureResult(await requestCommitDiff(hash), text.diffLoadFailed);
    if (!result.ok) {
      if (fileViewerContent) {
        fileViewerContent.innerHTML = `<div class="file-viewer-error"><p>${escapeHtml(result.error || text.diffLoadFailed)}</p></div>`;
      }
      return;
    }

    const data = result.data || {};
    if (data.error) {
      if (fileViewerContent) {
        fileViewerContent.innerHTML = `<div class="file-viewer-error"><p>${escapeHtml(data.error)}</p></div>`;
      }
      return;
    }

    if (fileViewerName) {
      fileViewerName.textContent = `${hash.slice(0, 7)} - ${data.message}`;
    }
    renderDiff(data);
  }

  return {
    loadCommits,
  };
}
