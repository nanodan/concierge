// --- Data Tab (DuckDB + BigQuery SQL Analysis) ---
import { escapeHtml } from '../markdown.js';
import { haptic, showToast, apiFetch } from '../utils.js';
import * as state from '../state.js';

const DATA_SOURCE_DUCKDB = 'duckdb';
const DATA_SOURCE_BIGQUERY = 'bigquery';

// DOM elements (set by init)
let _dataView = null;
let dataSourceSelect = null;
let dataTablesRow = null;
let bigQueryControls = null;
let bigQueryAuthStatus = null;
let bigQueryConnectBtn = null;
let bigQueryProjectSelect = null;
let sqlEditor = null;
let runQueryBtn = null;
let cancelQueryBtn = null;
let queryHistoryBtn = null;
let queryHistoryDropdown = null;
let tablesContainer = null;
let loadTableBtn = null;
let resultsContainer = null;
let queryStatus = null;

// State
let querySource = DATA_SOURCE_DUCKDB;
let queryHistory = [];
let maxHistory = 20;
let loadedTables = [];
let currentHistoryConvId = null;
let lastQueryResults = null;
let lastQuerySQL = null;
let lastQuerySource = DATA_SOURCE_DUCKDB;
let lastBigQueryJob = null;

let bigQueryConfigured = false;
let bigQueryConnected = false;
let bigQueryPrincipal = null;
let bigQueryDefaultProject = null;
let bigQueryProjects = [];
const bigQueryProjectByConversation = new Map();
let activeBigQueryJob = null;
let bigQueryPollTimer = null;

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
      silent: true,
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

  queryHistory = queryHistory.filter((q) => q !== sql);
  queryHistory.unshift(sql);
  if (queryHistory.length > maxHistory) {
    queryHistory = queryHistory.slice(0, maxHistory);
  }

  try {
    await apiFetch(`/api/duckdb/history/${convId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
      silent: true,
    });
  } catch {
    // Ignore persistence errors - local history already updated
  }
}

/**
 * Initialize data tab elements
 */
export function initDataTab(elements) {
  _dataView = elements.dataView;
  dataSourceSelect = elements.dataSourceSelect;
  dataTablesRow = elements.dataTablesRow;
  bigQueryControls = elements.bigQueryControls;
  bigQueryAuthStatus = elements.bigQueryAuthStatus;
  bigQueryConnectBtn = elements.bigQueryConnectBtn;
  bigQueryProjectSelect = elements.bigQueryProjectSelect;
  sqlEditor = elements.sqlEditor;
  runQueryBtn = elements.runQueryBtn;
  cancelQueryBtn = elements.cancelQueryBtn;
  queryHistoryBtn = elements.queryHistoryBtn;
  queryHistoryDropdown = elements.queryHistoryDropdown;
  tablesContainer = elements.tablesContainer;
  loadTableBtn = elements.loadTableBtn;
  resultsContainer = elements.resultsContainer;
  queryStatus = elements.queryStatus;
}

/**
 * Setup data tab event listeners
 */
export function setupDataTabEventListeners() {
  if (runQueryBtn) {
    runQueryBtn.addEventListener('click', () => {
      haptic();
      runQuery();
    });
  }

  if (cancelQueryBtn) {
    cancelQueryBtn.addEventListener('click', () => {
      haptic();
      cancelBigQueryQuery();
    });
  }

  if (sqlEditor) {
    sqlEditor.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        haptic();
        runQuery();
      }
    });
  }

  if (queryHistoryBtn) {
    queryHistoryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      haptic();
      toggleHistoryDropdown();
    });
  }

  document.addEventListener('click', (e) => {
    if (queryHistoryDropdown && !queryHistoryDropdown.contains(e.target) && e.target !== queryHistoryBtn) {
      queryHistoryDropdown.classList.add('hidden');
    }
  });

  if (loadTableBtn) {
    loadTableBtn.addEventListener('click', () => {
      haptic();
      showLoadTableDialog();
    });
  }

  if (dataSourceSelect) {
    dataSourceSelect.addEventListener('change', () => {
      querySource = dataSourceSelect.value === DATA_SOURCE_BIGQUERY ? DATA_SOURCE_BIGQUERY : DATA_SOURCE_DUCKDB;
      stopBigQueryPolling();
      activeBigQueryJob = null;
      setQueryRunningState(false);
      applyDataSourceMode();
      if (querySource === DATA_SOURCE_DUCKDB) {
        refreshTables();
      } else {
        void loadBigQueryState({ forceProjects: false });
      }
    });
  }

  if (bigQueryConnectBtn) {
    bigQueryConnectBtn.addEventListener('click', () => {
      haptic();
      refreshBigQueryAuth();
    });
  }

  if (bigQueryProjectSelect) {
    bigQueryProjectSelect.addEventListener('change', () => {
      const convId = state.getCurrentConversationId();
      if (!convId) return;
      if (bigQueryProjectSelect.value) {
        bigQueryProjectByConversation.set(convId, bigQueryProjectSelect.value);
      }
    });
  }

}

/**
 * Load and display current data tab state
 */
export async function loadDataTabState() {
  await loadHistory();
  await loadBigQueryState({ forceProjects: false });

  applyDataSourceMode();

  if (querySource === DATA_SOURCE_DUCKDB) {
    await refreshTables();
  }
}

function setStatus(text, running = false) {
  if (!queryStatus) return;
  queryStatus.textContent = text || '';
  queryStatus.classList.toggle('running', running);
}

function setQueryRunningState(running) {
  if (runQueryBtn) {
    runQueryBtn.disabled = running;
  }

  if (cancelQueryBtn) {
    const showCancel = running && querySource === DATA_SOURCE_BIGQUERY;
    cancelQueryBtn.classList.toggle('hidden', !showCancel);
    cancelQueryBtn.disabled = !showCancel;
  }
}

function applyDataSourceMode() {
  if (dataSourceSelect) {
    dataSourceSelect.value = querySource;
  }

  const isDuck = querySource === DATA_SOURCE_DUCKDB;

  if (dataTablesRow) {
    dataTablesRow.classList.toggle('hidden', !isDuck);
  }

  if (loadTableBtn) {
    loadTableBtn.classList.toggle('hidden', !isDuck);
  }

  if (bigQueryControls) {
    bigQueryControls.classList.toggle('hidden', isDuck);
  }

  if (sqlEditor) {
    sqlEditor.placeholder = isDuck
      ? 'SELECT * FROM table LIMIT 100'
      : 'SELECT * FROM `project.dataset.table` LIMIT 100';
  }

  if (querySource === DATA_SOURCE_BIGQUERY) {
    updateBigQueryControls();
  }
}

function getCurrentBigQueryProjectId() {
  if (bigQueryProjectSelect?.value) {
    return bigQueryProjectSelect.value;
  }

  const convId = state.getCurrentConversationId();
  if (!convId) return '';
  return bigQueryProjectByConversation.get(convId) || '';
}

function updateBigQueryProjectSelect() {
  if (!bigQueryProjectSelect) return;

  const convId = state.getCurrentConversationId();
  const savedProject = convId ? bigQueryProjectByConversation.get(convId) : null;
  const options = bigQueryProjects || [];

  let selected = savedProject || '';
  if (selected && !options.some((p) => p.id === selected)) {
    selected = '';
  }
  if (!selected && options.length > 0) {
    selected = options[0].id;
  }

  if (convId && selected) {
    bigQueryProjectByConversation.set(convId, selected);
  }

  if (!bigQueryConnected) {
    bigQueryProjectSelect.innerHTML = '<option value="">ADC unavailable</option>';
    bigQueryProjectSelect.disabled = true;
    return;
  }

  if (options.length === 0) {
    bigQueryProjectSelect.innerHTML = '<option value="">No projects found</option>';
    bigQueryProjectSelect.disabled = true;
    return;
  }

  bigQueryProjectSelect.innerHTML = options.map((project) => `
    <option value="${escapeHtml(project.id)}">${escapeHtml(project.friendlyName || project.id)}</option>
  `).join('');
  bigQueryProjectSelect.disabled = false;
  bigQueryProjectSelect.value = selected;
}

function updateBigQueryControls(message = '') {
  if (!bigQueryControls) return;

  if (!bigQueryConfigured) {
    if (bigQueryAuthStatus) {
      bigQueryAuthStatus.textContent = message || 'BigQuery ADC unavailable';
    }
    if (bigQueryConnectBtn) {
      bigQueryConnectBtn.classList.remove('hidden');
      bigQueryConnectBtn.textContent = 'Recheck';
    }
    if (bigQueryProjectSelect) {
      bigQueryProjectSelect.innerHTML = '<option value="">Unavailable</option>';
      bigQueryProjectSelect.disabled = true;
    }
    return;
  }

  if (bigQueryConnected) {
    if (bigQueryAuthStatus) {
      const projectLabel = bigQueryDefaultProject ? ` • ${bigQueryDefaultProject}` : '';
      const userLabel = bigQueryPrincipal ? `${bigQueryPrincipal}${projectLabel}` : `ADC active${projectLabel}`;
      bigQueryAuthStatus.textContent = userLabel;
    }
    if (bigQueryConnectBtn) {
      bigQueryConnectBtn.classList.remove('hidden');
      bigQueryConnectBtn.textContent = 'Refresh';
    }
  } else {
    if (bigQueryAuthStatus) {
      bigQueryAuthStatus.textContent = message || 'ADC not ready';
    }
    if (bigQueryConnectBtn) {
      bigQueryConnectBtn.classList.remove('hidden');
      bigQueryConnectBtn.textContent = 'Recheck';
    }
  }

  updateBigQueryProjectSelect();
}

async function loadBigQueryProjects() {
  if (!bigQueryConnected) {
    bigQueryProjects = [];
    updateBigQueryProjectSelect();
    return;
  }

  const res = await apiFetch('/api/bigquery/projects', { silent: true });
  if (!res) {
    bigQueryProjects = [];
    updateBigQueryProjectSelect();
    return;
  }

  const data = await res.json();
  bigQueryProjects = (data.projects || []).slice().sort((a, b) => {
    const aName = a.friendlyName || a.id;
    const bName = b.friendlyName || b.id;
    return aName.localeCompare(bName);
  });
  updateBigQueryProjectSelect();
}

async function loadBigQueryState({ forceProjects = false, forceRefresh = false } = {}) {
  const statusUrl = forceRefresh ? '/api/bigquery/auth/status?refresh=1' : '/api/bigquery/auth/status';
  const res = await apiFetch(statusUrl, { silent: true });
  if (!res) {
    bigQueryConfigured = false;
    bigQueryConnected = false;
    bigQueryPrincipal = null;
    bigQueryDefaultProject = null;
    bigQueryProjects = [];
    updateBigQueryControls('BigQuery status unavailable');
    return;
  }

  const status = await res.json();
  bigQueryConfigured = status.configured !== false;
  bigQueryConnected = Boolean(status.connected);
  bigQueryPrincipal = status.principal || null;
  bigQueryDefaultProject = status.defaultProjectId || null;

  if (bigQueryConnected && bigQueryDefaultProject) {
    const convId = state.getCurrentConversationId();
    if (convId && !bigQueryProjectByConversation.get(convId)) {
      bigQueryProjectByConversation.set(convId, bigQueryDefaultProject);
    }
  }

  if (bigQueryConnected && (forceProjects || bigQueryProjects.length === 0)) {
    await loadBigQueryProjects();
  } else if (!bigQueryConnected) {
    bigQueryProjects = [];
  }

  updateBigQueryControls(status.message || '');
}

async function refreshBigQueryAuth() {
  const res = await apiFetch('/api/bigquery/auth/refresh', {
    method: 'POST',
    silent: true,
  });
  if (res) {
    const status = await res.json();
    if (status.connected) {
      showToast('BigQuery ADC ready');
    } else {
      showToast(status.message || 'ADC not ready', { variant: 'error' });
    }
  } else {
    showToast('ADC check failed', { variant: 'error' });
  }
  await loadBigQueryState({ forceProjects: true, forceRefresh: true });
}

function stopBigQueryPolling() {
  if (bigQueryPollTimer) {
    clearTimeout(bigQueryPollTimer);
    bigQueryPollTimer = null;
  }
}

function formatBigQueryBytes(bytesValue) {
  const n = Number(bytesValue || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function formatBigQueryStatus(data) {
  const rowInfo = data.truncated
    ? `${data.rowCount} rows (preview)`
    : `${data.rowCount} rows`;
  const bytes = formatBigQueryBytes(data.totalBytesProcessed);
  const cache = data.cacheHit ? 'cache hit' : '';
  return [rowInfo, bytes, cache].filter(Boolean).join(' • ');
}

/**
 * Refresh the list of loaded tables
 */
export async function refreshTables() {
  if (querySource !== DATA_SOURCE_DUCKDB) {
    loadedTables = [];
    renderTables();
    return;
  }

  const res = await apiFetch('/api/duckdb/tables', { silent: true });
  if (!res) {
    loadedTables = [];
    renderTables();
    return;
  }

  const data = await res.json();
  const allTables = data.tables || [];

  const convId = state.getCurrentConversationId();
  const conv = state.conversations.find((c) => c.id === convId);
  const cwd = conv?.cwd || '';

  if (cwd) {
    loadedTables = allTables.filter((t) => t.filePath && t.filePath.startsWith(cwd));
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

  closeSchemaDropdown();

  if (querySource !== DATA_SOURCE_DUCKDB) {
    tablesContainer.innerHTML = '<span class="data-tab-no-tables">DuckDB tables are hidden in BigQuery mode</span>';
    return;
  }

  if (loadedTables.length === 0) {
    tablesContainer.innerHTML = '<span class="data-tab-no-tables">No tables loaded</span>';
    return;
  }

  tablesContainer.innerHTML = loadedTables.map((table) => `
    <div class="data-tab-table-wrapper">
      <button class="data-tab-table-chip" data-table="${escapeHtml(table.name)}">
        <span class="table-name">${escapeHtml(table.name)}</span>
        <span class="table-count">${Number(table.rowCount)?.toLocaleString() || '?'} rows</span>
        <svg class="table-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
  `).join('');

  tablesContainer.querySelectorAll('.data-tab-table-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      haptic();
      const tableName = chip.dataset.table;
      const table = loadedTables.find((t) => t.name === tableName);
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
  if (activeSchemaDropdown) {
    const isCurrentTable = activeSchemaDropdown.dataset.table === table.name;
    closeSchemaDropdown();
    if (isCurrentTable) return;
  }

  const dropdown = document.createElement('div');
  dropdown.className = 'data-tab-schema-dropdown';
  dropdown.dataset.table = table.name;

  const columns = table.columns || [];
  const columnsHtml = columns.length > 0
    ? columns.map((col) => `
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
    method: 'DELETE',
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
    body: JSON.stringify({ path: filePath, conversationId }),
  });

  if (!res) return;

  const data = await res.json();
  showToast(`Loaded ${data.tableName} (${data.rowCount?.toLocaleString() || 0} rows)`);
  await refreshTables();

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

  if (querySource === DATA_SOURCE_BIGQUERY) {
    await runBigQueryQuery(sql);
    return;
  }

  await runDuckDbQuery(sql);
}

