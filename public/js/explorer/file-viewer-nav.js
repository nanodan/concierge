const NAV_HTML = `
  <button class="file-nav-btn file-nav-prev" aria-label="Previous file">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
  </button>
  <span class="file-nav-counter"></span>
  <button class="file-nav-btn file-nav-next" aria-label="Next file">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
  </button>
`;

export function createFileViewerNavigation({
  fileViewer,
  onNavigate,
  onHaptic,
  isNavigationBlocked = () => false,
  swipeThreshold = 50,
}) {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoveX = 0;

  function ensureNavContainer() {
    if (!fileViewer) return null;

    let navContainer = fileViewer.querySelector('.file-viewer-nav');
    if (navContainer) return navContainer;

    navContainer = document.createElement('div');
    navContainer.className = 'file-viewer-nav hidden';
    navContainer.innerHTML = NAV_HTML;

    const header = fileViewer.querySelector('.file-viewer-header');
    if (header) {
      header.after(navContainer);
    }

    navContainer.querySelector('.file-nav-prev').addEventListener('click', (e) => {
      e.stopPropagation();
      if (isNavigationBlocked()) return;
      if (onHaptic) onHaptic();
      onNavigate(-1);
    });
    navContainer.querySelector('.file-nav-next').addEventListener('click', (e) => {
      e.stopPropagation();
      if (isNavigationBlocked()) return;
      if (onHaptic) onHaptic();
      onNavigate(1);
    });

    return navContainer;
  }

  // Ensure nav chrome exists even before first file open so other viewer modes
  // (e.g. git diff) can reuse it consistently.
  ensureNavContainer();

  function update(currentIndex, total) {
    if (!fileViewer) return;

    const navContainer = ensureNavContainer();
    if (!navContainer) return;

    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < total - 1;

    navContainer.querySelector('.file-nav-prev').disabled = !hasPrev;
    navContainer.querySelector('.file-nav-next').disabled = !hasNext;
    navContainer.querySelector('.file-nav-counter').textContent = total > 1 ? `${currentIndex + 1} / ${total}` : '';
    navContainer.classList.toggle('hidden', total <= 1);
  }

  function handleKeydown(e) {
    if (!fileViewer || fileViewer.classList.contains('hidden')) return;
    if (isNavigationBlocked()) return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      onNavigate(-1);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      onNavigate(1);
    }
  }

  function handleTouchStart(e) {
    if (isNavigationBlocked()) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchMoveX = touchStartX;
  }

  function handleTouchMove(e) {
    if (isNavigationBlocked()) return;
    touchMoveX = e.touches[0].clientX;
  }

  function handleTouchEnd(e) {
    if (isNavigationBlocked()) return;
    if (!fileViewer || fileViewer.classList.contains('hidden')) return;

    const deltaX = touchMoveX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;

    if (Math.abs(deltaX) > swipeThreshold && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (onHaptic) onHaptic();
      if (deltaX > 0) {
        onNavigate(-1);
      } else {
        onNavigate(1);
      }
    }

    touchStartX = 0;
    touchStartY = 0;
    touchMoveX = 0;
  }

  return {
    update,
    handleKeydown,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}
