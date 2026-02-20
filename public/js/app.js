// --- Main entry point ---
// This module imports all other modules and initializes the application

import { initToast, initDialog, apiFetch, haptic } from './utils.js';
import { initWebSocket, connectWS, forceReconnect } from './websocket.js';
import * as state from './state.js';
import {
  initConversations,
  loadConversations,
  createConversation,
  setupActionPopupHandlers,
  enterSelectionMode,
  exitSelectionMode,
  selectAllConversations,
  bulkArchive,
  bulkDelete,
  showListView,
  openConversation,
  renderConversationList
} from './conversations.js';
import {
  initUI,
  setupEventListeners,
  hideMsgActionPopup,
  populateFilterModels
} from './ui.js';
import { initFilePanel } from './file-panel.js';
import { initBranches, openBranchesFromChat } from './branches.js';
import { initStandaloneFiles, closeStandaloneFiles } from './files-standalone.js';

// --- DOM refs ---
const listView = document.getElementById('list-view');
const chatView = document.getElementById('chat-view');
const conversationList = document.getElementById('conversation-list');
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const inputForm = document.getElementById('input-form');
const sendBtn = document.getElementById('send-btn');
const chatName = document.getElementById('chat-name');
const chatStatus = document.getElementById('chat-status');
const typingIndicator = document.getElementById('typing-indicator');
const newChatBtn = document.getElementById('new-chat-btn');
const backBtn = document.getElementById('back-btn');
const deleteBtn = document.getElementById('delete-btn');
const modalOverlay = document.getElementById('modal-overlay');
const newConvForm = document.getElementById('new-conv-form');
const modalCancel = document.getElementById('modal-cancel');
const convNameInput = document.getElementById('conv-name');
const convCwdInput = document.getElementById('conv-cwd');
const recentDirs = document.getElementById('recent-dirs');
const recentDirsList = document.getElementById('recent-dirs-list');
const archiveToggle = document.getElementById('archive-toggle');
const searchInput = document.getElementById('search-input');
const actionPopup = document.getElementById('action-popup');
const actionPopupOverlay = document.getElementById('action-popup-overlay');
const popupArchiveBtn = document.getElementById('popup-archive-btn');
const browseBtn = document.getElementById('browse-btn');
const dirBrowser = document.getElementById('dir-browser');
const dirUpBtn = document.getElementById('dir-up-btn');
const dirCurrentPath = document.getElementById('dir-current-path');
const dirList = document.getElementById('dir-list');
const dirNewBtn = document.getElementById('dir-new-btn');
const dirSelectBtn = document.getElementById('dir-select-btn');
const micBtn = document.getElementById('mic-btn');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const attachmentPreview = document.getElementById('attachment-preview');
const cancelBtn = document.getElementById('cancel-btn');
const convAutopilot = document.getElementById('conv-autopilot');
const convSandboxed = document.getElementById('conv-sandboxed');
const dialogOverlay = document.getElementById('dialog-overlay');
const dialogTitle = document.getElementById('dialog-title');
const dialogBody = document.getElementById('dialog-body');
const dialogInput = document.getElementById('dialog-input');
const dialogCancel = document.getElementById('dialog-cancel');
const dialogOk = document.getElementById('dialog-ok');
const modeBadge = document.getElementById('mode-badge');
const providerBadge = document.getElementById('provider-badge');
const modelBtn = document.getElementById('model-btn');
const modelDropdown = document.getElementById('model-dropdown');
const convStatsBtn = document.getElementById('conv-stats-btn');
const convStatsDropdown = document.getElementById('conv-stats-dropdown');
const contextBar = document.getElementById('context-bar');
const contextBarFill = document.getElementById('context-bar-fill');
const contextBarLabel = document.getElementById('context-bar-label');
const convProviderSelect = document.getElementById('conv-provider');
const convModelSelect = document.getElementById('conv-model');
const jumpToBottomBtn = document.getElementById('jump-to-bottom');
const toastContainer = document.getElementById('toast-container');
const exportBtn = document.getElementById('export-btn');
const filesBtn = document.getElementById('files-btn');
const newChatHereBtn = document.getElementById('new-chat-here-btn');
const fileBrowserModal = document.getElementById('file-browser-modal');
const fileBrowserClose = document.getElementById('file-browser-close');
const fileBrowserUp = document.getElementById('file-browser-up');
const fileBrowserCurrentPath = document.getElementById('file-browser-current-path');
const fileBrowserList = document.getElementById('file-browser-list');
const fileBrowserUploadBtn = document.getElementById('file-browser-upload-btn');
const fileBrowserFileInput = document.getElementById('file-browser-file-input');
const generalFilesBtn = document.getElementById('general-files-btn');
const msgActionPopup = document.getElementById('msg-action-popup');
const reconnectBanner = document.getElementById('reconnect-banner');
const filePanel = document.getElementById('file-panel');
const filePanelBackdrop = document.getElementById('file-panel-backdrop');
const filePanelClose = document.getElementById('file-panel-close');
const filePanelUp = document.getElementById('file-panel-up');
const filePanelPath = document.getElementById('file-panel-path');
const fileSearchInput = document.getElementById('file-search-input');
const filePanelUploadBtn = document.getElementById('file-panel-upload-btn');
const filePanelFileInput = document.getElementById('file-panel-file-input');
const filePanelTree = document.getElementById('file-tree');
const filePanelViewer = document.getElementById('file-viewer');
const fileViewerName = document.getElementById('file-viewer-name');
const fileViewerClose = document.getElementById('file-viewer-close');
const fileViewerContent = document.getElementById('file-viewer-content');
const diffGranularToggle = document.getElementById('diff-granular-toggle');
const filePanelTabs = document.getElementById('file-panel-tabs');
const filesTab = document.getElementById('files-tab');
const changesTab = document.getElementById('changes-tab');
const filesView = document.getElementById('files-view');
const changesView = document.getElementById('changes-view');
const changesList = document.getElementById('changes-list');
const commitForm = document.getElementById('commit-form');
const commitMessage = document.getElementById('commit-message');
const commitBtn = document.getElementById('commit-btn');
const branchSelector = document.getElementById('branch-selector');
const branchDropdown = document.getElementById('branch-dropdown');
const gitRefreshBtn = document.getElementById('git-refresh-btn');
const pushBtn = document.getElementById('push-btn');
const pullBtn = document.getElementById('pull-btn');
const stashBtn = document.getElementById('stash-btn');
const aheadBehindBadge = document.getElementById('ahead-behind-badge');
const historyTab = document.getElementById('history-tab');
const historyView = document.getElementById('history-view');
const historyList = document.getElementById('history-list');
const previewTab = document.getElementById('preview-tab');
const previewView = document.getElementById('preview-view');
const previewEmpty = document.getElementById('preview-empty');
const previewRunning = document.getElementById('preview-running');
const previewMessage = document.getElementById('preview-message');
const previewStartBtn = document.getElementById('preview-start-btn');
const previewType = document.getElementById('preview-type');
const previewUrl = document.getElementById('preview-url');
const previewOpenBtn = document.getElementById('preview-open-btn');
const previewStopBtn = document.getElementById('preview-stop-btn');
const themeDropdown = document.getElementById('theme-dropdown');
const colorThemeDropdown = document.getElementById('color-theme-dropdown');
const moreMenuBtn = document.getElementById('more-menu-btn');
const moreMenuDropdown = document.getElementById('more-menu-dropdown');
const moreColorTheme = document.getElementById('more-color-theme');
const moreThemeToggle = document.getElementById('more-theme-toggle');
const moreThemeIcon = document.getElementById('more-theme-icon');
const moreThemeLabel = document.getElementById('more-theme-label');
const moreNotificationsToggle = document.getElementById('more-notifications-toggle');
const moreNotificationsLabel = document.getElementById('more-notifications-label');
const filterToggle = document.getElementById('filter-toggle');
const semanticToggle = document.getElementById('semantic-toggle');
const filterRow = document.getElementById('filter-row');
const filterModelSelect = document.getElementById('filter-model');
const loadMoreBtn = document.getElementById('load-more-btn');
const pullIndicator = document.getElementById('pull-indicator');
const statsBtn = document.getElementById('stats-btn');
const statsView = document.getElementById('stats-view');
const statsBackBtn = document.getElementById('stats-back-btn');
const statsContent = document.getElementById('stats-content');
const branchesBtn = document.getElementById('branches-btn');
const branchesView = document.getElementById('branches-view');
const branchesBackBtn = document.getElementById('branches-back-btn');
const branchesContent = document.getElementById('branches-content');
const filesStandaloneView = document.getElementById('files-standalone-view');
const filesStandaloneBackBtn = document.getElementById('files-standalone-back-btn');
const filesStandaloneTitle = document.getElementById('files-standalone-title');
const filesStandaloneUp = document.getElementById('files-standalone-up');
const filesStandalonePath = document.getElementById('files-standalone-path');
const filesStandaloneTree = document.getElementById('files-standalone-tree');
const filesStandaloneViewer = document.getElementById('files-standalone-viewer');
const filesStandaloneViewerName = document.getElementById('files-standalone-viewer-name');
const filesStandaloneViewerClose = document.getElementById('files-standalone-viewer-close');
const filesStandaloneViewerContent = document.getElementById('files-standalone-viewer-content');
const listHeader = listView.querySelector('.list-header');
const selectModeBtn = document.getElementById('select-mode-btn');
const collapseAllBtn = document.getElementById('collapse-all-btn');
const _bulkActionBar = document.getElementById('bulk-action-bar');
const bulkCancelBtn = document.getElementById('bulk-cancel-btn');
const bulkSelectAllBtn = document.getElementById('bulk-select-all-btn');
const bulkArchiveBtn = document.getElementById('bulk-archive-btn');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');

