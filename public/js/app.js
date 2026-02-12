// --- Main entry point ---
// This module imports all other modules and initializes the application

import { initToast, initDialog } from './utils.js';
import { initWebSocket, connectWS } from './websocket.js';
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
  bulkDelete
} from './conversations.js';
import {
  initUI,
  setupEventListeners,
  hideMsgActionPopup,
  populateFilterModels
} from './ui.js';

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
const archiveToggle = document.getElementById('archive-toggle');
const archiveToggleLabel = document.getElementById('archive-toggle-label');
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
const dialogOverlay = document.getElementById('dialog-overlay');
const dialogTitle = document.getElementById('dialog-title');
const dialogBody = document.getElementById('dialog-body');
const dialogInput = document.getElementById('dialog-input');
const dialogCancel = document.getElementById('dialog-cancel');
const dialogOk = document.getElementById('dialog-ok');
const modeBadge = document.getElementById('mode-badge');
const modelBtn = document.getElementById('model-btn');
const modelDropdown = document.getElementById('model-dropdown');
const contextBar = document.getElementById('context-bar');
const contextBarFill = document.getElementById('context-bar-fill');
const contextBarLabel = document.getElementById('context-bar-label');
const convModelSelect = document.getElementById('conv-model');
const jumpToBottomBtn = document.getElementById('jump-to-bottom');
const toastContainer = document.getElementById('toast-container');
const exportBtn = document.getElementById('export-btn');
const filesBtn = document.getElementById('files-btn');
const fileBrowserModal = document.getElementById('file-browser-modal');
const fileBrowserClose = document.getElementById('file-browser-close');
const fileBrowserUp = document.getElementById('file-browser-up');
const fileBrowserCurrentPath = document.getElementById('file-browser-current-path');
const fileBrowserList = document.getElementById('file-browser-list');
const generalFilesBtn = document.getElementById('general-files-btn');
const msgActionPopup = document.getElementById('msg-action-popup');
const reconnectBanner = document.getElementById('reconnect-banner');
const themeToggle = document.getElementById('theme-toggle');
const themeDropdown = document.getElementById('theme-dropdown');
const colorThemeToggle = document.getElementById('color-theme-toggle');
const colorThemeDropdown = document.getElementById('color-theme-dropdown');
const filterToggle = document.getElementById('filter-toggle');
const filterRow = document.getElementById('filter-row');
const filterModelSelect = document.getElementById('filter-model');
const loadMoreBtn = document.getElementById('load-more-btn');
const pullIndicator = document.getElementById('pull-indicator');
const statsBtn = document.getElementById('stats-btn');
const statsView = document.getElementById('stats-view');
const statsBackBtn = document.getElementById('stats-back-btn');
const statsContent = document.getElementById('stats-content');
const listHeader = listView.querySelector('.list-header');
const selectModeBtn = document.getElementById('select-mode-btn');
const bulkActionBar = document.getElementById('bulk-action-bar');
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
  filterModelSelect
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
  convAutopilot,
  convModelSelect,
  archiveToggle,
  archiveToggleLabel,
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
  modelBtn,
  modelDropdown,
  contextBar,
  contextBarFill,
  contextBarLabel,
  jumpToBottomBtn,
  msgActionPopup,
  actionPopupOverlay,
  themeToggle,
  themeDropdown,
  colorThemeToggle,
  colorThemeDropdown,
  filterToggle,
  filterRow,
  filterModelSelect,
  loadMoreBtn,
  backBtn,
  deleteBtn,
  newChatBtn,
  exportBtn,
  filesBtn,
  fileBrowserModal,
  fileBrowserClose,
  fileBrowserUp,
  fileBrowserCurrentPath,
  fileBrowserList,
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

// Setup action popup handlers
setupActionPopupHandlers(hideMsgActionPopup);

// Setup all event listeners
setupEventListeners(createConversation);

// --- Load models ---
async function loadModels() {
  try {
    const res = await fetch('/api/models');
    const models = await res.json();
    state.setModels(models);
    // Populate modal select
    convModelSelect.innerHTML = models.map(m =>
      `<option value="${m.id}"${m.id === 'sonnet' ? ' selected' : ''}>${m.name}</option>`
    ).join('');
    populateFilterModels();
  } catch {
    state.setModels([{ id: 'sonnet', name: 'Sonnet 4.5', context: 200000 }]);
  }
}

// --- Init ---
connectWS();
loadModels();
loadConversations();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

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
