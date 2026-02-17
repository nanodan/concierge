// --- Shared state module ---
// This module holds all mutable state that's shared across modules
import {
  MESSAGES_PER_PAGE as MESSAGES_PER_PAGE_CONST,
  SCROLL_NEAR_BOTTOM_THRESHOLD,
  THINKING_TEXT_TRUNCATE,
} from './constants.js';

// Conversations
export let conversations = [];
export let currentConversationId = null;

// Memory system
export let memoryEnabled = localStorage.getItem('memoryEnabled') !== 'false'; // Global toggle
export let memories = []; // Current project's memories

// Compression prompt state (reset per conversation)
export let compressionPromptShown = false;

// Models
export let models = [];
export let currentModel = 'sonnet';
export let currentAutopilot = true;

// Streaming state
export let streamingMessageEl = null;
export let streamingText = '';
export let pendingDelta = '';
export let renderScheduled = false;
export let isStreaming = false;
export let userHasScrolledUp = false;

// Virtual scrolling
export const MESSAGES_PER_PAGE = MESSAGES_PER_PAGE_CONST;
export let allMessages = [];
export let messagesOffset = 0;

// UI state
export let showingArchived = false;
export let activeSwipeCard = null;
export let recognition = null;
export let isRecording = false;
export let currentTTSBtn = null;

// Theme (light/dark/auto)
export let currentTheme = localStorage.getItem('theme') || 'auto';

// Color theme (darjeeling, claude, etc.)
export let currentColorTheme = localStorage.getItem('colorTheme') || 'darjeeling';

// Notifications preference (true by default)
export let notificationsEnabled = localStorage.getItem('notificationsEnabled') !== 'false';

// Original document title (for restoration)
let originalTitle = document.title;
let titleModified = false;

// Message queue for offline resilience
export let pendingMessages = JSON.parse(localStorage.getItem('pendingMessages') || '[]');

// Scope grouping collapsed state
export let collapsedScopes = JSON.parse(localStorage.getItem('collapsedScopes') || '{}');

// Fork stack expanded state (Set of root IDs)
export let expandedStacks = new Set(JSON.parse(localStorage.getItem('expandedStacks') || '[]'));

// Unread conversations
export const unreadConversations = new Set(JSON.parse(localStorage.getItem('unreadConversations') || '[]'));

// Thinking conversations (which are currently processing)
export const thinkingConversations = new Set();

// Message reactions
export let messageReactions = JSON.parse(localStorage.getItem('messageReactions') || '{}');

// Long press
export let longPressTimer = null;
export let longPressTarget = null;

// Selection mode
export let selectionMode = false;
export let selectedConversations = new Set();

// Search
export let searchDebounceTimer = null;

// Pending attachments
export let pendingAttachments = [];

// Directory browser
export let currentBrowsePath = '';

// DOM elements (set by init)
export let elements = {};

// --- State setters ---
export function setConversations(convs) {
  conversations = convs;
}

export function setCurrentConversationId(id) {
  currentConversationId = id;
}

export function getCurrentConversationId() {
  return currentConversationId;
}

export function setModels(m) {
  models = m;
}

export function getModels() {
  return models;
}

export function setCurrentModel(m) {
  currentModel = m;
}

export function getCurrentModel() {
  return currentModel;
}

export function setCurrentAutopilot(a) {
  currentAutopilot = a;
}

export function getCurrentAutopilot() {
  return currentAutopilot;
}

export function setStreamingMessageEl(el) {
  streamingMessageEl = el;
}

export function getStreamingMessageEl() {
  return streamingMessageEl;
}

export function setStreamingText(text) {
  streamingText = text;
}

export function getStreamingText() {
  return streamingText;
}

export function appendStreamingText(text) {
  streamingText += text;
}

export function setPendingDelta(delta) {
  pendingDelta = delta;
}

export function getPendingDelta() {
  return pendingDelta;
}

