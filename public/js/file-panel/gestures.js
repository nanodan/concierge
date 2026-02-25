// --- File Panel Gestures (mobile drag, desktop resize) ---
import {
  FILE_PANEL_MIN_WIDTH,
  FILE_PANEL_MAX_WIDTH,
  FILE_PANEL_MIN_CHAT_WIDTH,
  FILE_PANEL_MIN_HEIGHT,
} from '../constants.js';

// Snap points for mobile (percentage of viewport height)
const SNAP_POINTS = [30, 60, 90];

// State
let filePanel = null;
let isDragging = false;
let dragStartY = 0;
let dragStartHeight = 0;

// Desktop resize state
let resizeHandle = null;
let isResizing = false;
let resizeStartX = 0;
let resizeStartWidth = 0;
let resizeScrollDistance = 0;
let resizeMessages = null;

function getDesktopMaxPanelWidth() {
  // Let the panel grow with monitor size while preserving a minimal chat viewport.
  const viewportLimited = window.innerWidth - FILE_PANEL_MIN_CHAT_WIDTH;
  return Math.max(FILE_PANEL_MIN_WIDTH, Math.min(FILE_PANEL_MAX_WIDTH, viewportLimited));
}

function clampDesktopPanelWidth(width) {
  const maxWidth = getDesktopMaxPanelWidth();
  return Math.max(FILE_PANEL_MIN_WIDTH, Math.min(maxWidth, width));
}

function applyDesktopPanelWidth(width) {
  const clamped = clampDesktopPanelWidth(width);
  filePanel.style.width = clamped + 'px';
  document.documentElement.style.setProperty('--file-panel-width', clamped + 'px');
}

/**
 * Check if current viewport is mobile width
 */
export function isMobile() {
  return window.innerWidth < 768;
}

/**
 * Initialize gestures for the file panel
 * @param {HTMLElement} panel - The file panel element
 * @param {Function} closeCallback - Callback to close the panel
 */
export function initGestures(panel, closeCallback) {
  filePanel = panel;

  if (isMobile()) {
    setupDragGesture(closeCallback);
  } else {
    setupDesktopResize();
  }

  // Handle resize - reinitialize gestures when viewport changes
  window.addEventListener('resize', () => {
    if (isMobile()) {
      setupDragGesture(closeCallback);
      return;
    }
    if (filePanel?.classList.contains('open')) {
      applyDesktopPanelWidth(filePanel.offsetWidth);
    }
  });
}

/**
 * Setup desktop resize handle for the file panel
 */
export function setupDesktopResize() {
  if (!filePanel) return;

  // Create resize handle if it doesn't exist
  if (!filePanel.querySelector('.file-panel-resize')) {
    resizeHandle = document.createElement('div');
    resizeHandle.className = 'file-panel-resize';
    filePanel.insertBefore(resizeHandle, filePanel.firstChild);
  } else {
    resizeHandle = filePanel.querySelector('.file-panel-resize');
  }

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeStartX = e.clientX;
    resizeStartWidth = filePanel.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();

    // Save scroll position for preservation during resize
    resizeMessages = document.getElementById('messages');
    if (resizeMessages) {
      resizeScrollDistance = resizeMessages.scrollHeight - resizeMessages.scrollTop;
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const dx = resizeStartX - e.clientX;
    applyDesktopPanelWidth(resizeStartWidth + dx);

    // Preserve scroll position as content reflows
    if (resizeMessages) {
      resizeMessages.scrollTop = resizeMessages.scrollHeight - resizeScrollDistance;
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      resizeMessages = null;
    }
  });
}

/**
 * Setup mobile drag gesture for the file panel
 * @param {Function} closeCallback - Callback to close the panel when dragged below threshold
 */
export function setupDragGesture(closeCallback) {
  if (!filePanel) return;

  const header = filePanel.querySelector('.file-panel-header');
  if (!header) return;

  header.addEventListener('touchstart', (e) => {
    isDragging = true;
    dragStartY = e.touches[0].clientY;
    dragStartHeight = filePanel.offsetHeight;
    filePanel.classList.add('dragging');
  }, { passive: true });

  header.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const dy = dragStartY - e.touches[0].clientY;
    const newHeight = Math.max(FILE_PANEL_MIN_HEIGHT, Math.min(window.innerHeight * 0.95, dragStartHeight + dy));
    filePanel.style.height = newHeight + 'px';
  }, { passive: true });

  header.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    filePanel.classList.remove('dragging');

    // Snap to closest point
    const currentHeightVh = (filePanel.offsetHeight / window.innerHeight) * 100;
    let closestSnap = SNAP_POINTS[0];
    let minDist = Math.abs(currentHeightVh - SNAP_POINTS[0]);

    for (const snap of SNAP_POINTS) {
      const dist = Math.abs(currentHeightVh - snap);
      if (dist < minDist) {
        minDist = dist;
        closestSnap = snap;
      }
    }

    // If dragged below minimum, close the panel
    if (currentHeightVh < 20) {
      closeCallback();
      return;
    }

    // Apply snap
    filePanel.style.height = '';
    filePanel.classList.remove('snap-30', 'snap-60', 'snap-90');
    filePanel.classList.add(`snap-${closestSnap}`);
  }, { passive: true });
}