async function runDuckDbQuery(sql) {
  setStatus('Running...', true);
  setQueryRunningState(true);

  const startTime = Date.now();
  const res = await apiFetch('/api/duckdb/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, limit: 1000 }),
  });

  setQueryRunningState(false);

  if (!res) {
    setStatus('Error', false);
    renderError('Query failed');
    return;
  }

  const data = await res.json();

  if (data.error) {
    setStatus('Error', false);
    renderError(data.error);
    return;
  }

  addToHistory(sql);
  lastQuerySQL = sql;
  lastQuerySource = DATA_SOURCE_DUCKDB;
  lastBigQueryJob = null;

  const elapsed = data.executionTimeMs || (Date.now() - startTime);
  const rowInfo = data.truncated
    ? `${data.rowCount} rows (truncated)`
    : `${data.rowCount} rows`;
  setStatus(`${elapsed}ms • ${rowInfo}`, false);

  renderResults(data, { source: DATA_SOURCE_DUCKDB });
}

async function runBigQueryQuery(sql) {
  if (!bigQueryConfigured) {
    showToast('BigQuery ADC is not configured', { variant: 'error' });
    return;
  }

  if (!bigQueryConnected) {
    showToast('Connect BigQuery first');
    return;
  }

  const projectId = getCurrentBigQueryProjectId();
  if (!projectId) {
    showToast('Select a BigQuery project');
    return;
  }

  const conversationId = state.getCurrentConversationId();
  if (!conversationId) {
    showToast('No conversation selected');
    return;
  }

  stopBigQueryPolling();
  activeBigQueryJob = null;

  setStatus('Running...', true);
  setQueryRunningState(true);

  const res = await apiFetch('/api/bigquery/query/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId,
      projectId,
      sql,
      maxResults: 1000,
    }),
  });

  if (!res) {
    setStatus('Error', false);
    setQueryRunningState(false);
    renderError('Query failed');
    return;
  }

  const data = await res.json();

  addToHistory(sql);
  lastQuerySQL = sql;
  lastQuerySource = DATA_SOURCE_BIGQUERY;
  lastBigQueryJob = data.job || null;

  if (data.jobComplete) {
    activeBigQueryJob = null;
    setQueryRunningState(false);
    setStatus(formatBigQueryStatus(data), false);
    renderResults(data, { source: DATA_SOURCE_BIGQUERY });
    return;
  }

  activeBigQueryJob = data.job || null;
  setStatus('BigQuery job running...', true);
  startBigQueryPolling();
}

