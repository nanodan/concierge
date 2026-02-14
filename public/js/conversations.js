// --- Conversation management ---
import { escapeHtml } from './markdown.js';
import { formatTime, setLoading, showToast, showDialog, haptic } from './utils.js';
import { openNewChatModal } from './ui.js';
import { renderMessages } from './render.js';
import * as state from './state.js';

// DOM elements (set by init)
let listView = null;
let chatView = null;
let conversationList = null;
let chatName = null;
let loadMoreBtn = null;
let contextBar = null;
let messageInput = null;
let actionPopup = null;
let actionPopupOverlay = null;
let popupArchiveBtn = null;
let searchInput = null;
let filterRow = null;
let filterModelSelect = null;

export function initConversations(elements) {
  listView = elements.listView;
  chatView = elements.chatView;
  conversationList = elements.conversationList;
  chatName = elements.chatName;
  loadMoreBtn = elements.loadMoreBtn;
  contextBar = elements.contextBar;
  messageInput = elements.messageInput;
  actionPopup = elements.actionPopup;
  actionPopupOverlay = elements.actionPopupOverlay;
  popupArchiveBtn = elements.popupArchiveBtn;
  searchInput = elements.searchInput;
  filterRow = elements.filterRow;
  filterModelSelect = elements.filterModelSelect;
}

export async function loadConversations() {
  const conversations = state.conversations;
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
    const qs = state.getShowingArchived() ? '?archived=true' : '';
    const res = await fetch(`/api/conversations${qs}`);
    const convs = await res.json();
    state.setConversations(convs);
    if (!chatView.classList.contains('slide-in')) {
      renderConversationList();
    }
  } catch (err) {
    console.error('Failed to load conversations:', err);
  } finally {
    setLoading(listView, false);
  }
}

export async function getConversation(id) {
  const res = await fetch(`/api/conversations/${id}`);
  if (!res.ok) return null;
  return res.json();
}

export async function createConversation(name, cwd, autopilot, model) {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, cwd, autopilot, model }),
  });
  const conv = await res.json();
  await loadConversations();
  openConversation(conv.id);
}

export async function deleteConversation(id) {
  await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
  if (state.getCurrentConversationId() === id) {
    showListView();
  }
  await loadConversations();
}

// Soft delete with undo - hides immediately, deletes after timeout unless undone
let pendingDelete = null;

export function softDeleteConversation(id) {
  // Cancel any existing pending delete
  if (pendingDelete) {
    clearTimeout(pendingDelete.timeout);
    pendingDelete.toast?.cancel?.();
  }

  const conv = state.conversations.find(c => c.id === id);
  const convName = conv?.name || 'Conversation';

  // Immediately hide from list by filtering
  state.setConversations(state.conversations.filter(c => c.id !== id));
  renderConversationList();

  if (state.getCurrentConversationId() === id) {
    showListView();
  }

  // Show toast with undo
  const toast = showToast(`"${convName}" deleted`, {
    duration: 5000,
    action: 'Undo',
    onAction: () => {
      // Restore conversation
      if (pendingDelete && pendingDelete.id === id) {
        clearTimeout(pendingDelete.timeout);
        pendingDelete = null;
        loadConversations(); // Reload to restore
        showToast('Restored');
      }
    }
  });

  // Schedule actual deletion
  const timeout = setTimeout(async () => {
    if (pendingDelete && pendingDelete.id === id) {
      await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      pendingDelete = null;
    }
  }, 5000);

  pendingDelete = { id, timeout, toast };
}

export async function archiveConversation(id, archived) {
  await fetch(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived }),
  });
  await loadConversations();
}

export async function renameConversation(id, name) {
  await fetch(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  await loadConversations();
}

export async function pinConversation(id, pinned) {
  await fetch(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned }),
  });
  await loadConversations();
}