export function appendPendingDelta(text) {
  pendingDelta += text;
}

export function setRenderScheduled(scheduled) {
  renderScheduled = scheduled;
}

export function getRenderScheduled() {
  return renderScheduled;
}

export function setIsStreaming(streaming) {
  isStreaming = streaming;
}

export function getIsStreaming() {
  return isStreaming;
}

export function setUserHasScrolledUp(scrolled) {
  userHasScrolledUp = scrolled;
}

export function getUserHasScrolledUp() {
  return userHasScrolledUp;
}

export function setAllMessages(messages) {
  allMessages = messages;
}

export function getAllMessages() {
  return allMessages;
}

export function setMessagesOffset(offset) {
  messagesOffset = offset;
}

export function getMessagesOffset() {
  return messagesOffset;
}

export function setShowingArchived(showing) {
  showingArchived = showing;
}

export function getShowingArchived() {
  return showingArchived;
}

export function setActiveSwipeCard(card) {
  activeSwipeCard = card;
}

export function getActiveSwipeCard() {
  return activeSwipeCard;
}

export function setRecognition(rec) {
  recognition = rec;
}

export function getRecognition() {
  return recognition;
}

export function setIsRecording(recording) {
  isRecording = recording;
}

export function getIsRecording() {
  return isRecording;
}

export function setCurrentTTSBtn(btn) {
  currentTTSBtn = btn;
}

export function getCurrentTTSBtn() {
  return currentTTSBtn;
}

export function setCurrentTheme(theme) {
  currentTheme = theme;
  localStorage.setItem('theme', theme);
}

export function getCurrentTheme() {
  return currentTheme;
}

export function setCurrentColorTheme(theme) {
  currentColorTheme = theme;
  localStorage.setItem('colorTheme', theme);
}

export function getCurrentColorTheme() {
  return currentColorTheme;
}

export function setNotificationsEnabled(enabled) {
  notificationsEnabled = enabled;
  localStorage.setItem('notificationsEnabled', enabled ? 'true' : 'false');
}

export function getNotificationsEnabled() {
  return notificationsEnabled;
}

// Request notification permission
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

