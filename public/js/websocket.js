// --- WebSocket connection management ---
import { showToast } from './utils.js';
import { appendDelta, finalizeMessage, renderMessages } from './render.js';
import { loadConversations } from './conversations.js';
import * as state from './state.js';
import { WS_RECONNECT_MAX_DELAY } from './constants.js';

let ws = null;
let reconnectTimer = null;
let wsHasConnected = false;
let reconnectAttempt = 0;

// Elements set by init
let reconnectBanner = null;

export function initWebSocket(elements) {
  reconnectBanner = elements.reconnectBanner;
}

export function getWS() {
  return ws;
}

export function connectWS() {
  // Clean up old WebSocket if exists
  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }

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
    const baseDelay = Math.min(1000 * Math.pow(2, reconnectAttempt), WS_RECONNECT_MAX_DELAY);
    const jitter = baseDelay * (0.5 + Math.random()); // 50-150% of base delay
    reconnectAttempt++;
    reconnectTimer = setTimeout(connectWS, jitter);
    // Show reconnect banner with attempt info
    if (wsHasConnected && reconnectBanner) {
      reconnectBanner.classList.remove('hidden');
      const textEl = reconnectBanner.querySelector('#reconnect-text');
      if (textEl) {
        const nextRetry = Math.round(jitter / 1000);
        textEl.textContent = `Reconnecting... (attempt ${reconnectAttempt}, retry in ${nextRetry}s)`;
      }
    }
  };

  ws.onerror = () => {
    ws.close();
  };
}

// Manual reconnect (for retry button)
export function forceReconnect() {
  clearTimeout(reconnectTimer);
  reconnectAttempt = 0;
  connectWS();
}

// Handler map for WebSocket message types
const messageHandlers = {
  delta(data, currentConversationId) {
    if (data.conversationId === currentConversationId) {
      state.recordActivity();
      appendDelta(data.text);
    }
  },

  result(data, currentConversationId) {
    if (data.conversationId === currentConversationId) {
      finalizeMessage(data);
      const conv = state.conversations.find(c => c.id === data.conversationId);
      state.notifyCompletion(conv?.name);
    } else if (data.conversationId) {
      state.addUnread(data.conversationId);
      const conv = state.conversations.find(c => c.id === data.conversationId);
      state.notifyCompletion(conv?.name);
    }
    loadConversations();
  },

  status(data) {
    // Track thinking state for all conversations
    if (data.status === 'thinking') {
      state.addThinking(data.conversationId);
    } else {
      state.removeThinking(data.conversationId);
    }

    // Update current conversation UI
    state.updateStatus(data.conversationId, data.status, data.thinkingStartTime);

    // Refresh list view to show thinking indicators
    import('./conversations.js').then(({ renderConversationList }) => {
      renderConversationList();
    });
  },

  error(data, currentConversationId) {
    if (data.conversationId === currentConversationId || !data.conversationId) {
      state.showError(data.error);
      state.setThinking(false);
    }
  },

  messages_updated(data, currentConversationId) {
    if (data.conversationId === currentConversationId) {
      renderMessages(data.messages);
      state.setThinking(true);
    }
  },

  async edit_forked(data) {
    await loadConversations();
    const { openConversation } = await import('./conversations.js');
    openConversation(data.conversationId);
    showToast('Edited in new fork');
  },

  async resend_forked(data) {
    await loadConversations();
    const { openConversation } = await import('./conversations.js');
    openConversation(data.conversationId);
    showToast('Resent in new fork');
  },

  stderr() {
    // No-op: stderr messages are ignored
  },

  thinking(data, currentConversationId) {
    if (data.conversationId === currentConversationId) {
      state.recordActivity();
      state.updateThinkingText(data.text);
    }
  },

  tool_start(data, currentConversationId) {
    if (data.conversationId === currentConversationId) {
      state.recordActivity();
      state.updateToolStatus(data.tool);
    }
  },

  tool_result(data, currentConversationId) {
    if (data.conversationId === currentConversationId) {
      state.recordActivity();
      state.clearToolStatus();
    }
  },
};

function handleWSMessage(data) {
  const handler = messageHandlers[data.type];
  if (handler) {
    handler(data, state.getCurrentConversationId());
  }
}
