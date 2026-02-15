// --- UI modules index ---
// Re-exports from all UI submodules for cleaner imports

export {
  initTheme,
  applyTheme,
  applyColorTheme,
  selectTheme,
  selectColorTheme,
  updateThemeIcon,
  updateColorThemeIcon,
  toggleMoreMenu,
  closeMoreMenu,
  toggleThemeDropdown,
  closeThemeDropdown,
  toggleColorThemeDropdown,
  closeColorThemeDropdown,
  setupThemeEventListeners,
  COLOR_THEMES,
} from './theme.js';

export {
  initVoice,
  startRecording,
  stopRecording,
  setupVoiceEventListeners,
} from './voice.js';

export {
  initStats,
  loadStats,
  showConvStatsDropdown,
  setupStatsEventListeners,
} from './stats.js';

export {
  initMemory,
  fetchMemories,
  createMemory,
  updateMemoryAPI,
  deleteMemoryAPI,
  showMemoryView,
  closeMemoryView,
  updateMemoryIndicator,
  toggleConversationMemory,
  rememberMessage,
  setupMemoryEventListeners,
} from './memory.js';

export {
  initDirectoryBrowser,
  browseTo,
  setupDirectoryBrowserEventListeners,
} from './directory-browser.js';

export {
  initCapabilities,
  openCapabilitiesModal,
  closeCapabilitiesModal,
  getCachedCapabilities,
  setupCapabilitiesEventListeners,
} from './capabilities.js';

export {
  initFileBrowser,
  getFileIcon,
  openFileBrowser,
  closeFileBrowser,
  getFileBrowserMode,
  getCurrentFileBrowserPath,
  setupFileBrowserEventListeners,
} from './file-browser.js';