// --- Initialize modules ---

// Initialize toast
initToast(toastContainer);

// Initialize dialog
initDialog({
  dialogOverlay,
  dialogTitle,
  dialogBody,
  dialogInput,
  dialogOk,
  dialogCancel
});

// Initialize state status elements
state.initStatusElements({
  typingIndicator,
  sendBtn,
  cancelBtn,
  chatStatus,
  messagesContainer,
  jumpToBottomBtn,
  loadMoreBtn
});

// Initialize WebSocket
initWebSocket({
  reconnectBanner
});

// Retry button for reconnection
const reconnectRetryBtn = document.getElementById('reconnect-retry-btn');
if (reconnectRetryBtn) {
  reconnectRetryBtn.addEventListener('click', forceReconnect);
}

// Initialize conversations
initConversations({
  listView,
  chatView,
  conversationList,
  chatName,
  loadMoreBtn,
  contextBar,
  messageInput,
  actionPopup,
  actionPopupOverlay,
  popupArchiveBtn,
  searchInput,
  filterRow,
  filterModelSelect,
  semanticToggle
});

// Initialize UI
initUI({
  messagesContainer,
  messageInput,
  inputForm,
  sendBtn,
  cancelBtn,
  modalOverlay,
  newConvForm,
  modalCancel,
  convNameInput,
  convCwdInput,
  recentDirs,
  recentDirsList,
  convAutopilot,
  convSandboxed,
  convProviderSelect,
  convModelSelect,
  archiveToggle,
  searchInput,
  browseBtn,
  dirBrowser,
  dirUpBtn,
  dirCurrentPath,
  dirList,
  dirNewBtn,
  dirSelectBtn,
  micBtn,
  attachBtn,
  fileInput,
  attachmentPreview,
  modeBadge,
  providerBadge,
  modelBtn,
  modelDropdown,
  convStatsBtn,
  convStatsDropdown,
  chatName,
  contextBar,
  contextBarFill,
  contextBarLabel,
  jumpToBottomBtn,
  msgActionPopup,
  actionPopupOverlay,
  themeDropdown,
  colorThemeDropdown,
  moreMenuBtn,
  moreMenuDropdown,
  moreColorTheme,
  moreThemeToggle,
  moreThemeIcon,
  moreThemeLabel,
  moreNotificationsToggle,
  moreNotificationsLabel,
  filterToggle,
  filterRow,
  filterModelSelect,
  loadMoreBtn,
  backBtn,
  deleteBtn,
  newChatBtn,
  exportBtn,
  filesBtn,
  newChatHereBtn,
  fileBrowserModal,
  fileBrowserClose,
  fileBrowserUp,
  fileBrowserCurrentPath,
  fileBrowserList,
  fileBrowserUploadBtn,
  fileBrowserFileInput,
  generalFilesBtn,
  conversationList,
  pullIndicator,
  listHeader,
  statsBtn,
  statsView,
  statsBackBtn,
  statsContent,
  listView,
  chatView
});

