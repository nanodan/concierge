// --- UI interactions (core message/input handling) ---
import { escapeHtml } from './markdown.js';
import { formatTime, haptic, showToast, showDialog, getDialogOverlay, getDialogCancel, apiFetch, setupLongPressHandler } from './utils.js';
import { HEADER_COMPACT_ENTER, HEADER_COMPACT_EXIT, MESSAGE_INPUT_MAX_HEIGHT } from './constants.js';
import { getWS } from './websocket.js';
import { loadConversations, deleteConversation, forkConversation, showListView, triggerSearch, hideActionPopup, renameConversation } from './conversations.js';
import { showReactionPicker, setAttachMessageActionsCallback, loadMoreMessages, attachCopyMsgHandlers } from './render.js';
import * as state from './state.js';
import { toggleFilePanel, openFilePanel, closeFilePanel, isFilePanelOpen, isFileViewerOpen, closeFileViewer } from './file-panel.js';
import { isBranchesViewOpen, closeBranchesView } from './branches.js';
import { openStandaloneFiles, closeStandaloneFiles } from './files-standalone.js';

// Import UI submodules
import {
  initTheme,
  applyTheme,
  applyColorTheme,
  updateThemeIcon,
  updateColorThemeIcon,
  closeMoreMenu,
  closeThemeDropdown,
  closeColorThemeDropdown,
  toggleColorThemeDropdown as _toggleColorThemeDropdown,
  toggleThemeDropdown as _toggleThemeDropdown,
  setupThemeEventListeners,
  selectTheme,
  selectColorTheme,
} from './ui/theme.js';

import {
  initVoice,
  setupVoiceEventListeners,
} from './ui/voice.js';

import {
  initStats,
  loadStats,
  showConvStatsDropdown,
  setupStatsEventListeners,
} from './ui/stats.js';

import {
  initMemory,
  showMemoryView,
  closeMemoryView,
  updateMemoryIndicator,
  toggleConversationMemory,
  rememberMessage,
  setupMemoryEventListeners,
} from './ui/memory.js';

import {
  initDirectoryBrowser,
  setupDirectoryBrowserEventListeners,
} from './ui/directory-browser.js';

import {
  initCapabilities,
  openCapabilitiesModal,
  closeCapabilitiesModal,
  setupCapabilitiesEventListeners,
} from './ui/capabilities.js';

import {
  initContextBar,
  setupContextBarEventListeners,
  updateContextBar,
  calculateCumulativeTokens,
  showCompressionPrompt,
} from './ui/context-bar.js';

// Re-export for backward compatibility
export {
  showMemoryView,
  closeMemoryView,
  updateMemoryIndicator,
  openCapabilitiesModal,
  closeCapabilitiesModal,
  updateContextBar,
  calculateCumulativeTokens,
  showCompressionPrompt,
};

// Re-export memory API functions
export { fetchMemories, createMemory, updateMemoryAPI, deleteMemoryAPI } from './ui/memory.js';

// --- File browser mode routing ---
let fileBrowserMode = 'conversation';
const WRITE_LOCK_HEARTBEAT_MS = 20_000;
let workflowHeartbeatTimer = null;
let workflowHeartbeatConversationId = null;
let workflowHeartbeatCwd = null;
let lastWorkflowLockErrorAt = 0;

function isStandaloneVisible() {
  const view = document.getElementById('files-standalone-view');
  return !!view && view.classList.contains('slide-in');
}

export function openFileBrowser(mode = 'conversation') {
  fileBrowserMode = mode;

  if (mode === 'general') {
    openStandaloneFiles('');
    return;
  }

  openFilePanel();
}

export function closeFileBrowser() {
  if (fileBrowserMode === 'general' || isStandaloneVisible()) {
    closeStandaloneFiles();
    return;
  }

  closeFilePanel();
}

function setupFileBrowserEventListeners(generalFilesBtn, hapticFn = () => {}) {
  if (!generalFilesBtn) return;

  generalFilesBtn.addEventListener('click', () => {
    hapticFn();
    openFileBrowser('general');
  });
}

function getCurrentConversationCwd() {
  const convId = state.getCurrentConversationId();
  if (!convId) return '';
  const conv = state.conversations.find((item) => item.id === convId);
  return conv?.cwd || '';
}

async function postWorkflowLock(endpoint, payload) {
  try {
    const res = await fetch(`/api/workflow/lock/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err.message || 'Network error' } };
  }
}

function stopWorkflowHeartbeat({ release = false } = {}) {
  if (workflowHeartbeatTimer) {
    clearInterval(workflowHeartbeatTimer);
    workflowHeartbeatTimer = null;
  }

  const prevConversationId = workflowHeartbeatConversationId;
  const prevCwd = workflowHeartbeatCwd;
  workflowHeartbeatConversationId = null;
  workflowHeartbeatCwd = null;

  if (release && prevConversationId && prevCwd) {
    void postWorkflowLock('release', {
      conversationId: prevConversationId,
      cwd: prevCwd,
    });
  }
}

async function downgradeFromAutonomousLockLoss(conversationId) {
  if (!conversationId || state.getCurrentConversationId() !== conversationId) return;
  if (state.getCurrentExecutionMode() !== 'autonomous') return;

  await apiFetch(`/api/conversations/${conversationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ executionMode: 'patch' }),
    silent: true,
  });

  state.setCurrentExecutionMode('patch');
  state.setCurrentAutopilot(true);
  updateModeBadge('patch', state.getCurrentProvider());
  showToast('Autonomous lock lost - switched to patch mode', { variant: 'error' });
}

async function sendWorkflowHeartbeat() {
  const conversationId = workflowHeartbeatConversationId;
  const cwd = workflowHeartbeatCwd;
  if (!conversationId || !cwd) return;

  const isSameConversation = state.getCurrentConversationId() === conversationId;
  const isAutonomous = state.getCurrentExecutionMode() === 'autonomous';

  if (!isSameConversation || !isAutonomous) {
    // Conversation focus changed; keep lock ownership intact and just stop this timer.
    stopWorkflowHeartbeat();
    return;
  }

  const result = await postWorkflowLock('heartbeat', { conversationId, cwd });
  if (result.ok) return;

  stopWorkflowHeartbeat();
  await downgradeFromAutonomousLockLoss(conversationId);
}

export async function syncWorkflowLockHeartbeat() {
  // Lock lifecycle is execution-scoped and managed by the server runtime.
  stopWorkflowHeartbeat();
}

