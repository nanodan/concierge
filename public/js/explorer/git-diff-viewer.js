function noop() {}

function getChangedFileEntries(gitStatus) {
  const entries = [];
  (gitStatus?.staged || []).forEach((file) => {
    entries.push({ path: file.path, staged: true });
  });
  (gitStatus?.unstaged || []).forEach((file) => {
    entries.push({ path: file.path, staged: false });
  });
  return entries;
}

export function createGitDiffViewer({
  fileViewer,
  fileViewerName,
  fileViewerContent,
  granularToggleBtn,
  escapeHtml,
  haptic = noop,
  showDialog = async () => true,
  showToast = noop,
  animationDelayMs = 0,
  getNavigationStatus = () => null,
  setViewingDiff = noop,
  fetchDiff = async () => ({ ok: false, error: 'Failed to load diff' }),
  applyDiffHunkAction = async () => ({ ok: false, error: 'Failed to apply chunk action' }),
  closeAfterHunkAction = noop,
  refreshAfterHunkAction = noop,
  granularStorageKey = 'gitGranularMode',
  swipeThreshold = 50,
}) {
  let granularMode = localStorage.getItem(granularStorageKey) === 'true';
  let currentDiffData = null;
  let diffNavEntries = [];
  let currentDiffIndex = -1;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoveX = 0;

  function isDiffOpen() {
    return !!fileViewer && fileViewer.classList.contains('open');
  }

  function setDiffError(message) {
    if (!fileViewerContent) return;
    fileViewerContent.innerHTML = `<div class="file-viewer-error"><p>${escapeHtml(message || 'Failed to load diff')}</p></div>`;
  }

  function clearDiffNavigation() {
    diffNavEntries = [];
    currentDiffIndex = -1;

    if (!fileViewer) return;
    const nav = fileViewer.querySelector('.file-viewer-nav');
    if (!nav) return;
    nav.classList.remove('diff-nav-mode');
  }

  function updateDiffNavigationUi() {
    if (!fileViewer) return;

    const nav = fileViewer.querySelector('.file-viewer-nav');
    if (!nav) return;

    const prevBtn = nav.querySelector('.file-nav-prev');
    const nextBtn = nav.querySelector('.file-nav-next');
    const counter = nav.querySelector('.file-nav-counter');
    if (!prevBtn || !nextBtn || !counter) return;

    const total = diffNavEntries.length;
    if (total <= 1 || currentDiffIndex < 0) {
      nav.classList.add('hidden');
      nav.classList.remove('diff-nav-mode');
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      counter.textContent = '';
      return;
    }

    nav.classList.remove('hidden');
    nav.classList.add('diff-nav-mode');
    prevBtn.disabled = currentDiffIndex <= 0;
    nextBtn.disabled = currentDiffIndex >= total - 1;
    counter.textContent = `${currentDiffIndex + 1} / ${total}`;
  }

  function syncDiffNavigation(path, staged) {
    diffNavEntries = getChangedFileEntries(getNavigationStatus());
    currentDiffIndex = diffNavEntries.findIndex((entry) => entry.path === path && entry.staged === staged);
    if (currentDiffIndex === -1) {
      currentDiffIndex = diffNavEntries.findIndex((entry) => entry.path === path);
    }
    updateDiffNavigationUi();
  }

  function isDiffNavigationActive() {
    return currentDiffIndex >= 0 && diffNavEntries.length > 0 && isDiffOpen();
  }

  function clearDiffState() {
    currentDiffData = null;
    clearDiffNavigation();
    setViewingDiff(null);
  }

  function hideGranularToggle() {
    if (granularToggleBtn) {
      granularToggleBtn.classList.add('hidden');
    }
    clearDiffState();
  }

  function updateGranularToggleState() {
    if (!granularToggleBtn) return;
    granularToggleBtn.classList.toggle('active', granularMode);
    granularToggleBtn.title = granularMode ? 'Switch to simple view' : 'Switch to granular view (accept/reject per chunk)';
  }

  function renderSimpleView(raw) {
    if (!fileViewerContent) return;
    const lines = (raw || '').split('\n');
    let html = '';

    for (const line of lines) {
      let className = 'diff-context';
      if (line.startsWith('+') && !line.startsWith('+++')) {
        className = 'diff-add';
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        className = 'diff-del';
      } else if (line.startsWith('@@')) {
        className = 'diff-hunk-header';
      } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
        className = 'diff-meta';
      }

      html += `<div class="${className}">${escapeHtml(line)}</div>`;
    }

    fileViewerContent.innerHTML = `<code class="diff-view">${html}</code>`;
  }

  function getHunkActionDescriptors(staged) {
    if (staged) {
      return [{ action: 'reject', label: 'Unstage', className: 'reject', title: 'Remove this chunk from staged changes' }];
    }
    return [
      { action: 'accept', label: 'Accept', className: 'accept', title: 'Stage this chunk' },
      { action: 'reject', label: 'Reject', className: 'reject', title: 'Discard this chunk from working tree' },
    ];
  }

  async function handleHunkAction(filePath, hunkIndex, hunk, staged, action) {
    const isReject = action === 'reject';
    if (isReject) {
      const confirmed = await showDialog({
        title: staged ? 'Unstage this chunk?' : 'Reject this chunk?',
        message: staged
          ? 'This removes this chunk from staged changes.'
          : 'This discards this chunk from your working copy.',
        danger: true,
        confirmLabel: staged ? 'Unstage' : 'Reject',
      });
      if (!confirmed) return;
    }

    const result = await applyDiffHunkAction(filePath, hunkIndex, hunk, staged, action);
    if (!result?.ok) {
      showToast(result?.error || 'Failed to apply chunk action', { variant: 'error' });
      return;
    }

    if (action === 'accept') showToast('Chunk staged');
    else if (staged) showToast('Chunk unstaged');
    else showToast('Chunk discarded');

    await refreshAfterHunkAction();
    const reopened = await openDiff(filePath, staged);
    if (!reopened) {
      const reopenedOpposite = await openDiff(filePath, !staged);
      if (reopenedOpposite) return;
      clearDiffState();
      await closeAfterHunkAction();
    }
  }

  function renderHunksView(hunks, filePath, staged) {
    if (!fileViewerContent) return;
    let html = '';

    hunks.forEach((hunk, index) => {
      const headerMatch = hunk.header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)?/);
      const context = headerMatch && headerMatch[5] ? headerMatch[5].trim() : '';
      const lineInfo = `Lines ${hunk.oldStart}-${hunk.oldStart + hunk.oldLines - 1}`;

      let additions = 0;
      let deletions = 0;
      for (const line of hunk.lines) {
        if (line.startsWith('+')) additions++;
        else if (line.startsWith('-')) deletions++;
      }

      const actions = getHunkActionDescriptors(staged);
      html += `
        <div class="diff-hunk" data-hunk-index="${index}">
          <div class="diff-hunk-toolbar">
            <div class="diff-hunk-info">
              <span class="diff-hunk-lines">${lineInfo}</span>
              ${context ? `<span class="diff-hunk-context">${escapeHtml(context)}</span>` : ''}
              <span class="diff-hunk-stats">
                ${additions > 0 ? `<span class="diff-stat-add">+${additions}</span>` : ''}
                ${deletions > 0 ? `<span class="diff-stat-del">-${deletions}</span>` : ''}
              </span>
            </div>
            <div class="diff-hunk-actions">
              ${actions.map((item) => `
                <button class="diff-hunk-action-btn ${item.className}" data-hunk-index="${index}" data-action="${item.action}" title="${item.title}">
                  ${item.label}
                </button>
              `).join('')}
            </div>
          </div>
          <code class="diff-hunk-code">`;

      for (const line of hunk.lines) {
        let className = 'diff-context';
        if (line.startsWith('+')) className = 'diff-add';
        else if (line.startsWith('-')) className = 'diff-del';
        html += `<div class="${className}">${escapeHtml(line)}</div>`;
      }

      html += '</code></div>';
    });

    fileViewerContent.innerHTML = `<div class="diff-hunks-view">${html}</div>`;

    fileViewerContent.querySelectorAll('.diff-hunk-action-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.dataset.processing === 'true') return;
        btn.dataset.processing = 'true';
        haptic();

        try {
          const hunkIndex = parseInt(btn.dataset.hunkIndex, 10);
          const hunk = hunks[hunkIndex];
          const action = btn.dataset.action || 'reject';
          await handleHunkAction(filePath, hunkIndex, hunk, staged, action);
        } finally {
          btn.dataset.processing = 'false';
        }
      });
    });
  }

  function renderDiff(data) {
    const { hunks, raw, path, staged } = data || {};
    const hasHunks = Array.isArray(hunks) && hunks.length > 0;

    if (granularToggleBtn) {
      granularToggleBtn.classList.toggle('hidden', !hasHunks);
      updateGranularToggleState();
    }

    if (granularMode && hasHunks) {
      renderHunksView(hunks, path, staged);
      return;
    }

    renderSimpleView(raw || '');
  }

  function toggleGranularMode() {
    granularMode = !granularMode;
    localStorage.setItem(granularStorageKey, granularMode.toString());
    updateGranularToggleState();
    if (currentDiffData) {
      renderDiff(currentDiffData);
    }
  }

  async function openDiff(filePath, staged) {
    if (!fileViewer || !fileViewerName || !fileViewerContent) return false;

    const filename = filePath.split('/').pop();
    fileViewerName.textContent = filename;
    fileViewerContent.innerHTML = '<code>Loading diff...</code>';
    setViewingDiff({ path: filePath, staged });
    syncDiffNavigation(filePath, staged);

    fileViewer.classList.remove('hidden');
    setTimeout(() => fileViewer.classList.add('open'), animationDelayMs);

    const result = await fetchDiff(filePath, staged);
    if (!result?.ok) {
      setDiffError(result?.error || 'Failed to load diff');
      currentDiffData = null;
      return false;
    }

    const data = result.data || {};
    if (!data.raw || data.raw.trim() === '') {
      setDiffError('No changes to display');
      currentDiffData = null;
      return false;
    }

    currentDiffData = { ...data, path: filePath, staged };
    renderDiff(currentDiffData);
    return true;
  }

  function navigateDiff(direction) {
    if (currentDiffIndex < 0 || diffNavEntries.length <= 1) return;

    const nextIndex = currentDiffIndex + direction;
    if (nextIndex < 0 || nextIndex >= diffNavEntries.length) return;

    const nextEntry = diffNavEntries[nextIndex];
    void openDiff(nextEntry.path, nextEntry.staged);
  }

  function setupDiffNavigationHandlers() {
    if (!fileViewer) return;

    fileViewer.addEventListener('click', (e) => {
      if (!isDiffNavigationActive()) return;
      const btn = e.target.closest('.file-nav-btn');
      if (!btn) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      haptic();

      if (btn.classList.contains('file-nav-prev')) {
        navigateDiff(-1);
      } else if (btn.classList.contains('file-nav-next')) {
        navigateDiff(1);
      }
    }, true);

    document.addEventListener('keydown', (e) => {
      if (!isDiffNavigationActive()) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        haptic();
        navigateDiff(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopImmediatePropagation();
        haptic();
        navigateDiff(1);
      }
    }, true);

    fileViewer.addEventListener('touchstart', (e) => {
      if (!isDiffNavigationActive()) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchMoveX = touchStartX;
    }, { capture: true, passive: true });

    fileViewer.addEventListener('touchmove', (e) => {
      if (!isDiffNavigationActive()) return;
      touchMoveX = e.touches[0].clientX;
    }, { capture: true, passive: true });

    fileViewer.addEventListener('touchend', (e) => {
      if (!isDiffNavigationActive()) return;

      const deltaX = touchMoveX - touchStartX;
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(deltaX) > swipeThreshold && Math.abs(deltaX) > Math.abs(deltaY)) {
        haptic();
        if (deltaX > 0) {
          navigateDiff(-1);
        } else {
          navigateDiff(1);
        }
      }

      touchStartX = 0;
      touchStartY = 0;
      touchMoveX = 0;
    }, { capture: true, passive: true });
  }

  if (granularToggleBtn) {
    granularToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      haptic();
      toggleGranularMode();
    });
  }
  setupDiffNavigationHandlers();

  return {
    openDiff,
    renderDiff,
    hideGranularToggle,
    clearDiffState,
  };
}