export async function forkConversation(fromMessageIndex) {
  const currentConversationId = state.getCurrentConversationId();
  if (!currentConversationId) return;
  try {
    const res = await fetch(`/api/conversations/${currentConversationId}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromMessageIndex }),
    });
    if (!res.ok) { showToast('Fork failed', { variant: 'error' }); return; }
    const conv = await res.json();
    showToast('Forked conversation');
    await loadConversations();
    openConversation(conv.id);
  } catch (_err) {
    showToast('Fork failed', { variant: 'error' });
  }
}

export async function searchConversations(query, filters = {}) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.model) params.set('model', filters.model);
  const res = await fetch(`/api/conversations/search?${params}`);
  return res.json();
}

function truncate(text, len) {
  if (!text) return '';
  return text.length > len ? text.slice(0, len) + '...' : text;
}

export function renderConversationList(items) {
  const list = items || state.conversations;
  const isSearch = !!items;
  const showingArchived = state.getShowingArchived();
  const collapsedScopes = state.getCollapsedScopes();

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

  // Group by cwd (scope) unless searching
  const groups = new Map();
  for (const c of list) {
    const scope = c.cwd || 'Unknown';
    if (!groups.has(scope)) groups.set(scope, []);
    groups.get(scope).push(c);
  }

  const showCwdOnCards = isSearch; // Only show cwd on individual cards during search

  function renderCard(c) {
    const preview = c.lastMessage
      ? truncate(c.lastMessage.text, 60)
      : 'No messages yet';
    const time = c.lastMessage
      ? formatTime(c.lastMessage.timestamp)
      : formatTime(c.createdAt);

    let matchHtml = '';
    if (c.matchingMessages && c.matchingMessages.length > 0) {
      const snippet = truncate(c.matchingMessages[0].text, 80);
      matchHtml = `<div class="conv-card-match">${escapeHtml(snippet)}</div>`;
    }

    const cwdHtml = showCwdOnCards && c.cwd
      ? `<div class="conv-card-cwd">${escapeHtml(c.cwd.replace(/^\/Users\/[^/]+/, '~'))}</div>`
      : '';

    const archiveLabel = c.archived ? 'Unarchive' : 'Archive';
    const archiveBtnClass = c.archived ? 'unarchive-btn' : 'archive-btn';
    const isUnread = state.hasUnread(c.id);
    const isSelected = state.getSelectedConversations().has(c.id);
    const isPinned = c.pinned;
    const pinIcon = isPinned ? '<svg class="pin-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>' : '';
    return `
      <div class="conv-card-wrapper${isPinned ? ' pinned' : ''}">
        <div class="swipe-actions">
          <button class="swipe-action-btn ${archiveBtnClass}" data-id="${c.id}" data-action="archive">${archiveLabel}</button>
          <button class="swipe-action-btn delete-action-btn" data-id="${c.id}" data-action="delete">Delete</button>
        </div>
        <div class="conv-card${isSelected ? ' selected' : ''}" data-id="${c.id}">
          <div class="conv-card-select">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div class="conv-card-content">
            <div class="conv-card-top">
              ${isUnread ? '<span class="unread-dot"></span>' : ''}${pinIcon}<span class="conv-card-name">${escapeHtml(c.name)}</span>
              <span class="conv-card-time">${time}</span>
            </div>
            <div class="conv-card-preview">${escapeHtml(preview)}</div>
            ${matchHtml}
            ${cwdHtml}
          </div>
        </div>
      </div>
    `;
  }

  // Search: flat list without headers
  if (isSearch) {
    conversationList.innerHTML = list.map(renderCard).join('');
  } else {
    // Always show scope headers (even with single folder)
    const shortPath = (p) => p.replace(/^\/Users\/[^/]+/, '~');
    conversationList.innerHTML = Array.from(groups.entries()).map(([scope, convs]) => {
      const collapsed = collapsedScopes[scope];
      return `
        <div class="scope-group" data-scope="${escapeHtml(scope)}">
          <div class="scope-header-row">
            <button class="scope-header${collapsed ? ' collapsed' : ''}">
              <span class="scope-chevron">${collapsed ? '&#x25B6;' : '&#x25BC;'}</span>
              <span class="scope-path">${escapeHtml(shortPath(scope))}</span>
              <span class="scope-count">${convs.length}</span>
            </button>
            <button class="scope-add-btn" data-scope="${escapeHtml(scope)}" aria-label="New chat in this folder">+</button>
          </div>
          <div class="scope-items${collapsed ? ' hidden' : ''}">
            ${convs.map(renderCard).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Scope toggle handlers
    conversationList.querySelectorAll('.scope-header').forEach(header => {
      header.addEventListener('click', () => {
        const group = header.closest('.scope-group');
        const scope = group.dataset.scope;
        const items = group.querySelector('.scope-items');
        const isCollapsed = items.classList.toggle('hidden');
        header.classList.toggle('collapsed', isCollapsed);
        header.querySelector('.scope-chevron').innerHTML = isCollapsed ? '&#x25B6;' : '&#x25BC;';
        state.toggleCollapsedScope(scope, isCollapsed);
      });
    });

    // Scope add button handlers
    conversationList.querySelectorAll('.scope-add-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const scope = btn.dataset.scope;
        openNewChatModal(scope);
      });
    });
  }

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
    card.addEventListener('click', (_e) => {
      // Don't navigate if card is swiped open
      if (Math.abs(parseFloat(card.style.transform?.replace(/[^0-9.-]/g, '') || 0)) > 10) return;

      // Handle selection mode
      if (state.getSelectionMode()) {
        const isSelected = state.toggleSelectedConversation(id);
        card.classList.toggle('selected', isSelected);
        updateBulkSelectionCount();
        return;
      }

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
        softDeleteConversation(id);
      } else if (action === 'archive') {
        const conv = state.conversations.find(c => c.id === id);
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
    const activeSwipeCard = state.getActiveSwipeCard();
    if (activeSwipeCard && activeSwipeCard !== card) {
      resetSwipe(activeSwipeCard);
      state.setActiveSwipeCard(null);
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
      state.setActiveSwipeCard(card);
      haptic(10);
    } else {
      // Snap closed
      card.style.transform = 'translateX(0)';
      if (state.getActiveSwipeCard() === card) state.setActiveSwipeCard(null);
    }
  }, { passive: true });
}

