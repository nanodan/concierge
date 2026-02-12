// --- UI interactions ---
import { escapeHtml } from './markdown.js';
import { formatTime, formatTokens, haptic, showToast, showDialog, setLoading, getDialogOverlay, getDialogCancel } from './utils.js';
import { getWS } from './websocket.js';
import { loadConversations, deleteConversation, forkConversation, showListView, triggerSearch, hideActionPopup } from './conversations.js';
import { renderMessages, enhanceCodeBlocks, attachTTSHandlers, attachRegenHandlers, showReactionPicker, setAttachMessageActionsCallback, loadMoreMessages } from './render.js';
import * as state from './state.js';

// DOM elements (set by init)
let messagesContainer = null;
let messageInput = null;
let inputForm = null;
let sendBtn = null;
let cancelBtn = null;
let modalOverlay = null;
let newConvForm = null;
let modalCancel = null;
let convNameInput = null;
let convCwdInput = null;
let convAutopilot = null;
let convModelSelect = null;
let archiveToggle = null;
let archiveToggleLabel = null;
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
let contextBar = null;
let contextBarFill = null;
let contextBarLabel = null;
let jumpToBottomBtn = null;
let msgActionPopup = null;
let actionPopupOverlay = null;
let themeToggle = null;
let filterToggle = null;
let filterRow = null;
let filterModelSelect = null;
let loadMoreBtn = null;
let backBtn = null;
let deleteBtn = null;
let newChatBtn = null;
let exportBtn = null;
let conversationList = null;
let pullIndicator = null;
let listHeader = null;
let statsBtn = null;
let statsView = null;
let statsBackBtn = null;
let statsContent = null;
let listView = null;
let chatView = null;

export function initUI(elements) {
  messagesContainer = elements.messagesContainer;
  messageInput = elements.messageInput;
  inputForm = elements.inputForm;
  sendBtn = elements.sendBtn;
  cancelBtn = elements.cancelBtn;
  modalOverlay = elements.modalOverlay;
  newConvForm = elements.newConvForm;
  modalCancel = elements.modalCancel;
  convNameInput = elements.convNameInput;
  convCwdInput = elements.convCwdInput;
  convAutopilot = elements.convAutopilot;
  convModelSelect = elements.convModelSelect;
  archiveToggle = elements.archiveToggle;
  archiveToggleLabel = elements.archiveToggleLabel;
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
  contextBar = elements.contextBar;
  contextBarFill = elements.contextBarFill;
  contextBarLabel = elements.contextBarLabel;
  jumpToBottomBtn = elements.jumpToBottomBtn;
  msgActionPopup = elements.msgActionPopup;
  actionPopupOverlay = elements.actionPopupOverlay;
  themeToggle = elements.themeToggle;
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
}

// --- Auto resize input ---
export function autoResizeInput() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
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
    try {
      const resp = await fetch(
        `/api/conversations/${currentConversationId}/upload?filename=${encodeURIComponent(att.name)}`,
        { method: 'POST', body: att.file }
      );
      const result = await resp.json();
      attachments.push(result);
    } catch {
      showToast(`Failed to upload ${att.name}`, { variant: 'error' });
    }
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

  // Show message in UI
  const el = document.createElement('div');
  el.className = 'message user animate-in';
  el.innerHTML = attachHtml + escapeHtml(text) + `<div class="meta">${formatTime(Date.now())}</div>`;
  messagesContainer.appendChild(el);
  state.setUserHasScrolledUp(false);
  state.scrollToBottom(true);

  ws.send(JSON.stringify({
    type: 'message',
    conversationId: currentConversationId,
    text,
    attachments: attachments.length > 0 ? attachments : undefined,
  }));

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

  // Remove last assistant message from DOM
  const lastMsg = messagesContainer.querySelector('.message:last-child');
  if (lastMsg?.classList.contains('assistant')) {
    lastMsg.remove();
  }

  state.setThinking(true);
  ws.send(JSON.stringify({ type: 'regenerate', conversationId: currentConversationId }));
}

