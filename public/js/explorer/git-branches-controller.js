function noop() {}

function ensureResult(result, fallbackError) {
  if (!result) return { ok: false, error: fallbackError };
  if (typeof result.ok === 'boolean') return result;
  return { ok: true, data: result };
}

export function createGitBranchesController({
  branchSelector,
  branchDropdown,
  escapeHtml,
  haptic = noop,
  showToast = noop,
  showDialog = async () => null,
  requestBranches = async () => ({ ok: false, error: 'Not implemented' }),
  requestCreateBranch = async () => ({ ok: false, error: 'Not implemented' }),
  requestCheckoutBranch = async () => ({ ok: false, error: 'Not implemented' }),
  onBranchChanged = noop,
}) {
  let branches = null;
  let listenersBound = false;

  function getBranches() {
    return branches;
  }

  function setBranches(nextBranches) {
    branches = nextBranches;
  }

  function resetBranches() {
    branches = null;
    if (branchDropdown) branchDropdown.classList.add('hidden');
  }

  async function loadBranches() {
    const result = ensureResult(await requestBranches(), 'Failed to load branches');
    if (!result.ok || result.data?.error) {
      branches = null;
      return null;
    }

    branches = result.data;
    return branches;
  }

  async function toggleBranchDropdown() {
    if (!branchDropdown) return;

    haptic(5);
    const isHidden = branchDropdown.classList.contains('hidden');

    if (!isHidden) {
      branchDropdown.classList.add('hidden');
      return;
    }

    if (!branches) {
      branchDropdown.innerHTML = '<div class="branch-item">Loading...</div>';
      branchDropdown.classList.remove('hidden');

      const loaded = await loadBranches();
      if (!loaded) {
        branchDropdown.innerHTML = '<div class="branch-item">Failed to load branches</div>';
        return;
      }
    }

    renderBranchDropdown();
    branchDropdown.classList.remove('hidden');
  }

  function renderBranchDropdown() {
    if (!branchDropdown || !branches) return;

    const local = Array.isArray(branches.local) ? branches.local : [];
    const remote = Array.isArray(branches.remote) ? branches.remote : [];

    let html = '';

    for (const branch of local) {
      const isCurrent = branch === branches.current;
      html += `
        <div class="branch-item ${isCurrent ? 'current' : ''}" data-branch="${escapeHtml(branch)}">
          ${isCurrent ? '<span class="branch-check">\u2713</span>' : ''}
          <span class="branch-name">${escapeHtml(branch)}</span>
        </div>`;
    }

    const remoteOnly = remote.filter((name) => {
      const shortName = name.split('/').slice(1).join('/');
      return !local.includes(shortName);
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

    html += `
      <div class="branch-divider"></div>
      <div class="branch-item new-branch" data-action="new">
        <span class="branch-name">+ New branch</span>
      </div>`;

    branchDropdown.innerHTML = html;

    branchDropdown.querySelectorAll('.branch-item').forEach((item) => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        branchDropdown.classList.add('hidden');

        if (item.dataset.action === 'new') {
          const name = await showDialog({
            title: 'New branch',
            message: 'Enter branch name:',
            input: true,
            placeholder: 'feature/my-branch',
          });
          if (name) {
            await createBranch(name, true);
          }
          return;
        }

        if (!item.classList.contains('current')) {
          const branch = item.dataset.branch;
          await checkoutBranch(branch);
        }
      });
    });
  }

  async function createBranch(name, checkout) {
    const result = ensureResult(await requestCreateBranch(name, checkout), 'Failed to create branch');
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to create branch', { variant: 'error' });
      return false;
    }

    showToast(`Created ${name}`);
    await onBranchChanged();
    await loadBranches();
    return true;
  }

  async function checkoutBranch(branch) {
    const result = ensureResult(await requestCheckoutBranch(branch), 'Failed to checkout branch');
    if (!result.ok || result.data?.error) {
      showToast(result.error || result.data?.error || 'Failed to checkout branch', { variant: 'error' });
      return false;
    }

    showToast(`Switched to ${branch}`);
    await onBranchChanged();
    await loadBranches();
    return true;
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;

    if (branchSelector) {
      branchSelector.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggleBranchDropdown();
      });
    }

    document.addEventListener('click', () => {
      if (branchDropdown && !branchDropdown.classList.contains('hidden')) {
        branchDropdown.classList.add('hidden');
      }
    });
  }

  return {
    getBranches,
    setBranches,
    resetBranches,
    loadBranches,
    bindListeners,
    toggleBranchDropdown,
    renderBranchDropdown,
  };
}