function resetSwipe(card) {
  card.style.transform = 'translateX(0)';
}

export { resetSwipe };

// --- Long-press handling ---
function setupLongPress(card, id) {
  card.addEventListener('touchstart', (e) => {
    state.setLongPressTarget(id);
    state.setLongPressTimer(setTimeout(() => {
      haptic(15);
      showActionPopup(e.touches[0].clientX, e.touches[0].clientY, id);
    }, 500));
  }, { passive: true });

  card.addEventListener('touchmove', () => {
    state.clearLongPressTimer();
  }, { passive: true });

  card.addEventListener('touchend', () => {
    state.clearLongPressTimer();
  }, { passive: true });
}

function showActionPopup(x, y, id) {
  state.setLongPressTarget(id);
  const conv = state.conversations.find(c => c.id === id);
  popupArchiveBtn.textContent = conv?.archived ? 'Unarchive' : 'Archive';
  const popupPinBtn = document.getElementById('popup-pin-btn');
  if (popupPinBtn) popupPinBtn.textContent = conv?.pinned ? 'Unpin' : 'Pin';

  // Position popup near touch point
  actionPopup.style.left = Math.min(x, window.innerWidth - 180) + 'px';
  actionPopup.style.top = Math.min(y, window.innerHeight - 160) + 'px';
  actionPopup.classList.remove('hidden');
  actionPopupOverlay.classList.remove('hidden');
}

export function hideActionPopup() {
  actionPopup.classList.add('hidden');
  actionPopupOverlay.classList.add('hidden');
  state.setLongPressTarget(null);
}

export function setupActionPopupHandlers(hideMsgActionPopup) {
  actionPopupOverlay.addEventListener('click', () => {
    hideActionPopup();
    hideMsgActionPopup();
  });

  actionPopup.querySelectorAll('.action-popup-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const id = state.getLongPressTarget();
      hideActionPopup();
      if (!id) return;

      if (action === 'pin') {
        const conv = state.conversations.find(c => c.id === id);
        pinConversation(id, !conv?.pinned);
        showToast(conv?.pinned ? 'Conversation unpinned' : 'Conversation pinned');
      } else if (action === 'archive') {
        const conv = state.conversations.find(c => c.id === id);
        archiveConversation(id, !conv?.archived);
        showToast(conv?.archived ? 'Conversation unarchived' : 'Conversation archived');
      } else if (action === 'delete') {
        softDeleteConversation(id);
      } else if (action === 'rename') {
        const conv = state.conversations.find(c => c.id === id);
        const newName = await showDialog({ title: 'Rename conversation', input: true, defaultValue: conv?.name || '', placeholder: 'Conversation name', confirmLabel: 'Rename' });
        if (newName && newName.trim()) {
          renameConversation(id, newName.trim());
        }
      } else if (action === 'branches') {
        const { showBranchesView, loadBranchesTree } = await import('./branches.js');
        showBranchesView();
        loadBranchesTree(id);
      }
    });
  });
}

// --- Search ---
function getSearchFilters() {
  const filters = {};
  if (!filterRow || filterRow.classList.contains('hidden')) return filters;
  const activeChip = filterRow.querySelector('.filter-chip.active');
  if (activeChip && activeChip.dataset.days) {
    const days = parseInt(activeChip.dataset.days);
    const from = new Date();
    from.setDate(from.getDate() - days);
    filters.dateFrom = from.toISOString();
  }
  if (filterModelSelect && filterModelSelect.value) {
    filters.model = filterModelSelect.value;
  }
  return filters;
}

export function triggerSearch() {
  state.clearSearchDebounceTimer();
  const q = searchInput.value.trim();
  const filters = getSearchFilters();
  const hasFilters = filters.dateFrom || filters.model;
  if (!q && !hasFilters) {
    renderConversationList();
    return;
  }
  state.setSearchDebounceTimer(setTimeout(async () => {
    const results = await searchConversations(q, filters);
    renderConversationList(results);
  }, 250));
}

