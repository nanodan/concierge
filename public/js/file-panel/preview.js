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
let previewType = null;
let previewUrl = null;
let previewOpenBtn = null;
let previewStopBtn = null;

// Preview state
let previewState = { running: false, port: null, type: null, url: null };

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
  previewType = elements.previewType;
  previewUrl = elements.previewUrl;
  previewOpenBtn = elements.previewOpenBtn;
  previewStopBtn = elements.previewStopBtn;
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

    if (previewType) previewType.textContent = data.type || 'dev';
    if (previewUrl) previewUrl.textContent = data.url || `http://localhost:${data.port}`;
    if (previewOpenBtn) previewOpenBtn.href = data.url || `http://localhost:${data.port}`;
  } else {
    previewEmpty.classList.remove('hidden');
    previewRunning.classList.add('hidden');

    if (previewMessage) {
      previewMessage.textContent = data.error || 'Not running';
    }
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

  // Auto-open in new tab
  if (data.url) {
    window.open(data.url, '_blank');
  }
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