// Show completion notification when tab is hidden
export function notifyCompletion(conversationName) {
  if (!notificationsEnabled) return;

  // Always update title when tab is hidden (works even when notifications are blocked)
  if (document.hidden && !titleModified) {
    originalTitle = document.title;
    document.title = '✓ ' + originalTitle;
    titleModified = true;
  }

  // Try native notification (works even when tab is visible, will queue)
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const notification = new Notification('Response complete', {
        body: conversationName ? `"${conversationName}" finished` : 'Claude has responded',
        tag: 'claude-response',
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (err) {
      console.warn('Notification failed:', err);
    }
  }
}

// Restore title when tab becomes visible
export function clearTitleNotification() {
  if (titleModified) {
    document.title = originalTitle;
    titleModified = false;
  }
}

export function getPendingMessages() {
  return pendingMessages;
}

export function addPendingMessage(msg) {
  pendingMessages.push(msg);
  localStorage.setItem('pendingMessages', JSON.stringify(pendingMessages));
}

export function clearPendingMessages() {
  pendingMessages = [];
  localStorage.setItem('pendingMessages', JSON.stringify(pendingMessages));
}

export function setCollapsedScopes(scopes) {
  collapsedScopes = scopes;
  localStorage.setItem('collapsedScopes', JSON.stringify(collapsedScopes));
}

export function getCollapsedScopes() {
  return collapsedScopes;
}

export function toggleCollapsedScope(scope, isCollapsed) {
  collapsedScopes[scope] = isCollapsed;
  localStorage.setItem('collapsedScopes', JSON.stringify(collapsedScopes));
}

export function isStackExpanded(rootId) {
  return expandedStacks.has(rootId);
}

export function toggleExpandedStack(rootId) {
  if (expandedStacks.has(rootId)) {
    expandedStacks.delete(rootId);
  } else {
    expandedStacks.add(rootId);
  }
  localStorage.setItem('expandedStacks', JSON.stringify([...expandedStacks]));
  return expandedStacks.has(rootId);
}

export function setStackExpanded(rootId, expanded) {
  if (expanded) {
    expandedStacks.add(rootId);
  } else {
    expandedStacks.delete(rootId);
  }
  localStorage.setItem('expandedStacks', JSON.stringify([...expandedStacks]));
}

/**
 * Get all unique scopes (cwd paths) from conversations.
 * @returns {string[]} - Array of unique scope paths
 */
export function getAllScopes() {
  return [...new Set(conversations.map(c => c.cwd || 'Unknown'))];
}

/**
 * Collapse all scope groups and fork stacks.
 * @param {string[]} scopes - Array of scope paths to collapse
 */
export function collapseAll(scopes) {
  // Collapse all scopes
  for (const scope of scopes) {
    collapsedScopes[scope] = true;
  }
  localStorage.setItem('collapsedScopes', JSON.stringify(collapsedScopes));
  // Collapse all expanded stacks
  expandedStacks.clear();
  localStorage.setItem('expandedStacks', JSON.stringify([]));
}

/**
 * Expand all scope groups.
 * @param {string[]} scopes - Array of scope paths to expand
 */
export function expandAll(scopes) {
  // Expand all scopes
  for (const scope of scopes) {
    delete collapsedScopes[scope];
  }
  localStorage.setItem('collapsedScopes', JSON.stringify(collapsedScopes));
  // Note: fork stacks stay collapsed by default (only expand on explicit user click)
}

/**
 * Check if all scopes are collapsed.
 * @param {string[]} scopes - Array of scope paths to check
 * @returns {boolean}
 */
export function areAllCollapsed(scopes) {
  if (scopes.length === 0) return false;
  // If any scope is expanded, return false
  for (const scope of scopes) {
    if (!collapsedScopes[scope]) return false;
  }
  // Also check if any stacks are expanded
  if (expandedStacks.size > 0) return false;
  return true;
}

export function addUnread(id) {
  unreadConversations.add(id);
  localStorage.setItem('unreadConversations', JSON.stringify([...unreadConversations]));
}

export function deleteUnread(id) {
  unreadConversations.delete(id);
  localStorage.setItem('unreadConversations', JSON.stringify([...unreadConversations]));
}

export function hasUnread(id) {
  return unreadConversations.has(id);
}

export function addThinking(id) {
  thinkingConversations.add(id);
}

export function removeThinking(id) {
  thinkingConversations.delete(id);
}

export function isThinking(id) {
  return thinkingConversations.has(id);
}

export function setMessageReactions(reactions) {
  messageReactions = reactions;
  localStorage.setItem('messageReactions', JSON.stringify(messageReactions));
}

export function getMessageReactions() {
  return messageReactions;
}

export function setLongPressTimer(timer) {
  longPressTimer = timer;
}

export function getLongPressTimer() {
  return longPressTimer;
}

export function clearLongPressTimer() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
}

export function setLongPressTarget(target) {
  longPressTarget = target;
}

export function getLongPressTarget() {
  return longPressTarget;
}

export function setSelectionMode(mode) {
  selectionMode = mode;
  if (!mode) {
    selectedConversations.clear();
  }
}

export function getSelectionMode() {
  return selectionMode;
}

export function toggleSelectedConversation(id) {
  if (selectedConversations.has(id)) {
    selectedConversations.delete(id);
  } else {
    selectedConversations.add(id);
  }
  return selectedConversations.has(id);
}

export function getSelectedConversations() {
  return selectedConversations;
}

export function selectAllConversations(ids) {
  ids.forEach(id => selectedConversations.add(id));
}

export function clearSelectedConversations() {
  selectedConversations.clear();
}

