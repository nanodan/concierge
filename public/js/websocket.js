// --- WebSocket connection management ---
import { showToast } from './utils.js';
import { appendDelta, finalizeMessage, renderMessages } from './render.js';
import { loadConversations } from './conversations.js';
import * as state from './state.js';

let ws = null;
let reconnectTimer = null;
let wsHasConnected = false;
let reconnectAttempt = 0;
const MAX_RECONNECT_DELAY = 30000;

// Elements set by init
let reconnectBanner = null;

export function initWebSocket(elements) {
  reconnectBanner = elements.reconnectBanner;
}

export function getWS() {
  return ws;
}

export function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    clearTimeout(reconnectTimer);
    reconnectAttempt = 0;
    if (reconnectBanner) reconnectBanner.classList.add('hidden');
    if (wsHasConnected) showToast('Reconnected');
    wsHasConnected = true;
    // Flush queued messages
    const pendingMessages = state.getPendingMessages();
    if (pendingMessages.length > 0) {
      const queued = [...pendingMessages];
      state.clearPendingMessages();
      queued.forEach(msg => ws.send(JSON.stringify(msg)));
      showToast(`Sent ${queued.length} queued message${queued.length > 1 ? 's' : ''}`);
    }
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
    const baseDelay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
    const jitter = baseDelay * (0.5 + Math.random()); // 50-150% of base delay
    reconnectAttempt++;
    reconnectTimer = setTimeout(connectWS, jitter);
    // Show reconnect banner after first failed attempt
    if (wsHasConnected && reconnectBanner) reconnectBanner.classList.remove('hidden');
  };

  ws.onerror = () => {
    ws.close();
  };
}

function handleWSMessage(data) {
  const currentConversationId = state.getCurrentConversationId();

  switch (data.type) {
    case 'delta':
      if (data.conversationId === currentConversationId) {
        appendDelta(data.text);
      }
      break;

    case 'result':
      if (data.conversationId === currentConversationId) {
        finalizeMessage(data);
        // Notify if tab is hidden
        const conv = state.conversations.find(c => c.id === data.conversationId);
        state.notifyCompletion(conv?.name);
      } else if (data.conversationId) {
        state.addUnread(data.conversationId);
        // Notify for background conversations too
        const conv = state.conversations.find(c => c.id === data.conversationId);
        state.notifyCompletion(conv?.name);
      }
      // Update conversation list in background
      loadConversations();
      break;

    case 'status':
      state.updateStatus(data.conversationId, data.status);
      break;

    case 'error':
      if (data.conversationId === currentConversationId || !data.conversationId) {
        state.showError(data.error);
        state.setThinking(false);
      }
      break;

    case 'messages_updated':
      if (data.conversationId === currentConversationId) {
        renderMessages(data.messages);
        state.setThinking(true);
      }
      break;

    case 'stderr':
      break;

    case 'thinking':
      if (data.conversationId === currentConversationId) {
        state.updateThinkingText(data.text);
      }
      break;

    case 'tool_start':
      if (data.conversationId === currentConversationId) {
        state.updateToolStatus(data.tool);
      }
      break;

    case 'tool_result':
      if (data.conversationId === currentConversationId) {
        state.clearToolStatus();
      }
      break;
  }
}
