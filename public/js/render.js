// --- Rendering functions ---
import { escapeHtml, renderMarkdown } from './markdown.js';
import { formatTime, formatTokens, haptic, showToast } from './utils.js';
import * as state from './state.js';

// Claude avatar SVG (sparkle/AI icon)
export const CLAUDE_AVATAR_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L9.5 9.5L2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2z"/></svg>`;

// Reaction emojis
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '🤔', '👀'];

export function enhanceCodeBlocks(container) {
  container.querySelectorAll('pre code').forEach(el => {
    if (window.hljs && !el.dataset.highlighted) hljs.highlightElement(el);
    const pre = el.parentElement;
    if (pre.parentElement?.classList.contains('code-block')) return;

    // Detect language from class (e.g., "language-javascript" -> "javascript")
    const langClass = [...el.classList].find(c => c.startsWith('language-'));
    const lang = langClass ? langClass.replace('language-', '') : '';

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    pre.parentNode.insertBefore(wrapper, pre);

    // Add header with language badge and copy button
    const header = document.createElement('div');
    header.className = 'code-block-header';

    const langBadge = document.createElement('span');
    langBadge.className = 'code-lang-badge';
    langBadge.textContent = lang || 'code';

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      haptic(10);
      navigator.clipboard.writeText(el.textContent).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        showToast('Copied to clipboard');
      });
    });

    header.appendChild(langBadge);
    header.appendChild(btn);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });
}

export function renderMessages(messages) {
  const messagesContainer = state.getMessagesContainer();
  const loadMoreBtn = state.getLoadMoreBtn();
  const chatEmptyState = document.getElementById('chat-empty-state');

  state.setStreamingMessageEl(null);
  state.setStreamingText('');
  state.setPendingDelta('');
  state.setRenderScheduled(false);

  state.setAllMessages(messages);
  const MESSAGES_PER_PAGE = state.MESSAGES_PER_PAGE;

  // Show/hide empty state
  if (chatEmptyState) {
    chatEmptyState.classList.toggle('hidden', messages.length > 0);
  }

  // If more messages than MESSAGES_PER_PAGE, show only the last page
  if (messages.length > MESSAGES_PER_PAGE) {
    state.setMessagesOffset(messages.length - MESSAGES_PER_PAGE);
    const visible = messages.slice(state.getMessagesOffset());
    messagesContainer.innerHTML = renderMessageSlice(visible, state.getMessagesOffset());
    if (loadMoreBtn) loadMoreBtn.classList.remove('hidden');
  } else {
    state.setMessagesOffset(0);
    messagesContainer.innerHTML = renderMessageSlice(messages, 0);
    if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
  }

  enhanceCodeBlocks(messagesContainer);
  attachTTSHandlers();
  attachTimestampHandlers();
  attachImageHandlers();
  attachRegenHandlers();
  attachMessageActions();
  renderAllReactions();
  state.scrollToBottom(true);
}

export function renderMessageSlice(messages, startIndex) {
  const allMessages = state.getAllMessages();
  return messages.map((m, i) => {
    const globalIndex = startIndex + i;
    const cls = m.role === 'user' ? 'user' : 'assistant';
    const content = m.role === 'assistant' ? renderMarkdown(m.text) : escapeHtml(m.text);
    const timestamp = m.timestamp || Date.now();
    let meta = formatTime(timestamp);
    if (m.cost != null) {
      meta += ` &middot; $${m.cost.toFixed(4)}`;
    }
    if (m.duration != null) {
      meta += ` &middot; ${(m.duration / 1000).toFixed(1)}s`;
    }
    if (m.inputTokens != null) {
      meta += ` &middot; ${formatTokens(m.inputTokens)} in / ${formatTokens(m.outputTokens)} out`;
    }
    let attachHtml = '';
    if (m.attachments && m.attachments.length > 0) {
      attachHtml = '<div class="msg-attachments">' + m.attachments.map(a =>
        a.url && /\.(png|jpg|jpeg|gif|webp)$/i.test(a.filename)
          ? `<img src="${a.url}" class="msg-attachment-img" alt="${escapeHtml(a.filename)}">`
          : `<span class="msg-attachment-file">${escapeHtml(a.filename)}</span>`
      ).join('') + '</div>';
    }
    const isLastAssistant = cls === 'assistant' && globalIndex === allMessages.length - 1;
    const regenBtn = isLastAssistant
      ? '<button class="msg-action-btn regen-btn" aria-label="Regenerate" title="Regenerate"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg></button>'
      : '';
    const ttsBtn = (cls === 'assistant' && window.speechSynthesis)
      ? '<button class="msg-action-btn tts-btn" aria-label="Read aloud"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button>'
      : '';
    const actionBtns = (ttsBtn || regenBtn) ? `<div class="msg-action-btns">${ttsBtn}${regenBtn}</div>` : '';

    // Wrap assistant messages with avatar
    if (cls === 'assistant') {
      return `<div class="message-wrapper assistant">
        <div class="claude-avatar">${CLAUDE_AVATAR_SVG}</div>
        <div class="message ${cls}" data-index="${globalIndex}">${attachHtml}${content}<div class="meta" data-ts="${timestamp}">${meta}</div>${actionBtns}</div>
      </div>`;
    }
    return `<div class="message ${cls}" data-index="${globalIndex}">${attachHtml}${content}<div class="meta" data-ts="${timestamp}">${meta}</div>${actionBtns}</div>`;
  }).join('');
}

