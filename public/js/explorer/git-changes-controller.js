import { bindStashListeners, renderStashSection as renderSharedStashSection } from './git-stash.js';

function noop() {}

const DEFAULT_CHECKMARK = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';

function ensureResult(result, fallbackError) {
  if (!result) return { ok: false, error: fallbackError };
  if (typeof result.ok === 'boolean') return result;
  return { ok: true, data: result };
}

function normalizeWorkflowPatchStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'queued' || value === 'conflict') return value;
  return '';
}

export function createGitChangesController({
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
  haptic = noop,
  showDialog = async () => true,
  showToast = noop,
  buttonProcessingTimeout = 250,
  icons = {},
  enableUntrackedSelection = false,
  onViewDiff = noop,
  requestStatus = async () => ({ ok: false, error: 'Not implemented' }),
  requestStashes = async () => ({ ok: true, data: { stashes: [] } }),
  requestStage = async () => ({ ok: false, error: 'Not implemented' }),
  requestUnstage = async () => ({ ok: false, error: 'Not implemented' }),
  requestDiscard = async () => ({ ok: false, error: 'Not implemented' }),
  requestDeleteUntracked = async () => ({ ok: false, error: 'Not implemented' }),
  requestCommit = async () => ({ ok: false, error: 'Not implemented' }),
  requestPush = async () => ({ ok: false, error: 'Not implemented' }),
  requestPull = async () => ({ ok: false, error: 'Not implemented' }),
  requestWorkflowPatches = async () => ({ ok: true, data: { patches: [] } }),
  requestApplyWorkflowPatch = async () => ({ ok: false, error: 'Not implemented' }),
  requestRejectWorkflowPatch = async () => ({ ok: false, error: 'Not implemented' }),
  canApplyWorkflowPatches = true,
  stashActions = null,
}) {
  let gitStatus = null;
  let stashes = [];
  let workflowPatches = [];
  let untrackedSelectionMode = false;
  const selectedUntracked = new Set();
  let actionListenersBound = false;

  function getGitStatus() {
    return gitStatus;
  }

  function setGitStatus(status) {
    gitStatus = status;
  }

  function getStashes() {
    return stashes;
  }

  function setStashes(nextStashes) {
    stashes = Array.isArray(nextStashes) ? nextStashes : [];
  }

  function getWorkflowPatches() {
    return workflowPatches;
  }

  function setWorkflowPatches(nextPatches) {
    workflowPatches = Array.isArray(nextPatches)
      ? nextPatches.filter((item) => normalizeWorkflowPatchStatus(item?.status))
      : [];
  }

  function resetUntrackedSelection() {
    untrackedSelectionMode = false;
    selectedUntracked.clear();
  }

  async function loadStatus() {
    if (changesList) {
      changesList.innerHTML = '<div class="changes-loading">Loading...</div>';
    }
    if (commitForm) {
      commitForm.classList.add('hidden');
    }

    const statusResult = ensureResult(await requestStatus(), 'Failed to load git status');
    if (!statusResult.ok) {
      if (changesList) {
        changesList.innerHTML = `<div class="changes-empty">${escapeHtml(statusResult.error || 'Failed to load git status')}</div>`;
      }
      return;
    }

    const statusData = statusResult.data || {};
    setGitStatus(statusData);

    if (!statusData.isRepo) {
      renderNotARepo();
      return;
    }

    const stashesPromise = requestStashes();
    const workflowPatchesPromise = requestWorkflowPatches();
    renderChangesView();

    const stashesResult = ensureResult(await stashesPromise, '');
    const stashData = stashesResult.data || {};
    setStashes(stashesResult.ok ? (stashData.stashes || []) : []);

    const workflowPatchesResult = ensureResult(await workflowPatchesPromise, '');
    const workflowData = workflowPatchesResult.data || {};
    setWorkflowPatches(workflowPatchesResult.ok ? (workflowData.patches || []) : []);

    if (getGitStatus()?.isRepo) {
      renderChangesView();
    }
  }

  function renderNotARepo() {
    if (changesList) {
      changesList.innerHTML = `
        <div class="changes-empty">
          ${icons.error || ''}
          <p>Not a git repository</p>
        </div>`;
    }

    if (branchSelector) branchSelector.classList.add('hidden');
    if (stashBtn) stashBtn.disabled = true;
    if (pushBtn) pushBtn.disabled = true;
    if (pullBtn) pullBtn.disabled = true;
  }

  function renderChangesView() {
    if (!gitStatus || !changesList) return;

    const staged = gitStatus.staged || [];
    const unstaged = gitStatus.unstaged || [];
    const untracked = gitStatus.untracked || [];
    const {
      branch = '',
      ahead = 0,
      behind = 0,
      hasOrigin = false,
      hasUpstream = false,
    } = gitStatus;
    const hasChanges = staged.length > 0 || unstaged.length > 0 || untracked.length > 0;

    if (branchSelector) {
      branchSelector.classList.remove('hidden');
      const branchName = branchSelector.querySelector('.branch-name');
      if (branchName) branchName.textContent = branch;
    }

    if (aheadBehindBadge) {
      if (hasUpstream && (ahead > 0 || behind > 0)) {
        let badgeHtml = '';
        if (ahead > 0) badgeHtml += `<span class="ahead">\u2191${ahead}</span>`;
        if (behind > 0) badgeHtml += `<span class="behind">\u2193${behind}</span>`;
        aheadBehindBadge.innerHTML = badgeHtml;
        aheadBehindBadge.classList.remove('hidden');
      } else {
        aheadBehindBadge.classList.add('hidden');
      }
    }

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
      pullBtn.title = behind > 0
        ? `Pull ${behind} commit${behind > 1 ? 's' : ''} from remote`
        : 'Pull from remote';
    }

    if (stashBtn) {
      stashBtn.disabled = !hasChanges;
      stashBtn.title = hasChanges ? 'Stash changes' : 'No changes to stash';
    }

    if (!hasChanges) {
      let cleanHtml = `
        <div class="changes-empty">
          ${icons.checkmark || DEFAULT_CHECKMARK}
          <p>Working tree clean</p>
        </div>`;

      if (stashes.length > 0) {
        cleanHtml += renderSharedStashSection(stashes, escapeHtml);
      }
      if (workflowPatches.length > 0) {
        cleanHtml += renderWorkflowPatchSection();
      }

      changesList.innerHTML = cleanHtml;
      attachStashListeners();
      attachWorkflowPatchListeners();
      if (commitForm) commitForm.classList.add('hidden');
      return;
    }

    let html = '';

    if (staged.length > 0) {
      html += `
        <div class="changes-section">
          <div class="changes-section-header">
            <span class="changes-section-title">Staged Changes</span>
            <span class="changes-section-count">${staged.length}</span>
            <button class="changes-section-btn" data-action="unstage-all" title="Unstage All">\u2212 All</button>
          </div>
          ${staged.map((file) => renderChangeItem(file, 'staged')).join('')}
        </div>`;
    }

    if (unstaged.length > 0) {
      html += `
        <div class="changes-section">
          <div class="changes-section-header">
            <span class="changes-section-title">Changes</span>
            <span class="changes-section-count">${unstaged.length}</span>
            <button class="changes-section-btn" data-action="stage-all-unstaged" title="Stage All">+ All</button>
          </div>
          ${unstaged.map((file) => renderChangeItem(file, 'unstaged')).join('')}
        </div>`;
    }

    if (untracked.length > 0) {
      html += `
        <div class="changes-section untracked-section${enableUntrackedSelection && untrackedSelectionMode ? ' selection-mode' : ''}">
          <div class="changes-section-header">
            <span class="changes-section-title">Untracked Files</span>
            <span class="changes-section-count">${untracked.length}</span>
            ${renderUntrackedSectionButtons()}
          </div>
          ${untracked.map((file) => renderChangeItem({ ...file, status: '?' }, 'untracked')).join('')}
        </div>`;
    }

    if (stashes.length > 0) {
      html += renderSharedStashSection(stashes, escapeHtml);
    }
    if (workflowPatches.length > 0) {
      html += renderWorkflowPatchSection();
    }

    changesList.innerHTML = html;
    attachChangeItemListeners();
    attachStashListeners();
    attachWorkflowPatchListeners();

    if (commitForm) {
      commitForm.classList.toggle('hidden', staged.length === 0);
    }
  }

  function renderUntrackedSectionButtons() {
    if (!enableUntrackedSelection) {
      return '<button class="changes-section-btn" data-action="stage-all-untracked" title="Stage All">+ All</button>';
    }

    if (untrackedSelectionMode) {
      return `
        <button class="changes-section-btn danger" data-action="delete-selected" title="Delete Selected"${selectedUntracked.size === 0 ? ' disabled' : ''}>Delete (${selectedUntracked.size})</button>
        <button class="changes-section-btn select-btn active" data-action="toggle-select" title="Cancel">Cancel</button>`;
    }

    return `
      <button class="changes-section-btn" data-action="stage-all-untracked" title="Stage All">+ All</button>
      <button class="changes-section-btn select-btn" data-action="toggle-select" title="Select Multiple">Select</button>`;
  }

  function renderChangeItem(file, type) {
    const statusLabels = {
      M: 'modified',
      A: 'added',
      D: 'deleted',
      R: 'renamed',
      C: 'copied',
      '?': 'untracked',
    };

    const statusLabel = statusLabels[file.status] || file.status;
    const normalizedPath = file.path.replace(/\/$/, '');
    const filename = normalizedPath.split('/').pop() + (file.path.endsWith('/') ? '/' : '');
    const isSelected = enableUntrackedSelection && type === 'untracked' && selectedUntracked.has(file.path);
    const showCheckbox = enableUntrackedSelection && type === 'untracked' && untrackedSelectionMode;

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
        ${showCheckbox ? '' : `
          <div class="changes-item-actions">
            ${type === 'staged' ? '<button class="changes-action-btn" data-action="unstage" title="Unstage">\u2212</button>' : ''}
            ${type === 'unstaged' ? '<button class="changes-action-btn" data-action="stage" title="Stage">+</button>' : ''}
            ${type === 'unstaged' ? '<button class="changes-action-btn danger" data-action="discard" title="Discard">\u00d7</button>' : ''}
            ${type === 'untracked' ? '<button class="changes-action-btn" data-action="stage" title="Stage">+</button>' : ''}
            ${type === 'untracked' ? '<button class="changes-action-btn danger" data-action="delete" title="Delete">\u00d7</button>' : ''}
          </div>
        `}
      </div>`;
  }

  function attachChangeItemListeners() {
    if (!changesList) return;

    changesList.querySelectorAll('.changes-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.changes-action-btn')) return;

        const filePath = item.dataset.path;
        const type = item.dataset.type;

        if (enableUntrackedSelection && type === 'untracked' && untrackedSelectionMode) {
          haptic(5);
          toggleUntrackedSelection(filePath);
          return;
        }

        if (type !== 'untracked') {
          onViewDiff(filePath, type === 'staged');
        }
      });
    });

    changesList.querySelectorAll('.changes-action-btn').forEach((btn) => {
      const handleAction = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (btn.dataset.processing === 'true') return;
        btn.dataset.processing = 'true';
        setTimeout(() => {
          btn.dataset.processing = 'false';
        }, buttonProcessingTimeout);

        const item = btn.closest('.changes-item');
        if (!item) return;

        const filePath = item.dataset.path;
        const action = btn.dataset.action;
        haptic();

        if (action === 'stage') {
          await stagePaths([filePath]);
        } else if (action === 'unstage') {
          await unstagePaths([filePath]);
        } else if (action === 'discard') {
          const confirmed = await showDialog({
            title: 'Discard changes?',
            message: `Discard all changes to ${filePath}?`,
            danger: true,
            confirmLabel: 'Discard',
          });
          if (confirmed) {
            await discardPaths([filePath]);
          }
        } else if (action === 'delete') {
          const filename = filePath.split('/').pop();
          const confirmed = await showDialog({
            title: 'Delete file?',
            message: `Delete "${filename}"? This cannot be undone.`,
            danger: true,
            confirmLabel: 'Delete',
          });
          if (confirmed) {
            await deleteUntracked(filePath);
          }
        }
      };

      btn.addEventListener('click', handleAction);
      btn.addEventListener('touchend', handleAction);
    });

    changesList.querySelectorAll('.changes-section-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        haptic();

        const action = btn.dataset.action;
        if (action === 'unstage-all' && gitStatus?.staged) {
          await unstagePaths(gitStatus.staged.map((file) => file.path));
        } else if (action === 'stage-all-unstaged' && gitStatus?.unstaged) {
          await stagePaths(gitStatus.unstaged.map((file) => file.path));
        } else if (action === 'stage-all-untracked' && gitStatus?.untracked) {
          await stagePaths(gitStatus.untracked.map((file) => file.path));
        } else if (enableUntrackedSelection && action === 'toggle-select') {
          if (untrackedSelectionMode) {
            exitUntrackedSelectionMode();
          } else {
            enterUntrackedSelectionMode();
          }
        } else if (enableUntrackedSelection && action === 'delete-selected') {
          await deleteSelectedUntracked();
        }
      });
    });
  }

  function attachStashListeners() {
    bindStashListeners({
      changesList,
      haptic,
      showDialog,
      buttonProcessingTimeout,
      onPop: async (index) => stashActions?.handleStashPop?.(index),
      onApply: async (index) => stashActions?.handleStashApply?.(index),
      onDrop: async (index) => stashActions?.handleStashDrop?.(index),
    });
  }

  function renderWorkflowPatchSection() {
    const patches = getWorkflowPatches();
    if (!patches.length) return '';

    return `
      <div class="patch-queue-section">
        <div class="patch-queue-header">
          <span class="patch-queue-title">Patch Queue</span>
          <span class="patch-queue-count">${patches.length}</span>
        </div>
        <div class="patch-queue-list">
          ${patches.map((patch) => renderWorkflowPatchItem(patch)).join('')}
        </div>
      </div>
    `;
  }

  function renderWorkflowPatchItem(patch) {
    const title = (patch.title || 'Untitled patch').trim() || 'Untitled patch';
    const status = normalizeWorkflowPatchStatus(patch.status);
    const statusLabel = status === 'conflict' ? 'CONFLICT' : 'QUEUED';
    const statusClass = status === 'conflict' ? 'status-conflict' : 'status-queued';
    const hasReason = patch.applyMeta?.reason ? String(patch.applyMeta.reason) : '';
    const applyLabel = status === 'conflict' ? 'Retry' : 'Apply';
    const applyBtn = canApplyWorkflowPatches
      ? `<button class="patch-queue-action-btn" data-action="apply" data-id="${escapeHtml(patch.id)}">${applyLabel}</button>`
      : '<span class="patch-queue-readonly">Open a conversation to apply</span>';

    return `
      <div class="patch-queue-item" data-id="${escapeHtml(patch.id)}" data-status="${escapeHtml(status)}">
        <span class="patch-queue-status ${statusClass}">${statusLabel}</span>
        <span class="patch-queue-name" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        ${hasReason ? `<span class="patch-queue-reason" title="${escapeHtml(hasReason)}">${escapeHtml(hasReason)}</span>` : ''}
        <div class="patch-queue-actions">
          ${applyBtn}
          <button class="patch-queue-action-btn danger" data-action="reject" data-id="${escapeHtml(patch.id)}">Reject</button>
        </div>
      </div>
    `;
  }

  function attachWorkflowPatchListeners() {
    if (!changesList) return;

    changesList.querySelectorAll('.patch-queue-action-btn').forEach((btn) => {
      const handleAction = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (btn.dataset.processing === 'true') return;
        btn.dataset.processing = 'true';
        setTimeout(() => {
          btn.dataset.processing = 'false';
        }, buttonProcessingTimeout);

        const action = btn.dataset.action;
        const patchId = btn.dataset.id;
        if (!patchId) return;
        haptic();

        if (action === 'apply') {
          await applyWorkflowPatch(patchId);
        } else if (action === 'reject') {
          await rejectWorkflowPatch(patchId);
        }
      };

      btn.addEventListener('click', handleAction);
      btn.addEventListener('touchend', handleAction);
    });
  }

  async function applyWorkflowPatch(patchId) {
    if (!canApplyWorkflowPatches) {
      showToast('Patch apply requires an open conversation', { variant: 'error' });
      return false;
    }

    const result = ensureResult(await requestApplyWorkflowPatch(patchId), 'Failed to apply patch');
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to apply patch', { variant: 'error' });
      await loadStatus();
      return false;
    }

    showToast('Patch applied');
    await loadStatus();
    return true;
  }

  async function rejectWorkflowPatch(patchId) {
    const reason = await showDialog({
      title: 'Reject patch',
      message: 'Optional: add a reason so others understand why this patch was rejected.',
      input: true,
      placeholder: 'Reason (optional)',
      confirmLabel: 'Reject',
      danger: true,
    });
    if (reason === null) return false;

    const result = ensureResult(await requestRejectWorkflowPatch(patchId, String(reason || '').trim()), 'Failed to reject patch');
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to reject patch', { variant: 'error' });
      return false;
    }

    showToast('Patch rejected');
    await loadStatus();
    return true;
  }

  function enterUntrackedSelectionMode() {
    if (!enableUntrackedSelection) return;
    untrackedSelectionMode = true;
    selectedUntracked.clear();
    renderChangesView();
  }

  function exitUntrackedSelectionMode() {
    if (!enableUntrackedSelection) return;
    untrackedSelectionMode = false;
    selectedUntracked.clear();
    renderChangesView();
  }

  function toggleUntrackedSelection(path) {
    if (!enableUntrackedSelection) return;

    if (selectedUntracked.has(path)) {
      selectedUntracked.delete(path);
    } else {
      selectedUntracked.add(path);
    }
    renderChangesView();
  }

  async function deleteSelectedUntracked() {
    if (!enableUntrackedSelection || selectedUntracked.size === 0) return;

    const count = selectedUntracked.size;
    const confirmed = await showDialog({
      title: `Delete ${count} file${count > 1 ? 's' : ''}?`,
      message: `This will permanently delete ${count} untracked file${count > 1 ? 's' : ''}. This cannot be undone.`,
      danger: true,
      confirmLabel: 'Delete All',
    });

    if (!confirmed) return;

    for (const path of selectedUntracked) {
      await deleteUntracked(path, { silent: true });
    }

    showToast(`Deleted ${count} file${count > 1 ? 's' : ''}`);
    resetUntrackedSelection();
    await loadStatus();
  }

  async function stagePaths(paths) {
    const result = ensureResult(await requestStage(paths), 'Failed to stage files');
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to stage files', { variant: 'error' });
      return false;
    }

    showToast('Staged');
    await loadStatus();
    return true;
  }

  async function unstagePaths(paths) {
    const result = ensureResult(await requestUnstage(paths), 'Failed to unstage files');
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to unstage files', { variant: 'error' });
      return false;
    }

    showToast('Unstaged');
    await loadStatus();
    return true;
  }

  async function discardPaths(paths) {
    const result = ensureResult(await requestDiscard(paths), 'Failed to discard changes');
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to discard changes', { variant: 'error' });
      return false;
    }

    showToast('Changes discarded');
    await loadStatus();
    return true;
  }

  async function deleteUntracked(relativePath, { silent = false } = {}) {
    const result = ensureResult(await requestDeleteUntracked(relativePath), 'Failed to delete file');
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to delete file', { variant: 'error' });
      return false;
    }

    if (!silent) {
      showToast('File deleted');
      await loadStatus();
    }

    return true;
  }

  async function handleCommit() {
    if (!commitMessage) return false;

    const message = commitMessage.value.trim();
    if (!message) {
      showToast('Enter a commit message');
      return false;
    }

    if (commitBtn) commitBtn.disabled = true;
    haptic(15);

    const result = ensureResult(await requestCommit(message), 'Failed to commit changes');
    if (commitBtn) commitBtn.disabled = false;

    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to commit changes', { variant: 'error' });
      return false;
    }

    const hash = result.data?.hash;
    showToast(hash ? `Committed ${hash}` : 'Committed');
    commitMessage.value = '';
    await loadStatus();
    return true;
  }

  async function handlePush() {
    if (!pushBtn) return false;

    haptic(15);
    pushBtn.disabled = true;

    const result = ensureResult(await requestPush(), 'Failed to push');
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to push', { variant: 'error' });
      pushBtn.disabled = false;
      return false;
    }

    showToast('Pushed successfully');
    await loadStatus();
    return true;
  }

  async function handlePull() {
    if (!pullBtn) return false;

    haptic(15);
    pullBtn.disabled = true;

    const result = ensureResult(await requestPull(), 'Failed to pull');
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to pull', { variant: 'error' });
      pullBtn.disabled = false;
      return false;
    }

    showToast('Pulled successfully');
    await loadStatus();
    return true;
  }

  function bindActionListeners() {
    if (actionListenersBound) return;
    actionListenersBound = true;

    if (commitBtn) {
      commitBtn.addEventListener('click', () => {
        void handleCommit();
      });
    }

    if (pushBtn) {
      pushBtn.addEventListener('click', () => {
        void handlePush();
      });
    }

    if (pullBtn) {
      pullBtn.addEventListener('click', () => {
        void handlePull();
      });
    }

    if (stashBtn) {
      stashBtn.addEventListener('click', () => {
        void stashActions?.handleStash?.();
      });
    }
  }

  return {
    getGitStatus,
    setGitStatus,
    getStashes,
    setStashes,
    getWorkflowPatches,
    setWorkflowPatches,
    resetUntrackedSelection,
    loadStatus,
    renderNotARepo,
    renderChangesView,
    stagePaths,
    unstagePaths,
    discardPaths,
    deleteUntracked,
    handleCommit,
    handlePush,
    handlePull,
    bindActionListeners,
  };
}