function startBigQueryPolling() {
  stopBigQueryPolling();

  if (!activeBigQueryJob?.jobId) {
    setStatus('Missing BigQuery job id', false);
    setQueryRunningState(false);
    return;
  }

  const runPoll = async () => {
    const convId = state.getCurrentConversationId();
    const projectId = activeBigQueryJob.projectId || getCurrentBigQueryProjectId();

    if (!convId || !projectId) {
      stopBigQueryPolling();
      setQueryRunningState(false);
      setStatus('BigQuery polling stopped', false);
      return;
    }

    const qs = new URLSearchParams({
      conversationId: convId,
      projectId,
      jobId: activeBigQueryJob.jobId,
    });
    if (activeBigQueryJob.location) {
      qs.set('location', activeBigQueryJob.location);
    }

    const res = await apiFetch(`/api/bigquery/query/status?${qs.toString()}`, { silent: true });

    if (!res) {
      stopBigQueryPolling();
      setQueryRunningState(false);
      setStatus('BigQuery polling failed', false);
      renderError('Query status unavailable');
      return;
    }

    const data = await res.json();
    lastBigQueryJob = data.job || lastBigQueryJob;

    if (data.jobComplete) {
      activeBigQueryJob = null;
      stopBigQueryPolling();
      setQueryRunningState(false);
      setStatus(formatBigQueryStatus(data), false);
      renderResults(data, { source: DATA_SOURCE_BIGQUERY });
      return;
    }

    setStatus('BigQuery job running...', true);
    bigQueryPollTimer = setTimeout(runPoll, 1200);
  };

  bigQueryPollTimer = setTimeout(runPoll, 1200);
}

