// --- UI interactions ---
import { escapeHtml } from './markdown.js';
import { formatTime, formatTokens, haptic, showToast, showDialog, getDialogOverlay, getDialogCancel, apiFetch } from './utils.js';
import { getWS } from './websocket.js';
import { loadConversations, deleteConversation, forkConversation, showListView, triggerSearch } from './conversations.js';
import { showReactionPicker, setAttachMessageActionsCallback, loadMoreMessages } from './render.js';
import * as state from './state.js';
import { toggleFilePanel, closeFilePanel, isFilePanelOpen, isFileViewerOpen, closeFileViewer } from './file-panel.js';
import { isBranchesViewOpen, closeBranchesView } from './branches.js';

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
let convModelSelect = null;
let archiveToggle = null;
let searchInput = null;
let browseBtn = null;
let dirBrowser = null;
let dirUpBtn = null;
let dirCurrentPath = null;
let dirList = null;
let dirNewBtn = null;
let dirSelectBtn = null;
let micBtn = null;
let attachBtn = null;
let fileInput = null;
let attachmentPreview = null;
let modeBadge = null;
let modelBtn = null;
let modelDropdown = null;
let convStatsBtn = null;
let convStatsDropdown = null;
let contextBar = null;
let contextBarFill = null;
let contextBarLabel = null;
let jumpToBottomBtn = null;
let msgActionPopup = null;
let actionPopupOverlay = null;
let themeDropdown = null;
let colorThemeDropdown = null;
let moreMenuBtn = null;
let moreMenuDropdown = null;
let moreColorTheme = null;
let moreThemeToggle = null;
let moreThemeIcon = null;
let moreThemeLabel = null;
let moreNotificationsToggle = null;
let moreNotificationsLabel = null;
let moreStats = null;
let moreFiles = null;
let moreArchive = null;
let moreArchiveLabel = null;
let colorThemeLink = null;
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
let statsBtn = null;
let statsView = null;
let statsBackBtn = null;
let statsContent = null;
let listView = null;
let chatView = null;
let filesBtn = null;
let newChatHereBtn = null;
let fileBrowserModal = null;
let fileBrowserClose = null;
let fileBrowserUp = null;
let fileBrowserCurrentPath = null;
let fileBrowserList = null;
let fileBrowserUploadBtn = null;
let fileBrowserFileInput = null;
let generalFilesBtn = null;
let capabilitiesBtn = null;
let capabilitiesModal = null;
let capabilitiesClose = null;
let capabilitiesSearch = null;
let capabilitiesList = null;

// Current file browser state
let currentFileBrowserPath = '';
let currentFileBrowserConvId = null;
let fileBrowserMode = 'conversation'; // 'conversation' or 'general'

// Capabilities cache
let cachedCapabilities = null;
let capabilitiesCwd = null;

// Memory view elements
let memoryView = null;
let memoryBackBtn = null;
let memoryContent = null;

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
  convModelSelect = elements.convModelSelect;
  archiveToggle = elements.archiveToggle;
  searchInput = elements.searchInput;
  browseBtn = elements.browseBtn;
  dirBrowser = elements.dirBrowser;
  dirUpBtn = elements.dirUpBtn;
  dirCurrentPath = elements.dirCurrentPath;
  dirList = elements.dirList;
  dirNewBtn = elements.dirNewBtn;
  dirSelectBtn = elements.dirSelectBtn;
  micBtn = elements.micBtn;
  attachBtn = elements.attachBtn;
  fileInput = elements.fileInput;
  attachmentPreview = elements.attachmentPreview;
  modeBadge = elements.modeBadge;
  modelBtn = elements.modelBtn;
  modelDropdown = elements.modelDropdown;
  convStatsBtn = elements.convStatsBtn;
  convStatsDropdown = elements.convStatsDropdown;
  contextBar = elements.contextBar;
  contextBarFill = elements.contextBarFill;
  contextBarLabel = elements.contextBarLabel;
  jumpToBottomBtn = elements.jumpToBottomBtn;
  msgActionPopup = elements.msgActionPopup;
  actionPopupOverlay = elements.actionPopupOverlay;
  themeDropdown = elements.themeDropdown;
  colorThemeDropdown = elements.colorThemeDropdown;
  moreMenuBtn = elements.moreMenuBtn;
  moreMenuDropdown = elements.moreMenuDropdown;
  moreColorTheme = elements.moreColorTheme;
  moreThemeToggle = elements.moreThemeToggle;
  moreThemeIcon = elements.moreThemeIcon;
  moreThemeLabel = elements.moreThemeLabel;
  moreNotificationsToggle = elements.moreNotificationsToggle;
  moreNotificationsLabel = elements.moreNotificationsLabel;
  moreStats = document.getElementById('more-stats');
  moreFiles = document.getElementById('more-files');
  moreArchive = document.getElementById('more-archive');
  moreArchiveLabel = document.getElementById('more-archive-label');
  chatMoreBtn = document.getElementById('chat-more-btn');
  chatMoreDropdown = document.getElementById('chat-more-dropdown');
  colorThemeLink = document.getElementById('color-theme-link');
  // Initialize notifications label
  updateNotificationsLabel();
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
  statsBtn = elements.statsBtn;
  statsView = elements.statsView;
  statsBackBtn = elements.statsBackBtn;
  statsContent = elements.statsContent;
  listView = elements.listView;
  chatView = elements.chatView;
  filesBtn = elements.filesBtn;
  newChatHereBtn = elements.newChatHereBtn;
  fileBrowserModal = elements.fileBrowserModal;
  fileBrowserClose = elements.fileBrowserClose;
  fileBrowserUp = elements.fileBrowserUp;
  fileBrowserCurrentPath = elements.fileBrowserCurrentPath;
  fileBrowserList = elements.fileBrowserList;
  fileBrowserUploadBtn = elements.fileBrowserUploadBtn;
  fileBrowserFileInput = elements.fileBrowserFileInput;
  generalFilesBtn = elements.generalFilesBtn;
  capabilitiesBtn = document.getElementById('capabilities-btn');
  capabilitiesModal = document.getElementById('capabilities-modal');
  capabilitiesClose = document.getElementById('capabilities-close');
  capabilitiesSearch = document.getElementById('capabilities-search');
  capabilitiesList = document.getElementById('capabilities-list');
}

// --- Auto resize input ---
export function autoResizeInput() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
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
      haptic(10);
    });
  });
}

