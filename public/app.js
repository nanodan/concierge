// --- Imported modules ---
const { escapeHtml, renderMarkdown } = window.markdown;

function enhanceCodeBlocks(container) {
  container.querySelectorAll('pre code').forEach(el => {
    if (window.hljs && !el.dataset.highlighted) hljs.highlightElement(el);
    const pre = el.parentElement;
    if (pre.parentElement?.classList.contains('code-block')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(el.textContent).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        showToast('Copied to clipboard');
      });
    });
    wrapper.appendChild(btn);
  });
}

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
let models = [];
let currentModel = 'sonnet';
let currentAutopilot = true;
let userHasScrolledUp = false;
let isStreaming = false;
const unreadConversations = new Set(JSON.parse(localStorage.getItem('unreadConversations') || '[]'));

// Streaming render throttle
let pendingDelta = '';
let renderScheduled = false;

// Attachments
let pendingAttachments = []; // Array of { file, previewUrl, name }

function saveUnread() {
  localStorage.setItem('unreadConversations', JSON.stringify([...unreadConversations]));
}

function haptic(ms = 10) { navigator.vibrate?.(ms); }

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
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const attachmentPreview = document.getElementById('attachment-preview');
const msgActionPopup = document.getElementById('msg-action-popup');
let currentBrowsePath = '';

// --- WebSocket ---
let wsHasConnected = false;
let reconnectAttempt = 0;
const MAX_RECONNECT_DELAY = 30000;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    clearTimeout(reconnectTimer);
    reconnectAttempt = 0;
    if (wsHasConnected) showToast('Reconnected');
    wsHasConnected = true;
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
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
    reconnectAttempt++;
    reconnectTimer = setTimeout(connectWS, delay);
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
      } else if (data.conversationId) {
        unreadConversations.add(data.conversationId);
        saveUnread();
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

    case 'messages_updated':
      if (data.conversationId === currentConversationId) {
        renderMessages(data.messages);
        setThinking(true);
      }
      break;

    case 'stderr':
      break;
  }
}

// --- API ---
async function loadConversations() {
  // Show skeletons on first load when list is empty
  if (conversations.length === 0 && !conversationList.querySelector('.conv-card-wrapper')) {
    conversationList.innerHTML = Array(5).fill(`
      <div class="conv-card-wrapper">
        <div class="conv-card skeleton-card">
          <div class="conv-card-top">
            <span class="skeleton-line" style="width:55%;height:16px"></span>
            <span class="skeleton-line" style="width:40px;height:12px"></span>
          </div>
          <span class="skeleton-line" style="width:80%;height:13px;margin-top:6px"></span>
          <span class="skeleton-line" style="width:40%;height:11px;margin-top:4px"></span>
        </div>
      </div>
    `).join('');
  }
  setLoading(listView, true);
  try {
    const qs = showingArchived ? '?archived=true' : '';
    const res = await fetch(`/api/conversations${qs}`);
    conversations = await res.json();
    if (!chatView.classList.contains('slide-in')) {
      renderConversationList();
    }
  } catch (err) {
    console.error('Failed to load conversations:', err);
  } finally {
    setLoading(listView, false);
  }
}

async function loadModels() {
  try {
    const res = await fetch('/api/models');
    models = await res.json();
    // Populate modal select
    convModelSelect.innerHTML = models.map(m =>
      `<option value="${m.id}"${m.id === 'sonnet' ? ' selected' : ''}>${m.name}</option>`
    ).join('');
  } catch {
    models = [{ id: 'sonnet', name: 'Sonnet 4.5', context: 200000 }];
  }
}

