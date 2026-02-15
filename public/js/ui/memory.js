// --- Memory view and APIs ---
import { escapeHtml } from '../markdown.js';
import { haptic, showToast, showDialog, apiFetch } from '../utils.js';
import * as state from '../state.js';

// DOM elements (set by init)
let memoryView = null;
let memoryBackBtn = null;
let memoryContent = null;
let listView = null;

export function initMemory(elements) {
  listView = elements.listView;
  // Memory elements are retrieved by ID since they may not be passed in
  memoryView = document.getElementById('memory-view');
  memoryBackBtn = document.getElementById('memory-back-btn');
  memoryContent = document.getElementById('memory-content');
}

// --- Memory API functions ---

export async function fetchMemories(scope = null) {
  const qs = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  const res = await apiFetch(`/api/memory${qs}`, { silent: true });
  if (!res) return [];
  return await res.json();
}

export async function createMemory(text, scope, category = null, source = null) {
  const res = await apiFetch('/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, scope, category, source }),
  });
  if (!res) return null;
  return await res.json();
}

export async function updateMemoryAPI(id, scope, data) {
  const res = await apiFetch(`/api/memory/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, ...data }),
  });
  if (!res) return null;
  return await res.json();
}

export async function deleteMemoryAPI(id, scope) {
  const res = await apiFetch(`/api/memory/${id}?scope=${encodeURIComponent(scope)}`, {
    method: 'DELETE',
  });
  if (!res) return false;
  return true;
}

// --- Memory View functions ---

export function showMemoryView() {
  if (!memoryView) {
    memoryView = document.getElementById('memory-view');
    memoryBackBtn = document.getElementById('memory-back-btn');
    memoryContent = document.getElementById('memory-content');
  }
  if (!memoryView) return;

  listView.classList.add('slide-out');
  memoryView.classList.add('slide-in');
  loadMemoryView();
}

export function closeMemoryView() {
  if (!memoryView) return;
  memoryView.classList.remove('slide-in');
  listView.classList.remove('slide-out');
}

async function loadMemoryView() {
  if (!memoryContent) return;

  memoryContent.innerHTML = `
    <div class="memory-loading">
      <div class="skeleton-line" style="width:60%;height:20px"></div>
      <div class="skeleton-line" style="width:80%;height:16px;margin-top:8px"></div>
      <div class="skeleton-line" style="width:70%;height:16px;margin-top:8px"></div>
    </div>`;

  // Get current conversation's cwd for project-scoped memories
  const currentId = state.getCurrentConversationId();
  const conv = state.conversations.find(c => c.id === currentId);
  const cwd = conv?.cwd || null;

  const memories = await fetchMemories(cwd);
  state.setMemories(memories);
  renderMemoryView(memories, cwd);
}

function renderMemoryView(memories, currentCwd) {
  if (!memoryContent) return;

  const globalMemories = memories.filter(m => m.scope === 'global');
  const projectMemories = memories.filter(m => m.scope !== 'global');

  if (memories.length === 0 && !currentCwd) {
    // No memories and no project context - show simple empty state
    memoryContent.innerHTML = `
      <div class="memory-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
        <h3>No memories yet</h3>
        <p>Add memories to help Claude remember important context across conversations.</p>
        <button class="btn-primary" id="add-global-memory-btn">Add Global Memory</button>
        <p class="memory-empty-hint">Open a conversation first to add project-specific memories.</p>
      </div>`;
    memoryContent.querySelector('#add-global-memory-btn')?.addEventListener('click', () => showAddMemoryDialogWithScope('global'));
    return;
  }

  let html = '';

  // Global section (always show)
  html += `
    <div class="memory-section memory-section-global">
      <div class="memory-section-header">
        <div>
          <div class="memory-section-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            Global
          </div>
          <div class="memory-section-subtitle">Available in all conversations</div>
        </div>
        <button class="btn-secondary btn-sm add-global-memory-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add
        </button>
      </div>
      ${globalMemories.length > 0
        ? globalMemories.map(m => renderMemoryCard(m)).join('')
        : '<div class="memory-empty-section">No global memories</div>'}
    </div>`;

  // Project section (only show if we have a cwd context)
  if (currentCwd) {
    const projectPath = currentCwd.split('/').slice(-2).join('/');
    html += `
      <div class="memory-section memory-section-project">
        <div class="memory-section-header">
          <div>
            <div class="memory-section-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              Project
            </div>
            <div class="memory-section-subtitle">${projectPath}</div>
          </div>
          <button class="btn-secondary btn-sm add-project-memory-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add
          </button>
        </div>
        ${projectMemories.length > 0
          ? projectMemories.map(m => renderMemoryCard(m)).join('')
          : '<div class="memory-empty-section">No project memories</div>'}
      </div>`;
  }

  memoryContent.innerHTML = html;

  // Attach event handlers
  memoryContent.querySelector('.add-global-memory-btn')?.addEventListener('click', () => showAddMemoryDialogWithScope('global'));
  memoryContent.querySelector('.add-project-memory-btn')?.addEventListener('click', () => showAddMemoryDialogWithScope(currentCwd));
  memoryContent.querySelectorAll('.memory-card').forEach(card => {
    const id = card.dataset.id;
    const scope = card.dataset.scope;

    card.querySelector('.memory-toggle')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const enabled = !card.classList.contains('disabled');
      await updateMemoryAPI(id, scope, { enabled: !enabled });
      card.classList.toggle('disabled', enabled);
      state.updateMemory(id, { enabled: !enabled });
      haptic(10);
    });

    card.querySelector('.memory-delete')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await showDialog({ title: 'Delete memory?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
      if (ok) {
        await deleteMemoryAPI(id, scope);
        state.removeMemory(id);
        card.remove();
        showToast('Memory deleted');
      }
    });

    card.querySelector('.memory-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showEditMemoryDialog(state.getMemories().find(m => m.id === id));
    });
  });
}

function renderMemoryCard(memory) {
  const disabledClass = memory.enabled === false ? 'disabled' : '';
  const categoryBadge = memory.category ? `<span class="memory-category">${escapeHtml(memory.category)}</span>` : '';

  return `
    <div class="memory-card ${disabledClass}" data-id="${memory.id}" data-scope="${escapeHtml(memory.scope)}">
      <div class="memory-card-content">
        <div class="memory-text">${escapeHtml(memory.text)}</div>
        ${categoryBadge}
      </div>
      <div class="memory-card-actions">
        <button class="memory-toggle" aria-label="Toggle memory" title="${memory.enabled !== false ? 'Disable' : 'Enable'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${memory.enabled !== false
              ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
              : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
            }
          </svg>
        </button>
        <button class="memory-edit" aria-label="Edit memory" title="Edit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="memory-delete" aria-label="Delete memory" title="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>`;
}

async function showAddMemoryDialogWithScope(scope) {
  const isGlobal = scope === 'global';
  const text = await showDialog({
    title: isGlobal ? 'Add Global Memory' : 'Add Project Memory',
    message: isGlobal ? 'This will be available in all conversations.' : 'This will only apply to this project.',
    input: true,
    placeholder: 'e.g., "Always use TypeScript for this project"',
    confirmLabel: 'Add',
  });
  if (!text || !text.trim()) return;

  const memory = await createMemory(text.trim(), scope);
  if (memory) {
    state.addMemory(memory);
    loadMemoryView();
    showToast('Memory added');
  }
}

async function showEditMemoryDialog(memory) {
  if (!memory) return;

  const newText = await showDialog({
    title: 'Edit Memory',
    input: true,
    placeholder: 'Memory text',
    confirmLabel: 'Save',
    defaultValue: memory.text,
  });

  if (newText === null) return; // Cancelled
  if (!newText.trim()) {
    showToast('Memory text cannot be empty', { variant: 'error' });
    return;
  }

  const updated = await updateMemoryAPI(memory.id, memory.scope, { text: newText.trim() });
  if (updated) {
    state.updateMemory(memory.id, { text: newText.trim() });
    loadMemoryView();
    showToast('Memory updated');
  }
}

// --- Remember message as memory ---
export async function rememberMessage(el, _index) {
  // Get plain text from the message
  const clone = el.cloneNode(true);
  clone.querySelector('.meta')?.remove();
  clone.querySelector('.msg-attachments')?.remove();
  clone.querySelectorAll('.tool-trace')?.forEach(e => e.remove());
  const text = clone.textContent.trim();

  if (!text) {
    showToast('No text to remember', { variant: 'error' });
    return;
  }

  // Truncate if too long
  const maxLen = 500;
  const memoryText = text.length > maxLen ? text.slice(0, maxLen) + '...' : text;

  // Get scope options
  const currentId = state.getCurrentConversationId();
  const conv = state.conversations.find(c => c.id === currentId);
  const cwd = conv?.cwd || null;

  // Show combined dialog with text input and scope selection
  const result = await showRememberDialog(memoryText, cwd);
  if (!result) return;

  const source = { conversationId: currentId };
  const memory = await createMemory(result.text.trim(), result.scope, null, source);
  if (memory) {
    state.addMemory(memory);
    showToast(result.scope === 'global' ? 'Global memory saved' : 'Project memory saved');
  }
}

// Combined dialog for remember with text + scope
function showRememberDialog(defaultText, cwd) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.innerHTML = `
      <div class="dialog-title">Save as Memory</div>
      <textarea class="dialog-textarea" rows="3" placeholder="Memory text">${defaultText}</textarea>
      <div class="dialog-scope">
        <label class="scope-option">
          <input type="radio" name="memory-scope" value="global" ${!cwd ? 'checked' : ''}>
          <span>Global</span>
          <span class="scope-desc">Applies to all conversations</span>
        </label>
        ${cwd ? `
        <label class="scope-option">
          <input type="radio" name="memory-scope" value="project" checked>
          <span>This project</span>
          <span class="scope-desc">${cwd.split('/').pop() || cwd}</span>
        </label>
        ` : ''}
      </div>
      <div class="dialog-actions">
        <button class="btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn-primary" data-action="save">Save</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const textarea = dialog.querySelector('.dialog-textarea');
    textarea.focus();
    textarea.select();

    function cleanup() {
      overlay.remove();
    }

    function onSave() {
      const text = textarea.value.trim();
      if (!text) {
        cleanup();
        resolve(null);
        return;
      }
      const scopeInput = dialog.querySelector('input[name="memory-scope"]:checked');
      const scope = scopeInput?.value === 'project' ? cwd : 'global';
      cleanup();
      resolve({ text, scope });
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    dialog.querySelector('[data-action="save"]').addEventListener('click', onSave);
    dialog.querySelector('[data-action="cancel"]').addEventListener('click', onCancel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) onCancel(); });
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSave(); }
      if (e.key === 'Escape') onCancel();
    });
  });
}

