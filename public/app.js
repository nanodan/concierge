// --- State ---
let conversations = [];
let currentConversationId = null;
let ws = null;
let reconnectTimer = null;
let streamingMessageEl = null;
let streamingText = '';
let showingArchived = false;
let searchDebounceTimer = null;
let activeSwipeCard = null; // track currently swiped-open card
let recognition = null;
let isRecording = false;
let currentTTSBtn = null; // track which TTS button is currently speaking

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
const cancelBtn = document.getElementById('cancel-btn');
const convAutopilot = document.getElementById('conv-autopilot');
const dialogOverlay = document.getElementById('dialog-overlay');
const dialogTitle = document.getElementById('dialog-title');
const dialogBody = document.getElementById('dialog-body');
const dialogInput = document.getElementById('dialog-input');
const dialogCancel = document.getElementById('dialog-cancel');
const dialogOk = document.getElementById('dialog-ok');
let currentBrowsePath = '';

// --- WebSocket ---
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    clearTimeout(reconnectTimer);
  };

  ws.onmessage = (e) => {
    let data;
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    handleWSMessage(data);
  };

  ws.onclose = () => {
    reconnectTimer = setTimeout(connectWS, 2000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function handleWSMessage(data) {
  switch (data.type) {
    case 'delta':
      if (data.conversationId === currentConversationId) {
        appendDelta(data.text);
      }
      break;

    case 'result':
      if (data.conversationId === currentConversationId) {
        finalizeMessage(data);
      }
      // Update conversation list in background
      loadConversations();
      break;

    case 'status':
      updateStatus(data.conversationId, data.status);
      break;

    case 'error':
      if (data.conversationId === currentConversationId || !data.conversationId) {
        showError(data.error);
        setThinking(false);
      }
      break;

    case 'stderr':
      break;
  }
}

// --- API ---
async function loadConversations() {
  setLoading(listView, true);
  try {
    const qs = showingArchived ? '?archived=true' : '';
    const res = await fetch(`/api/conversations${qs}`);
    conversations = await res.json();
    if (!chatView.classList.contains('active')) {
      renderConversationList();
    }
  } catch (err) {
    console.error('Failed to load conversations:', err);
  } finally {
    setLoading(listView, false);
  }
}

async function createConversation(name, cwd, autopilot) {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, cwd, autopilot }),
  });
  const conv = await res.json();
  await loadConversations();
  openConversation(conv.id);
}

async function deleteConversation(id) {
  await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
  if (currentConversationId === id) {
    showListView();
  }
  await loadConversations();
}

async function archiveConversation(id, archived) {
  await fetch(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived }),
  });
  await loadConversations();
}

async function renameConversation(id, name) {
  await fetch(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  await loadConversations();
}

async function searchConversations(query) {
  const res = await fetch(`/api/conversations/search?q=${encodeURIComponent(query)}`);
  return res.json();
}

async function getConversation(id) {
  const res = await fetch(`/api/conversations/${id}`);
  if (!res.ok) return null;
  return res.json();
}

// --- Rendering ---
function renderConversationList(items) {
  const list = items || conversations;
  const isSearch = !!items;

  if (list.length === 0) {
    const msg = isSearch
      ? 'No matching conversations'
      : showingArchived
        ? 'No archived conversations'
        : 'No conversations yet';
    const sub = isSearch
      ? ''
      : showingArchived
        ? ''
        : '<p style="font-size: 13px; margin-top: 8px;">Tap + to start chatting with Claude</p>';
    conversationList.innerHTML = `
      <div class="empty-state">
        <div class="icon">&#x1F4AC;</div>
        <p>${msg}</p>
        ${sub}
      </div>
    `;
    return;
  }

  conversationList.innerHTML = list.map(c => {
    const preview = c.lastMessage
      ? truncate(c.lastMessage.text, 60)
      : 'No messages yet';
    const time = c.lastMessage
      ? formatTime(c.lastMessage.timestamp)
      : formatTime(c.createdAt);

    // Search match snippet
    let matchHtml = '';
    if (c.matchingMessages && c.matchingMessages.length > 0) {
      const snippet = truncate(c.matchingMessages[0].text, 80);
      matchHtml = `<div class="conv-card-match">${escapeHtml(snippet)}</div>`;
    }

    const archiveLabel = c.archived ? 'Unarchive' : 'Archive';
    const archiveBtnClass = c.archived ? 'unarchive-btn' : 'archive-btn';

    return `
      <div class="conv-card-wrapper">
        <div class="swipe-actions">
          <button class="swipe-action-btn ${archiveBtnClass}" data-id="${c.id}" data-action="archive">${archiveLabel}</button>
          <button class="swipe-action-btn delete-action-btn" data-id="${c.id}" data-action="delete">Delete</button>
        </div>
        <div class="conv-card" data-id="${c.id}">
          <div class="conv-card-top">
            <span class="conv-card-name">${escapeHtml(c.name)}</span>
            <span class="conv-card-time">${time}</span>
          </div>
          <div class="conv-card-preview">${escapeHtml(preview)}</div>
          ${matchHtml}
          <div class="conv-card-cwd">${escapeHtml(c.cwd)}</div>
        </div>
      </div>
    `;
  }).join('');

  // Attach swipe + click + long-press handlers
  conversationList.querySelectorAll('.conv-card-wrapper').forEach(wrapper => {
    const card = wrapper.querySelector('.conv-card');
    const id = card.dataset.id;
    setupSwipe(wrapper, card);
    setupLongPress(card, id);
    // Right-click context menu (desktop equivalent of long-press)
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showActionPopup(e.clientX, e.clientY, id);
    });
    card.addEventListener('click', (e) => {
      // Don't navigate if card is swiped open
      if (Math.abs(parseFloat(card.style.transform?.replace(/[^0-9.-]/g, '') || 0)) > 10) return;
      openConversation(id);
    });
  });

  // Swipe action button handlers
  conversationList.querySelectorAll('.swipe-action-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'delete') {
        const ok = await showDialog({ title: 'Delete conversation?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
        if (ok) deleteConversation(id);
      } else if (action === 'archive') {
        const conv = conversations.find(c => c.id === id);
        archiveConversation(id, !conv?.archived);
      }
    });
  });
}

