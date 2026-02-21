// --- Preview Server Integration ---
import { haptic, showToast, apiFetch } from '../utils.js';
import * as state from '../state.js';

// DOM elements (set by init)
let _previewTab = null;
let _previewView = null;
let previewEmpty = null;
let previewRunning = null;
let previewMessage = null;
let previewStartBtn = null;
let previewOpenBtn = null;
let previewStopBtn = null;
let previewInlineBtn = null;
let previewActions = null;
let previewIframeWrapper = null;
let previewIframeContainer = null;
let previewIframeScaler = null;
let previewIframe = null;
let previewFileSelect = null;
let previewFitToggle = null;
let previewRefreshBtn = null;
let previewOpenBtnToolbar = null;
let previewHideBtn = null;

// Preview state
let previewState = { running: false, port: null, type: null, url: null, htmlFiles: [], currentFile: null };
let inlinePreviewShown = false;

// Scaling constants
const BASE_WIDTH = 1280;
const BASE_HEIGHT = 900; // Standard viewport height
let fitMode = localStorage.getItem('previewFitMode') !== 'actual'; // default to fit mode
let resizeObserver = null;
let resizeRafId = null; // For throttling resize updates
let resizeEndTimeout = null; // For detecting resize end
let scrollEndTimeout = null; // For detecting scroll end

/**
 * Initialize preview elements
 */
export function initPreview(elements) {
  _previewTab = elements.previewTab;
  _previewView = elements.previewView;
  previewEmpty = elements.previewEmpty;
  previewRunning = elements.previewRunning;
  previewMessage = elements.previewMessage;
  previewStartBtn = elements.previewStartBtn;
  previewOpenBtn = elements.previewOpenBtn;
  previewStopBtn = elements.previewStopBtn;
  previewInlineBtn = elements.previewInlineBtn;
  previewActions = elements.previewActions;
  previewIframeWrapper = elements.previewIframeWrapper;
  previewIframeContainer = elements.previewIframeContainer;
  previewIframeScaler = elements.previewIframeScaler;
  previewIframe = elements.previewIframe;
  previewFileSelect = elements.previewFileSelect;
  previewFitToggle = elements.previewFitToggle;
  previewRefreshBtn = elements.previewRefreshBtn;
  previewOpenBtnToolbar = elements.previewOpenBtnToolbar;
  previewHideBtn = elements.previewHideBtn;

  // Initialize fit toggle state
  if (previewFitToggle) {
    previewFitToggle.classList.toggle('active', fitMode);
  }
}

/**
 * Setup preview event listeners
 */
export function setupPreviewEventListeners() {
  if (previewStartBtn) {
    previewStartBtn.addEventListener('click', startPreview);
  }
  if (previewStopBtn) {
    previewStopBtn.addEventListener('click', stopPreviewServer);
  }
  if (previewInlineBtn) {
    previewInlineBtn.addEventListener('click', toggleInlinePreview);
  }
  if (previewFileSelect) {
    previewFileSelect.addEventListener('change', handleFileSelect);
  }
  if (previewFitToggle) {
    previewFitToggle.addEventListener('click', toggleFitMode);
  }
  if (previewRefreshBtn) {
    previewRefreshBtn.addEventListener('click', refreshPreview);
  }
  if (previewHideBtn) {
    previewHideBtn.addEventListener('click', hideInlinePreview);
  }
}

/**
 * Load current preview status from server
 */
export async function loadPreviewStatus() {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const res = await apiFetch(`/api/conversations/${convId}/preview/status`, { silent: true });
  if (!res) {
    renderPreviewState({ running: false });
    return;
  }

  const data = await res.json();
  previewState = data;
  renderPreviewState(data);
}

/**
 * Render the preview state in the UI
 */
function renderPreviewState(data) {
  if (!previewEmpty || !previewRunning) return;

  if (data.running) {
    previewEmpty.classList.add('hidden');
    previewRunning.classList.remove('hidden');

    const url = data.url || `http://localhost:${data.port}`;
    if (previewOpenBtn) previewOpenBtn.href = url;
    if (previewOpenBtnToolbar) previewOpenBtnToolbar.href = url;

    // Populate file selector
    if (previewFileSelect && data.htmlFiles) {
      populateFileSelect(data.htmlFiles, data.currentFile);
    }
  } else {
    previewEmpty.classList.remove('hidden');
    previewRunning.classList.add('hidden');

    // Reset inline preview state when server stops
    hideInlinePreview();

    if (previewMessage) {
      previewMessage.textContent = data.error || 'Not running';
    }
  }
}

/**
 * Populate the file selector dropdown
 */
