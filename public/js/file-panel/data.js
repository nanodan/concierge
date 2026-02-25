// --- Data Tab (DuckDB + BigQuery SQL Analysis) ---
import { escapeHtml } from '../markdown.js';
import { haptic, showToast, apiFetch, showDialog } from '../utils.js';
import * as state from '../state.js';

const DATA_SOURCE_DUCKDB = 'duckdb';
const DATA_SOURCE_BIGQUERY = 'bigquery';

// DOM elements (set by init)
let _dataView = null;
let dataSourceSelect = null;
let dataTablesRow = null;
let bigQueryControls = null;
let bigQueryAuthStatus = null;
let bigQueryAuthHint = null;
let bigQueryConnectBtn = null;
let bigQueryProjectInput = null;
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
let bigQueryDefaultProject = null;
const bigQueryProjectByConversation = new Map();
let activeBigQueryJob = null;
let bigQueryPollTimer = null;
let bigQueryPageTokens = [null];
let bigQueryCurrentPageIndex = 0;
let bigQueryCurrentNextPageToken = null;
let bigQueryTotalRows = 0;
let bigQueryPaging = false;

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
  bigQueryAuthHint = elements.bigQueryAuthHint;
  bigQueryConnectBtn = elements.bigQueryConnectBtn;
  bigQueryProjectInput = elements.bigQueryProjectInput;
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
      resetBigQueryPagination();
      setQueryRunningState(false);
      applyDataSourceMode();
      if (querySource === DATA_SOURCE_DUCKDB) {
        refreshTables();
      } else {
        void loadBigQueryState();
      }
    });
  }

  if (bigQueryConnectBtn) {
    bigQueryConnectBtn.addEventListener('click', () => {
      haptic();
      refreshBigQueryAuth();
    });
  }

  if (bigQueryProjectInput) {
    const persistProjectInput = () => {
      const convId = state.getCurrentConversationId();
      if (!convId) return;
      const value = (bigQueryProjectInput.value || '').trim();
      if (value) {
        bigQueryProjectByConversation.set(convId, value);
      } else {
        bigQueryProjectByConversation.delete(convId);
      }
      bigQueryProjectInput.value = value;
    };

    bigQueryProjectInput.addEventListener('change', persistProjectInput);
    bigQueryProjectInput.addEventListener('blur', persistProjectInput);
  }

}

/**
 * Load and display current data tab state
 */
