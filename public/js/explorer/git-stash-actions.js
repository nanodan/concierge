function noop() {}

function normalizeResult(result, fallbackError) {
  if (!result) return { ok: false, error: fallbackError };
  if (typeof result.ok === 'boolean') return result;
  return { ok: true, data: result };
}

export function createGitStashActions({
  haptic = noop,
  showDialog = async () => false,
  showToast = noop,
  requestCreate = async () => ({ ok: false, error: 'Not implemented' }),
  requestPop = async () => ({ ok: false, error: 'Not implemented' }),
  requestApply = async () => ({ ok: false, error: 'Not implemented' }),
  requestDrop = async () => ({ ok: false, error: 'Not implemented' }),
  onStatusChanged = noop,
}) {
  async function handleStash() {
    haptic();

    const message = await showDialog({
      title: 'Stash changes',
      message: 'Enter an optional message for this stash:',
      input: true,
      inputPlaceholder: 'Stash message (optional)',
      confirmLabel: 'Stash',
    });
    if (message === false) return;

    const body = message ? { message } : {};
    const result = normalizeResult(await requestCreate(body), 'Failed to stash changes');
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to stash changes', 'error');
      return;
    }

    showToast('Changes stashed', 'success');
    onStatusChanged();
  }

  async function handleStashPop(index) {
    const result = normalizeResult(await requestPop(index), 'Failed to apply stash');
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to apply stash', 'error');
      return;
    }

    showToast('Stash applied and removed', 'success');
    onStatusChanged();
  }

  async function handleStashApply(index) {
    const result = normalizeResult(await requestApply(index), 'Failed to apply stash');
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to apply stash', 'error');
      return;
    }

    showToast('Stash applied', 'success');
    onStatusChanged();
  }

  async function handleStashDrop(index) {
    const result = normalizeResult(await requestDrop(index), 'Failed to drop stash');
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to drop stash', 'error');
      return;
    }

    showToast('Stash dropped', 'success');
    onStatusChanged();
  }

  return {
    handleStash,
    handleStashPop,
    handleStashApply,
    handleStashDrop,
  };
}
