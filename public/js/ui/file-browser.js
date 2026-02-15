// --- File Browser (download files from conversation cwd) ---
import { escapeHtml } from '../markdown.js';
import { formatFileSize, showToast, apiFetch } from '../utils.js';
import * as state from '../state.js';
import { getFileIcon } from '../file-utils.js';

// Re-export getFileIcon for backwards compatibility
export { getFileIcon };

// DOM elements (set by init)
let fileBrowserModal = null;
let fileBrowserClose = null;
let fileBrowserUp = null;
let fileBrowserCurrentPath = null;
let fileBrowserList = null;
let fileBrowserUploadBtn = null;
let fileBrowserFileInput = null;

// Current file browser state
let currentFileBrowserPath = '';
let currentFileBrowserConvId = null;
let fileBrowserMode = 'conversation'; // 'conversation' or 'general'

export function initFileBrowser(elements) {
  fileBrowserModal = elements.fileBrowserModal;
  fileBrowserClose = elements.fileBrowserClose;
  fileBrowserUp = elements.fileBrowserUp;
  fileBrowserCurrentPath = elements.fileBrowserCurrentPath;
  fileBrowserList = elements.fileBrowserList;
  fileBrowserUploadBtn = elements.fileBrowserUploadBtn;
  fileBrowserFileInput = elements.fileBrowserFileInput;
}

export function openFileBrowser(mode = 'conversation') {
  fileBrowserMode = mode;

  if (mode === 'conversation') {
    const convId = state.getCurrentConversationId();
    if (!convId) return;
    currentFileBrowserConvId = convId;
    currentFileBrowserPath = '';
    fileBrowserModal.classList.remove('hidden');
    browseFiles('');
  } else {
    // General mode - start at home directory
    currentFileBrowserConvId = null;
    currentFileBrowserPath = '';
    fileBrowserModal.classList.remove('hidden');
    browseFilesGeneral('');
  }
}

export function closeFileBrowser() {
  fileBrowserModal.classList.add('hidden');
  currentFileBrowserConvId = null;
  fileBrowserMode = 'conversation';
}

async function browseFiles(subpath) {
  if (!currentFileBrowserConvId) return;

  currentFileBrowserPath = subpath;
  fileBrowserCurrentPath.textContent = subpath || '.';
  fileBrowserUp.disabled = !subpath;

  fileBrowserList.innerHTML = '<div class="file-browser-empty">Loading...</div>';

  const qs = subpath ? `?path=${encodeURIComponent(subpath)}` : '';
  const res = await apiFetch(`/api/conversations/${currentFileBrowserConvId}/files${qs}`, { silent: true });
  if (!res) {
    fileBrowserList.innerHTML = `<div class="file-browser-empty">Failed to load files</div>`;
    return;
  }
  const data = await res.json();

  if (data.error) {
    fileBrowserList.innerHTML = `<div class="file-browser-empty">${escapeHtml(data.error)}</div>`;
    return;
  }

  renderFileBrowserEntries(data.entries, (filePath) => {
    return `/api/conversations/${currentFileBrowserConvId}/files/download?path=${encodeURIComponent(filePath)}`;
  }, browseFiles);
}

async function browseFilesGeneral(targetPath) {
  currentFileBrowserPath = targetPath;
  fileBrowserCurrentPath.textContent = targetPath || '~';
  fileBrowserUp.disabled = false; // Always allow going up in general mode

  fileBrowserList.innerHTML = '<div class="file-browser-empty">Loading...</div>';

  const qs = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
  const res = await apiFetch(`/api/files${qs}`, { silent: true });
  if (!res) {
    fileBrowserList.innerHTML = `<div class="file-browser-empty">Failed to load files</div>`;
    return;
  }
  const data = await res.json();

  if (data.error) {
    fileBrowserList.innerHTML = `<div class="file-browser-empty">${escapeHtml(data.error)}</div>`;
    return;
  }

  // Update path display with actual resolved path
  currentFileBrowserPath = data.path;
  fileBrowserCurrentPath.textContent = data.path;
  fileBrowserUp.disabled = !data.parent;

  renderFileBrowserEntries(data.entries, (filePath) => {
    return `/api/files/download?path=${encodeURIComponent(filePath)}`;
  }, browseFilesGeneral);
}

// Upload files to current file browser directory
async function uploadToFileBrowser(files) {
  for (const file of files) {
    let url;
    if (fileBrowserMode === 'conversation' && currentFileBrowserConvId) {
      // Upload to conversation attachments
      url = `/api/conversations/${currentFileBrowserConvId}/upload?filename=${encodeURIComponent(file.name)}`;
    } else {
      // Upload to general filesystem
      const currentPath = currentFileBrowserPath || '';
      url = `/api/files/upload?path=${encodeURIComponent(currentPath)}&filename=${encodeURIComponent(file.name)}`;
    }

    const resp = await apiFetch(url, { method: 'POST', body: file });
    if (!resp) continue;
    showToast(`Uploaded ${file.name}`);
  }

  // Refresh file list
  if (fileBrowserMode === 'conversation') {
    browseFiles(currentFileBrowserPath);
  } else {
    browseFilesGeneral(currentFileBrowserPath);
  }
}