async function cancelBigQueryQuery() {
  const convId = state.getCurrentConversationId();
  const job = activeBigQueryJob || lastBigQueryJob;
  const projectId = job?.projectId || getCurrentBigQueryProjectId();

  if (!job?.jobId || !projectId) {
    showToast('No active BigQuery query');
    return;
  }

  setStatus('Cancelling...', true);

  const res = await apiFetch('/api/bigquery/query/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: convId,
      projectId,
      jobId: job.jobId,
      location: job.location || null,
    }),
  });

  stopBigQueryPolling();
  activeBigQueryJob = null;
  setQueryRunningState(false);

  if (!res) {
    setStatus('Cancel failed', false);
    return;
  }

  setStatus('Cancelled', false);
  showToast('BigQuery job cancelled');
}

function buildResultsActions(source) {
  if (source === DATA_SOURCE_BIGQUERY) {
    return `
      <button class="results-export-btn" data-format="csv" title="Download preview as CSV">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        CSV
      </button>
      <button class="results-export-btn" data-format="json" title="Download preview as JSON">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        JSON
      </button>
      <button class="results-export-btn" data-format="bq-save-csv" title="Save full query result to CSV file in repo">
        Save CSV File
      </button>
      <button class="results-export-btn" data-format="bq-save-json" title="Save full query result to JSON file in repo">
        Save JSON File
      </button>
    `;
  }

  return `
    <button class="results-export-btn" data-format="csv" title="Export as CSV">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      CSV
    </button>
    <button class="results-export-btn" data-format="json" title="Export as JSON">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      JSON
    </button>
    <button class="results-export-btn" data-format="parquet" title="Export as Parquet">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Parquet
    </button>
  `;
}