export function loadMoreMessages() {
  const messagesContainer = state.getMessagesContainer();
  const loadMoreBtn = state.getLoadMoreBtn();
  const allMessages = state.getAllMessages();
  let messagesOffset = state.getMessagesOffset();

  if (messagesOffset <= 0) return;
  const prevScrollHeight = messagesContainer.scrollHeight;
  const loadCount = Math.min(state.MESSAGES_PER_PAGE, messagesOffset);
  const newOffset = messagesOffset - loadCount;
  const slice = allMessages.slice(newOffset, messagesOffset);
  const html = renderMessageSlice(slice, newOffset);
  messagesContainer.insertAdjacentHTML('afterbegin', html);
  enhanceCodeBlocks(messagesContainer);
  attachTTSHandlers();
  attachTimestampHandlers();
  attachImageHandlers();
  attachMessageActions();
  state.setMessagesOffset(newOffset);
  // Preserve scroll position
  messagesContainer.scrollTop += messagesContainer.scrollHeight - prevScrollHeight;
  if (newOffset <= 0 && loadMoreBtn) loadMoreBtn.classList.add('hidden');
}

export function appendDelta(text) {
  const messagesContainer = state.getMessagesContainer();
  let streamingMessageEl = state.getStreamingMessageEl();

  if (!streamingMessageEl) {
    // Create wrapper with avatar
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper assistant animate-in';

    const avatar = document.createElement('div');
    avatar.className = 'claude-avatar';
    avatar.innerHTML = CLAUDE_AVATAR_SVG;

    streamingMessageEl = document.createElement('div');
    streamingMessageEl.className = 'message assistant';

    wrapper.appendChild(avatar);
    wrapper.appendChild(streamingMessageEl);
    messagesContainer.appendChild(wrapper);

    state.setStreamingMessageEl(streamingMessageEl);
    state.setStreamingText('');
    state.setPendingDelta('');
    state.setIsStreaming(true);
    state.setUserHasScrolledUp(!state.isNearBottom(150));
  }

  state.appendPendingDelta(text);
  if (!state.getRenderScheduled()) {
    state.setRenderScheduled(true);
    requestAnimationFrame(flushDelta);
  }
}

export function flushDelta() {
  state.setRenderScheduled(false);
  const pendingDelta = state.getPendingDelta();
  const streamingMessageEl = state.getStreamingMessageEl();

  if (!pendingDelta || !streamingMessageEl) return;
  state.appendStreamingText(pendingDelta);
  state.setPendingDelta('');
  // Skip cache during streaming - text constantly changing
  streamingMessageEl.innerHTML = renderMarkdown(state.getStreamingText(), { skipCache: true });
  enhanceCodeBlocks(streamingMessageEl);
  state.scrollToBottom();
}