function renderFileBrowserEntries(entries, getDownloadUrl, navigateFn) {
  if (entries.length === 0) {
    fileBrowserList.innerHTML = `
      <div class="file-browser-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <p>No files found</p>
      </div>`;
    return;
  }

  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'];

  fileBrowserList.innerHTML = entries.map(entry => {
    const icon = getFileIcon(entry);
    const meta = entry.type === 'directory'
      ? 'Folder'
      : formatFileSize(entry.size);
    const isImage = imageExts.includes(entry.ext);

    // For images, show actual thumbnail instead of icon
    let iconHtml;
    if (isImage) {
      const thumbUrl = getDownloadUrl(entry.path) + '&inline=true';
      iconHtml = `<div class="file-browser-icon thumbnail"><img src="${thumbUrl}" alt="" loading="lazy" /></div>`;
    } else {
      iconHtml = `<div class="file-browser-icon ${icon.class}">${icon.svg}</div>`;
    }

    return `
      <div class="file-browser-item" data-type="${entry.type}" data-path="${escapeHtml(entry.path)}">
        ${iconHtml}
        <div class="file-browser-info">
          <div class="file-browser-name">${escapeHtml(entry.name)}</div>
          <div class="file-browser-meta">${meta}</div>
        </div>
        ${entry.type === 'file' ? '<button class="file-browser-action">Download</button>' : ''}
      </div>`;
  }).join('');

  // Attach event handlers
  fileBrowserList.querySelectorAll('.file-browser-item').forEach(item => {
    const type = item.dataset.type;
    const filePath = item.dataset.path;

    if (type === 'directory') {
      item.addEventListener('click', () => navigateFn(filePath));
    } else {
      // Clicking the item row opens inline (for previewable files)
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('file-browser-action')) return;
        const url = getDownloadUrl(filePath) + '&inline=true';
        window.open(url, '_blank');
      });

      // Download button forces download
      const downloadBtn = item.querySelector('.file-browser-action');
      if (downloadBtn) {
        downloadBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const url = getDownloadUrl(filePath);
          const a = document.createElement('a');
          a.href = url;
          a.download = filePath.split('/').pop();
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        });
      }
    }
  });
}

// Getters for external use
export function getFileBrowserMode() {
  return fileBrowserMode;
}

export function getCurrentFileBrowserPath() {
  return currentFileBrowserPath;
}

// --- Event listener setup for file browser elements ---
export function setupFileBrowserEventListeners(generalFilesBtn, haptic) {
  if (fileBrowserClose) {
    fileBrowserClose.addEventListener('click', closeFileBrowser);
  }

  if (fileBrowserModal) {
    fileBrowserModal.addEventListener('click', (e) => {
      if (e.target === fileBrowserModal) closeFileBrowser();
    });
  }

  if (fileBrowserUp) {
    fileBrowserUp.addEventListener('click', () => {
      if (fileBrowserMode === 'conversation') {
        if (currentFileBrowserPath) {
          const parent = currentFileBrowserPath.split('/').slice(0, -1).join('/');
          browseFiles(parent);
        }
      } else {
        // General mode - go to parent directory
        if (currentFileBrowserPath) {
          const parent = currentFileBrowserPath.replace(/\/[^/]+$/, '') || '/';
          browseFilesGeneral(parent);
        }
      }
    });
  }

  // File browser upload button
  if (fileBrowserUploadBtn) {
    fileBrowserUploadBtn.addEventListener('click', () => {
      if (fileBrowserFileInput) fileBrowserFileInput.click();
    });
  }

  if (fileBrowserFileInput) {
    fileBrowserFileInput.addEventListener('change', () => {
      if (fileBrowserFileInput.files.length) {
        uploadToFileBrowser(fileBrowserFileInput.files);
        fileBrowserFileInput.value = '';
      }
    });
  }

  // Drag-and-drop for file browser
  if (fileBrowserModal) {
    fileBrowserModal.addEventListener('dragover', (e) => {
      e.preventDefault();
      fileBrowserModal.classList.add('drag-over');
    });
    fileBrowserModal.addEventListener('dragleave', (e) => {
      // Only remove class if leaving the modal entirely
      if (!fileBrowserModal.contains(e.relatedTarget)) {
        fileBrowserModal.classList.remove('drag-over');
      }
    });
    fileBrowserModal.addEventListener('drop', (e) => {
      e.preventDefault();
      fileBrowserModal.classList.remove('drag-over');
      if (e.dataTransfer.files.length) {
        uploadToFileBrowser(e.dataTransfer.files);
      }
    });
  }

  if (generalFilesBtn) {
    generalFilesBtn.addEventListener('click', () => {
      haptic();
      openFileBrowser('general');
    });
  }
}