// --- Open new chat modal with optional pre-filled directory ---
export function openNewChatModal(cwd = '') {
  convNameInput.value = '';
  convCwdInput.value = cwd;
  dirBrowser.classList.add('hidden');
  populateRecentDirs();
  modalOverlay.classList.remove('hidden');
  convNameInput.focus();
  haptic(15);
}

// --- Send message ---
export async function sendMessage(text) {
  const pendingAttachments = state.getPendingAttachments();
  const currentConversationId = state.getCurrentConversationId();
  const ws = getWS();

  if ((!text.trim() && pendingAttachments.length === 0) || !currentConversationId) return;
  haptic(5);

  // Queue if offline (without attachments)
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (pendingAttachments.length > 0) {
      showToast('Cannot upload files while offline', { variant: 'error' });
      return;
    }
    const msg = { type: 'message', conversationId: currentConversationId, text: text || '' };
    state.addPendingMessage(msg);
    const el = document.createElement('div');
    el.className = 'message user animate-in queued';
    el.innerHTML = escapeHtml(text) + `<div class="meta">${formatTime(Date.now())} &middot; queued</div>`;
    messagesContainer.appendChild(el);
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

  const el = document.createElement('div');
  el.className = 'message user animate-in';
  el.innerHTML = attachHtml + escapeHtml(text) + `<div class="meta">${formatTime(Date.now())}</div>`;
  messagesContainer.appendChild(el);
  state.setUserHasScrolledUp(false);
  state.scrollToBottom(true);

  // Attach handlers for any images in the newly added message
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
  const allMessages = state.getAllMessages();
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
  msgActionPopup.innerHTML = '';

  if (isUser) {
    const editBtn = document.createElement('button');
    editBtn.className = 'action-popup-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => { hideMsgActionPopup(); startEditMessage(el, index); });
    msgActionPopup.appendChild(editBtn);
  }

  const copyBtn = document.createElement('button');
  copyBtn.className = 'action-popup-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    haptic(10);
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

  // Remember button (for assistant messages)
  if (!isUser) {
    const rememberBtn = document.createElement('button');
    rememberBtn.className = 'action-popup-btn';
    rememberBtn.textContent = 'Remember';
    rememberBtn.addEventListener('click', () => {
      haptic(10);
      hideMsgActionPopup();
      rememberMessage(el, index);
    });
    msgActionPopup.appendChild(rememberBtn);
  }

  // Fork from here
  const forkBtn = document.createElement('button');
  forkBtn.className = 'action-popup-btn';
  forkBtn.textContent = 'Fork from here';
  forkBtn.addEventListener('click', () => {
    haptic(10);
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

// --- Model & Mode & Context Bar ---
export function updateModeBadge(isAutopilot) {
  modeBadge.textContent = isAutopilot ? 'AUTO' : 'RO';
  modeBadge.title = isAutopilot ? 'Autopilot: Full access to tools' : 'Read-only: No writes or commands';
  modeBadge.classList.toggle('autopilot', isAutopilot);
  modeBadge.classList.toggle('readonly', !isAutopilot);
}

export function updateModelBadge(modelId) {
  const models = state.getModels();
  const model = models.find(m => m.id === modelId);
  modelBtn.textContent = model ? model.name : modelId;
}

export function updateContextBar(inputTokens, outputTokens, modelId) {
  const models = state.getModels();
  const model = models.find(m => m.id === modelId);
  const contextLimit = model ? model.context : 200000;
  const totalTokens = (inputTokens || 0) + (outputTokens || 0);
  const pct = Math.min((totalTokens / contextLimit) * 100, 100);

  contextBar.classList.remove('hidden', 'warning', 'danger');
  contextBarFill.style.width = pct + '%';
  contextBarLabel.textContent = `${formatTokens(totalTokens)} / ${formatTokens(contextLimit)}`;

  if (pct >= 90) {
    contextBar.classList.add('danger');
  } else if (pct >= 75) {
    contextBar.classList.add('warning');
  }
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

// --- Directory browser ---
async function browseTo(dirPath) {
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

// --- File Browser (download files from conversation cwd) ---
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(entry) {
  if (entry.type === 'directory') {
    return { class: 'directory', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' };
  }

  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'];
  const codeExts = ['js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'xml', 'yaml', 'yml', 'sh', 'bash'];
  const docExts = ['md', 'txt', 'pdf', 'doc', 'docx'];

  if (imageExts.includes(entry.ext)) {
    return { class: 'image', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>' };
  }
  if (codeExts.includes(entry.ext)) {
    return { class: 'code', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' };
  }
  if (docExts.includes(entry.ext)) {
    return { class: 'document', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' };
  }

  return { class: '', svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>' };
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

// --- Capabilities Modal ---
export function openCapabilitiesModal() {
  if (!capabilitiesModal) return;
  capabilitiesModal.classList.remove('hidden');
  if (capabilitiesSearch) {
    capabilitiesSearch.value = '';
    capabilitiesSearch.focus();
  }
  loadCapabilities();
}

export function closeCapabilitiesModal() {
  if (capabilitiesModal) {
    capabilitiesModal.classList.add('hidden');
  }
}

async function loadCapabilities() {
  if (!capabilitiesList) return;

  const currentId = state.getCurrentConversationId();
  const conv = state.conversations.find(c => c.id === currentId);
  const cwd = conv?.cwd || '';

  // Show loading state
  capabilitiesList.innerHTML = `
    <div class="capabilities-empty">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 6v6l4 2"/>
      </svg>
      <p>Loading capabilities...</p>
    </div>`;

  // Use cache if same cwd
  if (cachedCapabilities && capabilitiesCwd === cwd) {
    renderCapabilities(cachedCapabilities);
    return;
  }

  try {
    const res = await apiFetch(`/api/capabilities?cwd=${encodeURIComponent(cwd)}`, { silent: true });
    if (!res) {
      capabilitiesList.innerHTML = `
        <div class="capabilities-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4M12 16h.01"/>
          </svg>
          <p>Failed to load capabilities</p>
        </div>`;
      return;
    }
    const data = await res.json();
    cachedCapabilities = data;
    capabilitiesCwd = cwd;
    renderCapabilities(data);
  } catch {
    capabilitiesList.innerHTML = `
      <div class="capabilities-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4M12 16h.01"/>
        </svg>
        <p>Failed to load capabilities</p>
      </div>`;
  }
}

function renderCapabilities(data, filter = '') {
  if (!capabilitiesList) return;

  const filterLower = filter.toLowerCase();
  const filterItem = (item) => {
    if (!filter) return true;
    return item.name.toLowerCase().includes(filterLower) ||
           (item.description && item.description.toLowerCase().includes(filterLower));
  };

  const skills = (data.skills || []).filter(filterItem);
  const commands = (data.commands || []).filter(filterItem);
  const agents = (data.agents || []).filter(filterItem);

  if (skills.length === 0 && commands.length === 0 && agents.length === 0) {
    capabilitiesList.innerHTML = `
      <div class="capabilities-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 17l6-6-6-6"/><path d="M12 19h8"/>
        </svg>
        <p>${filter ? 'No matching commands found' : 'No commands or skills available'}</p>
      </div>`;
    return;
  }

  let html = '';

  if (commands.length > 0) {
    html += `<div class="capabilities-section">
      <div class="capabilities-section-title">Commands</div>
      ${commands.map(c => renderCapabilityItem(c, 'command')).join('')}
    </div>`;
  }

  if (skills.length > 0) {
    html += `<div class="capabilities-section">
      <div class="capabilities-section-title">Skills</div>
      ${skills.map(s => renderCapabilityItem(s, 'skill')).join('')}
    </div>`;
  }

  if (agents.length > 0) {
    html += `<div class="capabilities-section">
      <div class="capabilities-section-title">Agents</div>
      ${agents.map(a => renderCapabilityItem(a, 'agent')).join('')}
    </div>`;
  }

  capabilitiesList.innerHTML = html;

  // Attach click handlers
  capabilitiesList.querySelectorAll('.capability-item').forEach(item => {
    item.addEventListener('click', () => {
      const name = item.dataset.name;
      const type = item.dataset.type;
      insertCapability(name, type);
    });
  });
}

function renderCapabilityItem(item, type) {
  const icons = {
    skill: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
    command: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>',
    agent: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>',
  };

  return `
    <div class="capability-item" data-name="${escapeHtml(item.name)}" data-type="${type}">
      <div class="capability-icon ${type}">${icons[type]}</div>
      <div class="capability-info">
        <div class="capability-name"><code>/${escapeHtml(item.name)}</code></div>
        ${item.description ? `<div class="capability-desc">${escapeHtml(item.description)}</div>` : ''}
      </div>
      ${item.source === 'project' ? '<span class="capability-source">Project</span>' : ''}
    </div>`;
}

function insertCapability(name, _type) {
  if (!messageInput) return;
  haptic(10);
  const prefix = `/${name} `;
  messageInput.value = prefix + messageInput.value;
  messageInput.focus();
  messageInput.setSelectionRange(prefix.length, prefix.length);
  closeCapabilitiesModal();
  showToast(`Inserted /${name}`);
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

// --- Voice Input (SpeechRecognition) ---
function startRecording() {
  const recognition = state.getRecognition();
  if (!recognition) return;
  state.setIsRecording(true);
  micBtn.classList.add('recording');
  // Save existing textarea content
  messageInput.dataset.preRecordingText = messageInput.value;
  try {
    recognition.start();
  } catch {
    // Already started
  }
}

function stopRecording() {
  const recognition = state.getRecognition();
  if (!recognition) return;
  state.setIsRecording(false);
  micBtn.classList.remove('recording');
  try {
    recognition.stop();
  } catch {
    // Already stopped
  }
  delete messageInput.dataset.preRecordingText;
}

// --- Theme ---
function applyTheme(animate = false) {
  let effective = state.getCurrentTheme();
  if (effective === 'auto') {
    effective = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  // Smooth transition when toggling themes
  if (animate) {
    document.documentElement.classList.add('theme-transitioning');
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 350);
  }

  document.documentElement.setAttribute('data-theme', effective);
  // Update status bar color from CSS variable
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    // Read the theme color from the CSS variable after it's been applied
    setTimeout(() => {
      const computed = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim();
      if (computed) meta.content = computed;
    }, 10);
  }
}

// --- More Menu ---
function toggleMoreMenu() {
  if (!moreMenuDropdown || !moreMenuBtn) return;
  const isHidden = moreMenuDropdown.classList.contains('hidden');
  if (isHidden) {
    closeThemeDropdown();
    closeColorThemeDropdown();
    moreMenuDropdown.classList.remove('hidden');
    setTimeout(() => {
      document.addEventListener('click', closeMoreMenuOnOutsideClick);
    }, 0);
  } else {
    closeMoreMenu();
  }
}

function closeMoreMenu() {
  if (!moreMenuDropdown) return;
  moreMenuDropdown.classList.add('hidden');
  document.removeEventListener('click', closeMoreMenuOnOutsideClick);
}

function closeMoreMenuOnOutsideClick(e) {
  if (!moreMenuDropdown.contains(e.target) && e.target !== moreMenuBtn && !moreMenuBtn.contains(e.target)) {
    closeMoreMenu();
  }
}

function toggleChatMoreMenu() {
  if (!chatMoreDropdown) return;
  const isHidden = chatMoreDropdown.classList.contains('hidden');

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
  }
}

function toggleThemeDropdown() {
  if (!themeDropdown) return;
  const isHidden = themeDropdown.classList.contains('hidden');

  // Get position before closing more menu
  let top = 60;
  let right = 12;
  if (moreMenuBtn) {
    const rect = moreMenuBtn.getBoundingClientRect();
    top = rect.bottom + 4;
    right = window.innerWidth - rect.right;
  }

  closeMoreMenu();
  if (isHidden) {
    closeColorThemeDropdown();
    themeDropdown.style.top = `${top}px`;
    themeDropdown.style.right = `${right}px`;
    themeDropdown.classList.remove('hidden');
    setTimeout(() => {
      document.addEventListener('click', closeThemeDropdownOnOutsideClick);
    }, 0);
  } else {
    closeThemeDropdown();
  }
}

function closeThemeDropdown() {
  if (!themeDropdown) return;
  themeDropdown.classList.add('hidden');
  document.removeEventListener('click', closeThemeDropdownOnOutsideClick);
}

function closeThemeDropdownOnOutsideClick(e) {
  if (!themeDropdown.contains(e.target)) {
    closeThemeDropdown();
  }
}

function selectTheme(newTheme) {
  haptic(10);
  state.setCurrentTheme(newTheme);
  applyTheme(true); // animate the transition
  updateThemeIcon();
  // Don't close dropdown - let user compare themes by clicking through
  const labels = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  showToast(`Theme: ${labels[newTheme]}`);
}

function updateThemeIcon() {
  const currentTheme = state.getCurrentTheme();
  const labels = { auto: 'Auto', light: 'Light', dark: 'Dark' };

  // Update the more menu icon and label
  if (moreThemeIcon) {
    const svgPaths = {
      auto: '<circle cx="12" cy="12" r="10"/><path d="M12 2v20"/><path d="M12 2a10 10 0 0 1 0 20"/>',
      light: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
      dark: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
    };
    moreThemeIcon.innerHTML = svgPaths[currentTheme] || svgPaths.auto;
  }

  if (moreThemeLabel) {
    moreThemeLabel.textContent = labels[currentTheme] || 'Auto';
  }

  // Update active state in dropdown
  if (themeDropdown) {
    themeDropdown.querySelectorAll('.theme-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.theme === currentTheme);
    });
  }
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

// --- Color Theme ---
const COLOR_THEMES = {
  darjeeling: { name: 'Darjeeling', icon: '\u{1F3DC}' },
  claude: { name: 'Claude', icon: '\u{1F49C}' },
  budapest: { name: 'Budapest', icon: '\u{1F3E8}' },
  moonrise: { name: 'Moonrise', icon: '\u{1F3D5}' },
  aquatic: { name: 'Aquatic', icon: '\u{1F6A2}' }
};

function applyColorTheme(animate = false) {
  const theme = state.getCurrentColorTheme();
  if (!colorThemeLink) return;

  if (animate) {
    document.documentElement.classList.add('theme-transitioning');
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 350);
  }

  colorThemeLink.href = `/css/themes/${theme}.css`;

  // Update status bar color after CSS loads
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    setTimeout(() => {
      const computed = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim();
      if (computed) meta.content = computed;
    }, 50);
  }
}

function toggleColorThemeDropdown() {
  if (!colorThemeDropdown) return;
  const isHidden = colorThemeDropdown.classList.contains('hidden');

  // Get position before closing more menu
  let top = 60;
  let right = 12;
  if (moreMenuBtn) {
    const rect = moreMenuBtn.getBoundingClientRect();
    top = rect.bottom + 4;
    right = window.innerWidth - rect.right;
  }

  closeMoreMenu();
  if (isHidden) {
    closeThemeDropdown();
    colorThemeDropdown.style.top = `${top}px`;
    colorThemeDropdown.style.right = `${right}px`;
    colorThemeDropdown.classList.remove('hidden');
    setTimeout(() => {
      document.addEventListener('click', closeColorThemeDropdownOnOutsideClick);
    }, 0);
  } else {
    closeColorThemeDropdown();
  }
}

function closeColorThemeDropdown() {
  if (!colorThemeDropdown) return;
  colorThemeDropdown.classList.add('hidden');
  document.removeEventListener('click', closeColorThemeDropdownOnOutsideClick);
}

function closeColorThemeDropdownOnOutsideClick(e) {
  if (!colorThemeDropdown.contains(e.target)) {
    closeColorThemeDropdown();
  }
}

function selectColorTheme(newTheme) {
  haptic(10);
  state.setCurrentColorTheme(newTheme);
  applyColorTheme(true);
  updateColorThemeIcon();
  // Don't close dropdown - let user compare themes by clicking through
  const info = COLOR_THEMES[newTheme] || { name: newTheme };
  showToast(`Color theme: ${info.name}`);
}

function updateColorThemeIcon() {
  // Update active state in dropdown
  if (colorThemeDropdown) {
    const currentColorTheme = state.getCurrentColorTheme();
    colorThemeDropdown.querySelectorAll('.theme-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.colorTheme === currentColorTheme);
    });
  }
}

// --- Stats ---
async function loadStats() {
  statsContent.innerHTML = `
    <div class="stat-cards">
      ${Array(4).fill(`
        <div class="stat-card">
          <div class="skeleton-line" style="width:60%;height:24px"></div>
          <div class="skeleton-line" style="width:45%;height:12px;margin-top:6px"></div>
          <div class="skeleton-line" style="width:70%;height:11px;margin-top:4px"></div>
        </div>
      `).join('')}
    </div>
    <div class="stat-section">
      <div class="skeleton-line" style="width:30%;height:13px;margin-bottom:12px"></div>
      <div class="skeleton-line" style="width:100%;height:80px"></div>
    </div>
  `;
  const res = await apiFetch('/api/stats');
  if (!res) {
    statsContent.innerHTML = '<div class="stats-loading">Failed to load stats</div>';
    return;
  }
  const s = await res.json();
  renderStats(s);
}

function renderStats(s) {
  const avgPerConv = s.conversations.total ? (s.messages.total / s.conversations.total).toFixed(1) : 0;
  const avgCostPerConv = s.conversations.total ? (s.cost / s.conversations.total).toFixed(4) : 0;
  const userWords = Math.round(s.characters.user / 5);
  const assistantWords = Math.round(s.characters.assistant / 5);

  // Daily activity chart
  const maxDaily = Math.max(...s.dailyActivity.map(d => d.count), 1);
  const barsHtml = s.dailyActivity.map(d => {
    const pct = (d.count / maxDaily) * 100;
    return `<div class="bar-col" title="${d.date}: ${d.count} messages">` +
      `<div class="bar" style="height:${pct}%"></div>` +
      `</div>`;
  }).join('');

  // Hourly chart
  const maxHourly = Math.max(...s.hourlyCounts, 1);
  const hourBarsHtml = s.hourlyCounts.map((count, h) => {
    const pct = (count / maxHourly) * 100;
    return `<div class="bar-col" title="${h}:00 — ${count} messages">` +
      `<div class="bar" style="height:${pct}%"></div>` +
      `</div>`;
  }).join('');

  // Top conversations
  const topHtml = s.topConversations.map(c =>
    `<div class="top-conv-row">` +
      `<span class="top-conv-name">${escapeHtml(c.name)}</span>` +
      `<span class="top-conv-stat">${c.messages} msgs &middot; $${c.cost.toFixed(4)}</span>` +
    `</div>`
  ).join('');

  statsContent.innerHTML = `
    <div class="stat-cards">
      <div class="stat-card accent">
        <div class="stat-value">${s.conversations.total}</div>
        <div class="stat-label">Conversations</div>
        <div class="stat-sub">${s.conversations.active} active &middot; ${s.conversations.archived} archived</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${s.messages.total.toLocaleString()}</div>
        <div class="stat-label">Messages</div>
        <div class="stat-sub">${s.messages.user} you &middot; ${s.messages.assistant} Claude</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">$${s.cost.toFixed(2)}</div>
        <div class="stat-label">Total Cost</div>
        <div class="stat-sub">~$${avgCostPerConv} per conversation</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${s.streak}</div>
        <div class="stat-label">Day Streak</div>
        <div class="stat-sub">${s.duration > 3600 ? (s.duration / 3600).toFixed(1) + 'h' : Math.round(s.duration / 60) + 'min'} total think time</div>
      </div>
    </div>

    <div class="stat-section">
      <div class="stat-section-title">Last 30 Days</div>
      <div class="bar-chart">${barsHtml}</div>
      <div class="bar-chart-labels"><span>${s.dailyActivity[0].date.slice(5)}</span><span>Today</span></div>
    </div>

    <div class="stat-section">
      <div class="stat-section-title">Activity by Hour</div>
      <div class="bar-chart hours">${hourBarsHtml}</div>
      <div class="bar-chart-labels"><span>12am</span><span>12pm</span><span>11pm</span></div>
    </div>

    <div class="stat-section">
      <div class="stat-section-title">Words Exchanged</div>
      <div class="words-row">
        <div class="words-bar-label">You</div>
        <div class="words-bar-track"><div class="words-bar you" style="width:${Math.round(userWords / (userWords + assistantWords) * 100)}%"></div></div>
        <div class="words-bar-count">${userWords.toLocaleString()}</div>
      </div>
      <div class="words-row">
        <div class="words-bar-label">Claude</div>
        <div class="words-bar-track"><div class="words-bar claude" style="width:${Math.round(assistantWords / (userWords + assistantWords) * 100)}%"></div></div>
        <div class="words-bar-count">${assistantWords.toLocaleString()}</div>
      </div>
    </div>

    <div class="stat-section">
      <div class="stat-section-title">Top Conversations</div>
      ${topHtml}
    </div>

    <div class="stat-section">
      <div class="stat-section-title">Fun Facts</div>
      <div class="fun-facts">
        <div class="fun-fact">${avgPerConv} avg messages per conversation</div>
        <div class="fun-fact">${assistantWords > 10000 ? (assistantWords / 1000).toFixed(0) + 'k' : assistantWords} words from Claude (~${Math.round(assistantWords / 250)} pages)</div>
        <div class="fun-fact">${s.duration > 0 ? '$' + (s.cost / (s.duration / 3600)).toFixed(2) + '/hr of Claude think time' : 'No response time yet'}</div>
      </div>
    </div>
  `;
}

// --- Memory API functions ---

export async function fetchMemories(scope = null) {
  const qs = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  const res = await apiFetch(`/api/memory${qs}`, { silent: true });
  if (!res) return [];
  return await res.json();
}

export async function createMemory(text, scope, category = null, source = null) {
  const res = await apiFetch('/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, scope, category, source }),
  });
  if (!res) return null;
  return await res.json();
}

export async function updateMemoryAPI(id, scope, data) {
  const res = await apiFetch(`/api/memory/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, ...data }),
  });
  if (!res) return null;
  return await res.json();
}

export async function deleteMemoryAPI(id, scope) {
  const res = await apiFetch(`/api/memory/${id}?scope=${encodeURIComponent(scope)}`, {
    method: 'DELETE',
  });
  if (!res) return false;
  return true;
}

// --- Memory View functions ---

export function showMemoryView() {
  if (!memoryView) {
    memoryView = document.getElementById('memory-view');
    memoryBackBtn = document.getElementById('memory-back-btn');
    memoryContent = document.getElementById('memory-content');
  }
  if (!memoryView) return;

  listView.classList.add('slide-out');
  memoryView.classList.add('slide-in');
  loadMemoryView();
}

export function closeMemoryView() {
  if (!memoryView) return;
  memoryView.classList.remove('slide-in');
  listView.classList.remove('slide-out');
}

async function loadMemoryView() {
  if (!memoryContent) return;

  memoryContent.innerHTML = `
    <div class="memory-loading">
      <div class="skeleton-line" style="width:60%;height:20px"></div>
      <div class="skeleton-line" style="width:80%;height:16px;margin-top:8px"></div>
      <div class="skeleton-line" style="width:70%;height:16px;margin-top:8px"></div>
    </div>`;

  // Get current conversation's cwd for project-scoped memories
  const currentId = state.getCurrentConversationId();
  const conv = state.conversations.find(c => c.id === currentId);
  const cwd = conv?.cwd || null;

  const memories = await fetchMemories(cwd);
  state.setMemories(memories);
  renderMemoryView(memories, cwd);
}

function renderMemoryView(memories, currentCwd) {
  if (!memoryContent) return;

  const globalMemories = memories.filter(m => m.scope === 'global');
  const projectMemories = memories.filter(m => m.scope !== 'global');

  if (memories.length === 0 && !currentCwd) {
    // No memories and no project context - show simple empty state
    memoryContent.innerHTML = `
      <div class="memory-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
        <h3>No memories yet</h3>
        <p>Add memories to help Claude remember important context across conversations.</p>
        <button class="btn-primary" id="add-global-memory-btn">Add Global Memory</button>
        <p class="memory-empty-hint">Open a conversation first to add project-specific memories.</p>
      </div>`;
    memoryContent.querySelector('#add-global-memory-btn')?.addEventListener('click', () => showAddMemoryDialogWithScope('global'));
    return;
  }

  let html = '';

  // Global section (always show)
  html += `
    <div class="memory-section memory-section-global">
      <div class="memory-section-header">
        <div>
          <div class="memory-section-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            Global
          </div>
          <div class="memory-section-subtitle">Available in all conversations</div>
        </div>
        <button class="btn-secondary btn-sm add-global-memory-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add
        </button>
      </div>
      ${globalMemories.length > 0
        ? globalMemories.map(m => renderMemoryCard(m)).join('')
        : '<div class="memory-empty-section">No global memories</div>'}
    </div>`;

  // Project section (only show if we have a cwd context)
  if (currentCwd) {
    const projectPath = currentCwd.split('/').slice(-2).join('/');
    html += `
      <div class="memory-section memory-section-project">
        <div class="memory-section-header">
          <div>
            <div class="memory-section-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              Project
            </div>
            <div class="memory-section-subtitle">${projectPath}</div>
          </div>
          <button class="btn-secondary btn-sm add-project-memory-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add
          </button>
        </div>
        ${projectMemories.length > 0
          ? projectMemories.map(m => renderMemoryCard(m)).join('')
          : '<div class="memory-empty-section">No project memories</div>'}
      </div>`;
  }

  memoryContent.innerHTML = html;

  // Attach event handlers
  memoryContent.querySelector('.add-global-memory-btn')?.addEventListener('click', () => showAddMemoryDialogWithScope('global'));
  memoryContent.querySelector('.add-project-memory-btn')?.addEventListener('click', () => showAddMemoryDialogWithScope(currentCwd));
  memoryContent.querySelectorAll('.memory-card').forEach(card => {
    const id = card.dataset.id;
    const scope = card.dataset.scope;

    card.querySelector('.memory-toggle')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const enabled = !card.classList.contains('disabled');
      await updateMemoryAPI(id, scope, { enabled: !enabled });
      card.classList.toggle('disabled', enabled);
      state.updateMemory(id, { enabled: !enabled });
      haptic(10);
    });

    card.querySelector('.memory-delete')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await showDialog({ title: 'Delete memory?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
      if (ok) {
        await deleteMemoryAPI(id, scope);
        state.removeMemory(id);
        card.remove();
        showToast('Memory deleted');
      }
    });

    card.querySelector('.memory-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showEditMemoryDialog(state.getMemories().find(m => m.id === id));
    });
  });
}

function renderMemoryCard(memory) {
  const disabledClass = memory.enabled === false ? 'disabled' : '';
  const categoryBadge = memory.category ? `<span class="memory-category">${escapeHtml(memory.category)}</span>` : '';

  return `
    <div class="memory-card ${disabledClass}" data-id="${memory.id}" data-scope="${escapeHtml(memory.scope)}">
      <div class="memory-card-content">
        <div class="memory-text">${escapeHtml(memory.text)}</div>
        ${categoryBadge}
      </div>
      <div class="memory-card-actions">
        <button class="memory-toggle" aria-label="Toggle memory" title="${memory.enabled !== false ? 'Disable' : 'Enable'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${memory.enabled !== false
              ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
              : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
            }
          </svg>
        </button>
        <button class="memory-edit" aria-label="Edit memory" title="Edit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="memory-delete" aria-label="Delete memory" title="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>`;
}

async function showAddMemoryDialogWithScope(scope) {
  const isGlobal = scope === 'global';
  const text = await showDialog({
    title: isGlobal ? 'Add Global Memory' : 'Add Project Memory',
    message: isGlobal ? 'This will be available in all conversations.' : 'This will only apply to this project.',
    input: true,
    placeholder: 'e.g., "Always use TypeScript for this project"',
    confirmLabel: 'Add',
  });
  if (!text || !text.trim()) return;

  const memory = await createMemory(text.trim(), scope);
  if (memory) {
    state.addMemory(memory);
    loadMemoryView();
    showToast('Memory added');
  }
}

async function showEditMemoryDialog(memory) {
  if (!memory) return;

  const newText = await showDialog({
    title: 'Edit Memory',
    input: true,
    placeholder: 'Memory text',
    confirmLabel: 'Save',
    defaultValue: memory.text,
  });

  if (newText === null) return; // Cancelled
  if (!newText.trim()) {
    showToast('Memory text cannot be empty', { variant: 'error' });
    return;
  }

  const updated = await updateMemoryAPI(memory.id, memory.scope, { text: newText.trim() });
  if (updated) {
    state.updateMemory(memory.id, { text: newText.trim() });
    loadMemoryView();
    showToast('Memory updated');
  }
}

// --- Remember message as memory ---
async function rememberMessage(el, _index) {
  // Get plain text from the message
  const clone = el.cloneNode(true);
  clone.querySelector('.meta')?.remove();
  clone.querySelector('.msg-attachments')?.remove();
  clone.querySelectorAll('.tool-trace')?.forEach(e => e.remove());
  const text = clone.textContent.trim();

  if (!text) {
    showToast('No text to remember', { variant: 'error' });
    return;
  }

  // Truncate if too long
  const maxLen = 500;
  const memoryText = text.length > maxLen ? text.slice(0, maxLen) + '...' : text;

  // Ask user for the memory text (pre-filled with message snippet)
  const finalText = await showDialog({
    title: 'Save as Memory',
    input: true,
    placeholder: 'Memory text',
    confirmLabel: 'Save',
    defaultValue: memoryText,
  });

  if (!finalText || !finalText.trim()) return;

  // Get scope (project cwd or global)
  const currentId = state.getCurrentConversationId();
  const conv = state.conversations.find(c => c.id === currentId);
  const cwd = conv?.cwd || null;

  let scope = 'global';
  if (cwd) {
    // Default to project-specific since we're in a conversation
    const useGlobal = await showDialog({
      title: 'Memory Scope',
      message: `Save to this project only, or make it global?`,
      confirmLabel: 'Project only (Recommended)',
      cancelLabel: 'Global',
    });
    scope = useGlobal ? cwd : 'global';
  }

  const source = { conversationId: currentId };
  const memory = await createMemory(finalText.trim(), scope, null, source);
  if (memory) {
    state.addMemory(memory);
    showToast(scope === 'global' ? 'Global memory saved' : 'Project memory saved');
  }
}

// --- Memory toggle in chat header ---
export function updateMemoryIndicator(useMemory) {
  const memoryBtn = document.getElementById('memory-btn');
  if (memoryBtn) {
    memoryBtn.classList.toggle('active', useMemory !== false);
    memoryBtn.classList.toggle('disabled', useMemory === false);
    memoryBtn.title = useMemory !== false ? 'Memory enabled (click to disable)' : 'Memory disabled (click to enable)';
  }
  // Also update the menu label
  const chatMoreMemoryLabel = document.getElementById('chat-more-memory-label');
  if (chatMoreMemoryLabel) {
    chatMoreMemoryLabel.textContent = useMemory !== false ? 'Memory: On' : 'Memory: Off';
  }
}

// Show conversation stats dropdown
function showConvStatsDropdown() {
  if (!convStatsDropdown) return;
  const currentId = state.getCurrentConversationId();
  const conv = state.conversations.find(c => c.id === currentId);
  if (!conv) return;

  const messages = state.getAllMessages();
  const userMsgs = messages.filter(m => m.role === 'user').length;
  const assistantMsgs = messages.filter(m => m.role === 'assistant').length;
  const totalCost = messages.reduce((sum, m) => sum + (m.cost || 0), 0);
  const totalInput = messages.reduce((sum, m) => sum + (m.inputTokens || 0), 0);
  const totalOutput = messages.reduce((sum, m) => sum + (m.outputTokens || 0), 0);

  convStatsDropdown.innerHTML = `
    <div class="conv-stats-row"><span class="conv-stats-label">Messages</span><span class="conv-stats-value">${userMsgs} / ${assistantMsgs}</span></div>
    <div class="conv-stats-row"><span class="conv-stats-label">Tokens in</span><span class="conv-stats-value">${formatTokens(totalInput)}</span></div>
    <div class="conv-stats-row"><span class="conv-stats-label">Tokens out</span><span class="conv-stats-value">${formatTokens(totalOutput)}</span></div>
    <div class="conv-stats-row"><span class="conv-stats-label">Total cost</span><span class="conv-stats-value">$${totalCost.toFixed(4)}</span></div>
  `;
  convStatsDropdown.classList.remove('hidden');
}

async function toggleConversationMemory() {
  const currentId = state.getCurrentConversationId();
  if (!currentId) return;

  const conv = state.conversations.find(c => c.id === currentId);
  if (!conv) return;

  const newUseMemory = conv.useMemory === false ? true : false;

  const res = await apiFetch(`/api/conversations/${currentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ useMemory: newUseMemory }),
    silent: true,
  });

  if (res) {
    conv.useMemory = newUseMemory;
    updateMemoryIndicator(newUseMemory);
    showToast(newUseMemory ? 'Memory enabled for this conversation' : 'Memory disabled for this conversation');
  }
}

// Populate filter model dropdown
export function populateFilterModels() {
  const models = state.getModels();
  if (!filterModelSelect) return;
  filterModelSelect.innerHTML = '<option value="">All models</option>' +
    models.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
}

// --- Setup all event listeners ---
export function setupEventListeners(createConversation) {
  // Form submission
  inputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    haptic(10);
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
    haptic(10);
    messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
    state.setUserHasScrolledUp(false);
    jumpToBottomBtn.classList.remove('visible');
  });

  backBtn.addEventListener('click', () => {
    haptic(10);
    showListView();
  });

  deleteBtn.addEventListener('click', async () => {
    const currentConversationId = state.getCurrentConversationId();
    if (!currentConversationId) return;
    haptic(10);
    const ok = await showDialog({ title: 'Delete conversation?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
    if (ok) deleteConversation(currentConversationId);
  });

  newChatBtn.addEventListener('click', () => {
    haptic(15);
    convNameInput.value = '';
    convCwdInput.value = '';
    dirBrowser.classList.add('hidden');
    populateRecentDirs();
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
    const model = convModelSelect.value;
    if (name) {
      createConversation(name, cwd, autopilot, model);
      modalOverlay.classList.add('hidden');
    }
  });

  // Directory browser
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

  // Voice input
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (e) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = 0; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      const prefix = messageInput.dataset.preRecordingText || '';
      messageInput.value = prefix + finalTranscript + interimTranscript;
      autoResizeInput();
    };

    recognition.onerror = () => {
      stopRecording();
    };

    recognition.onend = () => {
      if (state.getIsRecording()) {
        stopRecording();
      }
    };

    state.setRecognition(recognition);

    micBtn.addEventListener('click', () => {
      if (state.getIsRecording()) {
        stopRecording();
      } else {
        startRecording();
      }
    });
  } else {
    micBtn.classList.add('hidden');
  }

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
      haptic(10);
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
      haptic(10);
      openFileBrowser('general');
    });
  }

  // Capabilities modal
  if (capabilitiesBtn) {
    capabilitiesBtn.addEventListener('click', () => {
      haptic(10);
      openCapabilitiesModal();
    });
  }

  // Memory toggle (click) and memory view (long-press)
  const memoryBtn = document.getElementById('memory-btn');
  if (memoryBtn) {
    let memoryPressTimer = null;
    let memoryLongPressed = false;

    memoryBtn.addEventListener('mousedown', (e) => {
      memoryLongPressed = false;
      memoryPressTimer = setTimeout(() => {
        memoryLongPressed = true;
        haptic(20);
        showMemoryView();
      }, 500);
    });

    memoryBtn.addEventListener('mouseup', () => {
      clearTimeout(memoryPressTimer);
      if (!memoryLongPressed) {
        haptic(10);
        toggleConversationMemory();
      }
    });

    memoryBtn.addEventListener('mouseleave', () => {
      clearTimeout(memoryPressTimer);
    });

    // Touch events for mobile
    memoryBtn.addEventListener('touchstart', (e) => {
      memoryLongPressed = false;
      memoryPressTimer = setTimeout(() => {
        memoryLongPressed = true;
        haptic(20);
        showMemoryView();
      }, 500);
    }, { passive: true });

    memoryBtn.addEventListener('touchend', (e) => {
      clearTimeout(memoryPressTimer);
      if (!memoryLongPressed) {
        e.preventDefault();
        haptic(10);
        toggleConversationMemory();
      }
    });

    memoryBtn.addEventListener('touchcancel', () => {
      clearTimeout(memoryPressTimer);
    });
  }

  if (capabilitiesClose) {
    capabilitiesClose.addEventListener('click', closeCapabilitiesModal);
  }

  if (capabilitiesModal) {
    capabilitiesModal.addEventListener('click', (e) => {
      if (e.target === capabilitiesModal) closeCapabilitiesModal();
    });
  }

  if (capabilitiesSearch) {
    capabilitiesSearch.addEventListener('input', () => {
      if (cachedCapabilities) {
        renderCapabilities(cachedCapabilities, capabilitiesSearch.value);
      }
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
    if (convStatsDropdown) convStatsDropdown.classList.add('hidden');
  });

  // Conversation stats dropdown handler
  if (convStatsBtn) {
    convStatsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !convStatsDropdown.classList.contains('hidden');
      if (isOpen) {
        convStatsDropdown.classList.add('hidden');
        return;
      }
      showConvStatsDropdown();
    });
  }

  // Mode badge click handler
  modeBadge.addEventListener('click', async () => {
    const currentConversationId = state.getCurrentConversationId();
    if (!currentConversationId) return;
    const newAutopilot = !state.getCurrentAutopilot();
    state.setCurrentAutopilot(newAutopilot);
    updateModeBadge(newAutopilot);
    await apiFetch(`/api/conversations/${currentConversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autopilot: newAutopilot }),
      silent: true,
    });
  });

  // Archive toggle
  archiveToggle.addEventListener('click', () => {
    haptic(10);
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
      haptic(10);
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
    if (scrollTop > 50 && !listHeader.classList.contains('compact')) {
      listHeader.classList.add('compact');
    } else if (scrollTop <= 20 && listHeader.classList.contains('compact')) {
      listHeader.classList.remove('compact');
    }
    lastScrollTop = scrollTop;
  }, { passive: true });

  // Stats
  statsBtn.addEventListener('click', () => {
    listView.classList.add('slide-out');
    statsView.classList.add('slide-in');
    loadStats();
  });

  statsBackBtn.addEventListener('click', () => {
    statsView.classList.remove('slide-in');
    listView.classList.remove('slide-out');
  });

  // Memory view
  memoryView = document.getElementById('memory-view');
  memoryBackBtn = document.getElementById('memory-back-btn');
  memoryContent = document.getElementById('memory-content');

  if (memoryBackBtn) {
    memoryBackBtn.addEventListener('click', closeMemoryView);
  }

  // More menu button
  if (moreMenuBtn) {
    moreMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMoreMenu();
    });
  }

  // More menu items
  if (moreColorTheme) {
    moreColorTheme.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleColorThemeDropdown();
    });
  }

  if (moreThemeToggle) {
    moreThemeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleThemeDropdown();
    });
  }

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
      haptic(10);
    });
  }

  // Mobile more menu items
  if (moreStats) {
    moreStats.addEventListener('click', () => {
      closeMoreMenu();
      haptic(10);
      listView.classList.add('slide-out');
      statsView.classList.add('slide-in');
      loadStats();
    });
  }

  if (moreFiles) {
    moreFiles.addEventListener('click', () => {
      closeMoreMenu();
      haptic(10);
      openFileBrowser('general');
    });
  }

  if (moreArchive) {
    moreArchive.addEventListener('click', () => {
      closeMoreMenu();
      haptic(10);
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
      haptic(10);
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
      haptic(10);
      dropdownOpenedAt = Date.now();
      showConvStatsDropdown();
    });
  }

  if (chatMoreFiles) {
    chatMoreFiles.addEventListener('click', () => {
      closeChatMoreMenu();
      haptic(10);
      if (filesBtn) filesBtn.click();
    });
  }

  if (chatMoreBranches) {
    chatMoreBranches.addEventListener('click', () => {
      closeChatMoreMenu();
      haptic(10);
      const branchesBtn = document.getElementById('branches-btn');
      if (branchesBtn) branchesBtn.click();
    });
  }

  if (chatMoreCapabilities) {
    chatMoreCapabilities.addEventListener('click', () => {
      closeChatMoreMenu();
      haptic(10);
      if (capabilitiesBtn) capabilitiesBtn.click();
    });
  }

  if (chatMoreMemory) {
    let memoryMenuPressTimer = null;
    let memoryMenuLongPressed = false;

    const handleMemoryLongPress = () => {
      memoryMenuLongPressed = true;
      haptic(20);
      closeChatMoreMenu();
      showMemoryView();
    };

    chatMoreMemory.addEventListener('mousedown', () => {
      memoryMenuLongPressed = false;
      memoryMenuPressTimer = setTimeout(handleMemoryLongPress, 500);
    });

    chatMoreMemory.addEventListener('mouseup', () => {
      clearTimeout(memoryMenuPressTimer);
      if (!memoryMenuLongPressed) {
        haptic(10);
        toggleConversationMemory();
        // Don't close menu - let user see the state change
      }
    });

    chatMoreMemory.addEventListener('mouseleave', () => {
      clearTimeout(memoryMenuPressTimer);
    });

    chatMoreMemory.addEventListener('touchstart', () => {
      memoryMenuLongPressed = false;
      memoryMenuPressTimer = setTimeout(handleMemoryLongPress, 500);
    }, { passive: true });

    chatMoreMemory.addEventListener('touchend', (e) => {
      clearTimeout(memoryMenuPressTimer);
      if (!memoryMenuLongPressed) {
        e.preventDefault();
        haptic(10);
        toggleConversationMemory();
        // Don't close menu - let user see the state change
      }
    });

    chatMoreMemory.addEventListener('touchcancel', () => {
      clearTimeout(memoryMenuPressTimer);
    });
  }

  if (chatMoreNew) {
    chatMoreNew.addEventListener('click', () => {
      closeChatMoreMenu();
      haptic(10);
      if (newChatHereBtn) newChatHereBtn.click();
    });
  }

  if (chatMoreExport) {
    chatMoreExport.addEventListener('click', () => {
      closeChatMoreMenu();
      haptic(10);
      if (exportBtn) exportBtn.click();
    });
  }

  if (chatMoreDelete) {
    chatMoreDelete.addEventListener('click', () => {
      closeChatMoreMenu();
      haptic(10);
      if (deleteBtn) deleteBtn.click();
    });
  }

  // Close chat more menu on outside click
  document.addEventListener('click', () => {
    if (chatMoreDropdown && !chatMoreDropdown.classList.contains('hidden')) {
      chatMoreDropdown.classList.add('hidden');
    }
  });

  // Theme dropdown (light/dark/auto)
  if (themeDropdown) {
    themeDropdown.addEventListener('click', (e) => {
      const option = e.target.closest('.theme-option');
      if (option && option.dataset.theme) {
        selectTheme(option.dataset.theme);
      }
    });
  }
  if (colorThemeDropdown) {
    colorThemeDropdown.addEventListener('click', (e) => {
      const option = e.target.closest('.theme-option');
      if (option && option.dataset.colorTheme) {
        selectColorTheme(option.dataset.colorTheme);
      }
    });
  }

  // Listen for OS theme changes when in auto mode
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (state.getCurrentTheme() === 'auto') applyTheme();
  });

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
      // Close theme dropdowns first
      if (themeDropdown && !themeDropdown.classList.contains('hidden')) {
        closeThemeDropdown();
      } else if (colorThemeDropdown && !colorThemeDropdown.classList.contains('hidden')) {
        closeColorThemeDropdown();
      } else if (lightbox && !lightbox.classList.contains('hidden')) {
        lightbox.classList.add('hidden');
      } else if (dialogOverlay && !dialogOverlay.classList.contains('hidden')) {
        dialogCancel?.click();
      } else if (isFileViewerOpen()) {
        closeFileViewer();
      } else if (isFilePanelOpen()) {
        closeFilePanel();
      } else if (fileBrowserModal && !fileBrowserModal.classList.contains('hidden')) {
        closeFileBrowser();
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

  chatView.addEventListener('touchend', (_e) => {
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
