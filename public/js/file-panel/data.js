// --- Data Tab (DuckDB SQL Analysis) ---
import { escapeHtml } from '../markdown.js';
import { haptic, showToast, apiFetch } from '../utils.js';
import * as state from '../state.js';

// DOM elements (set by init)
let _dataView = null;
let sqlEditor = null;
let runQueryBtn = null;
let queryHistoryBtn = null;
let queryHistoryDropdown = null;
let tablesContainer = null;
let loadTableBtn = null;
let resultsContainer = null;
let queryStatus = null;

// State
let queryHistory = [];
let maxHistory = 20;
let loadedTables = [];
let currentHistoryConvId = null;

// Callback for switching to files tab (set by index.js)
let switchToFilesTabFn = null;

/**
 * Set callback for switching to files tab
 */
export function setSwitchToFilesTab(fn) {
  switchToFilesTabFn = fn;
}

/**
 * Load query history for current conversation from server
 */
async function loadHistory() {
  const convId = state.getCurrentConversationId();
  if (!convId) {
    queryHistory = [];
    currentHistoryConvId = null;
    return;
  }

  // Only reload if conversation changed
  if (convId === currentHistoryConvId) return;

  currentHistoryConvId = convId;

  try {
    const res = await apiFetch(`/api/duckdb/history/${convId}`, { silent: true });
    if (res) {
      const data = await res.json();
      queryHistory = data.history || [];
      maxHistory = data.maxHistory || 20;
    } else {
      queryHistory = [];
    }
  } catch {
    queryHistory = [];
  }
}

/**
 * Copy query history from one conversation to another (used for forking)
 */
export async function copyQueryHistory(fromConvId, toConvId) {
  try {
    await apiFetch(`/api/duckdb/history/${toConvId}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromConversationId: fromConvId }),
      silent: true
    });
  } catch {
    // Ignore errors
  }
}

/**
 * Add query to history
 */
async function addToHistory(sql) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  // Optimistic update
  queryHistory = queryHistory.filter(q => q !== sql);
  queryHistory.unshift(sql);
  if (queryHistory.length > maxHistory) {
    queryHistory = queryHistory.slice(0, maxHistory);
  }

  // Persist to server
  try {
    await apiFetch(`/api/duckdb/history/${convId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
      silent: true
    });
  } catch {
    // Ignore errors - local state already updated
  }
}

/**
 * Initialize data tab elements
 */
export function initDataTab(elements) {
  _dataView = elements.dataView;
  sqlEditor = elements.sqlEditor;
  runQueryBtn = elements.runQueryBtn;
  queryHistoryBtn = elements.queryHistoryBtn;
  queryHistoryDropdown = elements.queryHistoryDropdown;
  tablesContainer = elements.tablesContainer;
  loadTableBtn = elements.loadTableBtn;
  resultsContainer = elements.resultsContainer;
  queryStatus = elements.queryStatus;
  // History is loaded when switching to data tab via loadDataTabState()
}

/**
 * Setup data tab event listeners
 */
export function setupDataTabEventListeners() {
  // Run query button
  if (runQueryBtn) {
    runQueryBtn.addEventListener('click', () => {
      haptic();
      runQuery();
    });
  }

  // Keyboard shortcut: Cmd/Ctrl+Enter to run query
  if (sqlEditor) {
    sqlEditor.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        haptic();
        runQuery();
      }
    });
  }

  // Query history toggle
  if (queryHistoryBtn) {
    queryHistoryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      haptic();
      toggleHistoryDropdown();
    });
  }

  // Close history dropdown on outside click
  document.addEventListener('click', (e) => {
    if (queryHistoryDropdown && !queryHistoryDropdown.contains(e.target) && e.target !== queryHistoryBtn) {
      queryHistoryDropdown.classList.add('hidden');
    }
  });

  // Load table button
  if (loadTableBtn) {
    loadTableBtn.addEventListener('click', () => {
      haptic();
      showLoadTableDialog();
    });
  }
}