export async function openConversation(id) {
  state.setCurrentConversationId(id);
  state.deleteUnread(id);
  setLoading(chatView, true);
  const conv = await getConversation(id);
  setLoading(chatView, false);

  if (!conv) {
    await loadConversations();
    return;
  }

  chatName.textContent = conv.name;
  state.updateStatusDot(conv.status);

  state.setCurrentModel(conv.model || 'sonnet');
  state.setCurrentAutopilot(conv.autopilot !== false);

  // Import UI functions dynamically to avoid circular dependency
  const ui = await import('./ui.js');
  ui.updateModelBadge(state.getCurrentModel());
  ui.updateModeBadge(state.getCurrentAutopilot());

  renderMessages(conv.messages);
  showChatView();

  // Update context bar from last assistant message with tokens
  const lastAssistant = [...conv.messages].reverse().find(m => m.role === 'assistant' && m.inputTokens);
  if (lastAssistant) {
    ui.updateContextBar(lastAssistant.inputTokens, lastAssistant.outputTokens, state.getCurrentModel());
  } else {
    contextBar.classList.add('hidden');
  }

  state.setThinking(conv.status === 'thinking');
}

export function showChatView() {
  listView.classList.add('slide-out');
  chatView.classList.add('slide-in');
  // Don't auto-focus on touch devices — keyboard opening during slide-in is disruptive
  if (!('ontouchstart' in window)) {
    messageInput.focus({ preventScroll: true });
  }
}

export function showListView() {
  chatView.classList.remove('slide-in');
  listView.classList.remove('slide-out');
  document.querySelector('.views-container').scrollLeft = 0;
  state.setCurrentConversationId(null);
  state.resetStreamingState();
  const jumpToBottomBtn = state.getJumpToBottomBtn();
  if (jumpToBottomBtn) jumpToBottomBtn.classList.remove('visible');
  if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
  loadConversations();
}

// --- Bulk Selection ---
export function enterSelectionMode() {
  state.setSelectionMode(true);
  listView.classList.add('selection-mode');
  document.getElementById('bulk-action-bar')?.classList.remove('hidden');
  document.getElementById('select-mode-btn')?.classList.add('active');
  updateBulkSelectionCount();
}

export function exitSelectionMode() {
  state.setSelectionMode(false);
  listView.classList.remove('selection-mode');
  document.getElementById('bulk-action-bar')?.classList.add('hidden');
  document.getElementById('select-mode-btn')?.classList.remove('active');
  // Remove selected class from all cards
  conversationList.querySelectorAll('.conv-card.selected').forEach(card => {
    card.classList.remove('selected');
  });
}

export function updateBulkSelectionCount() {
  const count = state.getSelectedConversations().size;
  const countEl = document.getElementById('bulk-count');
  if (countEl) {
    countEl.textContent = count === 1 ? '1 selected' : `${count} selected`;
  }
  // Disable action buttons if nothing selected
  const archiveBtn = document.getElementById('bulk-archive-btn');
  const deleteBtn = document.getElementById('bulk-delete-btn');
  if (archiveBtn) archiveBtn.disabled = count === 0;
  if (deleteBtn) deleteBtn.disabled = count === 0;
}

export function selectAllConversations() {
  const showingArchived = state.getShowingArchived();
  const visibleConvs = state.conversations.filter(c => showingArchived ? c.archived : !c.archived);
  const ids = visibleConvs.map(c => c.id);
  state.selectAllConversations(ids);
  // Update UI
  conversationList.querySelectorAll('.conv-card').forEach(card => {
    if (ids.includes(card.dataset.id)) {
      card.classList.add('selected');
    }
  });
  updateBulkSelectionCount();
}

export async function bulkArchive() {
  const selected = Array.from(state.getSelectedConversations());
  if (selected.length === 0) return;

  const showingArchived = state.getShowingArchived();
  const action = showingArchived ? 'unarchive' : 'archive';
  const ok = await showDialog({
    title: `${showingArchived ? 'Unarchive' : 'Archive'} ${selected.length} conversation${selected.length > 1 ? 's' : ''}?`,
    confirmLabel: showingArchived ? 'Unarchive' : 'Archive'
  });
  if (!ok) return;

  for (const id of selected) {
    await archiveConversation(id, !showingArchived);
  }
  showToast(`${selected.length} conversation${selected.length > 1 ? 's' : ''} ${action}d`);
  exitSelectionMode();
  loadConversations();
}

export async function bulkDelete() {
  const selected = Array.from(state.getSelectedConversations());
  if (selected.length === 0) return;

  const ok = await showDialog({
    title: `Delete ${selected.length} conversation${selected.length > 1 ? 's' : ''}?`,
    message: 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true
  });
  if (!ok) return;

  for (const id of selected) {
    await deleteConversation(id);
  }
  showToast(`${selected.length} conversation${selected.length > 1 ? 's' : ''} deleted`);
  exitSelectionMode();
  loadConversations();
}