// Initialize file panel
initFilePanel({
  filePanel,
  filePanelBackdrop,
  filePanelClose,
  filePanelUp,
  filePanelPath,
  fileSearchInput,
  filePanelUploadBtn,
  filePanelFileInput,
  fileTree: filePanelTree,
  fileViewer: filePanelViewer,
  fileViewerName,
  fileViewerClose,
  fileViewerContent,
  diffGranularToggle,
  chatView,
  filePanelTabs,
  filesTab,
  changesTab,
  filesView,
  changesView,
  changesList,
  commitForm,
  commitMessage,
  commitBtn,
  branchSelector,
  branchDropdown,
  gitRefreshBtn,
  pushBtn,
  pullBtn,
  stashBtn,
  aheadBehindBadge,
  historyTab,
  historyView,
  historyList,
  previewTab,
  previewView,
  previewEmpty,
  previewRunning,
  previewMessage,
  previewStartBtn,
  previewType,
  previewUrl,
  previewOpenBtn,
  previewStopBtn
});

// Initialize branches view
initBranches({
  branchesView,
  branchesBackBtn,
  branchesContent,
  listView,
  chatView
});

// Initialize standalone files view
initStandaloneFiles({
  filesStandaloneView,
  listView,
  backBtn: filesStandaloneBackBtn,
  titleEl: filesStandaloneTitle,
  upBtn: filesStandaloneUp,
  pathEl: filesStandalonePath,
  fileTree: filesStandaloneTree,
  fileViewer: filesStandaloneViewer,
  fileViewerName: filesStandaloneViewerName,
  fileViewerClose: filesStandaloneViewerClose,
  fileViewerContent: filesStandaloneViewerContent
});

