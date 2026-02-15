// --- Stats view rendering ---
import { escapeHtml } from '../markdown.js';
import { formatTokens, apiFetch } from '../utils.js';
import * as state from '../state.js';

// DOM elements (set by init)
let statsBtn = null;
let statsView = null;
let statsBackBtn = null;
let statsContent = null;
let listView = null;
let convStatsBtn = null;
let convStatsDropdown = null;

export function initStats(elements) {
  statsBtn = elements.statsBtn;
  statsView = elements.statsView;
  statsBackBtn = elements.statsBackBtn;
  statsContent = elements.statsContent;
  listView = elements.listView;
  convStatsBtn = elements.convStatsBtn;
  convStatsDropdown = elements.convStatsDropdown;
}

export async function loadStats() {
  statsContent.innerHTML = `
    <div class="stat-cards">
      ${Array(4).fill(`
        <div class="stat-card">
          <div class="skeleton-line" style="width:60%;height:24px"></div>
          <div class="skeleton-line" style="width:45%;height:12px;margin-top:6px"></div>
          <div class="skeleton-line" style="width:70%;height:11px;margin-top:4px"></div>
        </div>
      `).join('')}
    </div>
    <div class="stat-section">
      <div class="skeleton-line" style="width:30%;height:13px;margin-bottom:12px"></div>
      <div class="skeleton-line" style="width:100%;height:80px"></div>
    </div>
  `;
  const res = await apiFetch('/api/stats');
  if (!res) {
    statsContent.innerHTML = '<div class="stats-loading">Failed to load stats</div>';
    return;
  }
  const s = await res.json();
  renderStats(s);
}

function renderStats(s) {
  const avgPerConv = s.conversations.total ? (s.messages.total / s.conversations.total).toFixed(1) : 0;
  const avgCostPerConv = s.conversations.total ? (s.cost / s.conversations.total).toFixed(4) : 0;
  const userWords = Math.round(s.characters.user / 5);
  const assistantWords = Math.round(s.characters.assistant / 5);

  // Daily activity chart
  const maxDaily = Math.max(...s.dailyActivity.map(d => d.count), 1);
  const barsHtml = s.dailyActivity.map(d => {
    const pct = (d.count / maxDaily) * 100;
    return `<div class="bar-col" title="${d.date}: ${d.count} messages">` +
      `<div class="bar" style="height:${pct}%"></div>` +
      `</div>`;
  }).join('');

  // Hourly chart
  const maxHourly = Math.max(...s.hourlyCounts, 1);
  const hourBarsHtml = s.hourlyCounts.map((count, h) => {
    const pct = (count / maxHourly) * 100;
    return `<div class="bar-col" title="${h}:00 — ${count} messages">` +
      `<div class="bar" style="height:${pct}%"></div>` +
      `</div>`;
  }).join('');

  // Top conversations
  const topHtml = s.topConversations.map(c =>
    `<div class="top-conv-row">` +
      `<span class="top-conv-name">${escapeHtml(c.name)}</span>` +
      `<span class="top-conv-stat">${c.messages} msgs &middot; $${c.cost.toFixed(4)}</span>` +
    `</div>`
  ).join('');

  statsContent.innerHTML = `
    <div class="stat-cards">
      <div class="stat-card accent">
        <div class="stat-value">${s.conversations.total}</div>
        <div class="stat-label">Conversations</div>
        <div class="stat-sub">${s.conversations.active} active &middot; ${s.conversations.archived} archived</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${s.messages.total.toLocaleString()}</div>
        <div class="stat-label">Messages</div>
        <div class="stat-sub">${s.messages.user} you &middot; ${s.messages.assistant} Claude</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">$${s.cost.toFixed(2)}</div>
        <div class="stat-label">Total Cost</div>
        <div class="stat-sub">~$${avgCostPerConv} per conversation</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${s.streak}</div>
        <div class="stat-label">Day Streak</div>
        <div class="stat-sub">${s.duration > 3600 ? (s.duration / 3600).toFixed(1) + 'h' : Math.round(s.duration / 60) + 'min'} total think time</div>
      </div>
    </div>

    <div class="stat-section">
      <div class="stat-section-title">Last 30 Days</div>
      <div class="bar-chart">${barsHtml}</div>
      <div class="bar-chart-labels"><span>${s.dailyActivity[0].date.slice(5)}</span><span>Today</span></div>
    </div>

    <div class="stat-section">
      <div class="stat-section-title">Activity by Hour</div>
      <div class="bar-chart hours">${hourBarsHtml}</div>
      <div class="bar-chart-labels"><span>12am</span><span>12pm</span><span>11pm</span></div>
    </div>

    <div class="stat-section">
      <div class="stat-section-title">Words Exchanged</div>
      <div class="words-row">
        <div class="words-bar-label">You</div>
        <div class="words-bar-track"><div class="words-bar you" style="width:${Math.round(userWords / (userWords + assistantWords) * 100)}%"></div></div>
        <div class="words-bar-count">${userWords.toLocaleString()}</div>
      </div>
      <div class="words-row">
        <div class="words-bar-label">Claude</div>
        <div class="words-bar-track"><div class="words-bar claude" style="width:${Math.round(assistantWords / (userWords + assistantWords) * 100)}%"></div></div>
        <div class="words-bar-count">${assistantWords.toLocaleString()}</div>
      </div>
    </div>

    <div class="stat-section">
      <div class="stat-section-title">Top Conversations</div>
      ${topHtml}
    </div>

    <div class="stat-section">
      <div class="stat-section-title">Fun Facts</div>
      <div class="fun-facts">
        <div class="fun-fact">${avgPerConv} avg messages per conversation</div>
        <div class="fun-fact">${assistantWords > 10000 ? (assistantWords / 1000).toFixed(0) + 'k' : assistantWords} words from Claude (~${Math.round(assistantWords / 250)} pages)</div>
        <div class="fun-fact">${s.duration > 0 ? '$' + (s.cost / (s.duration / 3600)).toFixed(2) + '/hr of Claude think time' : 'No response time yet'}</div>
      </div>
    </div>
  `;
}