// --- Swipe gesture handling ---
function setupSwipe(wrapper, card) {
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let swiping = false;
  let directionLocked = false;
  let isHorizontal = false;
  const THRESHOLD = 60;
  const ACTION_WIDTH = 144; // 2 buttons * 72px

  card.addEventListener('touchstart', (e) => {
    // Close any other open swipe first
    if (activeSwipeCard && activeSwipeCard !== card) {
      resetSwipe(activeSwipeCard);
      activeSwipeCard = null;
    }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    currentX = 0;
    swiping = true;
    directionLocked = false;
    isHorizontal = false;
    card.classList.add('swiping');
  }, { passive: true });

  card.addEventListener('touchmove', (e) => {
    if (!swiping) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (!directionLocked) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        directionLocked = true;
        isHorizontal = Math.abs(dx) > Math.abs(dy);
      }
      return;
    }

    if (!isHorizontal) {
      swiping = false;
      card.classList.remove('swiping');
      return;
    }

    e.preventDefault();
    // Only allow swipe left (negative)
    currentX = Math.min(0, Math.max(-ACTION_WIDTH, dx));
    card.style.transform = `translateX(${currentX}px)`;
  }, { passive: false });

  card.addEventListener('touchend', () => {
    if (!swiping) return;
    swiping = false;
    card.classList.remove('swiping');

    if (currentX < -THRESHOLD) {
      // Snap open
      card.style.transform = `translateX(-${ACTION_WIDTH}px)`;
      activeSwipeCard = card;
    } else {
      // Snap closed
      card.style.transform = 'translateX(0)';
      if (activeSwipeCard === card) activeSwipeCard = null;
    }
  }, { passive: true });
}

function resetSwipe(card) {
  card.style.transform = 'translateX(0)';
}

// --- Long-press handling ---
let longPressTimer = null;
let longPressTarget = null;

function setupLongPress(card, id) {
  card.addEventListener('touchstart', (e) => {
    longPressTarget = id;
    longPressTimer = setTimeout(() => {
      showActionPopup(e.touches[0].clientX, e.touches[0].clientY, id);
    }, 500);
  }, { passive: true });

  card.addEventListener('touchmove', () => {
    clearTimeout(longPressTimer);
  }, { passive: true });

  card.addEventListener('touchend', () => {
    clearTimeout(longPressTimer);
  }, { passive: true });
}

function showActionPopup(x, y, id) {
  longPressTarget = id;
  const conv = conversations.find(c => c.id === id);
  popupArchiveBtn.textContent = conv?.archived ? 'Unarchive' : 'Archive';

  // Position popup near touch point
  actionPopup.style.left = Math.min(x, window.innerWidth - 180) + 'px';
  actionPopup.style.top = Math.min(y, window.innerHeight - 160) + 'px';
  actionPopup.classList.remove('hidden');
  actionPopupOverlay.classList.remove('hidden');
}