// Setup action popup handlers
setupActionPopupHandlers(hideMsgActionPopup);

// Setup all event listeners
setupEventListeners(createConversation);

// --- Load models ---
async function loadModels(provider = 'claude') {
  const res = await apiFetch(`/api/models?provider=${provider}`, { silent: true });
  if (!res) {
    if (provider === 'claude') {
      state.setModels([{ id: 'claude-sonnet-4.5', name: 'Sonnet 4.5', context: 200000 }]);
    } else {
      state.setModels([{ id: 'llama3.2', name: 'Llama 3.2', context: 128000 }]);
    }
    return;
  }
  const models = await res.json();
  state.setModels(models);

  // Populate modal select with first option selected
  const defaultModel = models[0]?.id || (provider === 'claude' ? 'claude-sonnet-4.5' : 'llama3.2');
  convModelSelect.innerHTML = models.map(m =>
    `<option value="${m.id}"${m.id === defaultModel ? ' selected' : ''}>${m.name}</option>`
  ).join('');

  // Only populate filter for Claude (main provider)
  if (provider === 'claude') {
    populateFilterModels();
  }
}

// Handle provider change in new conversation modal
if (convProviderSelect) {
  convProviderSelect.addEventListener('change', () => {
    const provider = convProviderSelect.value;
    loadModels(provider);

    // Disable sandbox/autopilot toggles for non-Claude providers (no tool use)
    const supportsTools = provider === 'claude';
    if (convSandboxed) {
      convSandboxed.disabled = !supportsTools;
      convSandboxed.closest('.toggle-row')?.classList.toggle('disabled', !supportsTools);
    }
    if (convAutopilot) {
      convAutopilot.disabled = !supportsTools;
      convAutopilot.closest('.toggle-row')?.classList.toggle('disabled', !supportsTools);
    }
  });
}