/**
 * Render query results as a table
 */
function renderResults(data, { source = DATA_SOURCE_DUCKDB } = {}) {
  if (!resultsContainer) return;

  const { columns, rows } = data;

  if (!columns || columns.length === 0) {
    lastQueryResults = null;
    resultsContainer.innerHTML = '<div class="data-tab-empty">No results</div>';
    return;
  }

  lastQueryResults = { columns, rows };

  const headerCells = columns.map((col) => `
    <th title="${escapeHtml(col.type)}">${escapeHtml(col.name)}<span class="col-type">${escapeHtml(col.type)}</span></th>
  `).join('');

  const dataRows = rows.map((row, idx) => {
    const cells = row.map((cell) => {
      const cellStr = cell === null ? '<null>' : cell === undefined ? '' : String(cell);
      const truncated = cellStr.length > 100 ? cellStr.slice(0, 100) + '...' : cellStr;
      const isNull = cell === null;
      return `<td class="copyable-cell${isNull ? ' null-cell' : ''}" data-value="${escapeHtml(cellStr)}" title="Click to copy">${escapeHtml(truncated)}</td>`;
    }).join('');
    return `<tr><td class="row-num">${idx + 1}</td>${cells}</tr>`;
  }).join('');

  const resultLabel = source === DATA_SOURCE_BIGQUERY ? 'preview row' : 'row';

  resultsContainer.innerHTML = `
    <div class="data-tab-results-header">
      <span class="results-count">${rows.length} ${resultLabel}${rows.length !== 1 ? 's' : ''}</span>
      <div class="results-export-btns">
        ${buildResultsActions(source)}
      </div>
    </div>
    <div class="data-tab-results-wrapper">
      <table class="data-preview-table">
        <thead><tr><th class="row-num-header">#</th>${headerCells}</tr></thead>
        <tbody>${dataRows}</tbody>
      </table>
    </div>
  `;

  resultsContainer.querySelectorAll('.copyable-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const value = cell.dataset.value;
      navigator.clipboard.writeText(value).then(() => {
        cell.classList.add('copied');
        setTimeout(() => cell.classList.remove('copied'), 1000);
      });
    });
  });

  resultsContainer.querySelectorAll('.results-export-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic();
      exportResults(btn.dataset.format);
    });
  });
}

