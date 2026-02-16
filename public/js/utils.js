// --- Utility functions ---
import { HAPTIC_LIGHT, HAPTIC_MEDIUM, TOAST_DURATION_DEFAULT, LONG_PRESS_DURATION } from './constants.js';

export function haptic(ms = HAPTIC_LIGHT) {
  navigator.vibrate?.(ms);
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  if (isToday) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatAge(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} min${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
}

export function formatTokens(count) {
  if (count == null) return '0';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'k';
  return String(count);
}

export function truncate(text, len) {
  if (!text) return '';
  return text.length > len ? text.slice(0, len) + '...' : text;
}

export function setLoading(view, loading) {
  view.classList.toggle('loading', loading);
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// --- Toast notifications ---
let toastContainer = null;

export function initToast(container) {
  toastContainer = container;
}

export function showToast(message, { variant = 'default', duration = TOAST_DURATION_DEFAULT, action, onAction } = {}) {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${variant}`;

  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  let actionClicked = false;
  if (action && onAction) {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'toast-action';
    actionBtn.textContent = action;
    actionBtn.addEventListener('click', () => {
      actionClicked = true;
      onAction();
      toast.classList.add('toast-exit');
      toast.addEventListener('animationend', () => toast.remove());
    });
    toast.appendChild(actionBtn);
  }

  while (toastContainer.children.length >= 2)
    toastContainer.removeChild(toastContainer.firstChild);
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-enter'));

  const timeoutId = setTimeout(() => {
    if (!actionClicked) {
      toast.classList.add('toast-exit');
      toast.addEventListener('animationend', () => toast.remove());
    }
  }, duration);

  return { cancel: () => { clearTimeout(timeoutId); toast.remove(); } };
}

// --- Dialog system ---
let dialogOverlay = null;
let dialogTitle = null;
let dialogBody = null;
let dialogInput = null;
let dialogOk = null;
let dialogCancel = null;

export function initDialog(elements) {
  dialogOverlay = elements.dialogOverlay;
  dialogTitle = elements.dialogTitle;
  dialogBody = elements.dialogBody;
  dialogInput = elements.dialogInput;
  dialogOk = elements.dialogOk;
  dialogCancel = elements.dialogCancel;
}

export function showDialog({ title, message, input, defaultValue, placeholder, confirmLabel, cancelLabel, danger }) {
  return new Promise((resolve) => {
    dialogTitle.textContent = title || '';
    dialogBody.textContent = message || '';
    dialogOk.textContent = confirmLabel || 'OK';
    dialogCancel.textContent = cancelLabel || 'Cancel';
    dialogOk.className = danger ? 'btn-primary danger' : 'btn-primary';

    if (input) {
      dialogInput.classList.remove('hidden');
      dialogInput.value = defaultValue || '';
      dialogInput.placeholder = placeholder || '';
    } else {
      dialogInput.classList.add('hidden');
    }

    // Hide cancel for alert-style (message only, no input, no danger action)
    const isAlert = !input && !danger;
    dialogCancel.classList.toggle('hidden', isAlert);

    dialogOverlay.classList.remove('hidden');
    if (input) dialogInput.focus();

    function cleanup() {
      dialogOverlay.classList.add('hidden');
      dialogOk.removeEventListener('click', onOk);
      dialogCancel.removeEventListener('click', onCancel);
      dialogOverlay.removeEventListener('click', onOverlay);
      dialogInput.removeEventListener('keydown', onKeydown);
    }

    function onOk() {
      cleanup();
      resolve(input ? dialogInput.value : true);
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    function onOverlay(e) {
      if (e.target === dialogOverlay) onCancel();
    }

    function onKeydown(e) {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
    }

    dialogOk.addEventListener('click', onOk);
    dialogCancel.addEventListener('click', onCancel);
    dialogOverlay.addEventListener('click', onOverlay);
    if (input) dialogInput.addEventListener('keydown', onKeydown);
  });
}

export function getDialogOverlay() {
  return dialogOverlay;
}

export function getDialogCancel() {
  return dialogCancel;
}

// --- Long-press gesture handler ---
// Reusable helper for elements that need short-tap vs long-press behavior

/**
 * Sets up long-press detection on an element with separate handlers for tap vs long-press.
 * Works on both mouse and touch devices.
 * @param {HTMLElement} element - The element to attach handlers to
 * @param {Object} handlers - Handler functions
 * @param {Function} handlers.onTap - Called on short tap (no movement, short duration)
 * @param {Function} handlers.onLongPress - Called after long-press threshold
 * @param {number} [handlers.duration=500] - Long-press duration in ms
 * @param {boolean} [handlers.tapHaptic=true] - Whether to trigger haptic on tap
 * @param {boolean} [handlers.longPressHaptic=true] - Whether to trigger haptic on long-press
 */
export function setupLongPressHandler(element, handlers) {
  const {
    onTap,
    onLongPress,
    duration = LONG_PRESS_DURATION,
    tapHaptic = true,
    longPressHaptic = true,
  } = handlers;

  let pressTimer = null;
  let longPressed = false;

  const startPress = () => {
    longPressed = false;
    pressTimer = setTimeout(() => {
      longPressed = true;
      if (longPressHaptic) haptic(HAPTIC_MEDIUM);
      onLongPress?.();
    }, duration);
  };

  const endPress = (event, preventDefault = false) => {
    clearTimeout(pressTimer);
    if (!longPressed) {
      if (preventDefault && event) {
        event.preventDefault();
      }
      if (tapHaptic) haptic(HAPTIC_LIGHT);
      onTap?.();
    }
  };

  const cancelPress = () => {
    clearTimeout(pressTimer);
  };

  // Store handler references for proper cleanup
  const mouseUpHandler = () => endPress();
  const touchEndHandler = (e) => endPress(e, true);

  // Mouse events
  element.addEventListener('mousedown', startPress);
  element.addEventListener('mouseup', mouseUpHandler);
  element.addEventListener('mouseleave', cancelPress);

  // Touch events
  element.addEventListener('touchstart', startPress, { passive: true });
  element.addEventListener('touchend', touchEndHandler);
  element.addEventListener('touchcancel', cancelPress);
  element.addEventListener('touchmove', cancelPress, { passive: true });

  // Return cleanup function using stored references
  return () => {
    element.removeEventListener('mousedown', startPress);
    element.removeEventListener('mouseup', mouseUpHandler);
    element.removeEventListener('mouseleave', cancelPress);
    element.removeEventListener('touchstart', startPress);
    element.removeEventListener('touchend', touchEndHandler);
    element.removeEventListener('touchcancel', cancelPress);
    element.removeEventListener('touchmove', cancelPress);
  };
}

// --- API Fetch wrapper ---
// Centralized fetch with error handling and toast notifications
export async function apiFetch(url, options = {}) {
  const { silent = false, ...fetchOptions } = options;
  try {
    const res = await fetch(url, fetchOptions);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = data.error || `Request failed (${res.status})`;
      if (!silent) showToast(msg, { variant: 'error' });
      return null;
    }
    return res;
  } catch (err) {
    if (!silent) showToast('Network error — check connection', { variant: 'error' });
    console.error('Fetch error:', url, err);
    return null;
  }
}
