// --- Conversation branches visualization ---
import { escapeHtml } from './markdown.js';
import { haptic } from './utils.js';
import * as state from './state.js';

// DOM elements (set by init)
let branchesView = null;
let branchesBackBtn = null;
let branchesContent = null;
let listView = null;
let chatView = null;

// State
let _currentTreeData = null;
let openedFromChat = false;

export function initBranches(elements) {
  branchesView = elements.branchesView;
  branchesBackBtn = elements.branchesBackBtn;
  branchesContent = elements.branchesContent;
  listView = elements.listView;
  chatView = elements.chatView;

  if (branchesBackBtn) {
    branchesBackBtn.addEventListener('click', () => {
      haptic(10);
      closeBranchesView();
    });
  }
}

export async function loadBranchesTree(conversationId) {
  if (!branchesContent) return;

  branchesContent.innerHTML = '<div class="branches-loading">Loading tree...</div>';

  try {
    const res = await fetch(`/api/conversations/${conversationId}/tree`);
    if (!res.ok) {
      branchesContent.innerHTML = '<div class="branches-empty">Failed to load tree</div>';
      return;
    }
    const data = await res.json();
    _currentTreeData = data;
    renderTree(data);
  } catch (_err) {
    branchesContent.innerHTML = '<div class="branches-empty">Failed to load tree</div>';
  }
}

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

  // Calculate tree dimensions
  const nodeWidth = 160;
  const nodeHeight = 50;
  const horizontalGap = 40;
  const verticalGap = 60;

  // Assign positions to nodes (top-to-bottom layout)
  const positions = new Map();
  let maxX = 0;
  let maxY = 0;

  function measureTree(node, depth = 0) {
    if (!node.children || node.children.length === 0) {
      return { width: nodeWidth, height: nodeHeight };
    }
    let totalWidth = 0;
    for (const child of node.children) {
      const childSize = measureTree(child, depth + 1);
      totalWidth += childSize.width + horizontalGap;
    }
    totalWidth -= horizontalGap; // Remove last gap
    return { width: Math.max(nodeWidth, totalWidth), height: nodeHeight };
  }

  function positionNodes(node, x, y, availableWidth) {
    // Center this node in its available width
    const nodeX = x + (availableWidth - nodeWidth) / 2;
    positions.set(node.id, { x: nodeX, y, node });
    maxX = Math.max(maxX, nodeX + nodeWidth);
    maxY = Math.max(maxY, y + nodeHeight);

    if (!node.children || node.children.length === 0) return;

    // Calculate widths for children
    const childWidths = node.children.map(child => measureTree(child).width);
    const totalChildWidth = childWidths.reduce((sum, w) => sum + w + horizontalGap, -horizontalGap);

    // Position children centered below this node
    let childX = x + (availableWidth - totalChildWidth) / 2;
    const childY = y + nodeHeight + verticalGap;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const childWidth = childWidths[i];
      positionNodes(child, childX, childY, childWidth);
      childX += childWidth + horizontalGap;
    }
  }

  // Measure full tree and position nodes
  const treeSize = measureTree(data.tree);
  const padding = 40;
  positionNodes(data.tree, padding, padding, treeSize.width);

  // Create SVG
  const svgWidth = maxX + padding * 2;
  const svgHeight = maxY + padding * 2;

  let svg = `<svg class="branches-svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">`;

  // Draw connections first (so they're behind nodes)
  function drawConnections(node) {
    const pos = positions.get(node.id);
    if (!pos) return;

    if (node.children) {
      for (const child of node.children) {
        const childPos = positions.get(child.id);
        if (childPos) {
          // Draw curved line from parent bottom center to child top center
          const x1 = pos.x + nodeWidth / 2;
          const y1 = pos.y + nodeHeight;
          const x2 = childPos.x + nodeWidth / 2;
          const y2 = childPos.y;
          const midY = (y1 + y2) / 2;

          svg += `<path class="branch-line" d="M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}" />`;

          // Add fork point label
          if (child.forkIndex != null) {
            const labelX = (x1 + x2) / 2;
            const labelY = midY;
            svg += `<text class="branch-fork-label" x="${labelX}" y="${labelY}">msg #${child.forkIndex + 1}</text>`;
          }
        }
        drawConnections(child);
      }
    }
  }
  drawConnections(data.tree);

  // Draw nodes
  function drawNodes(node) {
    const pos = positions.get(node.id);
    if (!pos) return;

    const isCurrent = node.id === data.currentId;
    const nodeClass = isCurrent ? 'branch-node current' : 'branch-node';

    svg += `<g class="${nodeClass}" data-id="${node.id}" transform="translate(${pos.x}, ${pos.y})">`;
    svg += `<rect class="branch-node-bg" width="${nodeWidth}" height="${nodeHeight}" rx="8" />`;
    svg += `<text class="branch-node-name" x="${nodeWidth / 2}" y="20">${escapeHtml(truncate(node.name, 18))}</text>`;
    svg += `<text class="branch-node-count" x="${nodeWidth / 2}" y="38">${node.messageCount} messages</text>`;
    svg += '</g>';

    if (node.children) {
      for (const child of node.children) {
        drawNodes(child);
      }
    }
  }
  drawNodes(data.tree);

  svg += '</svg>';

  // Wrap in container for pan/zoom
  branchesContent.innerHTML = `<div class="branches-container">${svg}</div>`;

  // Add click handlers to nodes
  branchesContent.querySelectorAll('.branch-node').forEach(node => {
    node.addEventListener('click', () => {
      const id = node.dataset.id;
      if (id && id !== data.currentId) {
        haptic(10);
        navigateToConversation(id);
      }
    });
  });

  // Setup pan/zoom
  setupPanZoom();
}