// --- Init ---
connectWS();
loadModels();
loadConversations().then(() => {
  // Sync collapse button state after conversations load
  updateCollapseButtonState();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Clear title notification when tab becomes visible
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    state.clearTitleNotification();
  }
});

// Request notification permission on first interaction if enabled
document.addEventListener('click', async function requestNotifOnce() {
  if (state.getNotificationsEnabled() && 'Notification' in window && Notification.permission === 'default') {
    await state.requestNotificationPermission();
  }
  document.removeEventListener('click', requestNotifOnce);
}, { once: true });

// --- Bulk selection handlers ---
if (selectModeBtn) {
  selectModeBtn.addEventListener('click', () => {
    if (state.getSelectionMode()) {
      exitSelectionMode();
    } else {
      enterSelectionMode();
    }
  });
}

if (bulkCancelBtn) {
  bulkCancelBtn.addEventListener('click', () => exitSelectionMode());
}

if (bulkSelectAllBtn) {
  bulkSelectAllBtn.addEventListener('click', () => selectAllConversations());
}

if (bulkArchiveBtn) {
  bulkArchiveBtn.addEventListener('click', () => bulkArchive());
}

if (bulkDeleteBtn) {
  bulkDeleteBtn.addEventListener('click', () => bulkDelete());
}

// Branches button handler
if (branchesBtn) {
  branchesBtn.addEventListener('click', () => {
    openBranchesFromChat();
  });
}

/**
 * Update the collapse/expand all button state based on current scope collapse status.
 * Exported for use in renderConversationList to keep button in sync.
 */
export function updateCollapseButtonState() {
  if (!collapseAllBtn) return;
  const scopes = state.getAllScopes();
  const allCollapsed = state.areAllCollapsed(scopes);
  collapseAllBtn.classList.toggle('active', allCollapsed);
  collapseAllBtn.title = allCollapsed ? 'Expand all' : 'Collapse all';
  collapseAllBtn.setAttribute('aria-label', allCollapsed ? 'Expand all' : 'Collapse all');
}

// Collapse/expand all button handler
if (collapseAllBtn) {
  collapseAllBtn.addEventListener('click', () => {
    haptic();
    const scopes = state.getAllScopes();

    if (state.areAllCollapsed(scopes)) {
      // Everything is collapsed, expand all
      state.expandAll(scopes);
    } else {
      // Some things are expanded, collapse all
      state.collapseAll(scopes);
    }
    updateCollapseButtonState();
    renderConversationList();
  });
}

// --- Browser history for Android back button support ---
// Set initial state
history.replaceState({ view: 'list' }, '', location.hash || '#');

// Handle back button (popstate)
window.addEventListener('popstate', (e) => {
  const currentView = e.state?.view;

  if (currentView === 'list' || !currentView) {
    // Going back to list view
    if (state.getCurrentConversationId()) {
      showListView(true); // true = skip history update
    }
    // Also close standalone files if open
    closeStandaloneFiles(true); // true = skip history update (popstate already handled it)
  } else if (currentView === 'chat' && e.state?.conversationId) {
    // Going forward to chat view (rare, but handle it)
    openConversation(e.state.conversationId);
  }
});

// Handle initial load with hash (direct link to conversation)
if (location.hash && location.hash.length > 1) {
  const convId = location.hash.slice(1);
  // Defer to let conversations load first
  setTimeout(() => {
    if (state.conversations.some(c => c.id === convId)) {
      openConversation(convId);
    }
  }, 500);
}

