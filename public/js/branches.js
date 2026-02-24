// --- Conversation branches visualization ---
import { escapeHtml } from './markdown.js';
import { haptic, apiFetch } from './utils.js';
import * as state from './state.js';

// DOM elements (set by init)
let branchesView = null;
let branchesBackBtn = null;
let branchesContent = null;

// State
let _currentTreeData = null;

export function initBranches(elements) {
  branchesView = elements.branchesView;
  branchesBackBtn = elements.branchesBackBtn;
  branchesContent = elements.branchesContent;

  if (branchesBackBtn) {
    branchesBackBtn.addEventListener('click', () => {
      haptic();
      closeBranchesView();
    });
  }
}

export async function loadBranchesTree(conversationId) {
  if (!branchesContent) return;

  branchesContent.innerHTML = '<div class="branches-loading">Loading tree...</div>';

  const res = await apiFetch(`/api/conversations/${conversationId}/tree`, { silent: true });
  if (!res) {
    branchesContent.innerHTML = '<div class="branches-empty">Failed to load tree</div>';
    return;
  }
  const data = await res.json();
  _currentTreeData = data;
  renderTree(data);
}

// Collapsed state for tree nodes
const collapsedNodes = new Set();

function renderTree(data) {
  if (!data.tree) {
    branchesContent.innerHTML = '<div class="branches-empty">No branches found</div>';
    return;
  }

  // Check if this is a single node with no branches
  const hasChildren = data.tree.children && data.tree.children.length > 0;
  const hasParent = data.tree.parentId != null;
  if (!hasChildren && !hasParent) {
    branchesContent.innerHTML = `
      <div class="branches-empty">
        <div style="text-align: center; max-width: 280px;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 12px; opacity: 0.5;">
            <circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><circle cx="18" cy="6" r="3"/>
            <path d="M6 9v6c0 3 3 3 6 3h3"/>
          </svg>
          <p style="margin: 0 0 8px; font-weight: 500;">No branches yet</p>
          <p style="margin: 0; font-size: 12px; opacity: 0.7;">Fork from any message to create a branch. Long-press a message and tap "Fork from here".</p>
        </div>
      </div>`;
    return;
  }

  // Build the list view HTML
  let html = '<div class="branches-list">';

  // Icons
  const rootIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v7m0 6v7M2 12h7m6 0h7"/></svg>`;
  const branchIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v3c0 3 3 3 6 3h3"/></svg>`;
  const rootCwd = data.rootCwd || data.tree.cwd || '';

  function compactCwd(cwd) {
    if (!cwd) return '';
    const compact = String(cwd).replace(/^\/(?:Users|home)\/[^/]+/, '~');
    if (compact.length <= 46) return compact;
    return `...${compact.slice(-43)}`;
  }

  function renderNode(node, depth, parentName = null, _isLastChild = true) {
    const isCurrent = node.id === data.currentId;
    const hasKids = node.children && node.children.length > 0;
    const isCollapsed = collapsedNodes.has(node.id);
    const isRoot = depth === 0;
    const workspaceKind = node.workspaceKind || (node.cwd && rootCwd && node.cwd !== rootCwd ? 'worktree' : 'shared');

    // Format relative time
    const timeAgo = formatRelativeTime(node.updatedAt || node.createdAt);

    // Fork info: show parent name and message preview
    let forkInfo = '';
    if (node.forkIndex != null && parentName) {
      const preview = node.forkPreview ? escapeHtml(node.forkPreview) : '';
      // Truncate parent name if too long
      const shortParent = parentName.length > 20 ? parentName.slice(0, 20) + '...' : parentName;
      forkInfo = `
        <div class="branch-fork-info">
          <span class="fork-from">↳ from <strong>${escapeHtml(shortParent)}</strong></span>
          <span class="fork-at">@ msg ${node.forkIndex + 1}</span>
          ${preview ? `<span class="fork-preview">"${preview}"</span>` : ''}
        </div>`;
    }

    // Children count for collapsed nodes
    const childrenBadge = hasKids && isCollapsed
      ? `<span class="branch-children-badge">${countDescendants(node)} hidden</span>`
      : '';
    const roleBadge = isRoot
      ? '<span class="branch-role-badge root">root</span>'
      : (hasKids ? '<span class="branch-role-badge parent">parent</span>' : '');
    const workspaceBadge = workspaceKind === 'worktree'
      ? '<span class="branch-workspace-badge worktree">worktree</span>'
      : '<span class="branch-workspace-badge shared">shared cwd</span>';
    const cwdLabel = node.cwd ? `<div class="branch-cwd" title="${escapeHtml(node.cwd)}">${escapeHtml(compactCwd(node.cwd))}</div>` : '';

    html += `
      <div class="branch-node-wrapper${isRoot ? ' root-wrapper' : ''}" data-depth="${depth}">
        <div class="branch-item${isCurrent ? ' current' : ''}${isRoot ? ' root' : ''}" data-id="${node.id}">
          <div class="branch-item-row">
            <div class="branch-item-icon">${isRoot ? rootIcon : branchIcon}</div>
            <div class="branch-item-content">
              <div class="branch-item-header">
                <span class="branch-item-name">${escapeHtml(node.name)}</span>
                ${isCurrent ? '<span class="branch-current-badge">current</span>' : ''}
                ${roleBadge}
                ${workspaceBadge}
              </div>
              <div class="branch-item-meta">
                <span class="branch-meta-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>${node.messageCount}</span>
                <span class="branch-meta-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>${timeAgo}</span>
              </div>
              ${cwdLabel}
              ${forkInfo}
            </div>
            ${childrenBadge}
            ${hasKids ? `
              <button class="branch-collapse-btn${isCollapsed ? ' collapsed' : ''}" data-id="${node.id}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="${isCollapsed ? '9 18 15 12 9 6' : '6 9 12 15 18 9'}"/>
                </svg>
              </button>
            ` : ''}
          </div>
        </div>`;

    // Render children in a nested container with connecting line
    if (hasKids && !isCollapsed) {
      html += `<div class="branch-children">`;
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) {
        renderNode(kids[i], depth + 1, node.name, i === kids.length - 1);
      }
      html += `</div>`;
    }

    html += `</div>`; // close branch-node-wrapper
  }

  // Count all descendants of a node
  function countDescendants(node) {
    if (!node.children) return 0;
    let count = node.children.length;
    for (const child of node.children) {
      count += countDescendants(child);
    }
    return count;
  }

  renderNode(data.tree, 0);
  html += '</div>';

  branchesContent.innerHTML = html;

  // Add click handlers
  branchesContent.querySelectorAll('.branch-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Ignore clicks on collapse button
      if (e.target.closest('.branch-collapse-btn')) return;

      const id = item.dataset.id;
      if (id && id !== data.currentId) {
        haptic();
        navigateToConversation(id);
      }
    });
  });

  // Add collapse/expand handlers
  branchesContent.querySelectorAll('.branch-collapse-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      haptic(5);
      const id = btn.dataset.id;
      if (collapsedNodes.has(id)) {
        collapsedNodes.delete(id);
      } else {
        collapsedNodes.add(id);
      }
      renderTree(data);
    });
  });
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}


async function navigateToConversation(id) {
  // Import dynamically to avoid circular dependency
  const { openConversation } = await import('./conversations.js');
  closeBranchesView();
  openConversation(id);
}

export function showBranchesView() {
  if (!branchesView) return;
  // Branches view slides down from top as an overlay
  branchesView.classList.add('slide-in');
}

export function closeBranchesView() {
  if (!branchesView) return;
  branchesView.classList.remove('slide-in');
}

export function isBranchesViewOpen() {
  return branchesView && branchesView.classList.contains('slide-in');
}

export function openBranchesFromChat() {
  const currentId = state.getCurrentConversationId();
  if (!currentId) return;
  showBranchesView();
  loadBranchesTree(currentId);
}