function populateFileSelect(htmlFiles, currentFile) {
  if (!previewFileSelect) return;

  previewFileSelect.innerHTML = '';

  if (htmlFiles.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No HTML files';
    previewFileSelect.appendChild(option);
    previewFileSelect.disabled = true;
    return;
  }

  previewFileSelect.disabled = false;

  for (const file of htmlFiles) {
    const option = document.createElement('option');
    option.value = file;
    option.textContent = file;
    if (file === currentFile) {
      option.selected = true;
    }
    previewFileSelect.appendChild(option);
  }
}

/**
 * Handle file selection change
 */
function handleFileSelect() {
  if (!previewFileSelect || !previewState.port) return;

  const selectedFile = previewFileSelect.value;
  if (!selectedFile) return;

  haptic(10);

  // Update state
  previewState.currentFile = selectedFile;
  const newUrl = `http://localhost:${previewState.port}/${selectedFile}`;
  previewState.url = newUrl;

  // Update UI
  if (previewOpenBtn) previewOpenBtn.href = newUrl;
  if (previewOpenBtnToolbar) previewOpenBtnToolbar.href = newUrl;

  // Update iframe if visible
  if (inlinePreviewShown && previewIframe) {
    previewIframe.src = newUrl;
  }
}

/**
 * Toggle fit/actual mode
 */
function toggleFitMode() {
  haptic(10);
  fitMode = !fitMode;

  // Save preference
  localStorage.setItem('previewFitMode', fitMode ? 'fit' : 'actual');

  // Update toggle button state
  if (previewFitToggle) {
    previewFitToggle.classList.toggle('active', fitMode);
  }

  // Update container mode
  if (previewIframeContainer) {
    previewIframeContainer.classList.toggle('fit-mode', fitMode);
    previewIframeContainer.classList.toggle('actual-mode', !fitMode);
  }

  // Recalculate scale
  updateIframeScale();
}

/**
 * Handle scroll events - disable pointer events during scroll for smooth scrolling
 */
function handlePreviewScroll() {
  if (!previewIframeContainer) return;

  // Add scrolling class to disable pointer events on iframe
  previewIframeContainer.classList.add('scrolling');

  // Clear existing timeout
  if (scrollEndTimeout) {
    clearTimeout(scrollEndTimeout);
  }

  // Re-enable pointer events after scroll ends
  scrollEndTimeout = setTimeout(() => {
    previewIframeContainer.classList.remove('scrolling');
    scrollEndTimeout = null;
  }, 150);
}

/**
 * Refresh the preview iframe
 */
function refreshPreview() {
  if (!previewIframe || !inlinePreviewShown) return;

  haptic(10);

  // Reload the iframe
  const currentSrc = previewIframe.src;
  previewIframe.src = 'about:blank';
  setTimeout(() => {
    previewIframe.src = currentSrc;
  }, 50);
}

/**
 * Update iframe scale based on container width (fit mode only)
 */
function updateIframeScale() {
  if (!previewIframeContainer || !previewIframeScaler || !previewIframe) return;

  if (fitMode) {
    const containerWidth = previewIframeContainer.clientWidth;
    if (containerWidth <= 0) return;

    const scale = containerWidth / BASE_WIDTH;
    const scaledWidth = BASE_WIDTH * scale;
    const scaledHeight = BASE_HEIGHT * scale;

    // Set iframe to base size and scale it
    previewIframe.style.width = `${BASE_WIDTH}px`;
    previewIframe.style.height = `${BASE_HEIGHT}px`;
    previewIframe.style.transform = `scale(${scale})`;
    previewIframe.style.transformOrigin = '0 0';

    // Set scaler wrapper to the visually scaled size
    previewIframeScaler.style.width = `${scaledWidth}px`;
    previewIframeScaler.style.height = `${scaledHeight}px`;
  } else {
    // Actual mode - natural sizing
    previewIframe.style.width = '';
    previewIframe.style.height = '';
    previewIframe.style.transform = '';
    previewIframe.style.transformOrigin = '';
    previewIframeScaler.style.width = '';
    previewIframeScaler.style.height = '';
  }
}

/**
 * Toggle inline iframe preview
 */
function toggleInlinePreview() {
  if (inlinePreviewShown) {
    hideInlinePreview();
  } else {
    showInlinePreview();
  }
}

/**
 * Show inline iframe preview
 */
