// --- File Panel (Project Mode) ---
// This file re-exports from the modular file-panel/ directory for backward compatibility.
// All implementation is now in public/js/file-panel/*.js

export {
  initFilePanel,
  openFilePanel,
  closeFilePanel,
  toggleFilePanel,
  isFilePanelOpen,
  loadFileTree,
  viewFile,
  closeFileViewer,
  isFileViewerOpen,
} from './file-panel/index.js';