/**
 * Load and display the current state of loaded tables
 */
export async function loadDataTabState() {
  // Reload history for current conversation
  await loadHistory();
  await refreshTables();
}

/**
 * Refresh the list of loaded tables
 */
export async function refreshTables() {
  const res = await apiFetch('/api/duckdb/tables', { silent: true });
  if (!res) {
    loadedTables = [];
    renderTables();
    return;
  }

  const data = await res.json();
  const allTables = data.tables || [];

  // Filter tables by current conversation's cwd
  const convId = state.getCurrentConversationId();
  const conv = state.conversations.find(c => c.id === convId);
  const cwd = conv?.cwd || '';

  if (cwd) {
    // Only show tables whose files are within this conversation's cwd
    loadedTables = allTables.filter(t => t.filePath && t.filePath.startsWith(cwd));
  } else {
    loadedTables = allTables;
  }

  renderTables();
}

// Currently open schema dropdown
let activeSchemaDropdown = null;

/**
 * Render loaded tables as chips
 */
function renderTables() {
  if (!tablesContainer) return;

  // Close any open schema dropdown
  closeSchemaDropdown();

  if (loadedTables.length === 0) {
    tablesContainer.innerHTML = '<span class="data-tab-no-tables">No tables loaded</span>';
    return;
  }

  tablesContainer.innerHTML = loadedTables.map(table => `
    <div class="data-tab-table-wrapper">
      <button class="data-tab-table-chip" data-table="${escapeHtml(table.name)}">
        <span class="table-name">${escapeHtml(table.name)}</span>
        <span class="table-count">${Number(table.rowCount)?.toLocaleString() || '?'} rows</span>
        <svg class="table-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
  `).join('');

  // Attach click handlers
  tablesContainer.querySelectorAll('.data-tab-table-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      haptic();
      const tableName = chip.dataset.table;
      const table = loadedTables.find(t => t.name === tableName);
      if (table) {
        toggleSchemaDropdown(chip.parentElement, table);
      }
    });
  });
}

/**
 * Toggle schema dropdown for a table
 */
function toggleSchemaDropdown(wrapper, table) {
  // Close existing dropdown
  if (activeSchemaDropdown) {
    const isCurrentTable = activeSchemaDropdown.dataset.table === table.name;
    closeSchemaDropdown();
    if (isCurrentTable) return; // Toggle off
  }

  // Create dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'data-tab-schema-dropdown';
  dropdown.dataset.table = table.name;

  const columns = table.columns || [];
  const columnsHtml = columns.length > 0
    ? columns.map(col => `
        <div class="schema-column">
          <span class="schema-col-name">${escapeHtml(col.name)}</span>
          <span class="schema-col-type">${escapeHtml(col.type)}</span>
        </div>
      `).join('')
    : '<div class="schema-empty">No columns</div>';

  dropdown.innerHTML = `
    <div class="schema-header">
      <span class="schema-title">${escapeHtml(table.name)}</span>
      <span class="schema-row-count">${Number(table.rowCount)?.toLocaleString() || '?'} rows</span>
    </div>
    <div class="schema-columns">${columnsHtml}</div>
    <div class="schema-actions">
      <button class="schema-action-btn schema-insert-btn">Insert into query</button>
      <button class="schema-action-btn schema-drop-btn">Drop table</button>
    </div>
  `;

  wrapper.appendChild(dropdown);
  activeSchemaDropdown = dropdown;

  // Attach action handlers
  dropdown.querySelector('.schema-insert-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    insertTableReference(table.name);
    closeSchemaDropdown();
  });

  dropdown.querySelector('.schema-drop-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    closeSchemaDropdown();
    dropTable(table.name);
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', closeSchemaDropdownOnOutsideClick);
  }, 0);
}

/**
 * Close schema dropdown
 */