function showInlinePreview() {
  if (!previewIframeWrapper || !previewIframeContainer || !previewIframe || !previewState.url) return;

  haptic(10);
  inlinePreviewShown = true;

  // Load the preview URL in the iframe
  previewIframe.src = previewState.url;

  // Hide the action buttons (consolidated into toolbar)
  if (previewActions) previewActions.classList.add('hidden');

  // Update toolbar open button href
  if (previewOpenBtnToolbar) {
    previewOpenBtnToolbar.href = previewState.url;
  }

  // Show the iframe wrapper
  previewIframeWrapper.classList.remove('hidden');
  previewRunning.classList.add('has-iframe');

  // Set up fit mode
  if (previewIframeContainer) {
    previewIframeContainer.classList.toggle('fit-mode', fitMode);
    previewIframeContainer.classList.toggle('actual-mode', !fitMode);
  }

  // Set up scroll handler to disable pointer events during scroll
  if (previewIframeContainer) {
    previewIframeContainer.addEventListener('scroll', handlePreviewScroll, { passive: true });
  }

  // Set up ResizeObserver for fit mode scaling (throttled with rAF)
  if (!resizeObserver && previewIframeContainer) {
    resizeObserver = new ResizeObserver(() => {
      if (inlinePreviewShown && fitMode) {
        // Disable iframe pointer events during resize to prevent it capturing mouse
        if (previewIframe) {
          previewIframe.style.pointerEvents = 'none';
        }

        // Clear existing timeouts/frames
        if (resizeEndTimeout) {
          clearTimeout(resizeEndTimeout);
        }
        if (resizeRafId) {
          cancelAnimationFrame(resizeRafId);
        }

        // Throttle scale updates using requestAnimationFrame
        resizeRafId = requestAnimationFrame(() => {
          updateIframeScale();
          resizeRafId = null;
        });

        // Re-enable pointer events after resize stops
        resizeEndTimeout = setTimeout(() => {
          if (previewIframe) {
            previewIframe.style.pointerEvents = '';
          }
          resizeEndTimeout = null;
        }, 150);
      }
    });
    resizeObserver.observe(previewIframeContainer);
  }

  // Initial scale calculation (after layout settles)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      updateIframeScale();
    });
  });

  // Update button text
  if (previewInlineBtn) {
    previewInlineBtn.textContent = 'Hide Inline';
  }
}

/**
 * Hide inline iframe preview
 */
function hideInlinePreview() {
  if (!previewIframeWrapper || !previewIframeContainer || !previewIframe) return;

  haptic(10);
  inlinePreviewShown = false;

  // Clear and hide the iframe
  previewIframe.src = 'about:blank';
  previewIframeWrapper.classList.add('hidden');
  if (previewRunning) {
    previewRunning.classList.remove('has-iframe');
  }

  // Show the action buttons again
  if (previewActions) previewActions.classList.remove('hidden');

  // Clean up ResizeObserver, pending rAF, and timeouts
  if (scrollEndTimeout) {
    clearTimeout(scrollEndTimeout);
    scrollEndTimeout = null;
  }
  if (resizeEndTimeout) {
    clearTimeout(resizeEndTimeout);
    resizeEndTimeout = null;
  }
  if (resizeRafId) {
    cancelAnimationFrame(resizeRafId);
    resizeRafId = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  // Reset iframe styles
  previewIframe.style.width = '';
  previewIframe.style.height = '';
  previewIframe.style.transform = '';
  previewIframe.style.transformOrigin = '';
  previewIframeContainer.style.height = '';

  // Update button text
  if (previewInlineBtn) {
    previewInlineBtn.textContent = 'Show Inline';
  }
}

/**
 * Start the preview server
 */
async function startPreview() {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  haptic(15);

  // Show loading state
  if (previewStartBtn) {
    previewStartBtn.disabled = true;
    previewStartBtn.textContent = 'Starting...';
  }
  if (previewMessage) {
    previewMessage.textContent = 'Starting preview server...';
  }

  const res = await apiFetch(`/api/conversations/${convId}/preview/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  // Reset button
  if (previewStartBtn) {
    previewStartBtn.disabled = false;
    previewStartBtn.textContent = 'Start Preview';
  }

  if (!res) {
    if (previewMessage) {
      previewMessage.textContent = 'Failed to start preview';
    }
    showToast('Failed to start preview', 'error');
    return;
  }

  const data = await res.json();

  if (data.error) {
    if (previewMessage) {
      previewMessage.textContent = data.error;
    }
    showToast(data.error, 'error');
    return;
  }

  previewState = data;
  renderPreviewState(data);
  showToast(`Preview started on port ${data.port}`);
}

/**
 * Stop the preview server
 */
async function stopPreviewServer() {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  haptic(10);

  if (previewStopBtn) {
    previewStopBtn.disabled = true;
    previewStopBtn.textContent = 'Stopping...';
  }

  const res = await apiFetch(`/api/conversations/${convId}/preview/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (previewStopBtn) {
    previewStopBtn.disabled = false;
    previewStopBtn.textContent = 'Stop';
  }

  if (!res) {
    showToast('Failed to stop preview', 'error');
    return;
  }

  previewState = { running: false };
  renderPreviewState({ running: false });
  showToast('Preview stopped');
}

/**
 * Get current preview state
 */
export function getPreviewState() {
  return previewState;
}
