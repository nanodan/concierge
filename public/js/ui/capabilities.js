// --- Capabilities modal ---
import { escapeHtml } from '../markdown.js';
import { haptic, showToast, apiFetch } from '../utils.js';
import * as state from '../state.js';

// DOM elements (set by init)
let capabilitiesBtn = null;
let capabilitiesModal = null;
let capabilitiesClose = null;
let capabilitiesSearch = null;
let capabilitiesList = null;
let messageInput = null;

// Capabilities cache
let cachedCapabilities = null;
let capabilitiesCwd = null;

export function initCapabilities(elements) {
  capabilitiesBtn = document.getElementById('capabilities-btn');
  capabilitiesModal = document.getElementById('capabilities-modal');
  capabilitiesClose = document.getElementById('capabilities-close');
  capabilitiesSearch = document.getElementById('capabilities-search');
  capabilitiesList = document.getElementById('capabilities-list');
  messageInput = elements.messageInput;
}

export function openCapabilitiesModal() {
  if (!capabilitiesModal) return;
  capabilitiesModal.classList.remove('hidden');
  if (capabilitiesSearch) {
    capabilitiesSearch.value = '';
    capabilitiesSearch.focus();
  }
  loadCapabilities();
}

export function closeCapabilitiesModal() {
  if (capabilitiesModal) {
    capabilitiesModal.classList.add('hidden');
  }
}

async function loadCapabilities() {
  if (!capabilitiesList) return;

  const currentId = state.getCurrentConversationId();
  const conv = state.conversations.find(c => c.id === currentId);
  const cwd = conv?.cwd || '';

  // Show loading state
  capabilitiesList.innerHTML = `
    <div class="capabilities-empty">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 6v6l4 2"/>
      </svg>
      <p>Loading capabilities...</p>
    </div>`;

  // Use cache if same cwd
  if (cachedCapabilities && capabilitiesCwd === cwd) {
    renderCapabilities(cachedCapabilities);
    return;
  }

  try {
    const res = await apiFetch(`/api/capabilities?cwd=${encodeURIComponent(cwd)}`, { silent: true });
    if (!res) {
      capabilitiesList.innerHTML = `
        <div class="capabilities-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4M12 16h.01"/>
          </svg>
          <p>Failed to load capabilities</p>
        </div>`;
      return;
    }
    const data = await res.json();
    cachedCapabilities = data;
    capabilitiesCwd = cwd;
    renderCapabilities(data);
  } catch {
    capabilitiesList.innerHTML = `
      <div class="capabilities-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4M12 16h.01"/>
        </svg>
        <p>Failed to load capabilities</p>
      </div>`;
  }
}

function renderCapabilities(data, filter = '') {
  if (!capabilitiesList) return;

  const filterLower = filter.toLowerCase();
  const filterItem = (item) => {
    if (!filter) return true;
    return item.name.toLowerCase().includes(filterLower) ||
           (item.description && item.description.toLowerCase().includes(filterLower));
  };

  const skills = (data.skills || []).filter(filterItem);
  const commands = (data.commands || []).filter(filterItem);
  const agents = (data.agents || []).filter(filterItem);

  if (skills.length === 0 && commands.length === 0 && agents.length === 0) {
    capabilitiesList.innerHTML = `
      <div class="capabilities-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 17l6-6-6-6"/><path d="M12 19h8"/>
        </svg>
        <p>${filter ? 'No matching commands found' : 'No commands or skills available'}</p>
      </div>`;
    return;
  }

  let html = '';

  if (commands.length > 0) {
    html += `<div class="capabilities-section">
      <div class="capabilities-section-title">Commands</div>
      ${commands.map(c => renderCapabilityItem(c, 'command')).join('')}
    </div>`;
  }

  if (skills.length > 0) {
    html += `<div class="capabilities-section">
      <div class="capabilities-section-title">Skills</div>
      ${skills.map(s => renderCapabilityItem(s, 'skill')).join('')}
    </div>`;
  }

  if (agents.length > 0) {
    html += `<div class="capabilities-section">
      <div class="capabilities-section-title">Agents</div>
      ${agents.map(a => renderCapabilityItem(a, 'agent')).join('')}
    </div>`;
  }

  capabilitiesList.innerHTML = html;

  // Attach click handlers
  capabilitiesList.querySelectorAll('.capability-item').forEach(item => {
    item.addEventListener('click', () => {
      const name = item.dataset.name;
      const type = item.dataset.type;
      insertCapability(name, type);
    });
  });
}

function renderCapabilityItem(item, type) {
  const icons = {
    skill: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
    command: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>',
    agent: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>',
  };

  return `
    <div class="capability-item" data-name="${escapeHtml(item.name)}" data-type="${type}">
      <div class="capability-icon ${type}">${icons[type]}</div>
      <div class="capability-info">
        <div class="capability-name"><code>/${escapeHtml(item.name)}</code></div>
        ${item.description ? `<div class="capability-desc">${escapeHtml(item.description)}</div>` : ''}
      </div>
      ${item.source === 'project' ? '<span class="capability-source">Project</span>' : ''}
    </div>`;
}

function insertCapability(name, _type) {
  if (!messageInput) return;
  haptic(10);
  const prefix = `/${name} `;
  messageInput.value = prefix + messageInput.value;
  messageInput.focus();
  messageInput.setSelectionRange(prefix.length, prefix.length);
  closeCapabilitiesModal();
  showToast(`Inserted /${name}`);
}

// Export for use in search filtering
export function getCachedCapabilities() {
  return cachedCapabilities;
}

// --- Event listener setup for capabilities-related elements ---
export function setupCapabilitiesEventListeners() {
  if (capabilitiesBtn) {
    capabilitiesBtn.addEventListener('click', () => {
      haptic(10);
      openCapabilitiesModal();
    });
  }

  if (capabilitiesClose) {
    capabilitiesClose.addEventListener('click', closeCapabilitiesModal);
  }

  if (capabilitiesModal) {
    capabilitiesModal.addEventListener('click', (e) => {
      if (e.target === capabilitiesModal) closeCapabilitiesModal();
    });
  }

  if (capabilitiesSearch) {
    capabilitiesSearch.addEventListener('input', () => {
      if (cachedCapabilities) {
        renderCapabilities(cachedCapabilities, capabilitiesSearch.value);
      }
    });
  }
}