// --- Model & Mode & Context Bar ---
export function updateModeBadge(isAutopilot) {
  modeBadge.textContent = isAutopilot ? 'AP' : 'ASK';
  modeBadge.classList.toggle('autopilot', isAutopilot);
  modeBadge.classList.toggle('manual', !isAutopilot);
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
  await fetch(`/api/conversations/${convId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId }),
  });
  state.setCurrentModel(modelId);
  updateModelBadge(modelId);
  const models = state.getModels();
  const model = models.find(m => m.id === modelId);
  showToast(`Switched to ${model ? model.name : modelId}`);
}

// --- Directory browser ---
async function browseTo(dirPath) {
  try {
    const qs = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
    const res = await fetch(`/api/browse${qs}`);
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
  } catch (err) {
    dirList.innerHTML = `<div class="dir-empty">Failed to browse</div>`;
  }
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
function applyTheme() {
  let effective = state.getCurrentTheme();
  if (effective === 'auto') {
    effective = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', effective);
  // Update status bar color
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = effective === 'light' ? '#f5f5f7' : '#1c1c1e';
}

function cycleTheme() {
  haptic(10);
  const order = ['auto', 'light', 'dark'];
  const currentTheme = state.getCurrentTheme();
  const idx = order.indexOf(currentTheme);
  const newTheme = order[(idx + 1) % order.length];
  state.setCurrentTheme(newTheme);
  applyTheme();
  updateThemeIcon();
  const labels = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  showToast(`Theme: ${labels[newTheme]}`);
}

function updateThemeIcon() {
  if (!themeToggle) return;
  const icons = { auto: '\u25D0', light: '\u2600', dark: '\u263E' };
  themeToggle.textContent = icons[state.getCurrentTheme()] || '\u25D0';
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
  try {
    const res = await fetch('/api/stats');
    const s = await res.json();
    renderStats(s);
  } catch {
    statsContent.innerHTML = '<div class="stats-loading">Failed to load stats</div>';
  }
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
    const label = d.date.slice(5); // MM-DD
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
    try {
      const res = await fetch('/api/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath }),
      });
      const data = await res.json();
      if (data.ok) {
        browseTo(newPath);
      } else {
        showDialog({ title: 'Error', message: data.error || 'Failed to create folder' });
      }
    } catch {
      showDialog({ title: 'Error', message: 'Failed to create folder' });
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

  document.addEventListener('click', () => {
    modelDropdown.classList.add('hidden');
  });

  // Mode badge click handler
  modeBadge.addEventListener('click', async () => {
    const currentConversationId = state.getCurrentConversationId();
    if (!currentConversationId) return;
    const newAutopilot = !state.getCurrentAutopilot();
    state.setCurrentAutopilot(newAutopilot);
    updateModeBadge(newAutopilot);
    await fetch(`/api/conversations/${currentConversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autopilot: newAutopilot }),
    });
  });

  // Archive toggle
  archiveToggle.addEventListener('click', () => {
    haptic(10);
    const newShowing = !state.getShowingArchived();
    state.setShowingArchived(newShowing);
    archiveToggle.classList.toggle('active', newShowing);
    archiveToggleLabel.textContent = newShowing ? 'Active' : 'Archived';
    searchInput.value = '';
    loadConversations();
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
  let lastScrollTop = 0;

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

  // Theme
  if (themeToggle) {
    themeToggle.addEventListener('click', cycleTheme);
  }

  // Listen for OS theme changes when in auto mode
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (state.getCurrentTheme() === 'auto') applyTheme();
  });

  applyTheme();
  updateThemeIcon();

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const mod = e.metaKey || e.ctrlKey;
    const dialogOverlay = getDialogOverlay();
    const dialogCancel = getDialogCancel();

    // Escape always works
    if (e.key === 'Escape') {
      if (dialogOverlay && !dialogOverlay.classList.contains('hidden')) {
        dialogCancel?.click();
      } else if (!modalOverlay.classList.contains('hidden')) {
        modalOverlay.classList.add('hidden');
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
}