// --- Easter eggs ---

// Konami code: ↑↑↓↓←→←→BA
const konamiSequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let konamiIndex = 0;

document.addEventListener('keydown', (e) => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === konamiSequence[konamiIndex]) {
    konamiIndex++;
    if (konamiIndex === konamiSequence.length) {
      konamiIndex = 0;
      triggerPartyMode();
    }
  } else {
    konamiIndex = 0;
  }
});

function triggerPartyMode() {
  haptic(50);
  // Create confetti burst
  const colors = ['#d4a574', '#f0c674', '#81a2be', '#b294bb', '#8abeb7', '#cc6666'];
  for (let i = 0; i < 100; i++) {
    const confetti = document.createElement('div');
    confetti.style.cssText = `
      position: fixed;
      width: 10px;
      height: 10px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      left: ${Math.random() * 100}vw;
      top: -10px;
      border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
      pointer-events: none;
      z-index: 9999;
      animation: confetti-fall ${2 + Math.random() * 2}s linear forwards;
    `;
    document.body.appendChild(confetti);
    setTimeout(() => confetti.remove(), 4000);
  }

  // Add confetti animation if not exists
  if (!document.getElementById('confetti-style')) {
    const style = document.createElement('style');
    style.id = 'confetti-style';
    style.textContent = `
      @keyframes confetti-fall {
        to {
          transform: translateY(100vh) rotate(${Math.random() * 720}deg);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Show toast
  import('./utils.js').then(({ showToast }) => {
    showToast('🎉 You found the secret!');
  });
}

// Tap title 7 times for secret
let titleTapCount = 0;
let titleTapTimer = null;
const appTitle = document.querySelector('#list-view .brand h1');
if (appTitle) {
  appTitle.addEventListener('click', () => {
    titleTapCount++;
    clearTimeout(titleTapTimer);
    titleTapTimer = setTimeout(() => { titleTapCount = 0; }, 2000);

    if (titleTapCount === 7) {
      titleTapCount = 0;
      haptic(30);
      // Brief rainbow mode
      document.documentElement.style.setProperty('--accent', `hsl(${Math.random() * 360}, 70%, 60%)`);
      import('./utils.js').then(({ showToast }) => {
        showToast('🌈 Accent randomized! Refresh to reset.');
      });
    }
  });
}

// --- PWA Install Prompt ---
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome's default mini-infobar
  e.preventDefault();
  deferredInstallPrompt = e;

  // Show install menu item in the more menu
  const installBtn = document.getElementById('pwa-install-btn');
  const installDivider = document.getElementById('pwa-install-divider');
  if (installBtn) installBtn.classList.remove('hidden');
  if (installDivider) installDivider.classList.remove('hidden');
  console.log('PWA install prompt ready');
});

// Handle install button click
const pwaInstallBtn = document.getElementById('pwa-install-btn');
const pwaInstallDivider = document.getElementById('pwa-install-divider');
if (pwaInstallBtn) {
  pwaInstallBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      import('./utils.js').then(({ showToast }) => {
        showToast('App already installed or not available');
      });
      return;
    }

    // Close the more menu first
    moreMenuDropdown?.classList.add('hidden');

    haptic();
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;

    if (outcome === 'accepted') {
      import('./utils.js').then(({ showToast }) => {
        showToast('App installed! Find it on your home screen.');
      });
    }

    deferredInstallPrompt = null;
    pwaInstallBtn.classList.add('hidden');
    if (pwaInstallDivider) pwaInstallDivider.classList.add('hidden');
  });
}

// Hide install menu item if app is already installed
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const installBtn = document.getElementById('pwa-install-btn');
  const installDivider = document.getElementById('pwa-install-divider');
  if (installBtn) installBtn.classList.add('hidden');
  if (installDivider) installDivider.classList.add('hidden');
  console.log('PWA installed');
});