// --- Memory toggle in chat header ---
export function updateMemoryIndicator(useMemory) {
  const memoryBtn = document.getElementById('memory-btn');
  if (memoryBtn) {
    memoryBtn.classList.toggle('active', useMemory !== false);
    memoryBtn.classList.toggle('disabled', useMemory === false);
    memoryBtn.title = useMemory !== false ? 'Memory enabled (click to disable)' : 'Memory disabled (click to enable)';
  }
  // Also update the menu label
  const chatMoreMemoryLabel = document.getElementById('chat-more-memory-label');
  if (chatMoreMemoryLabel) {
    chatMoreMemoryLabel.textContent = useMemory !== false ? 'Memory: On' : 'Memory: Off';
  }
}

export async function toggleConversationMemory() {
  const currentId = state.getCurrentConversationId();
  if (!currentId) return;

  const conv = state.conversations.find(c => c.id === currentId);
  if (!conv) return;

  const newUseMemory = conv.useMemory === false ? true : false;

  const res = await apiFetch(`/api/conversations/${currentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ useMemory: newUseMemory }),
    silent: true,
  });

  if (res) {
    conv.useMemory = newUseMemory;
    updateMemoryIndicator(newUseMemory);
    showToast(newUseMemory ? 'Memory enabled for this conversation' : 'Memory disabled for this conversation');
  }
}

// --- Event listener setup for memory-related elements ---
export function setupMemoryEventListeners() {
  // Memory view back button
  if (memoryBackBtn) {
    memoryBackBtn.addEventListener('click', closeMemoryView);
  }

  // Memory toggle (click) and memory view (long-press)
  const memoryBtn = document.getElementById('memory-btn');
  if (memoryBtn) {
    let memoryPressTimer = null;
    let memoryLongPressed = false;

    memoryBtn.addEventListener('mousedown', () => {
      memoryLongPressed = false;
      memoryPressTimer = setTimeout(() => {
        memoryLongPressed = true;
        haptic(20);
        showMemoryView();
      }, 500);
    });

    memoryBtn.addEventListener('mouseup', () => {
      clearTimeout(memoryPressTimer);
      if (!memoryLongPressed) {
        haptic(10);
        toggleConversationMemory();
      }
    });

    memoryBtn.addEventListener('mouseleave', () => {
      clearTimeout(memoryPressTimer);
    });

    // Touch events for mobile
    memoryBtn.addEventListener('touchstart', () => {
      memoryLongPressed = false;
      memoryPressTimer = setTimeout(() => {
        memoryLongPressed = true;
        haptic(20);
        showMemoryView();
      }, 500);
    }, { passive: true });

    memoryBtn.addEventListener('touchend', (e) => {
      clearTimeout(memoryPressTimer);
      if (!memoryLongPressed) {
        e.preventDefault();
        haptic(10);
        toggleConversationMemory();
      }
    });

    memoryBtn.addEventListener('touchcancel', () => {
      clearTimeout(memoryPressTimer);
    });
  }
}
