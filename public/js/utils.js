// --- Utility functions ---

export function haptic(ms = 10) {
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

// --- Toast notifications ---
let toastContainer = null;

export function initToast(container) {
  toastContainer = container;
}

export function showToast(message, { variant = 'default', duration = 3000 } = {}) {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${variant}`;
  toast.textContent = message;
  while (toastContainer.children.length >= 2)
    toastContainer.removeChild(toastContainer.firstChild);
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-enter'));
  setTimeout(() => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
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
