// --- Directory browsing (for new conversation modal) ---
import { escapeHtml } from '../markdown.js';
import { showDialog, apiFetch } from '../utils.js';
import * as state from '../state.js';

// DOM elements (set by init)
let browseBtn = null;
let dirBrowser = null;
let dirUpBtn = null;
let dirCurrentPath = null;
let dirList = null;
let dirNewBtn = null;
let dirSelectBtn = null;
let convCwdInput = null;

export function initDirectoryBrowser(elements) {
  browseBtn = elements.browseBtn;
  dirBrowser = elements.dirBrowser;
  dirUpBtn = elements.dirUpBtn;
  dirCurrentPath = elements.dirCurrentPath;
  dirList = elements.dirList;
  dirNewBtn = elements.dirNewBtn;
  dirSelectBtn = elements.dirSelectBtn;
  convCwdInput = elements.convCwdInput;
}

// --- Directory browser ---
export async function browseTo(dirPath) {
  const qs = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
  const res = await apiFetch(`/api/browse${qs}`, { silent: true });
  if (!res) {
    dirList.innerHTML = `<div class="dir-empty">Failed to browse</div>`;
    return;
  }
  const data = await res.json();
  if (data.error) {
    dirList.innerHTML = `<div class="dir-empty">${escapeHtml(data.error)}</div>`;
    return;
  }
  state.setCurrentBrowsePath(data.path);
  dirCurrentPath.textContent = data.path;
  convCwdInput.value = data.path;

  if (data.dirs.length === 0) {
    dirList.innerHTML = '<div class="dir-empty">No subdirectories</div>';
  } else {
    dirList.innerHTML = data.dirs.map(d =>
      `<div class="dir-item" data-name="${escapeHtml(d)}">` +
      `<span class="dir-item-icon">&#x1F4C1;</span>` +
      `<span class="dir-item-name">${escapeHtml(d)}</span>` +
      `</div>`
    ).join('');
    dirList.querySelectorAll('.dir-item').forEach(item => {
      item.addEventListener('click', () => {
        browseTo(state.getCurrentBrowsePath() + '/' + item.dataset.name);
      });
    });
  }
}

// --- Event listener setup for directory browser elements ---
export function setupDirectoryBrowserEventListeners() {
  browseBtn.addEventListener('click', () => {
    const isHidden = dirBrowser.classList.contains('hidden');
    if (isHidden) {
      dirBrowser.classList.remove('hidden');
      browseTo(convCwdInput.value.trim() || '');
    } else {
      dirBrowser.classList.add('hidden');
    }
  });

  dirUpBtn.addEventListener('click', () => {
    const currentBrowsePath = state.getCurrentBrowsePath();
    if (currentBrowsePath && currentBrowsePath !== '/') {
      const parent = currentBrowsePath.replace(/\/[^/]+$/, '') || '/';
      browseTo(parent);
    }
  });

  dirSelectBtn.addEventListener('click', () => {
    convCwdInput.value = state.getCurrentBrowsePath();
    dirBrowser.classList.add('hidden');
  });

  dirNewBtn.addEventListener('click', async () => {
    const name = await showDialog({ title: 'New folder', input: true, placeholder: 'Folder name', confirmLabel: 'Create' });
    if (!name || !name.trim()) return;
    const newPath = state.getCurrentBrowsePath() + '/' + name.trim();
    const res = await apiFetch('/api/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: newPath }),
    });
    if (!res) return;
    const data = await res.json();
    if (data.ok) {
      browseTo(newPath);
    } else {
      showDialog({ title: 'Error', message: data.error || 'Failed to create folder' });
    }
  });
}