function closeSchemaDropdown() {
  if (activeSchemaDropdown) {
    activeSchemaDropdown.remove();
    activeSchemaDropdown = null;
    document.removeEventListener('click', closeSchemaDropdownOnOutsideClick);
  }
}

/**
 * Close schema dropdown on outside click
 */
function closeSchemaDropdownOnOutsideClick(e) {
  if (activeSchemaDropdown && !activeSchemaDropdown.contains(e.target)) {
    closeSchemaDropdown();
  }
}

/**
 * Insert a table reference into the SQL editor
 */
function insertTableReference(tableName) {
  if (!sqlEditor) return;

  const currentSql = sqlEditor.value.trim();
  if (!currentSql) {
    sqlEditor.value = `SELECT * FROM "${tableName}" LIMIT 100`;
  } else {
    // Insert at cursor position
    const start = sqlEditor.selectionStart;
    const end = sqlEditor.selectionEnd;
    const text = `"${tableName}"`;
    sqlEditor.value = currentSql.substring(0, start) + text + currentSql.substring(end);
    sqlEditor.selectionStart = sqlEditor.selectionEnd = start + text.length;
  }
  sqlEditor.focus();
}

/**
 * Drop a table
 */
async function dropTable(tableName) {
  const res = await apiFetch(`/api/duckdb/tables/${encodeURIComponent(tableName)}`, {
    method: 'DELETE'
  });

  if (res) {
    showToast('Table dropped');
    await refreshTables();
  }
}

/**
 * Switch to Files tab to browse and load files
 */
function showLoadTableDialog() {
  if (switchToFilesTabFn) {
    switchToFilesTabFn();
    showToast('Click the table icon on CSV/JSON/Parquet files to load');
  } else {
    showToast('Browse files in Files tab to load data');
  }
}

/**
 * Load a table from a file
 */
async function _loadTableFromFile(filePath, conversationId) {
  const res = await apiFetch('/api/duckdb/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, conversationId })
  });

  if (!res) return;

  const data = await res.json();
  showToast(`Loaded ${data.tableName} (${data.rowCount?.toLocaleString() || 0} rows)`);
  await refreshTables();

  // Auto-generate a query
  if (sqlEditor && !sqlEditor.value.trim()) {
    sqlEditor.value = `SELECT * FROM "${data.tableName}" LIMIT 100`;
  }
}

/**
 * Run the current SQL query
 */
async function runQuery() {
  if (!sqlEditor) return;

  const sql = sqlEditor.value.trim();
  if (!sql) {
    showToast('Enter a SQL query');
    return;
  }

  // Update status
  if (queryStatus) {
    queryStatus.textContent = 'Running...';
    queryStatus.classList.add('running');
  }

  if (runQueryBtn) {
    runQueryBtn.disabled = true;
  }

  const startTime = Date.now();

  const res = await apiFetch('/api/duckdb/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, limit: 1000 })
  });

  if (runQueryBtn) {
    runQueryBtn.disabled = false;
  }

  if (!res) {
    if (queryStatus) {
      queryStatus.textContent = 'Error';
      queryStatus.classList.remove('running');
    }
    renderError('Query failed');
    return;
  }

  const data = await res.json();

  if (data.error) {
    if (queryStatus) {
      queryStatus.textContent = 'Error';
      queryStatus.classList.remove('running');
    }
    renderError(data.error);
    return;
  }

  // Add to history
  addToHistory(sql);

  // Update status
  if (queryStatus) {
    const elapsed = data.executionTimeMs || (Date.now() - startTime);
    const rowInfo = data.truncated
      ? `${data.rowCount} rows (truncated)`
      : `${data.rowCount} rows`;
    queryStatus.textContent = `${elapsed}ms \u2022 ${rowInfo}`;
    queryStatus.classList.remove('running');
  }

  renderResults(data);
}

/**
 * Render query results as a table
 */