export function finalizeMessage(data) {
  const jumpToBottomBtn = state.getJumpToBottomBtn();
  const streamingMessageEl = state.getStreamingMessageEl();

  // Flush any pending delta
  if (state.getPendingDelta() && streamingMessageEl) {
    state.appendStreamingText(state.getPendingDelta());
    state.setPendingDelta('');
    state.setRenderScheduled(false);
  }

  state.setThinking(false);
  state.setIsStreaming(false);

  if (streamingMessageEl) {
    const finalText = data.text || state.getStreamingText();
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
      ? '<button class="msg-action-btn tts-btn" aria-label="Read aloud"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button>'
      : '';
    const regenBtn = '<button class="msg-action-btn regen-btn" aria-label="Regenerate" title="Regenerate"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg></button>';
    const actionBtns = `<div class="msg-action-btns">${ttsBtn}${regenBtn}</div>`;
    streamingMessageEl.innerHTML = renderMarkdown(finalText) + `<div class="meta">${meta}</div>${actionBtns}`;
    enhanceCodeBlocks(streamingMessageEl);
    attachTTSHandlers();
  attachTimestampHandlers();
  attachImageHandlers();
    attachRegenHandlers();
    state.setStreamingMessageEl(null);
    state.setStreamingText('');
    state.scrollToBottom();
    if (state.getUserHasScrolledUp() && jumpToBottomBtn) {
      jumpToBottomBtn.classList.add('flash');
      setTimeout(() => jumpToBottomBtn.classList.remove('flash'), 1500);
    }
  }

  // Add the finalized message to allMessages so stats are up-to-date
  const allMessages = state.getAllMessages();
  allMessages.push({
    role: 'assistant',
    text: data.text || state.getStreamingText(),
    timestamp: Date.now(),
    cost: data.cost,
    duration: data.duration,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
  });

  if (data.inputTokens != null) {
    // Import dynamically to avoid circular dependency
    import('./ui.js').then(ui => {
      ui.updateContextBar(data.inputTokens, data.outputTokens, state.getCurrentModel());
    });
  }
}

export function renderAllReactions() {
  const currentConversationId = state.getCurrentConversationId();
  const messagesContainer = state.getMessagesContainer();

  if (!currentConversationId) return;
  messagesContainer.querySelectorAll('.message[data-index]').forEach(el => {
    const idx = parseInt(el.dataset.index, 10);
    renderReactionsForMessage(idx);
  });
}

export function renderReactionsForMessage(msgIndex) {
  const currentConversationId = state.getCurrentConversationId();
  const messagesContainer = state.getMessagesContainer();
  const messageReactions = state.getMessageReactions();

  const key = `${currentConversationId}:${msgIndex}`;
  const reactions = messageReactions[key] || {};
  const msgEl = messagesContainer.querySelector(`.message[data-index="${msgIndex}"]`);
  if (!msgEl) return;

  // Find or create the wrapper
  let wrapper = msgEl.closest('.message-wrapper') || msgEl.parentElement;

  // Remove existing reaction container
  wrapper.querySelector('.message-reactions')?.remove();

  const emojis = Object.keys(reactions);
  if (emojis.length === 0) return;

  const reactionsDiv = document.createElement('div');
  reactionsDiv.className = 'message-reactions';

  emojis.forEach(emoji => {
    const pill = document.createElement('button');
    pill.className = 'reaction-pill active';
    pill.innerHTML = `${emoji}`;
    pill.addEventListener('click', () => {
      haptic(10);
      toggleReaction(msgIndex, emoji);
    });
    reactionsDiv.appendChild(pill);
  });

  wrapper.appendChild(reactionsDiv);
}

export function toggleReaction(msgIndex, emoji) {
  const currentConversationId = state.getCurrentConversationId();
  const messageReactions = state.getMessageReactions();

  const key = `${currentConversationId}:${msgIndex}`;
  if (!messageReactions[key]) messageReactions[key] = {};
  if (messageReactions[key][emoji]) {
    delete messageReactions[key][emoji];
  } else {
    messageReactions[key][emoji] = 1;
  }
  state.setMessageReactions(messageReactions);
  renderReactionsForMessage(msgIndex);
}

export function showReactionPicker(x, y, msgIndex, hideMsgActionPopup, actionPopupOverlay) {
  hideMsgActionPopup();

  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  picker.style.position = 'fixed';
  picker.style.left = Math.min(x, window.innerWidth - 220) + 'px';
  picker.style.top = Math.max(y - 50, 10) + 'px';

  REACTION_EMOJIS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'reaction-picker-btn';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      haptic(10);
      toggleReaction(msgIndex, emoji);
      picker.remove();
      actionPopupOverlay.classList.add('hidden');
    });
    picker.appendChild(btn);
  });

  document.body.appendChild(picker);
  actionPopupOverlay.classList.remove('hidden');

  // Close on overlay click
  const closeHandler = () => {
    picker.remove();
    actionPopupOverlay.removeEventListener('click', closeHandler);
  };
  actionPopupOverlay.addEventListener('click', closeHandler);
}

