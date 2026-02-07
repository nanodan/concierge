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
  try {
    const qs = showingArchived ? '?archived=true' : '';
    const res = await fetch(`/api/conversations${qs}`);
    conversations = await res.json();
    if (!chatView.classList.contains('active')) {
      renderConversationList();
    }
  } catch (err) {
    console.error('Failed to load conversations:', err);
  }
}

async function createConversation(name, cwd) {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, cwd }),
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
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'delete') {
        if (confirm('Delete this conversation?')) {
          deleteConversation(id);
        }
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
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    const id = longPressTarget;
    hideActionPopup();
    if (!id) return;

    if (action === 'archive') {
      const conv = conversations.find(c => c.id === id);
      archiveConversation(id, !conv?.archived);
    } else if (action === 'delete') {
      if (confirm('Delete this conversation?')) {
        deleteConversation(id);
      }
    } else if (action === 'rename') {
      const conv = conversations.find(c => c.id === id);
      const newName = prompt('Rename conversation:', conv?.name || '');
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
  const conv = await getConversation(id);

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
    return `<div class="message ${cls}">${content}<div class="meta">${meta}</div></div>`;
  }).join('');

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
    streamingMessageEl.innerHTML = renderMarkdown(finalText) + `<div class="meta">${meta}</div>`;
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

  html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';

  html = html.replace(/(?<!<\/?\w+[^>]*)\n(?!<\/?(?:pre|code|ul|ol|li|h[1-3]|p|hr))/g, '<br>');

  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>\s*(<(?:pre|h[1-3]|ul|ol|hr))/g, '$1');
  html = html.replace(/(<\/(?:pre|h[1-3]|ul|ol|hr)>)\s*<\/p>/g, '$1');

  return html;
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

backBtn.addEventListener('click', showListView);

deleteBtn.addEventListener('click', () => {
  if (currentConversationId && confirm('Delete this conversation?')) {
    deleteConversation(currentConversationId);
  }
});

newChatBtn.addEventListener('click', () => {
  convNameInput.value = '';
  convCwdInput.value = '';
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
  if (name) {
    createConversation(name, cwd);
    modalOverlay.classList.add('hidden');
  }
});

// Close open swipe when tapping elsewhere on the list
conversationList.addEventListener('click', (e) => {
  if (activeSwipeCard && !e.target.closest('.conv-card-wrapper')) {
    resetSwipe(activeSwipeCard);
    activeSwipeCard = null;
  }
});

// --- Init ---
connectWS();
loadConversations();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