export function setSearchDebounceTimer(timer) {
  searchDebounceTimer = timer;
}

export function getSearchDebounceTimer() {
  return searchDebounceTimer;
}

export function clearSearchDebounceTimer() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = null;
}

export function setPendingAttachments(attachments) {
  pendingAttachments = attachments;
}

export function getPendingAttachments() {
  return pendingAttachments;
}

export function addPendingAttachment(att) {
  pendingAttachments.push(att);
}

export function removePendingAttachment(idx) {
  if (pendingAttachments[idx]?.previewUrl) {
    URL.revokeObjectURL(pendingAttachments[idx].previewUrl);
  }
  pendingAttachments.splice(idx, 1);
}

export function clearPendingAttachments() {
  pendingAttachments.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
  pendingAttachments = [];
}

export function setCurrentBrowsePath(path) {
  currentBrowsePath = path;
}

export function getCurrentBrowsePath() {
  return currentBrowsePath;
}

export function setElements(els) {
  elements = els;
}

export function getElements() {
  return elements;
}

// --- Status and thinking state (needs DOM elements) ---
let typingIndicator = null;
let sendBtn = null;
let cancelBtn = null;
let chatStatus = null;
let messagesContainer = null;
let jumpToBottomBtn = null;
let loadMoreBtn = null;

export function initStatusElements(els) {
  typingIndicator = els.typingIndicator;
  sendBtn = els.sendBtn;
  cancelBtn = els.cancelBtn;
  chatStatus = els.chatStatus;
  messagesContainer = els.messagesContainer;
  jumpToBottomBtn = els.jumpToBottomBtn;
  loadMoreBtn = els.loadMoreBtn;
}

export function getMessagesContainer() {
  return messagesContainer;
}

export function getJumpToBottomBtn() {
  return jumpToBottomBtn;
}

export function getLoadMoreBtn() {
  return loadMoreBtn;
}

// Thinking timer state
let thinkingStartTime = null;
let lastActivityTime = null;
let thinkingTimerInterval = null;
const STALE_THRESHOLD = 30000; // 30 seconds without activity

function formatElapsed(ms) {
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
}

function updateThinkingTimer() {
  if (!typingIndicator || !thinkingStartTime) return;
  const timerEl = typingIndicator.querySelector('.typing-timer');
  if (!timerEl) return;

  const elapsed = Date.now() - thinkingStartTime;
  const sinceLastActivity = lastActivityTime ? Date.now() - lastActivityTime : 0;

  if (sinceLastActivity > STALE_THRESHOLD) {
    timerEl.textContent = `${formatElapsed(elapsed)} (no activity ${formatElapsed(sinceLastActivity)})`;
    timerEl.classList.add('stale');
  } else {
    timerEl.textContent = formatElapsed(elapsed);
    timerEl.classList.remove('stale');
  }
}

export function recordActivity() {
  lastActivityTime = Date.now();
}

export function setThinking(thinking) {
  if (typingIndicator) {
    typingIndicator.classList.toggle('hidden', !thinking);
    // Reset status text and timer when stopping
    if (!thinking) {
      const statusEl = typingIndicator.querySelector('.typing-status');
      if (statusEl) statusEl.textContent = '';
      const timerEl = typingIndicator.querySelector('.typing-timer');
      if (timerEl) {
        timerEl.textContent = '';
        timerEl.classList.remove('stale');
      }
      // Clear timer
      if (thinkingTimerInterval) {
        clearInterval(thinkingTimerInterval);
        thinkingTimerInterval = null;
      }
      thinkingStartTime = null;
      lastActivityTime = null;
    } else {
      // Start timer
      thinkingStartTime = Date.now();
      lastActivityTime = Date.now();
      updateThinkingTimer();
      thinkingTimerInterval = setInterval(updateThinkingTimer, 1000);
    }
  }
  if (sendBtn) {
    sendBtn.disabled = thinking;
    sendBtn.classList.toggle('hidden', thinking);
  }
  if (cancelBtn) cancelBtn.classList.toggle('hidden', !thinking);
  if (thinking && messagesContainer) {
    scrollToBottom();
  }
}