function truncate(text, len) {
  if (!text) return '';
  return text.length > len ? text.slice(0, len) + '...' : text;
}

function setupPanZoom() {
  const container = branchesContent.querySelector('.branches-container');
  if (!container) return;

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let isPanning = false;
  let startX = 0;
  let startY = 0;

  function updateTransform() {
    const svg = container.querySelector('svg');
    if (svg) {
      svg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    }
  }

  // Check if target is a node (skip panning for node interactions)
  function isNodeTarget(target) {
    return target.closest('.branch-node');
  }

  // Touch pan
  container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1 && !isNodeTarget(e.target)) {
      isPanning = true;
      startX = e.touches[0].clientX - translateX;
      startY = e.touches[0].clientY - translateY;
    }
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (isPanning && e.touches.length === 1) {
      translateX = e.touches[0].clientX - startX;
      translateY = e.touches[0].clientY - startY;
      updateTransform();
    }
  }, { passive: true });

  container.addEventListener('touchend', () => {
    isPanning = false;
  }, { passive: true });

  // Mouse pan
  container.addEventListener('mousedown', (e) => {
    if (isNodeTarget(e.target)) return;
    isPanning = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
    container.style.cursor = 'grabbing';
  });

  container.addEventListener('mousemove', (e) => {
    if (isPanning) {
      translateX = e.clientX - startX;
      translateY = e.clientY - startY;
      updateTransform();
    }
  });

  container.addEventListener('mouseup', () => {
    isPanning = false;
    container.style.cursor = 'grab';
  });

  container.addEventListener('mouseleave', () => {
    isPanning = false;
    container.style.cursor = 'grab';
  });

  // Mouse wheel zoom
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    scale = Math.min(Math.max(0.5, scale * delta), 2);
    updateTransform();
  }, { passive: false });

  container.style.cursor = 'grab';
}

async function navigateToConversation(id) {
  // Import dynamically to avoid circular dependency
  const { openConversation } = await import('./conversations.js');
  closeBranchesView();
  openConversation(id);
}

export function showBranchesView(fromChat = false) {
  if (!branchesView) return;
  openedFromChat = fromChat;
  if (fromChat) {
    chatView.classList.remove('slide-in');
  } else {
    listView.classList.add('slide-out');
  }
  branchesView.classList.add('slide-in');
}

export function closeBranchesView() {
  if (!branchesView) return;
  branchesView.classList.remove('slide-in');
  if (openedFromChat) {
    chatView.classList.add('slide-in');
  } else {
    listView.classList.remove('slide-out');
  }
}

export function isBranchesViewOpen() {
  return branchesView && branchesView.classList.contains('slide-in');
}

export function openBranchesFromChat() {
  const currentId = state.getCurrentConversationId();
  if (!currentId) return;
  showBranchesView(true);
  loadBranchesTree(currentId);
}
