// --- Context Bar (token display, breakdown, compression) ---
import { formatTokens, formatAge, haptic, showToast, showDialog, apiFetch } from '../utils.js';
import * as state from '../state.js';

// DOM elements (set by init)
let contextBar = null;
let contextBarFill = null;
let contextBarLabel = null;
let contextBreakdown = null;

/**
 * Initialize context bar elements
 */
export function initContextBar(elements) {
  contextBar = elements.contextBar;
  contextBarFill = elements.contextBarFill;
  contextBarLabel = elements.contextBarLabel;
  contextBreakdown = document.getElementById('context-breakdown');
}

/**
 * Setup context bar event listeners
 */
export function setupContextBarEventListeners() {
  if (!contextBar) return;

  // Context bar click to toggle breakdown
  contextBar.addEventListener('click', () => {
    haptic();
    toggleContextBreakdown();
  });

  contextBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      haptic();
      toggleContextBreakdown();
    }
  });
}

/**
 * Calculate current context tokens for the conversation.
 * We use the latest assistant turn's token usage, which reflects the
 * active context window for the current session.
 */
export function calculateCumulativeTokens(messages) {
  const allMessages = messages || [];
  const lastAssistant = [...allMessages]
    .reverse()
    .find(msg => msg.role === 'assistant' && msg.inputTokens != null);
  const latestCompressionAt = allMessages.reduce((latest, msg) => {
    const ts = msg?.compressionMeta?.compressedAt;
    return typeof ts === 'number' && ts > latest ? ts : latest;
  }, 0);

  if (!lastAssistant) {
    if (latestCompressionAt > 0) {
      // No post-compression token metrics yet; estimate from remaining visible context.
      const estimated = allMessages.reduce((sum, msg) => {
        if (msg?.summarized) return sum;
        return sum + Math.ceil((msg?.text || '').length / 4);
      }, 0);
      return { inputTokens: estimated, outputTokens: 0 };
    }
    return { inputTokens: 0, outputTokens: 0 };
  }

  // After compression, historical assistant token usage is stale until a new response arrives.
  if (latestCompressionAt > 0 && (lastAssistant.timestamp || 0) < latestCompressionAt) {
    const estimated = allMessages.reduce((sum, msg) => {
      if (msg?.summarized) return sum;
      return sum + Math.ceil((msg?.text || '').length / 4);
    }, 0);
    return { inputTokens: estimated, outputTokens: 0 };
  }

  return {
    inputTokens: lastAssistant.inputTokens || 0,
    outputTokens: lastAssistant.outputTokens || 0,
  };
}

/**
 * Update the context bar display
 */