function hideActionPopup() {
  actionPopup.classList.add('hidden');
  actionPopupOverlay.classList.add('hidden');
  longPressTarget = null;
}

// --- Action popup event handlers ---
actionPopupOverlay.addEventListener('click', hideActionPopup);

actionPopup.querySelectorAll('.action-popup-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.action;
    const id = longPressTarget;
    hideActionPopup();
    if (!id) return;

    if (action === 'archive') {
      const conv = conversations.find(c => c.id === id);
      archiveConversation(id, !conv?.archived);
    } else if (action === 'delete') {
      const ok = await showDialog({ title: 'Delete conversation?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
      if (ok) deleteConversation(id);
    } else if (action === 'rename') {
      const conv = conversations.find(c => c.id === id);
      const newName = await showDialog({ title: 'Rename conversation', input: true, defaultValue: conv?.name || '', placeholder: 'Conversation name', confirmLabel: 'Rename' });
      if (newName && newName.trim()) {
        renameConversation(id, newName.trim());
      }
    }
  });
});

// --- Search ---
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  const q = searchInput.value.trim();
  if (!q) {
    renderConversationList();
    return;
  }
  searchDebounceTimer = setTimeout(async () => {
    const results = await searchConversations(q);
    renderConversationList(results);
  }, 250);
});

// --- Archive toggle ---
archiveToggle.addEventListener('click', () => {
  showingArchived = !showingArchived;
  archiveToggle.classList.toggle('active', showingArchived);
  archiveToggleLabel.textContent = showingArchived ? 'Active' : 'Archived';
  searchInput.value = '';
  loadConversations();
});

async function openConversation(id) {
  currentConversationId = id;
  setLoading(chatView, true);
  const conv = await getConversation(id);
  setLoading(chatView, false);

  if (!conv) {
    await loadConversations();
    return;
  }

  chatName.textContent = conv.name;
  updateStatusDot(conv.status);

  renderMessages(conv.messages);
  showChatView();

  setThinking(conv.status === 'thinking');
}

function renderMessages(messages) {
  streamingMessageEl = null;
  streamingText = '';

  messagesContainer.innerHTML = messages.map(m => {
    const cls = m.role === 'user' ? 'user' : 'assistant';
    const content = m.role === 'assistant' ? renderMarkdown(m.text) : escapeHtml(m.text);
    let meta = formatTime(m.timestamp);
    if (m.cost != null) {
      meta += ` &middot; $${m.cost.toFixed(4)}`;
    }
    if (m.duration != null) {
      meta += ` &middot; ${(m.duration / 1000).toFixed(1)}s`;
    }
    const ttsBtn = (cls === 'assistant' && window.speechSynthesis)
      ? '<button class="tts-btn" aria-label="Read aloud">&#x1F50A;</button>'
      : '';
    return `<div class="message ${cls}">${content}<div class="meta">${meta}${ttsBtn}</div></div>`;
  }).join('');

  attachTTSHandlers();
  scrollToBottom();
}

function appendDelta(text) {
  if (!streamingMessageEl) {
    streamingMessageEl = document.createElement('div');
    streamingMessageEl.className = 'message assistant';
    messagesContainer.appendChild(streamingMessageEl);
    streamingText = '';
  }
  streamingText += text;
  streamingMessageEl.innerHTML = renderMarkdown(streamingText);
  scrollToBottom();
}

function finalizeMessage(data) {
  setThinking(false);

  if (streamingMessageEl) {
    const finalText = data.text || streamingText;
    let meta = formatTime(Date.now());
    if (data.cost != null) {
      meta += ` &middot; $${data.cost.toFixed(4)}`;
    }
    if (data.duration != null) {
      meta += ` &middot; ${(data.duration / 1000).toFixed(1)}s`;
    }
    const ttsBtn = window.speechSynthesis
      ? '<button class="tts-btn" aria-label="Read aloud">&#x1F50A;</button>'
      : '';
    streamingMessageEl.innerHTML = renderMarkdown(finalText) + `<div class="meta">${meta}${ttsBtn}</div>`;
    attachTTSHandlers();
    streamingMessageEl = null;
    streamingText = '';
    scrollToBottom();
  }
}

function showError(error) {
  const el = document.createElement('div');
  el.className = 'message error';
  el.textContent = error;
  messagesContainer.appendChild(el);
  scrollToBottom();
}

