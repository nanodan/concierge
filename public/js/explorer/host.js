function noop() {}

export function createExplorerHost({
  tabButtons = [],
  views = {},
  initialTab = 'files',
  haptic = noop,
  closeViewer = noop,
  onTabSelected = {},
  onTabChanged = noop,
}) {
  const buttons = Array.from(tabButtons || []);
  let currentTab = initialTab;
  let listenersBound = false;

  function applyTabUi(tab) {
    buttons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    Object.entries(views || {}).forEach(([name, el]) => {
      if (!el) return;
      el.classList.toggle('hidden', name !== tab);
    });
  }

  async function switchTab(tab, { force = false, skipHaptic = false, closeOpenViewer = true } = {}) {
    if (!force && tab === currentTab) return false;

    currentTab = tab;
    if (!skipHaptic) haptic(5);

    if (closeOpenViewer) {
      closeViewer();
    }

    applyTabUi(tab);
    onTabChanged(tab);

    const handler = onTabSelected?.[tab];
    if (typeof handler === 'function') {
      await handler();
    }

    return true;
  }

  function bindTabListeners() {
    if (listenersBound) return;
    listenersBound = true;

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        void switchTab(btn.dataset.tab);
      });
    });
  }

  async function resetToInitial(options = {}) {
    return switchTab(initialTab, { force: true, skipHaptic: true, ...options });
  }

  function setCurrentTab(tab) {
    currentTab = tab;
    applyTabUi(tab);
    onTabChanged(tab);
  }

  function getCurrentTab() {
    return currentTab;
  }

  return {
    bindTabListeners,
    switchTab,
    resetToInitial,
    setCurrentTab,
    getCurrentTab,
  };
}
