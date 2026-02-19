// --- Conversation management ---
import { escapeHtml } from './markdown.js';
import { formatTime, setLoading, showToast, showDialog, haptic, apiFetch, truncate } from './utils.js';
import { openNewChatModal } from './ui.js';
import { renderMessages } from './render.js';
import * as state from './state.js';
import {
  SWIPE_THRESHOLD,
  DELETE_UNDO_TIMEOUT,
  LONG_PRESS_DURATION,
  HAPTIC_LIGHT,
} from './constants.js';
import { closeFilePanel } from './file-panel.js';
import { openStandaloneFiles } from './files-standalone.js';

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

  // ESC key handler for collapsing expanded fork stacks
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Only handle if in list view (not chat view)
      if (chatView.classList.contains('slide-in')) return;
      // Find any expanded stacks and collapse them
      const expandedStacks = conversationList?.querySelectorAll('.fork-stack.expanded');
      if (expandedStacks && expandedStacks.length > 0) {
        e.stopPropagation();
        // Collapse all expanded stacks
        expandedStacks.forEach(stack => {
          const rootId = stack.dataset.rootId;
          state.setStackExpanded(rootId, false);
        });
        renderConversationList();
      }
    }
  });
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
  const qs = state.getShowingArchived() ? '?archived=true' : '';
  const res = await apiFetch(`/api/conversations${qs}`);
  setLoading(listView, false);
  if (!res) return;
  const convs = await res.json();
  state.setConversations(convs);
  // Sync thinking state from server
  convs.forEach(c => {
    if (c.status === 'thinking') {
      state.addThinking(c.id);
    } else {
      state.removeThinking(c.id);
    }
  });
  if (!chatView.classList.contains('slide-in')) {
    renderConversationList();
  }
}

export async function getConversation(id) {
  const res = await apiFetch(`/api/conversations/${id}`, { silent: true });
  if (!res) return null;
  return res.json();
}

export async function createConversation(name, cwd, autopilot, model) {
  const res = await apiFetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, cwd, autopilot, model }),
  });
  if (!res) return;
  const conv = await res.json();
  await loadConversations();
  openConversation(conv.id);
}

export async function deleteConversation(id) {
  const res = await apiFetch(`/api/conversations/${id}`, { method: 'DELETE' });
  if (!res) return false;
  if (state.getCurrentConversationId() === id) {
    showListView();
  }
  await loadConversations();
  return true;
}

/**
 * Generic helper to update a conversation via PATCH.
 * @param {string} id - Conversation ID
 * @param {Object} patch - Object with fields to update (e.g., { archived: true })
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
async function updateConversation(id, patch) {
  const res = await apiFetch(`/api/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res) return false;
  await loadConversations();
  return true;
}

// Soft delete with undo - hides immediately, deletes after timeout unless undone
// Use a Map to track multiple pending deletes simultaneously
const pendingDeletes = new Map();

export function softDeleteConversation(id) {
  // Cancel any existing pending delete for this specific conversation
  const existing = pendingDeletes.get(id);
  if (existing) {
    clearTimeout(existing.timeout);
    existing.toast?.cancel?.();
    pendingDeletes.delete(id);
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
    duration: DELETE_UNDO_TIMEOUT,
    action: 'Undo',
    onAction: () => {
      // Restore conversation
      const pending = pendingDeletes.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingDeletes.delete(id);
        loadConversations(); // Reload to restore
        showToast('Restored');
      }
    }
  });

  // Schedule actual deletion
  const timeout = setTimeout(async () => {
    if (pendingDeletes.has(id)) {
      pendingDeletes.delete(id);
      await apiFetch(`/api/conversations/${id}`, { method: 'DELETE', silent: true });
    }
  }, DELETE_UNDO_TIMEOUT);

  pendingDeletes.set(id, { timeout, toast });
}

export async function archiveConversation(id, archived) {
  return updateConversation(id, { archived });
}

export async function renameConversation(id, name) {
  return updateConversation(id, { name });
}

export async function pinConversation(id, pinned) {
  return updateConversation(id, { pinned });
}

export async function forkConversation(fromMessageIndex) {
  const currentConversationId = state.getCurrentConversationId();
  if (!currentConversationId) return;
  const res = await apiFetch(`/api/conversations/${currentConversationId}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromMessageIndex }),
  });
  if (!res) return;
  const conv = await res.json();
  showToast('Forked conversation', { duration: 1500 });
  await loadConversations();
  openConversation(conv.id);
}

export async function searchConversations(query, filters = {}) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.model) params.set('model', filters.model);
  const res = await apiFetch(`/api/conversations/search?${params}`, { silent: true });
  if (!res) return [];
  return res.json();
}

/**
 * Find the root conversation ID by traversing parentId chain.
 * @param {Array} list - Array of conversations
 * @param {string} id - Starting conversation ID
 * @returns {string} - Root conversation ID
 */
