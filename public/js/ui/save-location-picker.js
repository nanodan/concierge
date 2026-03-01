// --- Save Location Picker Modal ---
// A folder browser modal for choosing where to save files

import { escapeHtml } from '../markdown.js';
import { haptic, apiFetch, showToast } from '../utils.js';
import * as state from '../state.js';

// Modal elements (created dynamically)
let modal = null;
let currentPath = '';
let resolvePromise = null;

/**
 * Show save location picker modal
 * @param {Object} options - Picker options
 * @param {string} options.defaultFilename - Default filename (without extension)
 * @param {string} options.format - File format/extension
 * @returns {Promise<{path: string, filename: string} | null>} - Selected path and filename, or null if cancelled
 */
export async function showSaveLocationPicker({ defaultFilename = 'query-results', format = 'csv' } = {}) {
  // Get conversation cwd
  const convId = state.getCurrentConversationId();
  const conv = state.conversations.find(c => c.id === convId);
  const cwd = conv?.cwd || '';

  if (!cwd) {
    showToast('No working directory set');
    return null;
  }

  currentPath = cwd;

  return new Promise((resolve) => {
    resolvePromise = resolve;
    createModal(defaultFilename, format);
    loadDirectory(currentPath);
  });
}

function createModal(defaultFilename, format) {
  // Remove existing modal if any
  if (modal) {
    modal.remove();
  }

  modal = document.createElement('div');
  modal.className = 'save-location-modal-overlay';
  modal.innerHTML = `
    <div class="save-location-modal">
      <div class="save-location-header">
        <h3>Save to folder</h3>
        <button class="save-location-close" aria-label="Close">&times;</button>
      </div>
      <div class="save-location-nav">
        <button class="save-location-up" aria-label="Parent folder">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 11l-5-5-5 5M12 6v12"/></svg>
        </button>
        <div class="save-location-path"></div>
      </div>
      <div class="save-location-list"></div>
      <div class="save-location-footer">
        <div class="save-location-filename-row">
          <input type="text" class="save-location-filename" value="${escapeHtml(defaultFilename)}" placeholder="filename">
          <span class="save-location-ext">.${escapeHtml(format)}</span>
        </div>
        <div class="save-location-actions">
          <button class="save-location-cancel">Cancel</button>
          <button class="save-location-save">Save here</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Event listeners
  modal.querySelector('.save-location-close').addEventListener('click', closeModal);
  modal.querySelector('.save-location-cancel').addEventListener('click', closeModal);
  modal.querySelector('.save-location-up').addEventListener('click', navigateUp);
  modal.querySelector('.save-location-save').addEventListener('click', () => {
    const filename = modal.querySelector('.save-location-filename').value.trim();
    if (!filename) {
      showToast('Enter a filename');
      return;
    }
    haptic();
    closeModal({ path: currentPath, filename });
  });

  // Enter key in filename input
  modal.querySelector('.save-location-filename').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      modal.querySelector('.save-location-save').click();
    }
  });

  // Click overlay to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Escape key
  const onEscape = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeModal();
      document.removeEventListener('keydown', onEscape, true);
    }
  };
  document.addEventListener('keydown', onEscape, true);
}

function closeModal(result = null) {
  if (modal) {
    modal.remove();
    modal = null;
  }
  if (resolvePromise) {
    resolvePromise(result);
    resolvePromise = null;
  }
}

function navigateUp() {
  haptic();
  const convId = state.getCurrentConversationId();
  const conv = state.conversations.find(c => c.id === convId);
  const cwd = conv?.cwd || '';

  // Don't navigate above cwd
  if (currentPath === cwd || currentPath === '/') {
    return;
  }

  const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/';
  // Ensure we don't go above cwd
  if (!parent.startsWith(cwd)) {
    return;
  }
  loadDirectory(parent);
}

async function loadDirectory(dirPath) {
  if (!modal) return;

  const listEl = modal.querySelector('.save-location-list');
  const pathEl = modal.querySelector('.save-location-path');

  listEl.innerHTML = '<div class="save-location-loading">Loading...</div>';

  const convId = state.getCurrentConversationId();
  const conv = state.conversations.find(c => c.id === convId);
  const cwd = conv?.cwd || '';

  // Build relative path for display
  const relativePath = dirPath.startsWith(cwd) ? dirPath.slice(cwd.length) || '/' : dirPath;
  pathEl.textContent = relativePath;
  pathEl.title = dirPath;

  try {
    const url = `/api/conversations/${convId}/files?path=${encodeURIComponent(dirPath)}`;
    const res = await apiFetch(url, { silent: true });

    if (!res) {
      listEl.innerHTML = '<div class="save-location-error">Failed to load</div>';
      return;
    }

    const data = await res.json();
    const entries = data.entries || [];

    // Filter to directories only
    const dirs = entries.filter(e => e.type === 'directory').sort((a, b) => a.name.localeCompare(b.name));

    currentPath = dirPath;

    if (dirs.length === 0) {
      listEl.innerHTML = '<div class="save-location-empty">No subfolders</div>';
      return;
    }

    listEl.innerHTML = dirs.map(dir => `
      <button class="save-location-item" data-path="${escapeHtml(dirPath + '/' + dir.name)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span>${escapeHtml(dir.name)}</span>
      </button>
    `).join('');

    // Click handlers for directories
    listEl.querySelectorAll('.save-location-item').forEach(item => {
      item.addEventListener('click', () => {
        haptic();
        loadDirectory(item.dataset.path);
      });
    });

  } catch {
    listEl.innerHTML = '<div class="save-location-error">Error loading directory</div>';
  }
}