async function createConversation(name, cwd, autopilot, model) {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, cwd, autopilot, model }),
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

    const isUnread = unreadConversations.has(c.id);
    return `
      <div class="conv-card-wrapper">
        <div class="swipe-actions">
          <button class="swipe-action-btn ${archiveBtnClass}" data-id="${c.id}" data-action="archive">${archiveLabel}</button>
          <button class="swipe-action-btn delete-action-btn" data-id="${c.id}" data-action="delete">Delete</button>
        </div>
        <div class="conv-card" data-id="${c.id}">
          <div class="conv-card-top">
            ${isUnread ? '<span class="unread-dot"></span>' : ''}<span class="conv-card-name">${escapeHtml(c.name)}</span>
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
        if (ok) {
          deleteConversation(id);
          showToast('Conversation deleted');
        }
      } else if (action === 'archive') {
        const conv = conversations.find(c => c.id === id);
        archiveConversation(id, !conv?.archived);
        showToast(conv?.archived ? 'Conversation unarchived' : 'Conversation archived');
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
      haptic(10);
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
      haptic(15);
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
actionPopupOverlay.addEventListener('click', () => {
  hideActionPopup();
  hideMsgActionPopup();
});

actionPopup.querySelectorAll('.action-popup-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.action;
    const id = longPressTarget;
    hideActionPopup();
    if (!id) return;

    if (action === 'archive') {
      const conv = conversations.find(c => c.id === id);
      archiveConversation(id, !conv?.archived);
      showToast(conv?.archived ? 'Conversation unarchived' : 'Conversation archived');
    } else if (action === 'delete') {
      const ok = await showDialog({ title: 'Delete conversation?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
      if (ok) {
        deleteConversation(id);
        showToast('Conversation deleted');
      }
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

// --- Pull-to-refresh ---
const pullIndicator = document.getElementById('pull-indicator');
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

async function openConversation(id) {
  currentConversationId = id;
  unreadConversations.delete(id);
  saveUnread();
  setLoading(chatView, true);
  const conv = await getConversation(id);
  setLoading(chatView, false);

  if (!conv) {
    await loadConversations();
    return;
  }

  chatName.textContent = conv.name;
  updateStatusDot(conv.status);

  currentModel = conv.model || 'sonnet';
  currentAutopilot = conv.autopilot !== false;
  updateModelBadge(currentModel);
  updateModeBadge(currentAutopilot);

  renderMessages(conv.messages);
  showChatView();

  // Update context bar from last assistant message with tokens
  const lastAssistant = [...conv.messages].reverse().find(m => m.role === 'assistant' && m.inputTokens);
  if (lastAssistant) {
    updateContextBar(lastAssistant.inputTokens, lastAssistant.outputTokens, currentModel);
  } else {
    contextBar.classList.add('hidden');
  }

  setThinking(conv.status === 'thinking');
}

function renderMessages(messages) {
  streamingMessageEl = null;
  streamingText = '';
  pendingDelta = '';
  renderScheduled = false;

  messagesContainer.innerHTML = messages.map((m, i) => {
    const cls = m.role === 'user' ? 'user' : 'assistant';
    const content = m.role === 'assistant' ? renderMarkdown(m.text) : escapeHtml(m.text);
    let meta = formatTime(m.timestamp);
    if (m.cost != null) {
      meta += ` &middot; $${m.cost.toFixed(4)}`;
    }
    if (m.duration != null) {
      meta += ` &middot; ${(m.duration / 1000).toFixed(1)}s`;
    }
    if (m.inputTokens != null) {
      meta += ` &middot; ${formatTokens(m.inputTokens)} in / ${formatTokens(m.outputTokens)} out`;
    }
    // Attachment thumbnails for user messages
    let attachHtml = '';
    if (m.attachments && m.attachments.length > 0) {
      attachHtml = '<div class="msg-attachments">' + m.attachments.map(a =>
        a.url && /\.(png|jpg|jpeg|gif|webp)$/i.test(a.filename)
          ? `<img src="${a.url}" class="msg-attachment-img" alt="${escapeHtml(a.filename)}">`
          : `<span class="msg-attachment-file">${escapeHtml(a.filename)}</span>`
      ).join('') + '</div>';
    }
    const isLastAssistant = cls === 'assistant' && i === messages.length - 1;
    const regenBtn = isLastAssistant
      ? '<button class="regen-btn" aria-label="Regenerate" title="Regenerate">&#x21BB;</button>'
      : '';
    const ttsBtn = (cls === 'assistant' && window.speechSynthesis)
      ? '<button class="tts-btn" aria-label="Read aloud">&#x1F50A;</button>'
      : '';
    return `<div class="message ${cls}" data-index="${i}">${attachHtml}${content}<div class="meta">${meta}${ttsBtn}${regenBtn}</div></div>`;
  }).join('');

  enhanceCodeBlocks(messagesContainer);
  attachTTSHandlers();
  attachRegenHandlers();
  attachMessageActions();
  scrollToBottom(true);
}

function appendDelta(text) {
  if (!streamingMessageEl) {
    streamingMessageEl = document.createElement('div');
    streamingMessageEl.className = 'message assistant animate-in';
    messagesContainer.appendChild(streamingMessageEl);
    streamingText = '';
    pendingDelta = '';
    isStreaming = true;
    userHasScrolledUp = !isNearBottom(150);
  }
  pendingDelta += text;
  if (!renderScheduled) {
    renderScheduled = true;
    requestAnimationFrame(flushDelta);
  }
}

function flushDelta() {
  renderScheduled = false;
  if (!pendingDelta || !streamingMessageEl) return;
  streamingText += pendingDelta;
  pendingDelta = '';
  streamingMessageEl.innerHTML = renderMarkdown(streamingText);
  enhanceCodeBlocks(streamingMessageEl);
  scrollToBottom();
}

function finalizeMessage(data) {
  // Flush any pending delta
  if (pendingDelta && streamingMessageEl) {
    streamingText += pendingDelta;
    pendingDelta = '';
    renderScheduled = false;
  }

  setThinking(false);
  isStreaming = false;

  if (streamingMessageEl) {
    const finalText = data.text || streamingText;
    let meta = formatTime(Date.now());
    if (data.cost != null) {
      meta += ` &middot; $${data.cost.toFixed(4)}`;
    }
    if (data.duration != null) {
      meta += ` &middot; ${(data.duration / 1000).toFixed(1)}s`;
    }
    if (data.inputTokens != null) {
      meta += ` &middot; ${formatTokens(data.inputTokens)} in / ${formatTokens(data.outputTokens)} out`;
    }
    const ttsBtn = window.speechSynthesis
      ? '<button class="tts-btn" aria-label="Read aloud">&#x1F50A;</button>'
      : '';
    const regenBtn = '<button class="regen-btn" aria-label="Regenerate" title="Regenerate">&#x21BB;</button>';
    streamingMessageEl.innerHTML = renderMarkdown(finalText) + `<div class="meta">${meta}${ttsBtn}${regenBtn}</div>`;
    enhanceCodeBlocks(streamingMessageEl);
    attachTTSHandlers();
    attachRegenHandlers();
    streamingMessageEl = null;
    streamingText = '';
    scrollToBottom();
    if (userHasScrolledUp) {
      jumpToBottomBtn.classList.add('flash');
      setTimeout(() => jumpToBottomBtn.classList.remove('flash'), 1500);
    }
  }

  if (data.inputTokens != null) {
    updateContextBar(data.inputTokens, data.outputTokens, currentModel);
  }
}

function showError(error) {
  const el = document.createElement('div');
  el.className = 'message error animate-in';
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

function isNearBottom(threshold = 150) {
  const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
  return scrollHeight - scrollTop - clientHeight < threshold;
}

function scrollToBottom(force = false) {
  if (!force && userHasScrolledUp) return;
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

// --- View switching ---
function showChatView() {
  listView.classList.add('slide-out');
  chatView.classList.add('slide-in');
  // Don't auto-focus on touch devices — keyboard opening during slide-in is disruptive
  if (!('ontouchstart' in window)) {
    messageInput.focus({ preventScroll: true });
  }
}

function showListView() {
  chatView.classList.remove('slide-in');
  listView.classList.remove('slide-out');
  document.querySelector('.views-container').scrollLeft = 0;
  currentConversationId = null;
  streamingMessageEl = null;
  streamingText = '';
  pendingDelta = '';
  renderScheduled = false;
  userHasScrolledUp = false;
  isStreaming = false;
  jumpToBottomBtn.classList.remove('visible');
  clearPendingAttachments();
  loadConversations();
}

// --- Send message ---
async function sendMessage(text) {
  if ((!text.trim() && pendingAttachments.length === 0) || !currentConversationId) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  haptic(5);

  // Upload attachments first
  let attachments = [];
  if (pendingAttachments.length > 0) {
    for (const att of pendingAttachments) {
      try {
        const res = await fetch(
          `/api/conversations/${currentConversationId}/upload?filename=${encodeURIComponent(att.name)}`,
          { method: 'POST', body: att.file }
        );
        const result = await res.json();
        attachments.push(result);
      } catch (err) {
        showError(`Failed to upload ${att.name}`);
        return;
      }
    }
    clearPendingAttachments();
  }

  // Show message in UI
  let attachHtml = '';
  if (attachments.length > 0) {
    attachHtml = '<div class="msg-attachments">' + attachments.map(a =>
      a.url && /\.(png|jpg|jpeg|gif|webp)$/i.test(a.filename)
        ? `<img src="${a.url}" class="msg-attachment-img" alt="${escapeHtml(a.filename)}">`
        : `<span class="msg-attachment-file">${escapeHtml(a.filename)}</span>`
    ).join('') + '</div>';
  }

  const el = document.createElement('div');
  el.className = 'message user animate-in';
  el.innerHTML = attachHtml + escapeHtml(text) + `<div class="meta">${formatTime(Date.now())}</div>`;
  messagesContainer.appendChild(el);
  userHasScrolledUp = false;
  scrollToBottom(true);

  ws.send(JSON.stringify({
    type: 'message',
    conversationId: currentConversationId,
    text: text || '(see attached)',
    attachments: attachments.length > 0 ? attachments : undefined,
  }));

  setThinking(true);
  messageInput.value = '';
  autoResizeInput();
}

// --- Attachments ---
function addAttachment(file) {
  const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
  pendingAttachments.push({ file, previewUrl, name: file.name });
  renderAttachmentPreviewUI();
}

function removeAttachment(index) {
  if (pendingAttachments[index]?.previewUrl) {
    URL.revokeObjectURL(pendingAttachments[index].previewUrl);
  }
  pendingAttachments.splice(index, 1);
  renderAttachmentPreviewUI();
}

function clearPendingAttachments() {
  pendingAttachments.forEach(att => { if (att.previewUrl) URL.revokeObjectURL(att.previewUrl); });
  pendingAttachments = [];
  renderAttachmentPreviewUI();
}

function renderAttachmentPreviewUI() {
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
    btn.addEventListener('click', () => removeAttachment(parseInt(btn.dataset.index)));
  });
}

if (attachBtn) {
  attachBtn.addEventListener('click', () => fileInput.click());
}
if (fileInput) {
  fileInput.addEventListener('change', () => {
    Array.from(fileInput.files).forEach(f => addAttachment(f));
    fileInput.value = '';
  });
}

// Paste images from clipboard
messageInput.addEventListener('paste', (e) => {
  const files = Array.from(e.clipboardData?.files || []);
  if (files.length > 0) {
    e.preventDefault();
    files.forEach(f => addAttachment(f));
  }
});

// --- Message Actions (Edit & Regenerate) ---
function attachMessageActions() {
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
    hideMsgActionPopup();
    const clone = el.cloneNode(true);
    clone.querySelector('.meta')?.remove();
    clone.querySelector('.msg-attachments')?.remove();
    navigator.clipboard.writeText(clone.textContent.trim());
    showToast('Copied to clipboard');
  });
  msgActionPopup.appendChild(copyBtn);

  msgActionPopup.style.left = Math.min(x, window.innerWidth - 180) + 'px';
  msgActionPopup.style.top = Math.min(y, window.innerHeight - 160) + 'px';
  msgActionPopup.classList.remove('hidden');
  actionPopupOverlay.classList.remove('hidden');
}

function hideMsgActionPopup() {
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
    if (!newText || !ws || ws.readyState !== WebSocket.OPEN) return;
    el.classList.remove('editing');
    ws.send(JSON.stringify({
      type: 'edit',
      conversationId: currentConversationId,
      messageIndex: index,
      text: newText,
    }));
  });
}

function attachRegenHandlers() {
  messagesContainer.querySelectorAll('.regen-btn').forEach(btn => {
    if (btn.dataset.attached) return;
    btn.dataset.attached = 'true';
    btn.addEventListener('click', () => regenerateMessage());
  });
}

function regenerateMessage() {
  if (!currentConversationId || !ws || ws.readyState !== WebSocket.OPEN) return;

  // Remove last assistant message from DOM
  const lastMsg = messagesContainer.querySelector('.message:last-child');
  if (lastMsg?.classList.contains('assistant')) {
    lastMsg.remove();
  }

  setThinking(true);
  ws.send(JSON.stringify({ type: 'regenerate', conversationId: currentConversationId }));
}

// --- Export ---
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    if (!currentConversationId) return;
    window.open(`/api/conversations/${currentConversationId}/export?format=markdown`);
    showToast('Exporting conversation');
  });
}

// --- Toast notifications ---
function showToast(message, { variant = 'default', duration = 3000 } = {}) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${variant}`;
  toast.textContent = message;
  while (toastContainer.children.length >= 2)
    toastContainer.removeChild(toastContainer.firstChild);
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-enter'));
  setTimeout(() => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
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

// --- Smart scroll ---
messagesContainer.addEventListener('scroll', () => {
  if (isStreaming) {
    userHasScrolledUp = !isNearBottom(150);
  }
  jumpToBottomBtn.classList.toggle('visible', !isNearBottom(300));
});

jumpToBottomBtn.addEventListener('click', () => {
  messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
  userHasScrolledUp = false;
  jumpToBottomBtn.classList.remove('visible');
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
  const model = convModelSelect.value;
  if (name) {
    createConversation(name, cwd, autopilot, model);
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

// --- Model & Mode & Context Bar ---
function formatTokens(count) {
  if (count == null) return '0';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'k';
  return String(count);
}

function updateModeBadge(isAutopilot) {
  modeBadge.textContent = isAutopilot ? 'AP' : 'ASK';
  modeBadge.classList.toggle('autopilot', isAutopilot);
  modeBadge.classList.toggle('manual', !isAutopilot);
}

function updateModelBadge(modelId) {
  const model = models.find(m => m.id === modelId);
  modelBtn.textContent = model ? model.name : modelId;
}

function updateContextBar(inputTokens, outputTokens, modelId) {
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

async function switchModel(convId, modelId) {
  await fetch(`/api/conversations/${convId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId }),
  });
  currentModel = modelId;
  updateModelBadge(modelId);
  const model = models.find(m => m.id === modelId);
  showToast(`Switched to ${model ? model.name : modelId}`);
}

// Model dropdown handlers
modelBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = !modelDropdown.classList.contains('hidden');
  if (isOpen) {
    modelDropdown.classList.add('hidden');
    return;
  }
  modelDropdown.innerHTML = models.map(m =>
    `<div class="model-option${m.id === currentModel ? ' active' : ''}" data-id="${m.id}">${m.name}</div>`
  ).join('');
  modelDropdown.classList.remove('hidden');

  modelDropdown.querySelectorAll('.model-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = opt.dataset.id;
      modelDropdown.classList.add('hidden');
      if (id !== currentModel && currentConversationId) {
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
  if (!currentConversationId) return;
  currentAutopilot = !currentAutopilot;
  updateModeBadge(currentAutopilot);
  await fetch(`/api/conversations/${currentConversationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autopilot: currentAutopilot }),
  });
});

// --- Stats ---
const statsBtn = document.getElementById('stats-btn');
const statsView = document.getElementById('stats-view');
const statsBackBtn = document.getElementById('stats-back-btn');
const statsContent = document.getElementById('stats-content');

statsBtn.addEventListener('click', () => {
  listView.classList.add('slide-out');
  statsView.classList.add('slide-in');
  loadStats();
});

statsBackBtn.addEventListener('click', () => {
  statsView.classList.remove('slide-in');
  listView.classList.remove('slide-out');
});

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

// --- Mobile virtual keyboard handling ---
// dvh units lag behind the actual visual viewport when the keyboard opens/closes.
// Use visualViewport API to immediately set the correct height.
if (window.visualViewport) {
  const syncViewportHeight = () => {
    document.documentElement.style.setProperty('--app-height', `${window.visualViewport.height}px`);
  };
  window.visualViewport.addEventListener('resize', syncViewportHeight);
  syncViewportHeight();
}

// --- Init ---
connectWS();
loadModels();
loadConversations();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