function setThinking(thinking) {
  typingIndicator.classList.toggle('hidden', !thinking);
  sendBtn.disabled = thinking;
  sendBtn.classList.toggle('hidden', thinking);
  cancelBtn.classList.toggle('hidden', !thinking);
  if (thinking) {
    scrollToBottom();
  }
}

function updateStatus(conversationId, status) {
  if (conversationId === currentConversationId) {
    updateStatusDot(status);
    setThinking(status === 'thinking');
  }
}

function updateStatusDot(status) {
  chatStatus.className = 'status-dot ' + (status || 'idle');
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

// --- View switching ---
function showChatView() {
  listView.classList.remove('active');
  chatView.classList.add('active');
  messageInput.focus();
}

function showListView() {
  chatView.classList.remove('active');
  listView.classList.add('active');
  currentConversationId = null;
  streamingMessageEl = null;
  streamingText = '';
  loadConversations();
}

// --- Send message ---
function sendMessage(text) {
  if (!text.trim() || !currentConversationId) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const el = document.createElement('div');
  el.className = 'message user';
  el.innerHTML = escapeHtml(text) + `<div class="meta">${formatTime(Date.now())}</div>`;
  messagesContainer.appendChild(el);
  scrollToBottom();

  ws.send(JSON.stringify({
    type: 'message',
    conversationId: currentConversationId,
    text,
  }));

  setThinking(true);
  messageInput.value = '';
  autoResizeInput();
}

// --- Markdown rendering ---
function renderMarkdown(text) {
  if (!text) return '';

  let html = escapeHtml(text);

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  html = html.replace(/^---$/gm, '<hr>');

  html = html.replace(/^[*-] (.+)$/gm, '<ul-li>$1</ul-li>');
  html = html.replace(/(<ul-li>.*<\/ul-li>\n?)+/g, (m) => '<ul>' + m + '</ul>');
  html = html.replace(/<\/?ul-li>/g, (t) => t === '<ul-li>' ? '<li>' : '</li>');

  html = html.replace(/^\d+\. (.+)$/gm, '<ol-li>$1</ol-li>');
  html = html.replace(/(<ol-li>.*<\/ol-li>\n?)+/g, (m) => '<ol>' + m + '</ol>');
  html = html.replace(/<\/?ol-li>/g, (t) => t === '<ol-li>' ? '<li>' : '</li>');

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const decoded = url.replace(/&amp;/g, '&');
    if (/^(https?:\/\/|mailto:)/i.test(decoded)) {
      return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
    }
    return text;
  });

  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';

  html = html.replace(/(?<!<\/?\w+[^>]*)\n(?!<\/?(?:pre|code|ul|ol|li|h[1-3]|p|hr))/g, '<br>');

  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>\s*(<(?:pre|h[1-3]|ul|ol|hr))/g, '$1');
  html = html.replace(/(<\/(?:pre|h[1-3]|ul|ol|hr)>)\s*<\/p>/g, '$1');

  return html;
}

// --- Dialog system ---
function showDialog({ title, message, input, defaultValue, placeholder, confirmLabel, cancelLabel, danger }) {
  return new Promise((resolve) => {
    dialogTitle.textContent = title || '';
    dialogBody.textContent = message || '';
    dialogOk.textContent = confirmLabel || 'OK';
    dialogCancel.textContent = cancelLabel || 'Cancel';
    dialogOk.className = danger ? 'btn-primary danger' : 'btn-primary';

    if (input) {
      dialogInput.classList.remove('hidden');
      dialogInput.value = defaultValue || '';
      dialogInput.placeholder = placeholder || '';
    } else {
      dialogInput.classList.add('hidden');
    }

    // Hide cancel for alert-style (message only, no input, no danger action)
    const isAlert = !input && !danger;
    dialogCancel.classList.toggle('hidden', isAlert);

    dialogOverlay.classList.remove('hidden');
    if (input) dialogInput.focus();

    function cleanup() {
      dialogOverlay.classList.add('hidden');
      dialogOk.removeEventListener('click', onOk);
      dialogCancel.removeEventListener('click', onCancel);
      dialogOverlay.removeEventListener('click', onOverlay);
      dialogInput.removeEventListener('keydown', onKeydown);
    }

    function onOk() {
      cleanup();
      resolve(input ? dialogInput.value : true);
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    function onOverlay(e) {
      if (e.target === dialogOverlay) onCancel();
    }

    function onKeydown(e) {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
    }

    dialogOk.addEventListener('click', onOk);
    dialogCancel.addEventListener('click', onCancel);
    dialogOverlay.addEventListener('click', onOverlay);
    if (input) dialogInput.addEventListener('keydown', onKeydown);
  });
}

// --- Loading state ---
function setLoading(view, loading) {
  view.classList.toggle('loading', loading);
}

// --- Utilities ---
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncate(text, len) {
  if (!text) return '';
  return text.length > len ? text.slice(0, len) + '...' : text;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  if (isToday) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function autoResizeInput() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}

// --- Event listeners ---
inputForm.addEventListener('submit', (e) => {
  e.preventDefault();
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
  if (!currentConversationId || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'cancel', conversationId: currentConversationId }));
});

