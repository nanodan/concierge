// --- Shared state module ---
// This module holds all mutable state that's shared across modules

// Conversations
export let conversations = [];
export let currentConversationId = null;

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
export const MESSAGES_PER_PAGE = 100;
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

// Message queue for offline resilience
export let pendingMessages = JSON.parse(localStorage.getItem('pendingMessages') || '[]');

// Scope grouping collapsed state
export let collapsedScopes = JSON.parse(localStorage.getItem('collapsedScopes') || '{}');

// Unread conversations
export const unreadConversations = new Set(JSON.parse(localStorage.getItem('unreadConversations') || '[]'));

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

export function setThinking(thinking) {
  if (typingIndicator) typingIndicator.classList.toggle('hidden', !thinking);
  if (sendBtn) {
    sendBtn.disabled = thinking;
    sendBtn.classList.toggle('hidden', thinking);
  }
  if (cancelBtn) cancelBtn.classList.toggle('hidden', !thinking);
  if (thinking && messagesContainer) {
    scrollToBottom();
  }
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

export function isNearBottom(threshold = 150) {
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