export async function loadDataTabState() {
  await loadHistory();
  await loadBigQueryState();

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

function resetBigQueryPagination() {
  bigQueryPageTokens = [null];
  bigQueryCurrentPageIndex = 0;
  bigQueryCurrentNextPageToken = null;
  bigQueryTotalRows = 0;
  bigQueryPaging = false;
}

function applyBigQueryPageState(data, pageTokenUsed = null) {
  const token = pageTokenUsed || null;
  let pageIndex = bigQueryPageTokens.findIndex((t) => (t || null) === token);
  if (pageIndex === -1) {
    pageIndex = bigQueryPageTokens.length;
    bigQueryPageTokens.push(token);
  }

  bigQueryCurrentPageIndex = pageIndex;
  bigQueryCurrentNextPageToken = data.pageToken || null;
  bigQueryTotalRows = Number(data.rowCount || bigQueryTotalRows || 0);

  if (bigQueryCurrentNextPageToken) {
    if (bigQueryPageTokens.length === pageIndex + 1) {
      bigQueryPageTokens.push(bigQueryCurrentNextPageToken);
    } else {
      bigQueryPageTokens[pageIndex + 1] = bigQueryCurrentNextPageToken;
      bigQueryPageTokens = bigQueryPageTokens.slice(0, pageIndex + 2);
    }
  } else {
    bigQueryPageTokens = bigQueryPageTokens.slice(0, pageIndex + 1);
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
  const convId = state.getCurrentConversationId();
  const fromInput = (bigQueryProjectInput?.value || '').trim();
  if (fromInput) return fromInput;
  const fromConversation = convId ? (bigQueryProjectByConversation.get(convId) || '') : '';
  if (fromConversation) return fromConversation;
  return bigQueryDefaultProject || '';
}

function updateBigQueryProjectInput() {
  if (!bigQueryProjectInput) return;

  const convId = state.getCurrentConversationId();
  let projectId = convId ? (bigQueryProjectByConversation.get(convId) || '') : '';
  if (!projectId && bigQueryDefaultProject) {
    projectId = bigQueryDefaultProject;
  }

  if (convId && projectId && !bigQueryProjectByConversation.get(convId)) {
    bigQueryProjectByConversation.set(convId, projectId);
  }

  bigQueryProjectInput.value = projectId;
  bigQueryProjectInput.disabled = !bigQueryConnected;
  bigQueryProjectInput.placeholder = bigQueryConnected ? 'my-gcp-project' : 'Connect BigQuery first';
}

function updateBigQueryControls(message = '') {
  if (!bigQueryControls) return;

  if (!bigQueryConfigured) {
    if (bigQueryAuthStatus) {
      bigQueryAuthStatus.textContent = 'BigQuery unavailable';
    }
    if (bigQueryAuthHint) {
      bigQueryAuthHint.textContent = message || 'Run gcloud auth application-default login';
    }
    if (bigQueryConnectBtn) {
      bigQueryConnectBtn.classList.remove('hidden');
      bigQueryConnectBtn.textContent = 'Recheck';
    }
    updateBigQueryProjectInput();
    return;
  }

  if (bigQueryConnected) {
    if (bigQueryAuthStatus) {
      bigQueryAuthStatus.textContent = 'ADC connected';
    }
    if (bigQueryAuthHint) {
      bigQueryAuthHint.textContent = bigQueryDefaultProject
        ? `Default project: ${bigQueryDefaultProject}`
        : 'Enter a project ID to run queries';
    }
    if (bigQueryConnectBtn) {
      bigQueryConnectBtn.classList.remove('hidden');
      bigQueryConnectBtn.textContent = 'Refresh';
    }
  } else {
    if (bigQueryAuthStatus) {
      bigQueryAuthStatus.textContent = message || 'ADC not ready';
    }
    if (bigQueryAuthHint) {
      bigQueryAuthHint.textContent = 'Run gcloud auth application-default login';
    }
    if (bigQueryConnectBtn) {
      bigQueryConnectBtn.classList.remove('hidden');
      bigQueryConnectBtn.textContent = 'Recheck';
    }
  }

  updateBigQueryProjectInput();
}

async function loadBigQueryState({ forceRefresh = false } = {}) {
  const statusUrl = forceRefresh ? '/api/bigquery/auth/status?refresh=1' : '/api/bigquery/auth/status';
  const res = await apiFetch(statusUrl, { silent: true });
  if (!res) {
    bigQueryConfigured = false;
    bigQueryConnected = false;
    bigQueryDefaultProject = null;
    updateBigQueryControls('BigQuery status unavailable');
    return;
  }

  const status = await res.json();
  bigQueryConfigured = status.configured !== false;
  bigQueryConnected = Boolean(status.connected);
  bigQueryDefaultProject = status.defaultProjectId || null;

  if (bigQueryConnected && bigQueryDefaultProject) {
    const convId = state.getCurrentConversationId();
    if (convId && !bigQueryProjectByConversation.get(convId)) {
      bigQueryProjectByConversation.set(convId, bigQueryDefaultProject);
    }
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
  await loadBigQueryState({ forceRefresh: true });
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
    showToast('Enter a BigQuery project ID');
    return;
  }

  const conversationId = state.getCurrentConversationId();
  if (!conversationId) {
    showToast('No conversation selected');
    return;
  }

  stopBigQueryPolling();
  activeBigQueryJob = null;
  resetBigQueryPagination();

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
    applyBigQueryPageState(data, null);
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
      applyBigQueryPageState(data, null);
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

const GEO_COLUMN_HINTS = ['geo', 'geog', 'geography', 'geojson', 'geometry', 'geom', 'the_geom'];
const LAT_COLUMN_HINTS = ['lat', 'latitude', 'y'];
const LON_COLUMN_HINTS = ['lon', 'lng', 'longitude', 'x'];

function supportsGeoJsonExport(columns) {
  if (!Array.isArray(columns)) return false;
  const names = columns.map((col) => String(col?.name || '').toLowerCase());
  const hasGeoColumn = names.some((name) => GEO_COLUMN_HINTS.some((hint) => name.includes(hint)));
  const hasGeoType = columns.some((col) => String(col?.type || '').toUpperCase().includes('GEOGRAPHY'));
  const hasLatColumn = names.some((name) => LAT_COLUMN_HINTS.includes(name));
  const hasLonColumn = names.some((name) => LON_COLUMN_HINTS.includes(name));
  return hasGeoType || hasGeoColumn || (hasLatColumn && hasLonColumn);
}

function buildBigQueryFormatOptions(columns) {
  const geoEnabled = supportsGeoJsonExport(columns);
  return `
    <option value="csv">CSV</option>
    <option value="json">JSON</option>
    <option value="parquet">Parquet</option>
    <option value="geojson"${geoEnabled ? '' : ' disabled'}>${geoEnabled ? 'GeoJSON' : 'GeoJSON (needs geography/geometry or lat/lon columns)'}</option>
  `;
}

function buildBigQueryPaginationControls() {
  const hasPrev = bigQueryCurrentPageIndex > 0;
  const hasNext = Boolean(bigQueryCurrentNextPageToken);
  const totalLabel = bigQueryTotalRows > 0 ? `${bigQueryTotalRows.toLocaleString()} total` : 'preview';

  return `
    <div class="results-page-controls">
      <button class="results-page-btn" data-bq-page="prev"${hasPrev ? '' : ' disabled'}>Prev</button>
      <span class="results-page-label">Page ${bigQueryCurrentPageIndex + 1} • ${totalLabel}</span>
      <button class="results-page-btn" data-bq-page="next"${hasNext ? '' : ' disabled'}>Next</button>
    </div>
  `;
}

function buildResultsActions(source, columns) {
  if (source === DATA_SOURCE_BIGQUERY) {
    const formatOptions = buildBigQueryFormatOptions(columns);
    return `
      <div class="results-export-modes">
        <div class="results-export-mode">
          <span class="results-export-mode-label">Browser</span>
          <select class="results-export-select" data-target="browser">${formatOptions}</select>
          <button class="results-export-btn results-export-run-btn" data-target="browser" title="Download full query result to this browser">
            Download
          </button>
        </div>
        <div class="results-export-mode">
          <span class="results-export-mode-label">Project</span>
          <select class="results-export-select" data-target="cwd">${formatOptions}</select>
          <button class="results-export-btn results-export-run-btn" data-target="cwd" title="Save full query result into conversation cwd">
            Save
          </button>
        </div>
      </div>
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

async function loadBigQueryPreviewPage(direction) {
  if (querySource !== DATA_SOURCE_BIGQUERY) return;
  if (bigQueryPaging) return;
  if (activeBigQueryJob?.jobId) {
    showToast('Query still running');
    return;
  }

  const convId = state.getCurrentConversationId();
  if (!convId) {
    showToast('No conversation selected');
    return;
  }

  const projectId = lastBigQueryJob?.projectId || getCurrentBigQueryProjectId();
  if (!projectId || !lastBigQueryJob?.jobId) {
    showToast('No BigQuery result to paginate');
    return;
  }

  const delta = direction === 'prev' ? -1 : 1;
  const targetIndex = bigQueryCurrentPageIndex + delta;
  if (targetIndex < 0 || targetIndex >= bigQueryPageTokens.length) {
    return;
  }

  const pageToken = bigQueryPageTokens[targetIndex] || null;
  const qs = new URLSearchParams({
    conversationId: convId,
    projectId,
    jobId: lastBigQueryJob.jobId,
    maxResults: '1000',
  });
  if (lastBigQueryJob.location) {
    qs.set('location', lastBigQueryJob.location);
  }
  if (pageToken) {
    qs.set('pageToken', pageToken);
  }

  bigQueryPaging = true;
  setStatus('Loading page...', true);
  try {
    const res = await apiFetch(`/api/bigquery/query/status?${qs.toString()}`, { silent: true });
    if (!res) {
      showToast('Failed to load page', { variant: 'error' });
      setStatus('Paging failed', false);
      return;
    }

    const data = await res.json();
    if (!data.jobComplete) {
      showToast('Query is still running');
      setStatus('BigQuery job running...', true);
      return;
    }

    lastBigQueryJob = data.job || lastBigQueryJob;
    applyBigQueryPageState(data, pageToken);
    setStatus(formatBigQueryStatus(data), false);
    renderResults(data, { source: DATA_SOURCE_BIGQUERY });
  } finally {
    bigQueryPaging = false;
  }
}

async function promptForFilename(defaultName, confirmLabel) {
  const value = await showDialog({
    title: 'Filename',
    input: true,
    defaultValue: defaultName,
    placeholder: 'query-results',
    confirmLabel,
    cancelLabel: 'Cancel',
  });

  if (value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) {
    showToast('Filename is required');
    return null;
  }
  return trimmed;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseDownloadFilename(contentDisposition) {
  if (!contentDisposition) return null;

  const utf8 = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8 && utf8[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }

  const plain = contentDisposition.match(/filename="([^"]+)"/i) || contentDisposition.match(/filename=([^;]+)/i);
  return plain?.[1] || null;
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
  const paginationControls = source === DATA_SOURCE_BIGQUERY ? buildBigQueryPaginationControls() : '';

  resultsContainer.innerHTML = `
    <div class="data-tab-results-header">
      <div class="data-tab-results-header-left">
        <span class="results-count">${rows.length} ${resultLabel}${rows.length !== 1 ? 's' : ''}</span>
        ${paginationControls}
      </div>
      <div class="results-export-btns">
        ${buildResultsActions(source, columns)}
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

  resultsContainer.querySelectorAll('.results-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic();
      const direction = btn.dataset.bqPage;
      if (direction === 'prev' || direction === 'next') {
        void loadBigQueryPreviewPage(direction);
      }
    });
  });

  resultsContainer.querySelectorAll('.results-export-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic();
      if (btn.classList.contains('results-export-run-btn')) {
        const target = btn.dataset.target;
        const mode = btn.closest('.results-export-mode');
        const format = mode?.querySelector('.results-export-select')?.value || 'csv';
        if (target === 'browser') {
          void downloadBigQueryResults(format);
        } else if (target === 'cwd') {
          void saveBigQueryResultsToFile(format);
        }
        return;
      }
      void exportResults(btn.dataset.format);
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

  const defaultName = 'query-results';
  const filename = await promptForFilename(defaultName, 'Download');
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
      triggerBlobDownload(blob, `${filename}.parquet`);

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
  triggerBlobDownload(blob, `${filename}.${extension}`);

  showToast(`Exported ${rows.length} rows as ${extension.toUpperCase()}`);
}

async function downloadBigQueryResults(format) {
  if (lastQuerySource !== DATA_SOURCE_BIGQUERY) {
    showToast('No BigQuery result to download');
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
    showToast('Enter a BigQuery project ID');
    return;
  }

  const defaultName = `bigquery-results-${Date.now()}`;
  const filename = await promptForFilename(defaultName, 'Download');
  if (!filename) return;

  try {
    const res = await fetch('/api/bigquery/query/download', {
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

    if (!res.ok) {
      let message = 'Download failed';
      try {
        const err = await res.json();
        message = err.error || message;
      } catch {
        // ignore non-json error payload
      }
      showToast(message, { variant: 'error' });
      return;
    }

    const blob = await res.blob();
    const rowCount = Number(res.headers.get('X-Row-Count') || 0);
    const downloadName = parseDownloadFilename(res.headers.get('Content-Disposition')) || `${filename}.${format}`;
    triggerBlobDownload(blob, downloadName);

    const rowCountLabel = rowCount > 0 ? rowCount.toLocaleString() : 'all';
    showToast(`Downloaded ${rowCountLabel} rows as ${format.toUpperCase()}`);
  } catch {
    showToast('Download failed', { variant: 'error' });
  }
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
    showToast('Enter a BigQuery project ID');
    return;
  }

  const defaultName = `bigquery-results-${Date.now()}`;
  const filename = await promptForFilename(defaultName, 'Save');
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