/**
 * Export query results
 * @param {string} format - export target format
 */
async function exportResults(format) {
  if (!lastQueryResults) {
    showToast('No results to export');
    return;
  }

  if (format === 'bq-save-csv' || format === 'bq-save-json') {
    const target = format === 'bq-save-csv' ? 'csv' : 'json';
    await saveBigQueryResultsToFile(target);
    return;
  }

  const defaultName = 'query-results';
  const filename = window.prompt('Enter filename (without extension):', defaultName);
  if (!filename) return;

  const { columns, rows } = lastQueryResults;

  if (format === 'parquet') {
    if (lastQuerySource !== DATA_SOURCE_DUCKDB || !lastQuerySQL) {
      showToast('Parquet export is only available for DuckDB queries');
      return;
    }

    showToast('Exporting...', { duration: 1000 });

    try {
      const res = await fetch('/api/duckdb/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: lastQuerySQL,
          format: 'parquet',
          filename,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || 'Export failed');
        return;
      }

      const blob = await res.blob();
      const rowCount = res.headers.get('X-Row-Count') || rows.length;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.parquet`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`Exported ${rowCount} rows as Parquet`);
    } catch {
      showToast('Export failed');
    }
    return;
  }

  let content;
  let mimeType;
  let extension;

  if (format === 'json') {
    const data = rows.map((row) => {
      const obj = {};
      columns.forEach((col, i) => {
        obj[col.name] = row[i];
      });
      return obj;
    });
    content = JSON.stringify(data, null, 2);
    mimeType = 'application/json';
    extension = 'json';
  } else {
    const escapeCSV = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const header = columns.map((col) => escapeCSV(col.name)).join(',');
    const dataRows = rows.map((row) => row.map(escapeCSV).join(','));
    content = [header, ...dataRows].join('\n');
    mimeType = 'text/csv';
    extension = 'csv';
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`Exported ${rows.length} rows as ${extension.toUpperCase()}`);
}

async function saveBigQueryResultsToFile(format) {
  if (lastQuerySource !== DATA_SOURCE_BIGQUERY) {
    showToast('No BigQuery result to save');
    return;
  }

  if (!lastBigQueryJob?.jobId) {
    showToast('No BigQuery job reference available');
    return;
  }

  const convId = state.getCurrentConversationId();
  if (!convId) {
    showToast('No conversation selected');
    return;
  }

  const projectId = lastBigQueryJob.projectId || getCurrentBigQueryProjectId();
  if (!projectId) {
    showToast('Select a BigQuery project');
    return;
  }

  const defaultName = `bigquery-results-${Date.now()}`;
  const filename = window.prompt('Enter filename (without extension):', defaultName);
  if (!filename) return;

  const res = await apiFetch('/api/bigquery/query/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: convId,
      projectId,
      jobId: lastBigQueryJob.jobId,
      location: lastBigQueryJob.location || null,
      format,
      filename,
    }),
  });

  if (!res) return;

  const data = await res.json();
  const rowCount = Number(data.rowCount || 0).toLocaleString();
  showToast(`Saved ${rowCount} rows to ${data.relativePath}`, {
    action: 'Files',
    onAction: () => {
      switchToFilesTabFn?.();
    },
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

      queryHistoryDropdown.querySelectorAll('.history-item').forEach((item) => {
        item.addEventListener('click', () => {
          const idx = parseInt(item.dataset.index, 10);
          if (sqlEditor && queryHistory[idx]) {
            sqlEditor.value = queryHistory[idx];
            queryHistoryDropdown.classList.add('hidden');
          }
        });
      });

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
      silent: true,
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
    silent: false,
  });

  if (!res) return null;

  const data = await res.json();
  return data;
}