function findRootId(list, id) {
  const byId = new Map(list.map(c => [c.id, c]));
  let current = byId.get(id);
  while (current && current.parentId && byId.has(current.parentId)) {
    current = byId.get(current.parentId);
  }
  return current ? current.id : id;
}

/**
 * Build fork families from a list of conversations.
 * Returns a Map of rootId → array of conversations (root + all forks).
 * Standalone conversations (no forks) have a family of size 1.
 * @param {Array} convs - Array of conversations
 * @returns {Map<string, Array>} - Map of rootId → family array
 */
function buildForkFamilies(convs) {
  const families = new Map();
  for (const c of convs) {
    const rootId = findRootId(convs, c.id);
    if (!families.has(rootId)) families.set(rootId, []);
    families.get(rootId).push(c);
  }
  // Sort each family: root first (no parentId), then by createdAt
  for (const [rootId, family] of families) {
    family.sort((a, b) => {
      if (a.id === rootId) return -1;
      if (b.id === rootId) return 1;
      return a.createdAt - b.createdAt;
    });
  }
  return families;
}

export function renderConversationList(items) {
  const list = items || state.conversations;
  const isSearch = !!items;
  const showingArchived = state.getShowingArchived();
  const collapsedScopes = state.getCollapsedScopes();

  if (list.length === 0) {
    let icon, heading, sub;
    if (isSearch) {
      icon = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`;
      heading = 'No matches found';
      sub = '';
    } else if (showingArchived) {
      icon = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/></svg>`;
      heading = 'Archive is empty';
      sub = '';
    } else {
      icon = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`;
      heading = 'Welcome to Concierge';
      sub = `<span class="empty-state-sub">Tap <strong>+</strong> to ring the bell</span>`;
    }
    conversationList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icon}</div>
        <p class="empty-state-heading">${heading}</p>
        ${sub}
        <div class="empty-state-flourish">— ✦ —</div>
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
      ? `<div class="conv-card-cwd">${escapeHtml(c.cwd.replace(/^\/(?:Users|home)\/[^/]+/, '~'))}</div>`
      : '';

    const archiveLabel = c.archived ? 'Unarchive' : 'Archive';
    const archiveBtnClass = c.archived ? 'unarchive-btn' : 'archive-btn';
    const isUnread = state.hasUnread(c.id);
    const isThinking = state.isThinking(c.id);
    const isSelected = state.getSelectedConversations().has(c.id);
    const isPinned = c.pinned;
    const pinIcon = isPinned ? '<svg class="pin-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>' : '';
    const wrapperClasses = [isPinned && 'pinned', isUnread && 'unread'].filter(Boolean).join(' ');
    return `
      <div class="conv-card-wrapper${wrapperClasses ? ' ' + wrapperClasses : ''}">
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
              ${isThinking ? '<span class="thinking-dot"></span>' : ''}${isUnread ? '<span class="unread-dot"></span>' : ''}${pinIcon}<span class="conv-card-name">${escapeHtml(c.name)}</span>
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

  // Render a fork stack (collapsed or expanded)
  function renderStack(rootId, family) {
    // Single conversation - no stack needed
    if (family.length === 1) {
      return renderCard(family[0]);
    }

    const isExpanded = state.isStackExpanded(rootId);
    const mostRecent = family.reduce((a, b) => {
      const aTime = a.lastMessage?.timestamp || a.createdAt;
      const bTime = b.lastMessage?.timestamp || b.createdAt;
      return bTime > aTime ? b : a;
    });
    const forkCount = family.length - 1; // Exclude root from count

    if (isExpanded) {
      // Expanded: show all cards in a grouped container
      // Mark the root card with a label
      const cardsHtml = family.map(c => {
        const cardHtml = renderCard(c);
        if (c.id === rootId) {
          // Inject root label before the closing </div></div>
          return cardHtml.replace(
            /<\/div>\s*<\/div>\s*<\/div>\s*$/,
            '<div class="fork-root-label">root conversation</div></div></div></div>'
          );
        }
        return cardHtml;
      }).join('');

      return `
        <div class="fork-stack expanded" data-root-id="${rootId}">
          <div class="stack-header" data-root-id="${rootId}">
            <span>⑂ Fork family (${family.length})</span>
            <span class="stack-collapse-icon">&times;</span>
          </div>
          ${cardsHtml}
        </div>
      `;
    } else {
      // Collapsed: show most recent card with stack shadow effect
      return `
        <div class="fork-stack" data-root-id="${rootId}">
          ${renderCard(mostRecent)}
          <div class="stack-shadow-1"></div>
          <div class="stack-shadow-2"></div>
          <span class="stack-count">+${forkCount}</span>
        </div>
      `;
    }
  }

  // Render conversations within a scope, grouping forks into stacks
  function renderScopeItems(convs) {
    const families = buildForkFamilies(convs);
    // Sort families by most recent activity (most recent family first)
    const sortedFamilies = Array.from(families.entries()).sort((a, b) => {
      const aRecent = a[1].reduce((max, c) => Math.max(max, c.lastMessage?.timestamp || c.createdAt), 0);
      const bRecent = b[1].reduce((max, c) => Math.max(max, c.lastMessage?.timestamp || c.createdAt), 0);
      return bRecent - aRecent;
    });
    // Pinned conversations should bubble to top
    sortedFamilies.sort((a, b) => {
      const aPinned = a[1].some(c => c.pinned);
      const bPinned = b[1].some(c => c.pinned);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return 0;
    });
    return sortedFamilies.map(([rootId, family]) => renderStack(rootId, family)).join('');
  }

  // Search: flat list without headers
  if (isSearch) {
    conversationList.innerHTML = list.map(renderCard).join('');
  } else {
    // Always show scope headers (even with single folder)
    // Handle both macOS (/Users/) and Linux (/home/) home directories
    const shortPath = (p) => p.replace(/^\/(?:Users|home)\/[^/]+/, '~');
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
            <button class="scope-folder-btn" data-scope="${escapeHtml(scope)}" aria-label="Browse files in this folder">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </button>
            <button class="scope-add-btn" data-scope="${escapeHtml(scope)}" aria-label="New chat in this folder">+</button>
          </div>
          <div class="scope-items${collapsed ? ' hidden' : ''}">
            ${renderScopeItems(convs)}
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

    // Scope folder button handlers
    conversationList.querySelectorAll('.scope-folder-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        haptic();
        btn.blur(); // Remove focus so it doesn't stay highlighted
        const scope = btn.dataset.scope;
        openStandaloneFiles(scope);
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

    // Fork stack handlers - collapsed stacks expand on click
    conversationList.querySelectorAll('.fork-stack:not(.expanded)').forEach(stack => {
      stack.addEventListener('click', (e) => {
        // Don't expand if clicking on a card action (swipe, etc.)
        if (e.target.closest('.swipe-action-btn')) return;
        const rootId = stack.dataset.rootId;
        state.setStackExpanded(rootId, true);
        renderConversationList();
      });
    });

    // Fork stack header handlers - entire header collapses the stack
    conversationList.querySelectorAll('.fork-stack.expanded .stack-header').forEach(header => {
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        const rootId = header.dataset.rootId;
        state.setStackExpanded(rootId, false);
        renderConversationList();
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

      // Don't navigate if inside a collapsed stack (let stack handler expand it)
      const collapsedStack = wrapper.closest('.fork-stack:not(.expanded)');
      if (collapsedStack) return;

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
        const success = await archiveConversation(id, !conv?.archived);
        if (success) {
          showToast(conv?.archived ? 'Conversation unarchived' : 'Conversation archived');
        }
      }
    });
  });

  // Sync collapse/expand all button state
  syncCollapseButtonState();
}

/**
 * Sync the collapse/expand all button state with current scope collapse status.
 * Called at the end of renderConversationList to keep button in sync.
 */
function syncCollapseButtonState() {
  const collapseAllBtn = document.getElementById('collapse-all-btn');
  if (!collapseAllBtn) return;
  const scopes = state.getAllScopes();
  const allCollapsed = state.areAllCollapsed(scopes);
  collapseAllBtn.classList.toggle('active', allCollapsed);
  collapseAllBtn.title = allCollapsed ? 'Expand all' : 'Collapse all';
  collapseAllBtn.setAttribute('aria-label', allCollapsed ? 'Expand all' : 'Collapse all');
}

// --- Swipe gesture handling ---
function setupSwipe(wrapper, card) {
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let swiping = false;
  let directionLocked = false;
  let isHorizontal = false;
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

    if (currentX < -SWIPE_THRESHOLD) {
      // Snap open
      card.style.transform = `translateX(-${ACTION_WIDTH}px)`;
      state.setActiveSwipeCard(card);
      haptic(HAPTIC_LIGHT);
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
    }, LONG_PRESS_DURATION));
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

  // Show popup off-screen first to measure its size
  actionPopup.style.visibility = 'hidden';
  actionPopup.classList.remove('hidden');

  const popupWidth = actionPopup.offsetWidth || 160;
  const popupHeight = actionPopup.offsetHeight || 220;
  const padding = 12;

  // Horizontal: keep within viewport
  let left = Math.min(x, window.innerWidth - popupWidth - padding);
  left = Math.max(padding, left);

  // Vertical: prefer below touch point, but flip above if not enough room
  let top;
  const spaceBelow = window.innerHeight - y - padding;
  const spaceAbove = y - padding;

  if (spaceBelow >= popupHeight) {
    // Enough room below
    top = y;
  } else if (spaceAbove >= popupHeight) {
    // Position above the touch point
    top = y - popupHeight;
  } else {
    // Not enough room either way, position at bottom of viewport
    top = window.innerHeight - popupHeight - padding;
  }

  actionPopup.style.left = left + 'px';
  actionPopup.style.top = top + 'px';
  actionPopup.style.visibility = '';
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
        const success = await pinConversation(id, !conv?.pinned);
        if (success) {
          showToast(conv?.pinned ? 'Conversation unpinned' : 'Conversation pinned');
        }
      } else if (action === 'archive') {
        const conv = state.conversations.find(c => c.id === id);
        const success = await archiveConversation(id, !conv?.archived);
        if (success) {
          showToast(conv?.archived ? 'Conversation unarchived' : 'Conversation archived');
        }
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
  // Close file panel when switching conversations
  closeFilePanel();
  state.setCurrentConversationId(id);
  state.deleteUnread(id);
  // Clear any text from previous conversation
  if (messageInput) messageInput.value = '';
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
  ui.updateMemoryIndicator(conv.useMemory);

  renderMessages(conv.messages);
  showChatView();

  // Update context bar with cumulative tokens from all messages
  const { inputTokens, outputTokens } = ui.calculateCumulativeTokens(conv.messages);
  if (inputTokens > 0 || outputTokens > 0) {
    ui.updateContextBar(inputTokens, outputTokens, state.getCurrentModel());
  } else {
    contextBar.classList.add('hidden');
  }

  state.setThinking(conv.status === 'thinking', conv.thinkingStartTime);
}

export function showChatView() {
  listView.classList.add('slide-out');
  chatView.classList.add('slide-in');
  // Don't auto-focus on touch devices — keyboard opening during slide-in is disruptive
  if (!('ontouchstart' in window)) {
    messageInput.focus({ preventScroll: true });
  }
  // Push history state so Android back button works
  const convId = state.getCurrentConversationId();
  if (convId && (!history.state || history.state.view !== 'chat')) {
    history.pushState({ view: 'chat', conversationId: convId }, '', `#${convId}`);
  }
}

export function showListView(skipHistoryUpdate = false) {
  chatView.classList.remove('slide-in');
  listView.classList.remove('slide-out');
  document.querySelector('.views-container').scrollLeft = 0;
  state.setCurrentConversationId(null);
  state.resetStreamingState();
  const jumpToBottomBtn = state.getJumpToBottomBtn();
  if (jumpToBottomBtn) jumpToBottomBtn.classList.remove('visible');
  if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
  loadConversations();
  // Update history (unless triggered by popstate)
  if (!skipHistoryUpdate && history.state?.view === 'chat') {
    history.pushState({ view: 'list' }, '', '#');
  }
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