// --- Bell easter egg quotes by theme ---
const bellQuotes = {
  budapest: [
    "A lobby boy is completely invisible, yet always in sight.",
    "There are still faint glimmers of civilization left.",
    "Rudeness is merely an expression of fear.",
    "You see, there are still faint glimmers of civilization left in this barbaric slaughterhouse.",
    "I must say, I find that girl utterly delightful.",
    "Keep your hands off my lobby boy!",
    "To be frank, I think his world had vanished long before he ever entered it.",
    "A word from the wise: start with the caviar.",
    "You're looking so well, darling, you really are.",
    "We must be confident, not arrogant.",
  ],
  darjeeling: [
    "I wonder if the three of us could've been friends in real life.",
    "Let's make an agreement to love each other.",
    "I want us to be brothers again like we used to be.",
    "The train is lost. We haven't located us yet.",
    "I had a meltdown. Can I stay here a while?",
    "Sweet lime. It's very tasty.",
    "I guess I've still got some prior unfulfilled business.",
    "What's wrong with you? Nothing's wrong with me.",
    "We could be like brothers again. Like we used to be.",
    "The characters are all fictional.",
  ],
  moonrise: [
    "I love you, but you don't know what you're talking about.",
    "We're in love. We just want to be together. What's wrong with that?",
    "I always wished I was an orphan. Most of my favorite characters are.",
    "I feel I'm in a different world with you.",
    "Was he a good dog? Who's to say.",
    "Jiminy Cricket, he flew the coop!",
    "What kind of bird are YOU?",
    "I'm on your side, by the way.",
    "We wrote to each other once a week for a year.",
    "It's possible I may wet the bed. I'm a very anxious person.",
  ],
  aquatic: [
    "This is an adventure.",
    "I wonder if it remembers me.",
    "Let me tell you about my boat.",
    "Out here, we're all equals.",
    "Be still, Cody.",
    "We're in the middle of a lightning strike rescue.",
    "I'm right on top of that.",
    "This is supposed to be a happy occasion!",
    "That's an endangered species at most.",
    "You know I'm not good with those things.",
  ],
  monokai: [
    "Hello, World!",
    "// TODO: ring bell",
    "It works on my machine.",
    "Have you tried turning it off and on again?",
    "git commit -m 'ding'",
    "console.log('ring ring');",
    "Works in production.",
    "It's not a bug, it's a feature.",
    "Ship it!",
    "LGTM.",
  ],
  catppuccin: [
    "*purrs contentedly*",
    "Meow?",
    "*stretches lazily*",
    "Time for a nap...",
    "*blinks slowly*",
    "Cozy vibes only.",
    "*curls up*",
    "Warm and fuzzy.",
    "*kneads blanket*",
    "Purrfect.",
  ],
  fjord: [
    "Velkommen.",
    "Take your time.",
    "Breathe deeply.",
    "The mountains are calling.",
    "Find your calm.",
    "Slow and steady.",
    "Nature knows best.",
    "Peace and quiet.",
    "Stay cozy.",
    "The fjords await.",
  ],
};

// Bell ring handler
function ringBell(bellElement) {
  // Get current theme
  const themeLink = document.getElementById('color-theme-link');
  const themePath = themeLink?.href || '';
  const themeMatch = themePath.match(/themes\/([^.]+)\.css/);
  const theme = themeMatch ? themeMatch[1] : 'darjeeling';

  // Get quotes for this theme (fallback to darjeeling)
  const quotes = bellQuotes[theme] || bellQuotes.darjeeling;
  const quote = quotes[Math.floor(Math.random() * quotes.length)];

  // Trigger animation
  bellElement.classList.remove('bell-ringing');
  // Force reflow to restart animation
  void bellElement.offsetWidth;
  bellElement.classList.add('bell-ringing');

  // Haptic feedback
  haptic();

  // Show toast with quote
  showToast(quote, { duration: 3000 });

  // Remove animation class when done
  bellElement.addEventListener('animationend', () => {
    bellElement.classList.remove('bell-ringing');
  }, { once: true });
}

// DOM elements (set by init)
let messagesContainer = null;
let messageInput = null;
let inputForm = null;
let _sendBtn = null;
let cancelBtn = null;
let modalOverlay = null;
let newConvForm = null;
let modalCancel = null;
let convNameInput = null;
let convCwdInput = null;
let recentDirs = null;
let recentDirsList = null;
let convAutopilot = null;
let convSandboxed = null;
let convProviderSelect = null;
let convModelSelect = null;
let archiveToggle = null;
let searchInput = null;
let dirBrowser = null;
let attachBtn = null;
let fileInput = null;
let attachmentPreview = null;
let modeBadge = null;
let providerBadge = null;
let modelBtn = null;
let modelDropdown = null;
let jumpToBottomBtn = null;
let msgActionPopup = null;
let actionPopupOverlay = null;
let themeDropdown = null;
let colorThemeDropdown = null;
let moreMenuDropdown = null;
let moreNotificationsToggle = null;
let moreNotificationsLabel = null;
let moreStats = null;
let moreFiles = null;
let moreArchive = null;
let moreArchiveLabel = null;
let filterToggle = null;
let filterRow = null;
let filterModelSelect = null;
let loadMoreBtn = null;
let backBtn = null;
let deleteBtn = null;
let newChatBtn = null;
let exportBtn = null;
let chatMoreBtn = null;
let chatMoreDropdown = null;
let conversationList = null;
let pullIndicator = null;
let listHeader = null;
let statsView = null;
let statsBackBtn = null;
let listView = null;
let chatView = null;
let filesBtn = null;
let newChatHereBtn = null;
let capabilitiesBtn = null;
let capabilitiesModal = null;
let memoryView = null;
let chatName = null;

export function initUI(elements) {
  messagesContainer = elements.messagesContainer;
  messageInput = elements.messageInput;
  inputForm = elements.inputForm;
  _sendBtn = elements.sendBtn;
  cancelBtn = elements.cancelBtn;
  modalOverlay = elements.modalOverlay;
  newConvForm = elements.newConvForm;
  modalCancel = elements.modalCancel;
  convNameInput = elements.convNameInput;
  convCwdInput = elements.convCwdInput;
  recentDirs = elements.recentDirs;
  recentDirsList = elements.recentDirsList;
  convAutopilot = elements.convAutopilot;
  convSandboxed = elements.convSandboxed;
  convProviderSelect = elements.convProviderSelect;
  convModelSelect = elements.convModelSelect;
  archiveToggle = elements.archiveToggle;
  searchInput = elements.searchInput;
  dirBrowser = elements.dirBrowser;
  attachBtn = elements.attachBtn;
  fileInput = elements.fileInput;
  attachmentPreview = elements.attachmentPreview;
  modeBadge = elements.modeBadge;
  providerBadge = elements.providerBadge;
  modelBtn = elements.modelBtn;
  modelDropdown = elements.modelDropdown;
  jumpToBottomBtn = elements.jumpToBottomBtn;
  msgActionPopup = elements.msgActionPopup;
  actionPopupOverlay = elements.actionPopupOverlay;
  themeDropdown = elements.themeDropdown;
  colorThemeDropdown = elements.colorThemeDropdown;
  moreMenuDropdown = elements.moreMenuDropdown;
  moreNotificationsToggle = elements.moreNotificationsToggle;
  moreNotificationsLabel = elements.moreNotificationsLabel;
  moreStats = document.getElementById('more-stats');
  moreFiles = document.getElementById('more-files');
  moreArchive = document.getElementById('more-archive');
  moreArchiveLabel = document.getElementById('more-archive-label');
  chatMoreBtn = document.getElementById('chat-more-btn');
  chatMoreDropdown = document.getElementById('chat-more-dropdown');
  filterToggle = elements.filterToggle;
  filterRow = elements.filterRow;
  filterModelSelect = elements.filterModelSelect;
  loadMoreBtn = elements.loadMoreBtn;
  backBtn = elements.backBtn;
  deleteBtn = elements.deleteBtn;
  newChatBtn = elements.newChatBtn;
  exportBtn = elements.exportBtn;
  conversationList = elements.conversationList;
  pullIndicator = elements.pullIndicator;
  listHeader = elements.listHeader;
  statsView = elements.statsView;
  statsBackBtn = elements.statsBackBtn;
  listView = elements.listView;
  chatView = elements.chatView;
  filesBtn = elements.filesBtn;
  newChatHereBtn = elements.newChatHereBtn;
  capabilitiesBtn = document.getElementById('capabilities-btn');
  capabilitiesModal = document.getElementById('capabilities-modal');
  memoryView = document.getElementById('memory-view');
  chatName = elements.chatName;

  // Chat name click to rename
  if (chatName) {
    chatName.style.cursor = 'pointer';
    chatName.addEventListener('click', async () => {
      const currentId = state.getCurrentConversationId();
      if (!currentId) return;
      const currentName = chatName.textContent || '';
      const newName = await showDialog({
        title: 'Rename conversation',
        input: true,
        defaultValue: currentName,
        placeholder: 'Conversation name',
        confirmLabel: 'Rename'
      });
      if (newName && newName.trim() && newName.trim() !== currentName) {
        const success = await renameConversation(currentId, newName.trim());
        if (success) {
          chatName.textContent = newName.trim();
          showToast('Conversation renamed');
        }
      }
    });
  }

  // Initialize notifications label
  updateNotificationsLabel();

  // Initialize submodules
  initTheme({
    themeDropdown: elements.themeDropdown,
    colorThemeDropdown: elements.colorThemeDropdown,
    moreMenuBtn: elements.moreMenuBtn,
    moreMenuDropdown: elements.moreMenuDropdown,
    moreColorTheme: elements.moreColorTheme,
    moreThemeToggle: elements.moreThemeToggle,
    moreThemeIcon: elements.moreThemeIcon,
    moreThemeLabel: elements.moreThemeLabel,
  });

  initVoice({
    micBtn: elements.micBtn,
    messageInput: elements.messageInput,
  }, autoResizeInput);

  initStats({
    statsBtn: elements.statsBtn,
    statsView: elements.statsView,
    statsBackBtn: elements.statsBackBtn,
    statsContent: elements.statsContent,
    listView: elements.listView,
    convStatsBtn: elements.convStatsBtn,
    convStatsDropdown: elements.convStatsDropdown,
  });

  initMemory({
    listView: elements.listView,
  });

  initDirectoryBrowser({
    browseBtn: elements.browseBtn,
    dirBrowser: elements.dirBrowser,
    dirUpBtn: elements.dirUpBtn,
    dirCurrentPath: elements.dirCurrentPath,
    dirList: elements.dirList,
    dirNewBtn: elements.dirNewBtn,
    dirSelectBtn: elements.dirSelectBtn,
    convCwdInput: elements.convCwdInput,
  });

  initCapabilities({
    messageInput: elements.messageInput,
  });

  initContextBar({
    contextBar: elements.contextBar,
    contextBarFill: elements.contextBarFill,
    contextBarLabel: elements.contextBarLabel,
  });
}