function renderResults(data) {
  if (!resultsContainer) return;

  const { columns, rows } = data;

  if (!columns || columns.length === 0) {
    resultsContainer.innerHTML = '<div class="data-tab-empty">No results</div>';
    return;
  }

  // Build table
  const headerCells = columns.map(col => `
    <th title="${escapeHtml(col.type)}">${escapeHtml(col.name)}<span class="col-type">${escapeHtml(col.type)}</span></th>
  `).join('');

  const dataRows = rows.map((row, idx) => {
    const cells = row.map(cell => {
      const cellStr = cell === null ? '<null>' : cell === undefined ? '' : String(cell);
      const truncated = cellStr.length > 100 ? cellStr.slice(0, 100) + '...' : cellStr;
      const isNull = cell === null;
      return `<td class="copyable-cell${isNull ? ' null-cell' : ''}" data-value="${escapeHtml(cellStr)}" title="Click to copy">${escapeHtml(truncated)}</td>`;
    }).join('');
    return `<tr><td class="row-num">${idx + 1}</td>${cells}</tr>`;
  }).join('');

  resultsContainer.innerHTML = `
    <div class="data-tab-results-wrapper">
      <table class="data-preview-table">
        <thead><tr><th class="row-num-header">#</th>${headerCells}</tr></thead>
        <tbody>${dataRows}</tbody>
      </table>
    </div>
  `;

  // Attach copy handlers
  resultsContainer.querySelectorAll('.copyable-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const value = cell.dataset.value;
      navigator.clipboard.writeText(value).then(() => {
        cell.classList.add('copied');
        setTimeout(() => cell.classList.remove('copied'), 1000);
      });
    });
  });
}

/**
 * Render an error message
 */
function renderError(message) {
  if (!resultsContainer) return;

  resultsContainer.innerHTML = `
    <div class="data-tab-error">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

/**
 * Toggle query history dropdown
 */
function toggleHistoryDropdown() {
  if (!queryHistoryDropdown) return;

  const isHidden = queryHistoryDropdown.classList.contains('hidden');

  if (isHidden) {
    // Render history items
    if (queryHistory.length === 0) {
      queryHistoryDropdown.innerHTML = '<div class="history-empty">No history</div>';
    } else {
      const itemsHtml = queryHistory.map((sql, i) => `
        <button class="history-item" data-index="${i}" title="${escapeHtml(sql)}">
          ${escapeHtml(sql.length > 50 ? sql.slice(0, 50) + '...' : sql)}
        </button>
      `).join('');

      queryHistoryDropdown.innerHTML = `
        <div class="history-items">${itemsHtml}</div>
        <button class="history-clear-btn">Clear history</button>
      `;

      // Attach click handlers for history items
      queryHistoryDropdown.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', () => {
          const idx = parseInt(item.dataset.index, 10);
          if (sqlEditor && queryHistory[idx]) {
            sqlEditor.value = queryHistory[idx];
            queryHistoryDropdown.classList.add('hidden');
          }
        });
      });

      // Attach clear handler
      queryHistoryDropdown.querySelector('.history-clear-btn').addEventListener('click', () => {
        clearHistory();
        queryHistoryDropdown.classList.add('hidden');
      });
    }

    queryHistoryDropdown.classList.remove('hidden');
  } else {
    queryHistoryDropdown.classList.add('hidden');
  }
}

/**
 * Clear query history for current conversation
 */
async function clearHistory() {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  queryHistory = [];

  try {
    await apiFetch(`/api/duckdb/history/${convId}`, {
      method: 'DELETE',
      silent: true
    });
  } catch {
    // Ignore errors
  }

  showToast('History cleared');
}

/**
 * Profile a file and show results
 * Called from file browser context menu
 */
export async function profileFile(filePath, conversationId) {
  const res = await apiFetch(`/api/duckdb/profile?path=${encodeURIComponent(filePath)}&conversationId=${conversationId}`, {
    silent: false
  });

  if (!res) return null;

  const data = await res.json();
  return data;
}