// Show conversation stats dropdown
export function showConvStatsDropdown() {
  if (!convStatsDropdown) return;
  const currentId = state.getCurrentConversationId();
  const conv = state.conversations.find(c => c.id === currentId);
  if (!conv) return;

  const messages = state.getAllMessages();
  const userMsgs = messages.filter(m => m.role === 'user').length;
  const assistantMsgs = messages.filter(m => m.role === 'assistant').length;
  const totalCost = messages.reduce((sum, m) => sum + (m.cost || 0), 0);
  const totalInput = messages.reduce((sum, m) => sum + (m.inputTokens || 0), 0);
  const totalOutput = messages.reduce((sum, m) => sum + (m.outputTokens || 0), 0);

  convStatsDropdown.innerHTML = `
    <div class="conv-stats-row"><span class="conv-stats-label">Messages</span><span class="conv-stats-value">${userMsgs} / ${assistantMsgs}</span></div>
    <div class="conv-stats-row"><span class="conv-stats-label">Tokens in</span><span class="conv-stats-value">${formatTokens(totalInput)}</span></div>
    <div class="conv-stats-row"><span class="conv-stats-label">Tokens out</span><span class="conv-stats-value">${formatTokens(totalOutput)}</span></div>
    <div class="conv-stats-row"><span class="conv-stats-label">Total cost</span><span class="conv-stats-value">$${totalCost.toFixed(4)}</span></div>
  `;
  convStatsDropdown.classList.remove('hidden');
}

// --- Event listener setup for stats-related elements ---
export function setupStatsEventListeners() {
  // Stats button (in list view header)
  statsBtn.addEventListener('click', () => {
    listView.classList.add('slide-out');
    statsView.classList.add('slide-in');
    loadStats();
  });

  statsBackBtn.addEventListener('click', () => {
    statsView.classList.remove('slide-in');
    listView.classList.remove('slide-out');
  });

  // Conversation stats dropdown handler
  if (convStatsBtn) {
    convStatsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !convStatsDropdown.classList.contains('hidden');
      if (isOpen) {
        convStatsDropdown.classList.add('hidden');
        return;
      }
      showConvStatsDropdown();
    });
  }
}