// --- Auto resize input ---
export function autoResizeInput() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, MESSAGE_INPUT_MAX_HEIGHT) + 'px';
}

// --- Populate recent directories ---
function populateRecentDirs() {
  if (!recentDirs || !recentDirsList) return;

  // Get unique directories from conversations, sorted by most recent
  const dirs = state.conversations
    .filter(c => c.cwd && !c.archived)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map(c => c.cwd)
    .filter((dir, i, arr) => arr.indexOf(dir) === i) // unique
    .slice(0, 5); // limit to 5

  if (dirs.length === 0) {
    recentDirs.classList.add('hidden');
    return;
  }

  recentDirs.classList.remove('hidden');
  recentDirsList.innerHTML = dirs.map(dir => {
    const shortName = dir.split('/').pop() || dir;
    return `<button type="button" class="recent-dir-chip" data-dir="${dir}" title="${dir}">${shortName}</button>`;
  }).join('');

  // Add click handlers
  recentDirsList.querySelectorAll('.recent-dir-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      convCwdInput.value = chip.dataset.dir;
      haptic();
    });
  });
}

// --- Open new chat modal with optional pre-filled directory ---
export function openNewChatModal(cwd = '') {
  convNameInput.value = '';
  convCwdInput.value = cwd;
  dirBrowser.classList.add('hidden');
  populateRecentDirs();

  // Reset provider to Claude and re-enable toggles
  if (convProviderSelect) {
    convProviderSelect.value = 'claude';
    // Trigger change event to reload Claude models
    convProviderSelect.dispatchEvent(new Event('change'));
  }
  if (convSandboxed) {
    convSandboxed.disabled = false;
    convSandboxed.closest('.toggle-row')?.classList.remove('disabled');
  }
  if (convAutopilot) {
    convAutopilot.disabled = false;
    convAutopilot.closest('.toggle-row')?.classList.remove('disabled');
  }

  modalOverlay.classList.remove('hidden');
  convNameInput.focus();
  haptic(15);
}

// --- Send message ---

// Thank you easter egg - check for gratitude and show hearts
const THANK_YOU_PATTERNS = /\b(thanks?|thank\s*you|thx|ty|tysm|thank\s*u|cheers|gracias|merci|danke|arigatou?|grazie)\b/i;
const COPY_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

function buildUserMessageActionButtons() {
  return `<div class="msg-action-btns user-actions"><button class="msg-action-btn copy-msg-btn" aria-label="Copy message" title="Copy">${COPY_ICON_SVG}</button></div>`;
}

