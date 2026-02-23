function noop() {}

export function renderStashSection(stashes, escapeHtml) {
  if (!stashes || stashes.length === 0) return '';

  return `
    <div class="stash-section">
      <div class="stash-section-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6"/><path d="M9 15h6"/></svg>
        <span class="stash-section-title">Stashes</span>
        <span class="stash-section-count">${stashes.length}</span>
      </div>
      <div class="stash-list">
        ${stashes.map((stash) => `
          <div class="stash-item" data-index="${stash.index}">
            <span class="stash-message">${escapeHtml(stash.message)}</span>
            <span class="stash-time">${escapeHtml(stash.time)}</span>
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

export function bindStashListeners({
  changesList,
  haptic = noop,
  showDialog = async () => true,
  buttonProcessingTimeout = 250,
  onPop = noop,
  onApply = noop,
  onDrop = noop,
}) {
  if (!changesList) return;

  changesList.querySelectorAll('.stash-action-btn').forEach((btn) => {
    const handleAction = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (btn.dataset.processing === 'true') return;
      btn.dataset.processing = 'true';
      setTimeout(() => {
        btn.dataset.processing = 'false';
      }, buttonProcessingTimeout);

      const item = btn.closest('.stash-item');
      if (!item) return;

      const index = Number.parseInt(item.dataset.index, 10);
      const action = btn.dataset.action;
      haptic();

      if (action === 'pop') {
        await onPop(index);
      } else if (action === 'apply') {
        await onApply(index);
      } else if (action === 'drop') {
        const confirmed = await showDialog({
          title: 'Drop stash?',
          message: 'This will permanently delete the stash. This cannot be undone.',
          danger: true,
          confirmLabel: 'Drop',
        });
        if (confirmed) {
          await onDrop(index);
        }
      }
    };

    btn.addEventListener('click', handleAction);
    btn.addEventListener('touchend', handleAction);
  });
}