export function updateToolStatus(toolName) {
  if (!typingIndicator) return;
  let statusEl = typingIndicator.querySelector('.typing-status');
  if (!statusEl) {
    statusEl = document.createElement('span');
    statusEl.className = 'typing-status';
    typingIndicator.appendChild(statusEl);
  }
  // Format tool name nicely
  const toolLabels = {
    'Read': 'Reading file...',
    'Write': 'Writing file...',
    'Edit': 'Editing file...',
    'Bash': 'Running command...',
    'Glob': 'Searching files...',
    'Grep': 'Searching code...',
    'WebFetch': 'Fetching URL...',
    'WebSearch': 'Searching web...',
    'Task': 'Running task...',
  };
  statusEl.textContent = toolLabels[toolName] || `Using ${toolName}...`;
}

export function updateThinkingText(text) {
  if (!typingIndicator) return;
  let statusEl = typingIndicator.querySelector('.typing-status');
  if (!statusEl) {
    statusEl = document.createElement('span');
    statusEl.className = 'typing-status';
    typingIndicator.appendChild(statusEl);
  }
  // Show truncated thinking text
  const truncated = text.length > THINKING_TEXT_TRUNCATE ? text.slice(-THINKING_TEXT_TRUNCATE) + '...' : text;
  statusEl.textContent = truncated;
}

export function clearToolStatus() {
  if (!typingIndicator) return;
  const statusEl = typingIndicator.querySelector('.typing-status');
  if (statusEl) statusEl.textContent = '';
}

export function updateStatus(conversationId, status) {
  if (conversationId === currentConversationId) {
    updateStatusDot(status);
    setThinking(status === 'thinking');
  }
}

export function updateStatusDot(status) {
  if (chatStatus) chatStatus.className = 'status-dot ' + (status || 'idle');
}

export function showError(error) {
  if (!messagesContainer) return;
  const el = document.createElement('div');
  el.className = 'message error animate-in';
  el.textContent = error;
  messagesContainer.appendChild(el);
  scrollToBottom();
}

export function isNearBottom(threshold = SCROLL_NEAR_BOTTOM_THRESHOLD) {
  if (!messagesContainer) return true;
  const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
  return scrollHeight - scrollTop - clientHeight < threshold;
}

export function scrollToBottom(force = false) {
  if (!messagesContainer) return;
  if (!force && userHasScrolledUp) return;
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

export function resetStreamingState() {
  streamingMessageEl = null;
  streamingText = '';
  pendingDelta = '';
  renderScheduled = false;
  userHasScrolledUp = false;
  isStreaming = false;
  allMessages = [];
  messagesOffset = 0;
}

// --- Memory state ---

export function setMemoryEnabled(enabled) {
  memoryEnabled = enabled;
  localStorage.setItem('memoryEnabled', enabled ? 'true' : 'false');
}

export function getMemoryEnabled() {
  return memoryEnabled;
}

export function setMemories(mems) {
  memories = mems;
}

export function getMemories() {
  return memories;
}

export function addMemory(memory) {
  memories.push(memory);
}

export function updateMemory(id, updates) {
  const idx = memories.findIndex(m => m.id === id);
  if (idx >= 0) {
    memories[idx] = { ...memories[idx], ...updates };
  }
}

export function removeMemory(id) {
  memories = memories.filter(m => m.id !== id);
}

// --- Compression prompt state ---

export function setCompressionPromptShown(shown) {
  compressionPromptShown = shown;
}

export function getCompressionPromptShown() {
  return compressionPromptShown;
}

export function resetCompressionPromptShown() {
  compressionPromptShown = false;
}