backBtn.addEventListener('click', showListView);

deleteBtn.addEventListener('click', async () => {
  if (!currentConversationId) return;
  const ok = await showDialog({ title: 'Delete conversation?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
  if (ok) deleteConversation(currentConversationId);
});

newChatBtn.addEventListener('click', () => {
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
  if (name) {
    createConversation(name, cwd, autopilot);
    modalOverlay.classList.add('hidden');
  }
});

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
    currentBrowsePath = data.path;
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
          browseTo(currentBrowsePath + '/' + item.dataset.name);
        });
      });
    }
  } catch (err) {
    dirList.innerHTML = `<div class="dir-empty">Failed to browse</div>`;
  }
}

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
  if (currentBrowsePath && currentBrowsePath !== '/') {
    const parent = currentBrowsePath.replace(/\/[^/]+$/, '') || '/';
    browseTo(parent);
  }
});

dirSelectBtn.addEventListener('click', () => {
  convCwdInput.value = currentBrowsePath;
  dirBrowser.classList.add('hidden');
});

dirNewBtn.addEventListener('click', async () => {
  const name = await showDialog({ title: 'New folder', input: true, placeholder: 'Folder name', confirmLabel: 'Create' });
  if (!name || !name.trim()) return;
  const newPath = currentBrowsePath + '/' + name.trim();
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
  if (activeSwipeCard && !e.target.closest('.conv-card-wrapper')) {
    resetSwipe(activeSwipeCard);
    activeSwipeCard = null;
  }
});

// --- Voice Input (SpeechRecognition) ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (e) => {
    let finalTranscript = '';
    let interimTranscript = '';
    // Rebuild full transcript from all results each time (avoids duplication)
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
    // If still in recording state (unexpected end), reset
    if (isRecording) {
      stopRecording();
    }
  };

  micBtn.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });
} else {
  // Hide mic button if SpeechRecognition not available
  micBtn.classList.add('hidden');
}

function startRecording() {
  if (!recognition) return;
  isRecording = true;
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
  if (!recognition) return;
  isRecording = false;
  micBtn.classList.remove('recording');
  try {
    recognition.stop();
  } catch {
    // Already stopped
  }
  delete messageInput.dataset.preRecordingText;
}

// --- Voice Output (SpeechSynthesis) ---
function attachTTSHandlers() {
  if (!window.speechSynthesis) return;
  messagesContainer.querySelectorAll('.tts-btn').forEach(btn => {
    if (btn.dataset.ttsAttached) return;
    btn.dataset.ttsAttached = 'true';
    btn.addEventListener('click', () => toggleTTS(btn));
  });
}

function toggleTTS(btn) {
  // If this button is currently speaking, stop
  if (btn.classList.contains('speaking')) {
    speechSynthesis.cancel();
    resetTTSBtn(btn);
    return;
  }

  // Cancel any other ongoing speech
  if (currentTTSBtn) {
    speechSynthesis.cancel();
    resetTTSBtn(currentTTSBtn);
  }

  // Get plain text from the message (strip HTML)
  const messageEl = btn.closest('.message');
  if (!messageEl) return;

  // Clone, remove the meta div, then get text content
  const clone = messageEl.cloneNode(true);
  const metaEl = clone.querySelector('.meta');
  if (metaEl) metaEl.remove();
  const plainText = clone.textContent.trim();

  if (!plainText) return;

  const utterance = new SpeechSynthesisUtterance(plainText);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  utterance.onend = () => resetTTSBtn(btn);
  utterance.onerror = () => resetTTSBtn(btn);

  btn.classList.add('speaking');
  btn.innerHTML = '&#x23F9;'; // stop icon
  currentTTSBtn = btn;

  speechSynthesis.speak(utterance);
}

function resetTTSBtn(btn) {
  btn.classList.remove('speaking');
  btn.innerHTML = '&#x1F50A;'; // speaker icon
  if (currentTTSBtn === btn) currentTTSBtn = null;
}

// --- Init ---
connectWS();
loadConversations();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
