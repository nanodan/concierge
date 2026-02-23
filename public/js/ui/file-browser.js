// --- File Browser UI Adapter ---
// Bridges legacy entry points onto the consolidated explorer surfaces.

import { getFileIcon } from '../file-utils.js';
import { openStandaloneFiles, closeStandaloneFiles } from '../files-standalone.js';
import { openFilePanel, closeFilePanel } from '../file-panel.js';

// Re-export for backward compatibility.
export { getFileIcon };

let fileBrowserMode = 'conversation';
let currentFileBrowserPath = '';

// Kept for API compatibility; no legacy modal state is needed now.
export function initFileBrowser() {}

export function openFileBrowser(mode = 'conversation') {
  fileBrowserMode = mode;

  if (mode === 'general') {
    currentFileBrowserPath = '';
    openStandaloneFiles(currentFileBrowserPath);
    return;
  }

  openFilePanel();
}

function isStandaloneVisible() {
  const view = document.getElementById('files-standalone-view');
  return !!view && view.classList.contains('slide-in');
}

export function closeFileBrowser() {
  if (fileBrowserMode === 'general' || isStandaloneVisible()) {
    closeStandaloneFiles();
    return;
  }

  closeFilePanel();
}

export function getFileBrowserMode() {
  return fileBrowserMode;
}

export function getCurrentFileBrowserPath() {
  return currentFileBrowserPath;
}

export function setupFileBrowserEventListeners(generalFilesBtn, haptic = () => {}) {
  if (!generalFilesBtn) return;

  generalFilesBtn.addEventListener('click', () => {
    haptic();
    openFileBrowser('general');
  });
}