export function attachTTSHandlers() {
  if (!window.speechSynthesis) return;
  const messagesContainer = state.getMessagesContainer();
  messagesContainer.querySelectorAll('.tts-btn').forEach(btn => {
    if (btn.dataset.ttsAttached) return;
    btn.dataset.ttsAttached = 'true';
    btn.addEventListener('click', () => toggleTTS(btn));
  });
}

export function attachTimestampHandlers() {
  const messagesContainer = state.getMessagesContainer();
  messagesContainer.querySelectorAll('.meta[data-ts]').forEach(meta => {
    if (meta.dataset.tsAttached) return;
    meta.dataset.tsAttached = 'true';
    meta.style.cursor = 'pointer';
    meta.addEventListener('click', () => {
      const ts = parseInt(meta.dataset.ts, 10);
      if (!ts) return;
      const date = new Date(ts);
      const full = date.toLocaleString(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
      });
      // Toggle between relative and full timestamp
      if (meta.dataset.expanded === 'true') {
        meta.innerHTML = meta.dataset.original;
        meta.dataset.expanded = 'false';
      } else {
        meta.dataset.original = meta.innerHTML;
        meta.innerHTML = full;
        meta.dataset.expanded = 'true';
      }
    });
  });
}

// Lightbox elements (lazy initialized)
let lightbox = null;
let lightboxImg = null;
let lightboxClose = null;
let lightboxDownload = null;

function initLightbox() {
  if (lightbox) return;
  lightbox = document.getElementById('lightbox');
  lightboxImg = document.getElementById('lightbox-img');
  lightboxClose = document.getElementById('lightbox-close');
  lightboxDownload = document.getElementById('lightbox-download');

  if (!lightbox) return;

  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
}

export function openLightbox(src) {
  initLightbox();
  if (!lightbox) return;
  lightboxImg.src = src;
  lightboxDownload.href = src;
  lightbox.classList.remove('hidden');
  haptic(10);
}

export function closeLightbox() {
  if (lightbox) {
    lightbox.classList.add('hidden');
    lightboxImg.src = '';
  }
}

export function attachImageHandlers() {
  const messagesContainer = state.getMessagesContainer();
  messagesContainer.querySelectorAll('.msg-attachment-img').forEach(img => {
    if (img.dataset.lightboxAttached) return;
    img.dataset.lightboxAttached = 'true';
    img.style.cursor = 'pointer';
    img.addEventListener('click', () => openLightbox(img.src));
  });
}

export function toggleTTS(btn) {
  let currentTTSBtn = state.getCurrentTTSBtn();

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

  // Clone, remove meta and tool trace sections, then get text content
  const clone = messageEl.cloneNode(true);
  const metaEl = clone.querySelector('.meta');
  if (metaEl) metaEl.remove();
  // Remove tool call traces (user doesn't want these read aloud)
  clone.querySelectorAll('.tool-trace').forEach(el => el.remove());
  const plainText = clone.textContent.trim();

  if (!plainText) return;

  const utterance = new SpeechSynthesisUtterance(plainText);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  utterance.onend = () => resetTTSBtn(btn);
  utterance.onerror = () => resetTTSBtn(btn);

  btn.classList.add('speaking');
  // Store original icon and show stop icon
  btn.dataset.originalIcon = btn.innerHTML;
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  state.setCurrentTTSBtn(btn);

  speechSynthesis.speak(utterance);
}

function resetTTSBtn(btn) {
  btn.classList.remove('speaking');
  // Restore original SVG icon
  if (btn.dataset.originalIcon) {
    btn.innerHTML = btn.dataset.originalIcon;
    delete btn.dataset.originalIcon;
  }
  if (state.getCurrentTTSBtn() === btn) state.setCurrentTTSBtn(null);
}

export function attachRegenHandlers() {
  const messagesContainer = state.getMessagesContainer();
  messagesContainer.querySelectorAll('.regen-btn').forEach(btn => {
    if (btn.dataset.attached) return;
    btn.dataset.attached = 'true';
    btn.addEventListener('click', () => {
      import('./ui.js').then(ui => ui.regenerateMessage());
    });
  });
}

// Message actions (needs to be set up by UI module)
let attachMessageActionsCallback = null;

export function setAttachMessageActionsCallback(callback) {
  attachMessageActionsCallback = callback;
}

export function attachMessageActions() {
  if (attachMessageActionsCallback) {
    attachMessageActionsCallback();
  }
}