export function updateContextBar(inputTokens, outputTokens, modelId) {
  const models = state.getModels();
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

/**
 * Toggle context breakdown panel visibility
 */
function toggleContextBreakdown() {
  const isExpanded = contextBar.getAttribute('aria-expanded') === 'true';
  if (isExpanded) {
    hideContextBreakdown();
  } else {
    showContextBreakdown();
  }
}

/**
 * Hide context breakdown panel
 */
export function hideContextBreakdown() {
  contextBar.setAttribute('aria-expanded', 'false');
  contextBreakdown.classList.add('hidden');
}

/**
 * Show context breakdown panel with token details
 */
function showContextBreakdown() {
  if (!contextBreakdown) return;

  const messages = state.getAllMessages();
  const memories = state.getMemories();
  const models = state.getModels();
  const modelId = state.getCurrentModel();
  const model = models.find(m => m.id === modelId);
  const contextLimit = model ? model.context : 200000;

  // Estimate system prompt (~12k base + memories)
  const memoryTokens = memories.reduce((sum, m) => {
    // Rough estimate: ~4 chars per token
    return sum + Math.ceil((m.text || '').length / 4);
  }, 0);
  const systemTokens = 12000 + memoryTokens;

  const { inputTokens, outputTokens } = calculateCumulativeTokens(messages);
  const currentContext = (inputTokens || 0) + (outputTokens || 0);

  // Message count and oldest message
  const msgCount = messages.length;
  const oldestMsg = messages[0]?.timestamp;
  const oldestAge = oldestMsg ? formatAge(oldestMsg) : 'N/A';

  // Calculate percentage
  const pct = Math.min((currentContext / contextLimit) * 100, 100);
  const pctClass = pct >= 90 ? 'danger' : pct >= 75 ? 'warning' : '';

  // Count user vs assistant messages
  const userMsgs = messages.filter(m => m.role === 'user').length;
  const assistantMsgs = messages.filter(m => m.role === 'assistant').length;

  // Estimate potential savings from compression (first 50% of messages)
  const halfIndex = Math.floor(messages.length / 2);
  const messagesToCompress = messages.slice(0, halfIndex);
  const estimatedSavings = messagesToCompress.reduce((sum, m) => {
    // Rough estimate based on text length
    return sum + Math.ceil((m.text || '').length / 4);
  }, 0);

  contextBreakdown.innerHTML = `
    <div class="context-breakdown-bar">
      <div class="context-breakdown-bar-fill ${pctClass}" style="width: ${pct}%"></div>
    </div>
    <div class="context-breakdown-row">
      <span class="context-breakdown-label">Current context</span>
      <span class="context-breakdown-value">${formatTokens(currentContext)} / ${formatTokens(contextLimit)}</span>
    </div>
    <div class="context-breakdown-row">
      <span class="context-breakdown-label">System prompt (est.)</span>
      <span class="context-breakdown-value">~${formatTokens(systemTokens)}</span>
    </div>
    <div class="context-breakdown-row">
      <span class="context-breakdown-label">Messages</span>
      <span class="context-breakdown-value">${msgCount} (${userMsgs} you, ${assistantMsgs} Claude)</span>
    </div>
    <div class="context-breakdown-row">
      <span class="context-breakdown-label">Oldest message</span>
      <span class="context-breakdown-value">${oldestAge}</span>
    </div>
    ${pct >= 50 ? `
      <div class="context-breakdown-actions">
        <button class="compress-btn" id="compress-btn">
          Compress conversation
        </button>
      </div>
      <div class="compress-btn-hint">
        Summarize ~${halfIndex} messages, save ~${formatTokens(estimatedSavings)} tokens
      </div>
    ` : ''}
  `;

  // Add compress button handler
  const compressBtn = contextBreakdown.querySelector('#compress-btn');
  if (compressBtn) {
    compressBtn.addEventListener('click', () => {
      haptic(15);
      compressConversation();
    });
  }

  contextBar.setAttribute('aria-expanded', 'true');
  contextBreakdown.classList.remove('hidden');
}

/**
 * Compress conversation (calls API)
 */
async function compressConversation() {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  const compressBtn = contextBreakdown.querySelector('#compress-btn');
  if (compressBtn) {
    compressBtn.disabled = true;
    compressBtn.textContent = 'Compressing...';
  }

  try {
    const res = await apiFetch(`/api/conversations/${convId}/compress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold: 0.5 }),
    });

    if (!res || !res.ok) {
      const data = res ? await res.json() : { error: 'Network error' };
      showToast(data.error || 'Compression failed', { variant: 'error' });
      if (compressBtn) {
        compressBtn.disabled = false;
        compressBtn.textContent = 'Compress conversation';
      }
      return;
    }

    const data = await res.json();
    showToast(`Compressed ${data.messagesSummarized} messages`);
    hideContextBreakdown();

    // Reload conversation to show updated messages
    const { openConversation, loadConversations } = await import('../conversations.js');
    await openConversation(convId);
    await loadConversations();
  } catch (err) {
    showToast('Compression failed: ' + err.message, { variant: 'error' });
    if (compressBtn) {
      compressBtn.disabled = false;
      compressBtn.textContent = 'Compress conversation';
    }
  }
}

/**
 * Show compression prompt when context is near limit
 */
export async function showCompressionPrompt(pct, totalTokens, contextLimit) {
  state.setCompressionPromptShown(true);

  const ok = await showDialog({
    title: 'Context limit approaching',
    message: `Your conversation is at ${Math.round(pct)}% of the ${formatTokens(contextLimit)} token limit. Would you like to compress older messages to free up space?\n\nThis will summarize earlier messages and start a fresh session while preserving context.`,
    confirmLabel: 'Compress now',
    cancelLabel: 'Not now',
  });

  if (ok) {
    await compressConversation();
  }
}
