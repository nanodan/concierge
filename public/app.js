// --- State ---
let conversations = [];
let currentConversationId = null;
let ws = null;
let reconnectTimer = null;
let streamingMessageEl = null;
let streamingText = '';

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
      // Could display debug info, but skip for clean UI
      break;
  }
}

// --- API ---
async function loadConversations() {
  try {
    const res = await fetch('/api/conversations');
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

async function getConversation(id) {
  const res = await fetch(`/api/conversations/${id}`);
  if (!res.ok) return null;
  return res.json();
}

// --- Rendering ---
function renderConversationList() {
  if (conversations.length === 0) {
    conversationList.innerHTML = `
      <div class="empty-state">
        <div class="icon">&#x1F4AC;</div>
        <p>No conversations yet</p>
        <p style="font-size: 13px; margin-top: 8px;">Tap + to start chatting with Claude</p>
      </div>
    `;
    return;
  }

  conversationList.innerHTML = conversations.map(c => {
    const preview = c.lastMessage
      ? truncate(c.lastMessage.text, 60)
      : 'No messages yet';
    const time = c.lastMessage
      ? formatTime(c.lastMessage.timestamp)
      : formatTime(c.createdAt);
    return `
      <div class="conv-card" data-id="${c.id}">
        <div class="conv-card-top">
          <span class="conv-card-name">${escapeHtml(c.name)}</span>
          <span class="conv-card-time">${time}</span>
        </div>
        <div class="conv-card-preview">${escapeHtml(preview)}</div>
        <div class="conv-card-cwd">${escapeHtml(c.cwd)}</div>
      </div>
    `;
  }).join('');

  // Attach click handlers
  conversationList.querySelectorAll('.conv-card').forEach(card => {
    card.addEventListener('click', () => openConversation(card.dataset.id));
  });
}

async function openConversation(id) {
  currentConversationId = id;
  const conv = await getConversation(id);

  if (!conv) {
    // Conversation gone (server restarted) — remove from list and go back
    await loadConversations();
    return;
  }

  chatName.textContent = conv.name;
  updateStatusDot(conv.status);

  renderMessages(conv.messages);
  showChatView();

  // If currently thinking, show indicator
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

  // Add user message to UI
  const el = document.createElement('div');
  el.className = 'message user';
  el.innerHTML = escapeHtml(text) + `<div class="meta">${formatTime(Date.now())}</div>`;
  messagesContainer.appendChild(el);
  scrollToBottom();

  // Send over WebSocket
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

  // Escape HTML first
  let html = escapeHtml(text);

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  // Unordered lists
  html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Paragraphs - convert double newlines
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Single newlines to <br> (but not inside pre/code)
  html = html.replace(/(?<!<\/?\w+[^>]*)\n(?!<\/?(?:pre|code|ul|ol|li|h[1-3]|p|hr))/g, '<br>');

  // Clean up empty paragraphs
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

// Auto-resize textarea
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

// --- Init ---
connectWS();
loadConversations();

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