function triggerHeartsAnimation() {
  const hearts = ['❤️', '🧡', '💛', '💚', '💙', '💜', '🩷', '🩵', '🤍'];
  for (let i = 0; i < 15; i++) {
    const heart = document.createElement('div');
    heart.textContent = hearts[Math.floor(Math.random() * hearts.length)];
    heart.style.cssText = `
      position: fixed;
      font-size: ${16 + Math.random() * 16}px;
      left: ${20 + Math.random() * 60}vw;
      bottom: 80px;
      pointer-events: none;
      z-index: 9999;
      opacity: 1;
      animation: heart-float ${2 + Math.random() * 2}s ease-out forwards;
    `;
    document.body.appendChild(heart);
    setTimeout(() => heart.remove(), 4000);
  }

  // Add animation if not exists
  if (!document.getElementById('heart-float-style')) {
    const style = document.createElement('style');
    style.id = 'heart-float-style';
    style.textContent = `
      @keyframes heart-float {
        0% { transform: translateY(0) scale(0); opacity: 0; }
        10% { transform: translateY(-20px) scale(1); opacity: 1; }
        100% { transform: translateY(-200px) scale(0.5); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }
}

export async function sendMessage(text) {
  const pendingAttachments = state.getPendingAttachments();
  const currentConversationId = state.getCurrentConversationId();
  const ws = getWS();

  if ((!text.trim() && pendingAttachments.length === 0) || !currentConversationId) return;
  haptic(5);

  // Easter egg: hearts when thanking Claude
  if (THANK_YOU_PATTERNS.test(text)) {
    triggerHeartsAnimation();
  }

  // Queue if offline (without attachments)
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (pendingAttachments.length > 0) {
      showToast('Cannot upload files while offline', { variant: 'error' });
      return;
    }
    const msg = { type: 'message', conversationId: currentConversationId, text: text || '' };
    state.addPendingMessage(msg);
    const queuedIndex = state.getAllMessages().length;
    const el = document.createElement('div');
    el.className = 'message user animate-in queued';
    el.dataset.index = queuedIndex;
    el.innerHTML = escapeHtml(text) + `<div class="meta">${formatTime(Date.now())} &middot; queued</div>${buildUserMessageActionButtons()}`;
    messagesContainer.appendChild(el);
    attachCopyMsgHandlers();
    attachMessageActions();
    state.scrollToBottom(true);
    messageInput.value = '';
    autoResizeInput();
    showToast('Message queued — will send when reconnected');
    return;
  }

  // Upload attachments first
  let attachments = [];
  for (const att of pendingAttachments) {
    const resp = await apiFetch(
      `/api/conversations/${currentConversationId}/upload?filename=${encodeURIComponent(att.name)}`,
      { method: 'POST', body: att.file }
    );
    if (!resp) continue;
    const result = await resp.json();
    attachments.push(result);
  }

  // Build attachment HTML for the message bubble
  let attachHtml = '';
  if (attachments.length > 0) {
    attachHtml = '<div class="msg-attachments">' + attachments.map(a =>
      /\.(png|jpg|jpeg|gif|webp)$/i.test(a.filename)
        ? `<img src="${a.url}" class="msg-attachment-img" alt="${escapeHtml(a.filename)}">`
        : `<span class="msg-attachment-file">${escapeHtml(a.filename)}</span>`
    ).join('') + '</div>';
  }

  // Hide empty state and show message in UI
  const chatEmptyState = document.getElementById('chat-empty-state');
  if (chatEmptyState) chatEmptyState.classList.add('hidden');

  // Get index for this message (current length before adding)
  const allMessages = state.getAllMessages();
  const msgIndex = allMessages.length;

  const el = document.createElement('div');
  el.className = 'message user animate-in';
  el.dataset.index = msgIndex;
  el.innerHTML = attachHtml + escapeHtml(text) + `<div class="meta">${formatTime(Date.now())}</div>${buildUserMessageActionButtons()}`;
  messagesContainer.appendChild(el);
  state.setUserHasScrolledUp(false);
  state.scrollToBottom(true);

  // Attach handlers for the newly added message
  attachCopyMsgHandlers();
  attachMessageActions();
  if (attachments.length > 0) {
    const { attachImageHandlers } = await import('./render.js');
    attachImageHandlers();
  }

  ws.send(JSON.stringify({
    type: 'message',
    conversationId: currentConversationId,
    text,
    attachments: attachments.length > 0 ? attachments : undefined,
  }));

  // Add user message to allMessages so stats are up-to-date
  allMessages.push({
    role: 'user',
    text,
    attachments: attachments.length > 0 ? attachments : undefined,
    timestamp: Date.now(),
  });

  // Clean up
  state.clearPendingAttachments();
  renderAttachmentPreview();
  state.setThinking(true);
  messageInput.value = '';
  autoResizeInput();
}

// --- Attachments ---
export function renderAttachmentPreview() {
  const pendingAttachments = state.getPendingAttachments();

  // Update attach button state
  if (attachBtn) {
    attachBtn.classList.toggle('has-files', pendingAttachments.length > 0);
  }

  if (pendingAttachments.length === 0) {
    attachmentPreview.classList.add('hidden');
    return;
  }
  attachmentPreview.classList.remove('hidden');
  attachmentPreview.innerHTML = pendingAttachments.map((att, i) => {
    const thumb = att.previewUrl
      ? `<img src="${att.previewUrl}" class="attachment-thumb">`
      : '<span class="attachment-file-icon">&#x1F4CE;</span>';
    return `<div class="attachment-item">
      ${thumb}
      <span class="attachment-name">${escapeHtml(att.name)}</span>
      <button class="attachment-remove" data-index="${i}">&times;</button>
    </div>`;
  }).join('');
  attachmentPreview.querySelectorAll('.attachment-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      state.removePendingAttachment(idx);
      renderAttachmentPreview();
    });
  });
}

// --- Message Actions (Edit & Regenerate) ---
export function attachMessageActions() {
  messagesContainer.querySelectorAll('.message[data-index]').forEach(el => {
    if (el.dataset.actionsAttached) return;
    el.dataset.actionsAttached = 'true';

    const index = parseInt(el.dataset.index);
    const isUser = el.classList.contains('user');

    // Right-click context menu
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showMsgActionPopup(e.clientX, e.clientY, el, index, isUser);
    });

    // Long-press for mobile
    let timer;
    el.addEventListener('touchstart', (e) => {
      timer = setTimeout(() => {
        haptic(15);
        showMsgActionPopup(e.touches[0].clientX, e.touches[0].clientY, el, index, isUser);
      }, 500);
    }, { passive: true });
    el.addEventListener('touchmove', () => clearTimeout(timer), { passive: true });
    el.addEventListener('touchend', () => clearTimeout(timer), { passive: true });
  });
}

// Set the callback in render module
setAttachMessageActionsCallback(attachMessageActions);

function showMsgActionPopup(x, y, el, index, isUser) {
  // Clear any text selection from long-press
  window.getSelection()?.removeAllRanges();
  msgActionPopup.innerHTML = '';

  if (isUser) {
    const editBtn = document.createElement('button');
    editBtn.className = 'action-popup-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => { hideMsgActionPopup(); startEditMessage(el, index); });
    msgActionPopup.appendChild(editBtn);

    const resendBtn = document.createElement('button');
    resendBtn.className = 'action-popup-btn';
    resendBtn.textContent = 'Resend';
    resendBtn.addEventListener('click', () => {
      haptic();
      hideMsgActionPopup();
      resendMessage(index);
    });
    msgActionPopup.appendChild(resendBtn);
  }

  const copyBtn = document.createElement('button');
  copyBtn.className = 'action-popup-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    haptic();
    hideMsgActionPopup();
    const clone = el.cloneNode(true);
    clone.querySelector('.meta')?.remove();
    clone.querySelector('.msg-attachments')?.remove();
    navigator.clipboard.writeText(clone.textContent.trim());
    showToast('Copied to clipboard');
  });
  msgActionPopup.appendChild(copyBtn);

  // React button
  const reactBtn = document.createElement('button');
  reactBtn.className = 'action-popup-btn';
  reactBtn.textContent = 'React';
  reactBtn.addEventListener('click', () => {
    showReactionPicker(x, y, index, hideMsgActionPopup, actionPopupOverlay);
  });
  msgActionPopup.appendChild(reactBtn);

  // Remember button (for all messages)
  const rememberBtn = document.createElement('button');
  rememberBtn.className = 'action-popup-btn';
  rememberBtn.textContent = 'Remember';
  rememberBtn.addEventListener('click', () => {
    haptic();
    hideMsgActionPopup();
    rememberMessage(el, index);
  });
  msgActionPopup.appendChild(rememberBtn);

  // Fork from here
  const forkBtn = document.createElement('button');
  forkBtn.className = 'action-popup-btn';
  forkBtn.textContent = 'Fork from here';
  forkBtn.addEventListener('click', () => {
    haptic();
    hideMsgActionPopup();
    forkConversation(index);
  });
  msgActionPopup.appendChild(forkBtn);

  msgActionPopup.style.left = Math.min(x, window.innerWidth - 180) + 'px';
  msgActionPopup.style.top = Math.min(y, window.innerHeight - 200) + 'px';
  msgActionPopup.classList.remove('hidden');
  actionPopupOverlay.classList.remove('hidden');
}

export function hideMsgActionPopup() {
  msgActionPopup.classList.add('hidden');
  actionPopupOverlay.classList.add('hidden');
}

function startEditMessage(el, index) {
  const clone = el.cloneNode(true);
  clone.querySelector('.meta')?.remove();
  clone.querySelector('.msg-attachments')?.remove();
  const originalText = clone.textContent.trim();

  el.dataset.originalHtml = el.innerHTML;
  el.innerHTML = '';
  el.classList.add('editing');

  const editArea = document.createElement('textarea');
  editArea.className = 'edit-textarea';
  editArea.value = originalText;
  el.appendChild(editArea);

  const editActions = document.createElement('div');
  editActions.className = 'edit-actions';
  editActions.innerHTML = '<button class="btn-secondary btn-sm edit-cancel">Cancel</button><button class="btn-primary btn-sm edit-save">Save & Send</button>';
  el.appendChild(editActions);

  editArea.focus();
  editArea.style.height = editArea.scrollHeight + 'px';

  editActions.querySelector('.edit-cancel').addEventListener('click', () => {
    el.innerHTML = el.dataset.originalHtml;
    el.classList.remove('editing');
    delete el.dataset.originalHtml;
  });

  editActions.querySelector('.edit-save').addEventListener('click', () => {
    const newText = editArea.value.trim();
    const ws = getWS();
    if (!newText || !ws || ws.readyState !== WebSocket.OPEN) return;
    el.classList.remove('editing');
    ws.send(JSON.stringify({
      type: 'edit',
      conversationId: state.getCurrentConversationId(),
      messageIndex: index,
      text: newText,
    }));
  });
}

export function regenerateMessage() {
  const currentConversationId = state.getCurrentConversationId();
  const ws = getWS();
  if (!currentConversationId || !ws || ws.readyState !== WebSocket.OPEN) return;

  // Remove last assistant message from DOM (including wrapper if present)
  const lastWrapper = messagesContainer.querySelector('.message-wrapper.assistant:last-child');
  if (lastWrapper) {
    lastWrapper.remove();
  } else {
    // Fallback for messages without wrapper
    const lastMsg = messagesContainer.querySelector('.message.assistant:last-child');
    if (lastMsg) lastMsg.remove();
  }

  state.setThinking(true);
  ws.send(JSON.stringify({ type: 'regenerate', conversationId: currentConversationId }));
}

function resendMessage(messageIndex) {
  const currentConversationId = state.getCurrentConversationId();
  const ws = getWS();
  if (!currentConversationId || !ws || ws.readyState !== WebSocket.OPEN) return;

  state.setThinking(true);
  ws.send(JSON.stringify({
    type: 'resend',
    conversationId: currentConversationId,
    messageIndex,
  }));
}

// --- Model & Mode Badges ---
export function updateModeBadge(executionMode, provider = 'claude') {
  // Show mode badge for providers with tool use (Claude and Codex).
  const supportsTools = provider !== 'ollama';
  modeBadge.classList.toggle('hidden', !supportsTools);
  if (!supportsTools) {
    void syncWorkflowLockHeartbeat();
    return;
  }

  const mode = executionMode || 'patch';
  const labels = {
    autonomous: 'AUTO',
    patch: 'PATCH',
    discuss: 'DISCUSS',
  };
  const titles = {
    autonomous: 'Autonomous: write-capable agent execution',
    patch: 'Patch: read/analyze and submit/apply patches',
    discuss: 'Discuss: analysis only (no repository writes)',
  };

  modeBadge.textContent = labels[mode] || 'PATCH';
  modeBadge.title = titles[mode] || titles.patch;
  modeBadge.classList.toggle('autopilot', mode === 'autonomous');
  modeBadge.classList.toggle('readonly', mode !== 'autonomous');
  void syncWorkflowLockHeartbeat();
}

export function updateProviderBadge(provider) {
  if (!providerBadge) return;
  // Show badge for non-Claude providers.
  const showBadge = provider && provider !== 'claude';
  providerBadge.classList.toggle('hidden', !showBadge);
  providerBadge.classList.toggle('ollama', provider === 'ollama');
  providerBadge.classList.toggle('codex', provider === 'codex');
  if (showBadge) {
    if (provider === 'ollama') {
      providerBadge.textContent = 'Local';
      providerBadge.title = 'Using Ollama provider (local LLM)';
    } else if (provider === 'codex') {
      providerBadge.textContent = 'Codex';
      providerBadge.title = 'Using OpenAI Codex provider';
    } else {
      providerBadge.textContent = provider;
      providerBadge.title = `Using ${provider} provider`;
    }
  }
}

export function updateSandboxBanner(isSandboxed, provider = 'claude') {
  const banner = document.getElementById('unsafe-banner');
  const supportsTools = provider !== 'ollama';

  if (banner) {
    // Hide banner for non-Claude providers (no tool use, so sandbox is irrelevant)
    banner.classList.toggle('hidden', isSandboxed || !supportsTools);
  }
  // Also update the chat more menu item
  const menuItem = document.getElementById('chat-more-sandbox');
  const label = document.getElementById('chat-more-sandbox-label');
  if (menuItem) {
    menuItem.classList.toggle('disabled', !supportsTools);
  }
  if (label) {
    if (supportsTools) {
      label.textContent = isSandboxed ? 'Sandbox: On' : 'Sandbox: Off';
    } else {
      label.textContent = 'Sandbox: N/A';
    }
  }
}

export async function toggleSandboxMode() {
  const currentConversationId = state.getCurrentConversationId();
  if (!currentConversationId) return;

  const newSandboxed = !state.getCurrentSandboxed();

  // If disabling sandbox, show a confirmation dialog
  if (!newSandboxed) {
    const provider = state.getCurrentProvider() === 'codex' ? 'Codex' : 'Claude';
    const ok = await showDialog({
      title: 'Disable sandbox?',
      message: `This gives ${provider} unrestricted access to your entire filesystem. Only do this if you trust the conversation and need access to files outside the project.`,
      confirmLabel: 'Disable Sandbox',
      danger: true
    });
    if (!ok) return;
  }

  state.setCurrentSandboxed(newSandboxed);
  updateSandboxBanner(newSandboxed, state.getCurrentProvider());

  await apiFetch(`/api/conversations/${currentConversationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sandboxed: newSandboxed }),
    silent: true,
  });

  showToast(newSandboxed ? 'Sandbox enabled' : 'Sandbox disabled — be careful!');
}

export function updateModelBadge(modelId) {
  const models = state.getModels();
  const model = models.find(m => m.id === modelId);
  modelBtn.textContent = model ? model.name : modelId;
}

export async function switchModel(convId, modelId) {
  const res = await apiFetch(`/api/conversations/${convId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId }),
  });
  if (!res) return;
  state.setCurrentModel(modelId);
  updateModelBadge(modelId);
  const models = state.getModels();
  const model = models.find(m => m.id === modelId);
  showToast(`Switched to ${model ? model.name : modelId}`);
}

function updateNotificationsLabel() {
  if (moreNotificationsLabel) {
    const enabled = state.getNotificationsEnabled();
    moreNotificationsLabel.textContent = `Notifications: ${enabled ? 'On' : 'Off'}`;
  }
}

function updateMoreArchiveLabel() {
  if (moreArchiveLabel) {
    const showing = state.getShowingArchived();
    moreArchiveLabel.textContent = showing ? 'Show Active' : 'Show Archived';
  }
}

// Populate filter model dropdown
export function populateFilterModels() {
  const models = state.getModels();
  if (!filterModelSelect) return;
  filterModelSelect.innerHTML = '<option value="">All models</option>' +
    models.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
}

// Close all floating dropdowns/submenus
function _closeAllDropdowns() {
  closeThemeDropdown();
  closeColorThemeDropdown();
  closeChatMoreMenu();
  closeMoreMenu();
}

// Chat more menu
function toggleChatMoreMenu() {
  if (!chatMoreDropdown) return;
  const isHidden = chatMoreDropdown.classList.contains('hidden');

  // Close other dropdowns first (but not ourselves if we're about to open)
  closeThemeDropdown();
  closeColorThemeDropdown();
  closeMoreMenu();

  if (isHidden) {
    // Position the dropdown near the button
    const rect = chatMoreBtn.getBoundingClientRect();
    chatMoreDropdown.style.position = 'fixed';
    chatMoreDropdown.style.top = `${rect.bottom + 4}px`;
    chatMoreDropdown.style.right = `${window.innerWidth - rect.right}px`;
    chatMoreDropdown.style.left = 'auto';
    chatMoreDropdown.classList.remove('hidden');
  } else {
    chatMoreDropdown.classList.add('hidden');
  }
}

function closeChatMoreMenu() {
  if (chatMoreDropdown) {
    chatMoreDropdown.classList.add('hidden');
    // Collapse any expanded sections
    chatMoreDropdown.querySelectorAll('.expanded').forEach(el => el.classList.remove('expanded'));
  }
}

// --- Setup all event listeners ---
export function setupEventListeners(createConversation) {
  // Bell easter egg - header icon
  const brandIcon = document.querySelector('.brand-icon');
  if (brandIcon) {
    brandIcon.style.cursor = 'pointer';
    brandIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      ringBell(brandIcon);
    });
  }

  // Bell easter egg - empty state icon
  const emptyStateIcon = document.querySelector('.chat-empty-icon svg');
  if (emptyStateIcon) {
    emptyStateIcon.style.cursor = 'pointer';
    emptyStateIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      ringBell(emptyStateIcon);
    });
  }

  // Setup submodule event listeners
  setupThemeEventListeners();
  setupVoiceEventListeners();
  setupStatsEventListeners();
  setupMemoryEventListeners();
  setupDirectoryBrowserEventListeners();
  setupCapabilitiesEventListeners();
  setupFileBrowserEventListeners(document.getElementById('general-files-btn'), haptic);
  setupContextBarEventListeners();

  // Form submission
  inputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    haptic();
    sendMessage(messageInput.value);
  });

  messageInput.addEventListener('input', autoResizeInput);

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(messageInput.value);
    }
  });

  cancelBtn.addEventListener('click', () => {
    const currentConversationId = state.getCurrentConversationId();
    const ws = getWS();
    if (!currentConversationId || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'cancel', conversationId: currentConversationId }));
  });

  // Smart scroll
  messagesContainer.addEventListener('scroll', () => {
    if (state.getIsStreaming()) {
      state.setUserHasScrolledUp(!state.isNearBottom(150));
    }
    jumpToBottomBtn.classList.toggle('visible', !state.isNearBottom(300));
  });

  jumpToBottomBtn.addEventListener('click', () => {
    haptic();
    messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
    state.setUserHasScrolledUp(false);
    jumpToBottomBtn.classList.remove('visible');
  });

  backBtn.addEventListener('click', () => {
    haptic();
    showListView();
    void syncWorkflowLockHeartbeat();
  });

  deleteBtn.addEventListener('click', async () => {
    const currentConversationId = state.getCurrentConversationId();
    if (!currentConversationId) return;
    haptic();
    const ok = await showDialog({ title: 'Delete conversation?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
    if (ok) deleteConversation(currentConversationId);
  });

  newChatBtn.addEventListener('click', () => {
    haptic(15);
    convNameInput.value = '';
    convCwdInput.value = '';
    dirBrowser.classList.add('hidden');
    populateRecentDirs();

    // Reset provider to Claude and re-enable toggles
    if (convProviderSelect) {
      convProviderSelect.value = 'claude';
      // Trigger change event to reload Claude models
      convProviderSelect.dispatchEvent(new Event('change'));
    }
    if (convSandboxed) {
      convSandboxed.disabled = false;
      convSandboxed.closest('.toggle-row')?.classList.remove('disabled');
    }
    if (convAutopilot) {
      convAutopilot.disabled = false;
      convAutopilot.closest('.toggle-row')?.classList.remove('disabled');
    }

    modalOverlay.classList.remove('hidden');
    convNameInput.focus();
  });

  modalCancel.addEventListener('click', () => {
    modalOverlay.classList.add('hidden');
  });

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.classList.add('hidden');
    }
  });

  newConvForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = convNameInput.value.trim();
    const cwd = convCwdInput.value.trim() || undefined;
    const autopilot = convAutopilot.checked;
    const sandboxed = convSandboxed ? convSandboxed.checked : true;
    const provider = convProviderSelect ? convProviderSelect.value : 'claude';
    const model = convModelSelect.value;
    const executionMode = autopilot ? 'autonomous' : 'discuss';
    if (name) {
      createConversation(name, cwd, autopilot, model, sandboxed, provider, executionMode);
      modalOverlay.classList.add('hidden');
    }
  });

  // Close open swipe when tapping elsewhere on the list
  conversationList.addEventListener('click', (e) => {
    const activeSwipeCard = state.getActiveSwipeCard();
    if (activeSwipeCard && !e.target.closest('.conv-card-wrapper')) {
      activeSwipeCard.style.transform = 'translateX(0)';
      state.setActiveSwipeCard(null);
    }
  });

  // Attachments
  attachBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    for (const file of fileInput.files) {
      const att = { file, name: file.name };
      if (file.type.startsWith('image/')) {
        att.previewUrl = URL.createObjectURL(file);
      }
      state.addPendingAttachment(att);
    }
    fileInput.value = '';
    renderAttachmentPreview();
  });

  // Drag-and-drop file upload (entire chat view)
  const chatDropOverlay = document.getElementById('chat-drop-overlay');

  chatView.addEventListener('dragenter', (e) => {
    e.preventDefault();
    chatDropOverlay.classList.add('visible');
  });

  chatView.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  chatView.addEventListener('dragleave', (e) => {
    // Only hide when leaving the chat view entirely
    if (!chatView.contains(e.relatedTarget)) {
      chatDropOverlay.classList.remove('visible');
    }
  });

  chatView.addEventListener('drop', (e) => {
    e.preventDefault();
    chatDropOverlay.classList.remove('visible');

    if (e.dataTransfer.files.length === 0) return;

    for (const file of e.dataTransfer.files) {
      const att = { file, name: file.name };
      if (file.type.startsWith('image/')) {
        att.previewUrl = URL.createObjectURL(file);
      }
      state.addPendingAttachment(att);
    }
    renderAttachmentPreview();
  });

  // Export
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const currentConversationId = state.getCurrentConversationId();
      if (!currentConversationId) return;
      window.open(`/api/conversations/${currentConversationId}/export?format=markdown`);
      showToast('Exporting conversation');
    });
  }

  // New chat in same folder
  if (newChatHereBtn) {
    newChatHereBtn.addEventListener('click', () => {
      haptic();
      const currentId = state.getCurrentConversationId();
      const conv = state.conversations.find(c => c.id === currentId);
      if (conv && conv.cwd) {
        // Pre-fill the new conversation modal with the same cwd
        convCwdInput.value = conv.cwd;
        convNameInput.value = '';
        convNameInput.focus();
        modalOverlay.classList.remove('hidden');
        showToast('Creating chat in ' + conv.cwd.split('/').pop());
      } else {
        showToast('No working directory set');
      }
    });
  }

  // File panel (Project Mode)
  if (filesBtn) {
    filesBtn.addEventListener('click', () => {
      toggleFilePanel();
    });
  }

  // Model dropdown handlers
  modelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !modelDropdown.classList.contains('hidden');
    if (isOpen) {
      modelDropdown.classList.add('hidden');
      return;
    }
    const models = state.getModels();
    const currentModel = state.getCurrentModel();
    modelDropdown.innerHTML = models.map(m =>
      `<div class="model-option${m.id === currentModel ? ' active' : ''}" data-id="${m.id}">${m.name}</div>`
    ).join('');
    modelDropdown.classList.remove('hidden');

    modelDropdown.querySelectorAll('.model-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = opt.dataset.id;
        modelDropdown.classList.add('hidden');
        const currentConversationId = state.getCurrentConversationId();
        if (id !== state.getCurrentModel() && currentConversationId) {
          switchModel(currentConversationId, id);
        }
      });
    });
  });

  let dropdownOpenedAt = 0;
  document.addEventListener('click', () => {
    // Skip closing if dropdown was just opened (within 300ms)
    if (Date.now() - dropdownOpenedAt < 300) {
      return;
    }
    modelDropdown.classList.add('hidden');
    const convStatsDropdown = document.getElementById('conv-stats-dropdown');
    if (convStatsDropdown) convStatsDropdown.classList.add('hidden');
  });

  // Mode badge click handler - cycles execution mode.
  modeBadge.addEventListener('click', async () => {
    const currentConversationId = state.getCurrentConversationId();
    if (!currentConversationId) return;
    // Mode toggle only applies to providers with tool use
    if (state.getCurrentProvider() === 'ollama') return;

    const modeOrder = ['discuss', 'patch', 'autonomous'];
    const currentMode = state.getCurrentExecutionMode() || 'patch';
    const idx = modeOrder.indexOf(currentMode);
    const nextMode = modeOrder[(idx + 1 + modeOrder.length) % modeOrder.length];

    const patchRes = await apiFetch(`/api/conversations/${currentConversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executionMode: nextMode }),
      silent: true,
    });
    if (!patchRes) return;

    state.setCurrentExecutionMode(nextMode);
    state.setCurrentAutopilot(nextMode !== 'discuss');
    updateModeBadge(nextMode, state.getCurrentProvider());
  });

  // Archive toggle
  archiveToggle.addEventListener('click', () => {
    haptic();
    const newShowing = !state.getShowingArchived();
    state.setShowingArchived(newShowing);
    archiveToggle.classList.toggle('active', newShowing);
    searchInput.value = '';
    loadConversations();
    showToast(newShowing ? 'Showing archived' : 'Showing active');
  });

  // Search
  searchInput.addEventListener('input', triggerSearch);

  // Pull-to-refresh
  let pullStartY = 0;
  let isPulling = false;
  const PULL_THRESHOLD = 80;

  conversationList.addEventListener('touchstart', (e) => {
    if (conversationList.scrollTop <= 0) {
      pullStartY = e.touches[0].clientY;
      isPulling = true;
    }
  }, { passive: true });

  conversationList.addEventListener('touchmove', (e) => {
    if (!isPulling) return;
    const dy = e.touches[0].clientY - pullStartY;
    if (dy < 0) { isPulling = false; return; }
    const dampened = Math.min(dy * 0.4, 120);
    pullIndicator.style.height = dampened + 'px';
    pullIndicator.style.opacity = Math.min(dampened / PULL_THRESHOLD, 1);
    const rotation = dampened >= PULL_THRESHOLD * 0.4 ? 180 : 0;
    pullIndicator.querySelector('svg').style.transform = `rotate(${rotation}deg)`;
    if (dampened >= PULL_THRESHOLD * 0.4 && !pullIndicator.dataset.hapticFired) {
      haptic();
      pullIndicator.dataset.hapticFired = 'true';
    }
  }, { passive: true });

  conversationList.addEventListener('touchend', async () => {
    if (!isPulling) return;
    isPulling = false;
    const height = parseFloat(pullIndicator.style.height) || 0;
    if (height >= PULL_THRESHOLD * 0.4) {
      pullIndicator.classList.add('refreshing');
      await loadConversations();
      showToast('Refreshed');
    }
    pullIndicator.style.height = '0px';
    pullIndicator.style.opacity = '0';
    pullIndicator.classList.remove('refreshing');
    delete pullIndicator.dataset.hapticFired;
    pullIndicator.querySelector('svg').style.transform = '';
  }, { passive: true });

  // Scroll-linked compact header
  conversationList.addEventListener('scroll', () => {
    const scrollTop = conversationList.scrollTop;
    if (scrollTop > HEADER_COMPACT_ENTER && !listHeader.classList.contains('compact')) {
      listHeader.classList.add('compact');
    } else if (scrollTop <= HEADER_COMPACT_EXIT && listHeader.classList.contains('compact')) {
      listHeader.classList.remove('compact');
    }
  }, { passive: true });

  // Notifications toggle
  if (moreNotificationsToggle) {
    moreNotificationsToggle.addEventListener('click', async (e) => {
      e.stopPropagation();
      const enabled = state.getNotificationsEnabled();
      if (!enabled) {
        // Turning on - request permission
        const granted = await state.requestNotificationPermission();
        if (!granted && 'Notification' in window && Notification.permission === 'denied') {
          showToast('Notifications blocked - check browser settings');
        }
      }
      state.setNotificationsEnabled(!enabled);
      updateNotificationsLabel();
      closeMoreMenu();
      haptic();
    });
  }

  // Mobile more menu items
  if (moreStats) {
    moreStats.addEventListener('click', () => {
      closeMoreMenu();
      haptic();
      listView.classList.add('slide-out');
      statsView.classList.add('slide-in');
      loadStats();
    });
  }

  if (moreFiles) {
    moreFiles.addEventListener('click', () => {
      closeMoreMenu();
      haptic();
      openFileBrowser('general');
    });
  }

  if (moreArchive) {
    moreArchive.addEventListener('click', () => {
      closeMoreMenu();
      haptic();
      const newShowing = !state.getShowingArchived();
      state.setShowingArchived(newShowing);
      if (archiveToggle) archiveToggle.classList.toggle('active', newShowing);
      updateMoreArchiveLabel();
      searchInput.value = '';
      loadConversations();
    });
  }

  // Memory menu item
  const moreMemory = document.getElementById('more-memory');
  if (moreMemory) {
    moreMemory.addEventListener('click', () => {
      closeMoreMenu();
      haptic();
      showMemoryView();
    });
  }

  // Chat more menu (mobile)
  if (chatMoreBtn) {
    chatMoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleChatMoreMenu();
    });
  }

  const chatMoreStats = document.getElementById('chat-more-stats');
  const chatMoreFiles = document.getElementById('chat-more-files');
  const chatMoreBranches = document.getElementById('chat-more-branches');
  const chatMoreCapabilities = document.getElementById('chat-more-capabilities');
  const chatMoreMemory = document.getElementById('chat-more-memory');
  const chatMoreNew = document.getElementById('chat-more-new');
  const chatMoreExport = document.getElementById('chat-more-export');
  const chatMoreDelete = document.getElementById('chat-more-delete');

  if (chatMoreStats) {
    chatMoreStats.addEventListener('click', (e) => {
      e.stopPropagation();
      closeChatMoreMenu();
      haptic();
      dropdownOpenedAt = Date.now();
      showConvStatsDropdown();
    });
  }

  if (chatMoreFiles) {
    chatMoreFiles.addEventListener('click', () => {
      closeChatMoreMenu();
      haptic();
      if (filesBtn) filesBtn.click();
    });
  }

  if (chatMoreBranches) {
    chatMoreBranches.addEventListener('click', () => {
      closeChatMoreMenu();
      haptic();
      const branchesBtn = document.getElementById('branches-btn');
      if (branchesBtn) branchesBtn.click();
    });
  }

  if (chatMoreCapabilities) {
    chatMoreCapabilities.addEventListener('click', () => {
      closeChatMoreMenu();
      haptic();
      if (capabilitiesBtn) capabilitiesBtn.click();
    });
  }

  if (chatMoreMemory) {
    setupLongPressHandler(chatMoreMemory, {
      onTap: () => toggleConversationMemory(),
      onLongPress: () => {
        closeChatMoreMenu();
        showMemoryView();
      },
    });
  }

  // Sandbox toggle handler
  const chatMoreSandbox = document.getElementById('chat-more-sandbox');
  if (chatMoreSandbox) {
    chatMoreSandbox.addEventListener('click', async (e) => {
      e.stopPropagation();
      // Ignore click for providers without tool use.
      if (state.getCurrentProvider() === 'ollama') return;
      haptic();
      closeChatMoreMenu();
      await toggleSandboxMode();
    });
  }

  if (chatMoreNew) {
    chatMoreNew.addEventListener('click', () => {
      closeChatMoreMenu();
      haptic();
      if (newChatHereBtn) newChatHereBtn.click();
    });
  }

  if (chatMoreExport) {
    chatMoreExport.addEventListener('click', () => {
      closeChatMoreMenu();
      haptic();
      if (exportBtn) exportBtn.click();
    });
  }

  if (chatMoreDelete) {
    chatMoreDelete.addEventListener('click', () => {
      closeChatMoreMenu();
      haptic();
      if (deleteBtn) deleteBtn.click();
    });
  }

  // Chat more menu inline expandable theme sections
  const chatMoreColorTheme = document.getElementById('chat-more-color-theme');
  const chatMoreThemeToggle = document.getElementById('chat-more-theme-toggle');
  const chatColorThemeItems = document.getElementById('chat-color-theme-items');
  const chatThemeItems = document.getElementById('chat-theme-items');

  // Toggle color theme section expansion
  if (chatMoreColorTheme && chatColorThemeItems) {
    chatMoreColorTheme.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = chatMoreColorTheme.classList.contains('expanded');
      // Close other section if open
      chatMoreThemeToggle?.classList.remove('expanded');
      chatThemeItems?.classList.remove('expanded');
      // Toggle this section
      chatMoreColorTheme.classList.toggle('expanded', !isExpanded);
      chatColorThemeItems.classList.toggle('expanded', !isExpanded);
      // Update active state
      updateInlineColorThemeActive();
    });
  }

  // Toggle light/dark theme section expansion
  if (chatMoreThemeToggle && chatThemeItems) {
    chatMoreThemeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = chatMoreThemeToggle.classList.contains('expanded');
      // Close other section if open
      chatMoreColorTheme?.classList.remove('expanded');
      chatColorThemeItems?.classList.remove('expanded');
      // Toggle this section
      chatMoreThemeToggle.classList.toggle('expanded', !isExpanded);
      chatThemeItems.classList.toggle('expanded', !isExpanded);
      // Update active state
      updateInlineThemeActive();
    });
  }

  // Handle color theme selection
  if (chatColorThemeItems) {
    chatColorThemeItems.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = e.target.closest('.more-menu-subitem');
      if (item && item.dataset.colorTheme) {
        selectColorTheme(item.dataset.colorTheme);
        updateInlineColorThemeActive();
      }
    });
  }

  // Handle light/dark theme selection
  if (chatThemeItems) {
    chatThemeItems.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = e.target.closest('.more-menu-subitem');
      if (item && item.dataset.theme) {
        selectTheme(item.dataset.theme);
        updateInlineThemeActive();
      }
    });
  }

  // Helper to update active state for color themes
  function updateInlineColorThemeActive() {
    if (!chatColorThemeItems) return;
    const current = state.getCurrentColorTheme();
    chatColorThemeItems.querySelectorAll('.more-menu-subitem').forEach(item => {
      item.classList.toggle('active', item.dataset.colorTheme === current);
    });
  }

  // Helper to update active state for light/dark themes
  function updateInlineThemeActive() {
    if (!chatThemeItems) return;
    const current = state.getCurrentTheme();
    chatThemeItems.querySelectorAll('.more-menu-subitem').forEach(item => {
      item.classList.toggle('active', item.dataset.theme === current);
    });
  }

  // Close chat more menu on outside click
  document.addEventListener('click', (e) => {
    if (chatMoreDropdown && !chatMoreDropdown.classList.contains('hidden')) {
      // Check if click was outside the dropdown and button
      if (!chatMoreDropdown.contains(e.target) && e.target !== chatMoreBtn && !chatMoreBtn?.contains(e.target)) {
        // Consume the click - don't let it pass through to elements underneath
        e.preventDefault();
        e.stopPropagation();
        closeChatMoreMenu();
      }
    }
  }, true); // Use capture phase to intercept before other handlers

  // Apply themes on init
  applyTheme();
  updateThemeIcon();
  applyColorTheme();
  updateColorThemeIcon();

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const mod = e.metaKey || e.ctrlKey;
    const dialogOverlay = getDialogOverlay();
    const dialogCancel = getDialogCancel();

    // Escape always works
    if (e.key === 'Escape') {
      const lightbox = document.getElementById('lightbox');
      // Close action popups first (long-press/right-click menus)
      if (actionPopupOverlay && !actionPopupOverlay.classList.contains('hidden')) {
        hideActionPopup();
        hideMsgActionPopup();
      // Close dropdowns/menus (innermost first)
      } else if (themeDropdown && !themeDropdown.classList.contains('hidden')) {
        closeThemeDropdown();
      } else if (colorThemeDropdown && !colorThemeDropdown.classList.contains('hidden')) {
        closeColorThemeDropdown();
      } else if (chatMoreDropdown && !chatMoreDropdown.classList.contains('hidden')) {
        closeChatMoreMenu();
      } else if (moreMenuDropdown && !moreMenuDropdown.classList.contains('hidden')) {
        closeMoreMenu();
      } else if (lightbox && !lightbox.classList.contains('hidden')) {
        lightbox.classList.add('hidden');
      } else if (dialogOverlay && !dialogOverlay.classList.contains('hidden')) {
        dialogCancel?.click();
      } else if (isFileViewerOpen()) {
        closeFileViewer();
      } else if (isFilePanelOpen()) {
        closeFilePanel();
      } else if (capabilitiesModal && !capabilitiesModal.classList.contains('hidden')) {
        closeCapabilitiesModal();
      } else if (!modalOverlay.classList.contains('hidden')) {
        modalOverlay.classList.add('hidden');
      } else if (isBranchesViewOpen()) {
        closeBranchesView();
      } else if (memoryView && memoryView.classList.contains('slide-in')) {
        closeMemoryView();
      } else if (chatView.classList.contains('slide-in')) {
        showListView();
      } else if (statsView.classList.contains('slide-in')) {
        statsBackBtn.click();
      }
      return;
    }

    if (isTyping) return;

    if (mod && e.key === 'k') {
      e.preventDefault();
      if (!chatView.classList.contains('slide-in')) {
        searchInput.focus();
      }
    } else if (mod && e.key === 'n') {
      e.preventDefault();
      newChatBtn.click();
    } else if (mod && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      e.preventDefault();
      archiveToggle.click();
    } else if (mod && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      if (chatView.classList.contains('slide-in') && exportBtn) {
        exportBtn.click();
      }
    } else if (mod && e.key === '/') {
      e.preventDefault();
      if (chatView.classList.contains('slide-in')) {
        openCapabilitiesModal();
      }
    }
  });

  // Search filters
  if (filterToggle) {
    filterToggle.addEventListener('click', () => {
      if (!filterRow) return;
      filterRow.classList.toggle('hidden');
      filterToggle.classList.toggle('active', !filterRow.classList.contains('hidden'));
    });
  }

  if (filterRow) {
    filterRow.addEventListener('click', (e) => {
      const chip = e.target.closest('.filter-chip');
      if (!chip) return;
      filterRow.querySelectorAll('.filter-chip[data-days]').forEach(c => {
        c.classList.toggle('active', c === chip && !chip.classList.contains('active'));
      });
      triggerSearch();
    });
  }

  if (filterModelSelect) {
    filterModelSelect.addEventListener('change', triggerSearch);
  }

  // Load more messages
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', loadMoreMessages);
  }

  // Auto-load on scroll to top (IntersectionObserver)
  if (loadMoreBtn) {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && state.getMessagesOffset() > 0) {
        loadMoreMessages();
      }
    }, { root: messagesContainer, threshold: 0.1 });
    observer.observe(loadMoreBtn);
  }

  // Mobile virtual keyboard handling
  if (window.visualViewport) {
    const syncViewportHeight = () => {
      document.documentElement.style.setProperty('--app-height', `${window.visualViewport.height}px`);
    };
    window.visualViewport.addEventListener('resize', syncViewportHeight);
    syncViewportHeight();
  }

  // Swipe-to-go-back (edge swipe from left)
  let swipeBackStartX = 0;
  let swipeBackStartY = 0;
  let swipeBackActive = false;
  const SWIPE_EDGE_WIDTH = 30; // px from left edge
  const SWIPE_BACK_THRESHOLD = 80;

  chatView.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    // Only trigger from left edge
    if (touch.clientX <= SWIPE_EDGE_WIDTH && chatView.classList.contains('slide-in')) {
      swipeBackStartX = touch.clientX;
      swipeBackStartY = touch.clientY;
      swipeBackActive = true;
    }
  }, { passive: true });

  chatView.addEventListener('touchmove', (e) => {
    if (!swipeBackActive) return;
    const touch = e.touches[0];
    const dx = touch.clientX - swipeBackStartX;
    const dy = Math.abs(touch.clientY - swipeBackStartY);

    // Cancel if vertical scroll is dominant
    if (dy > Math.abs(dx)) {
      swipeBackActive = false;
      return;
    }

    // Visual feedback: translate chat view
    if (dx > 0) {
      chatView.style.transform = `translateX(${Math.min(dx, 150)}px)`;
      chatView.style.transition = 'none';
    }
  }, { passive: true });

  chatView.addEventListener('touchend', () => {
    if (!swipeBackActive) return;
    swipeBackActive = false;

    const currentTransform = parseFloat(chatView.style.transform.replace(/[^0-9.-]/g, '') || 0);
    chatView.style.transition = '';
    chatView.style.transform = '';

    if (currentTransform >= SWIPE_BACK_THRESHOLD) {
      haptic(15);
      showListView();
    }
  }, { passive: true });
}
