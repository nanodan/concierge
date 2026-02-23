// --- File Browser (file tree, navigation, upload, search) ---
import { escapeHtml, renderMarkdown } from '../markdown.js';
import { haptic, showToast, showDialog, apiFetch, formatFileSize } from '../utils.js';
import * as state from '../state.js';
import { getFileIcon, FILE_ICONS, IMAGE_EXTS } from '../file-utils.js';
import { ANIMATION_DELAY_SHORT, DEBOUNCE_SEARCH, SLIDE_TRANSITION_DURATION } from '../constants.js';
import { hideGranularToggle } from './git-changes.js';

// UI-specific icons
const ICONS = {
  ...FILE_ICONS,
  emptyFolder: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  error: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  openExternal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
};

// Previewable binary files (can open in browser)
const PREVIEWABLE_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);

// Data files that can be loaded into DuckDB
const DATA_FILE_EXTS = new Set(['csv', 'tsv', 'parquet', 'json', 'jsonl']);

// Callback for when a file is loaded to data tab (set by data.js)
let onFileLoadedToDataTab = null;

/**
 * Set callback for when file is loaded to data tab
 */
export function setOnFileLoadedToDataTab(callback) {
  onFileLoadedToDataTab = callback;
}

/**
 * Load a data file into DuckDB via the Data tab
 */
async function loadFileToDataTab(filePath) {
  const convId = state.getCurrentConversationId();
  if (!convId) {
    showToast('No conversation selected');
    return;
  }

  const res = await apiFetch('/api/duckdb/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, conversationId: convId })
  });

  if (!res) return;

  const data = await res.json();
  if (data.error) {
    showToast(data.error, { variant: 'error' });
    return;
  }

  const rowCountStr = data.rowCount?.toLocaleString() || '0';
  showToast(`Loaded ${data.tableName} (${rowCountStr} rows)`);

  // Notify data tab to refresh
  if (onFileLoadedToDataTab) {
    onFileLoadedToDataTab(data);
  }
}

/**
 * Render data preview (CSV/TSV/Parquet) as an HTML table
 */
function renderDataPreview(data) {
  const columns = data.columns || [];
  const rows = data.rows || [];
  const isParquet = data.parquet;

  // Column headers with row number column
  const headerCells = columns.map(col => {
    if (isParquet && typeof col === 'object') {
      const typeBadge = `<span class="col-type-badge">${escapeHtml(col.type)}</span>`;
      return `<th title="Type: ${escapeHtml(col.type)}">${escapeHtml(col.name)}${typeBadge}</th>`;
    }
    return `<th>${escapeHtml(col)}</th>`;
  }).join('');

  // Data rows with row numbers and copyable cells
  const dataRows = rows.map((row, idx) =>
    `<tr><td class="row-num">${idx + 1}</td>${row.map(cell => {
      const cellStr = cell === null || cell === undefined ? '' : String(cell);
      const truncated = cellStr.length > 100 ? cellStr.slice(0, 100) + '...' : cellStr;
      return `<td class="copyable-cell" data-value="${escapeHtml(cellStr)}" title="Click to copy">${escapeHtml(truncated)}</td>`;
    }).join('')}</tr>`
  ).join('');

  // Build info badge
  const colNames = isParquet
    ? columns.map(c => c.name)
    : columns;
  const colCount = colNames.length;
  const rowDisplay = data.truncated
    ? `Showing ${rows.length} of ${data.totalRows.toLocaleString()}`
    : `${data.totalRows.toLocaleString()}`;
  const infoBadge = `<div class="data-preview-info">${rowDisplay} rows × ${colCount} cols</div>`;

  // Truncation notice
  const truncationNotice = data.truncated
    ? `<div class="data-preview-truncated">Data truncated. Showing first ${rows.length} rows.</div>`
    : '';

  return `
    <div class="data-preview">
      ${infoBadge}
      <div class="data-preview-table-wrapper">
        <table class="data-preview-table">
          <thead><tr><th class="row-num-header">#</th>${headerCells}</tr></thead>
          <tbody>${dataRows}</tbody>
        </table>
      </div>
      ${truncationNotice}
    </div>
  `;
}

/**
 * Attach copy handlers to data preview cells
 */
function attachCopyHandlers(container) {
  container.querySelectorAll('.copyable-cell').forEach(cell => {
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
 * Render JSON as collapsible tree
 */
function renderJsonPreview(content) {
  try {
    const data = JSON.parse(content);
    const html = renderJsonNode(data, 0, true);
    return `
      <div class="json-preview">
        <div class="json-toolbar">
          <button class="json-expand-all" title="Expand all">Expand All</button>
          <button class="json-collapse-all" title="Collapse all">Collapse All</button>
        </div>
        <div class="json-content">${html}</div>
      </div>`;
  } catch {
    // Invalid JSON, fall back to plain text
    return null;
  }
}

/**
 * Attach expand/collapse handlers to JSON preview
 */
function attachJsonHandlers(container) {
  const expandBtn = container.querySelector('.json-expand-all');
  const collapseBtn = container.querySelector('.json-collapse-all');

  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      container.querySelectorAll('.json-collapsible').forEach(el => {
        el.open = true;
      });
    });
  }

  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      container.querySelectorAll('.json-collapsible').forEach(el => {
        el.open = false;
      });
    });
  }
}

/**
 * Recursively render a JSON node
 */
function renderJsonNode(value, depth, isLast) {
  const comma = isLast ? '' : ',';

  if (value === null) {
    return `<span class="json-null">null</span>${comma}`;
  }

  if (typeof value === 'boolean') {
    return `<span class="json-bool">${value}</span>${comma}`;
  }

  if (typeof value === 'number') {
    return `<span class="json-num">${value}</span>${comma}`;
  }

  if (typeof value === 'string') {
    const escaped = escapeHtml(value);
    const truncated = escaped.length > 200 ? escaped.slice(0, 200) + '...' : escaped;
    return `<span class="json-str">"${truncated}"</span>${comma}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `<span class="json-bracket">[]</span>${comma}`;
    }
    const items = value.map((item, i) =>
      `<div class="json-line">${renderJsonNode(item, depth + 1, i === value.length - 1)}</div>`
    ).join('');
    return `<details class="json-collapsible" open><summary class="json-bracket">[<span class="json-count">${value.length} items</span></summary><div class="json-children">${items}</div><span class="json-bracket">]</span>${comma}</details>`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return `<span class="json-bracket">{}</span>${comma}`;
    }
    const items = keys.map((key, i) =>
      `<div class="json-line"><span class="json-key">"${escapeHtml(key)}"</span>: ${renderJsonNode(value[key], depth + 1, i === keys.length - 1)}</div>`
    ).join('');
    return `<details class="json-collapsible" open><summary class="json-bracket">{<span class="json-count">${keys.length} keys</span></summary><div class="json-children">${items}</div><span class="json-bracket">}</span>${comma}</details>`;
  }

  return `<span>${escapeHtml(String(value))}</span>${comma}`;
}

/**
 * Render Jupyter notebook cells
 */
function renderNotebookPreview(data) {
  const cells = data.cells || [];
  const metadata = data.metadata || {};
  const language = metadata.language_info?.name || 'python';

  const cellsHtml = cells.map((cell) => {
    if (cell.type === 'markdown') {
      return `
        <div class="nb-cell nb-markdown">
          <div class="nb-cell-content markdown-body">${renderMarkdown(cell.source)}</div>
        </div>`;
    }

    if (cell.type === 'raw') {
      return `
        <div class="nb-cell nb-raw">
          <div class="nb-cell-content"><pre>${escapeHtml(cell.source)}</pre></div>
        </div>`;
    }

    // Code cell
    const execCount = cell.execution_count !== null && cell.execution_count !== undefined
      ? cell.execution_count
      : ' ';
    const outputs = (cell.outputs || []).map(renderNotebookOutput).join('');

    return `
      <div class="nb-cell nb-code">
        <div class="nb-cell-input">
          <span class="nb-exec-count">[${execCount}]:</span>
          <pre><code class="language-${language}">${escapeHtml(cell.source)}</code></pre>
        </div>
        ${outputs ? `<div class="nb-cell-outputs">${outputs}</div>` : ''}
      </div>`;
  }).join('');

  // Metadata header
  const kernelName = metadata.kernelspec?.display_name || metadata.kernelspec?.name || '';
  const headerInfo = kernelName ? `<div class="nb-header">${escapeHtml(kernelName)}</div>` : '';

  // Truncation notice
  const truncationNotice = data.truncated
    ? `<div class="nb-truncated">Showing ${cells.length} of ${data.totalCells} cells</div>`
    : '';

  return `
    <div class="notebook-preview">
      ${headerInfo}
      <div class="nb-cells">${cellsHtml}</div>
      ${truncationNotice}
    </div>
  `;
}

/**
 * Render a single notebook output
 */
function renderNotebookOutput(output) {
  if (output.output_type === 'stream') {
    const streamClass = output.name === 'stderr' ? 'nb-output-stderr' : 'nb-output-stdout';
    return `<div class="nb-output ${streamClass}"><pre>${escapeHtml(output.text)}</pre></div>`;
  }

  if (output.output_type === 'error') {
    // Clean ANSI codes from traceback and join
    const traceback = (output.traceback || [])
      .map(line => line.replace(/\x1b\[[0-9;]*m/g, ''))
      .join('\n');
    return `
      <div class="nb-output nb-output-error">
        <div class="nb-error-name">${escapeHtml(output.ename)}: ${escapeHtml(output.evalue)}</div>
        <pre>${escapeHtml(traceback)}</pre>
      </div>`;
  }

  if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
    const data = output.data || {};

    // Prefer images
    if (data['image/png']) {
      return `<div class="nb-output nb-output-image"><img src="data:image/png;base64,${data['image/png']}" alt="output" /></div>`;
    }
    if (data['image/jpeg']) {
      return `<div class="nb-output nb-output-image"><img src="data:image/jpeg;base64,${data['image/jpeg']}" alt="output" /></div>`;
    }
    if (data['image/svg+xml']) {
      return `<div class="nb-output nb-output-image">${data['image/svg+xml']}</div>`;
    }

    // HTML output
    if (data['text/html']) {
      return `<div class="nb-output nb-output-html">${data['text/html']}</div>`;
    }

    // Plain text fallback
    if (data['text/plain']) {
      return `<div class="nb-output nb-output-text"><pre>${escapeHtml(data['text/plain'])}</pre></div>`;
    }
  }

  return '';
}

// DOM elements (set by init)
let filePanelUp = null;
let filePanelPath = null;
let fileSearchInput = null;
let filePanelRefreshBtn = null;
let filePanelUploadBtn = null;
let filePanelFileInput = null;
let fileTree = null;
let fileViewer = null;
let fileViewerName = null;
let fileViewerClose = null;
let fileViewerContent = null;
let filesView = null;

// State
let currentPath = '';
let searchMode = false;
let searchResults = null;
let searchTimeout = null;
let viewingDiff = null;

// File navigation state
let viewableFiles = []; // List of files that can be viewed (non-directories)
let currentFileIndex = -1; // Index of currently viewed file
let touchStartX = 0;
let touchStartY = 0;
let touchMoveX = 0;
const SWIPE_THRESHOLD = 50; // Minimum swipe distance

/**
 * Initialize file browser elements
 */
export function initFileBrowser(elements) {
  filePanelUp = elements.filePanelUp;
  filePanelPath = elements.filePanelPath;
  fileSearchInput = elements.fileSearchInput;
  filePanelRefreshBtn = elements.filePanelRefreshBtn;
  filePanelUploadBtn = elements.filePanelUploadBtn;
  filePanelFileInput = elements.filePanelFileInput;
  fileTree = elements.fileTree;
  fileViewer = elements.fileViewer;
  fileViewerName = elements.fileViewerName;
  fileViewerClose = elements.fileViewerClose;
  fileViewerContent = elements.fileViewerContent;
  filesView = elements.filesView;
}

/**
 * Setup file browser event listeners
 */
export function setupFileBrowserEventListeners() {
  // Up button
  if (filePanelUp) {
    filePanelUp.addEventListener('click', () => {
      if (currentPath) {
        const parent = currentPath.split('/').slice(0, -1).join('/');
        loadFileTree(parent);
      }
    });
  }

  // File viewer close
  if (fileViewerClose) {
    fileViewerClose.addEventListener('click', () => {
      haptic();
      closeFileViewer();
    });
  }

  // File viewer navigation - keyboard
  document.addEventListener('keydown', handleFileViewerKeydown);

  // File viewer navigation - swipe gestures
  if (fileViewer) {
    fileViewer.addEventListener('touchstart', handleFileViewerTouchStart, { passive: true });
    fileViewer.addEventListener('touchmove', handleFileViewerTouchMove, { passive: true });
    fileViewer.addEventListener('touchend', handleFileViewerTouchEnd, { passive: true });
  }

  // File search input
  if (fileSearchInput) {
    fileSearchInput.addEventListener('input', handleSearchInput);
    fileSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        fileSearchInput.value = '';
        exitSearchMode();
        fileSearchInput.blur();
      }
    });
  }

  // Refresh button
  if (filePanelRefreshBtn) {
    filePanelRefreshBtn.addEventListener('click', () => {
      haptic();
      loadFileTree(currentPath);
    });
  }

  // Upload button
  if (filePanelUploadBtn) {
    filePanelUploadBtn.addEventListener('click', () => {
      if (filePanelFileInput) filePanelFileInput.click();
    });
  }

  if (filePanelFileInput) {
    filePanelFileInput.addEventListener('change', () => {
      if (filePanelFileInput.files.length) {
        uploadToFilePanel(filePanelFileInput.files);
        filePanelFileInput.value = '';
      }
    });
  }

  // Drag-and-drop for file panel
  if (filesView) {
    filesView.addEventListener('dragover', (e) => {
      e.preventDefault();
      filesView.classList.add('drag-over');
    });
    filesView.addEventListener('dragleave', (e) => {
      if (!filesView.contains(e.relatedTarget)) {
        filesView.classList.remove('drag-over');
      }
    });
    filesView.addEventListener('drop', (e) => {
      e.preventDefault();
      filesView.classList.remove('drag-over');
      if (e.dataTransfer.files.length) {
        uploadToFilePanel(e.dataTransfer.files);
      }
    });
  }
}

/**
 * Get the current path
 */
export function getCurrentPath() {
  return currentPath;
}

/**
 * Set the current path
 */
export function setCurrentPath(path) {
  currentPath = path;
}

/**
 * Load the file tree for a given path
 */
export async function loadFileTree(subpath) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  currentPath = subpath;
  filePanelPath.textContent = subpath || '.';
  filePanelUp.disabled = !subpath;

  fileTree.innerHTML = '<div class="file-tree-loading">Loading...</div>';

  const qs = subpath ? `?path=${encodeURIComponent(subpath)}` : '';
  const res = await apiFetch(`/api/conversations/${convId}/files${qs}`, { silent: true });
  if (!res) {
    fileTree.innerHTML = `
      <div class="file-tree-empty">
        ${ICONS.error}
        <p>Failed to load files</p>
      </div>`;
    return;
  }
  const data = await res.json();

  if (data.error) {
    fileTree.innerHTML = `
      <div class="file-tree-empty">
        ${ICONS.error}
        <p>${escapeHtml(data.error)}</p>
      </div>`;
    return;
  }

  if (data.entries.length === 0) {
    fileTree.innerHTML = `
      <div class="file-tree-empty">
        ${ICONS.emptyFolder}
        <p>Empty folder</p>
      </div>`;
    return;
  }

  renderFileTree(data.entries);
}

/**
 * Render the file tree
 */
function renderFileTree(entries) {
  const convId = state.getCurrentConversationId();
  const conv = state.conversations.find(c => c.id === convId);
  const baseCwd = conv?.cwd || '';

  // Build list of viewable (non-directory) files for navigation
  viewableFiles = entries.filter(e => e.type !== 'directory').map(e => e.path);
  currentFileIndex = -1;

  fileTree.innerHTML = entries.map(entry => {
    const icon = getFileIcon(entry);
    const meta = entry.type === 'directory' ? '' : formatFileSize(entry.size);
    const isImage = IMAGE_EXTS.has(entry.ext);

    // For images, show actual thumbnail instead of icon
    let iconHtml;
    if (isImage && convId) {
      const thumbUrl = `/api/conversations/${convId}/files/download?path=${encodeURIComponent(entry.path)}&inline=true`;
      iconHtml = `<div class="file-tree-icon thumbnail"><img src="${thumbUrl}" alt="" loading="lazy" /></div>`;
    } else {
      iconHtml = `<div class="file-tree-icon ${icon.class}">${icon.svg}</div>`;
    }

    // Build full path for delete
    const fullPath = baseCwd ? `${baseCwd}/${entry.path}` : entry.path;

    // Check if this is a data file that can be loaded into DuckDB
    const isDataFile = entry.type === 'file' && DATA_FILE_EXTS.has(entry.ext);
    const loadDataBtn = isDataFile
      ? `<button class="file-tree-load-data-btn" title="Load to Data tab">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6"/><path d="M9 15h6"/><path d="M9 12h6"/></svg>
         </button>`
      : '';

    return `
      <div class="file-tree-item" data-type="${entry.type}" data-path="${escapeHtml(entry.path)}" data-full-path="${escapeHtml(fullPath)}" data-ext="${entry.ext || ''}">
        ${iconHtml}
        <span class="file-tree-name">${escapeHtml(entry.name)}</span>
        ${meta ? `<span class="file-tree-meta">${meta}</span>` : ''}
        ${loadDataBtn}
        <button class="file-tree-delete-btn" title="Delete">\u00d7</button>
      </div>`;
  }).join('');

  // Attach event handlers
  fileTree.querySelectorAll('.file-tree-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't navigate if clicking action buttons
      if (e.target.closest('.file-tree-delete-btn') || e.target.closest('.file-tree-load-data-btn')) return;
      haptic(5);
      const type = item.dataset.type;
      const filePath = item.dataset.path;

      if (type === 'directory') {
        loadFileTree(filePath);
      } else {
        viewFile(filePath);
      }
    });
  });

  // Attach load data handlers
  fileTree.querySelectorAll('.file-tree-load-data-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = btn.closest('.file-tree-item');
      const filePath = item.dataset.path;
      haptic();
      await loadFileToDataTab(filePath);
    });
  });

  // Attach delete handlers
  fileTree.querySelectorAll('.file-tree-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = btn.closest('.file-tree-item');
      const fullPath = item.dataset.fullPath;
      const filename = item.dataset.path.split('/').pop();
      haptic();

      const confirmed = await showDialog({
        title: 'Delete file?',
        message: `Delete "${filename}"? This cannot be undone.`,
        danger: true,
        confirmLabel: 'Delete'
      });

      if (confirmed) {
        await deleteFile(fullPath);
      }
    });
  });
}

/**
 * Delete a file or directory
 */
async function deleteFile(filePath) {
  const res = await apiFetch(`/api/files?path=${encodeURIComponent(filePath)}`, {
    method: 'DELETE'
  });

  if (!res) return;

  const data = await res.json();
  if (data.error) {
    showToast(data.error, { variant: 'error' });
    return;
  }

  showToast('Deleted');
  loadFileTree(currentPath);
}

/**
 * Upload files to conversation attachments
 */
async function uploadToFilePanel(files) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  for (const file of files) {
    const url = `/api/conversations/${convId}/upload?filename=${encodeURIComponent(file.name)}`;
    const resp = await apiFetch(url, { method: 'POST', body: file });
    if (!resp) continue;
    showToast(`Uploaded ${file.name}`);
  }

  // Refresh file list
  loadFileTree(currentPath);
}

/**
 * View a file
 */
export async function viewFile(filePath) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  // Hide granular toggle since this is not a diff view
  hideGranularToggle();

  // Track current file index for navigation
  currentFileIndex = viewableFiles.indexOf(filePath);

  const filename = filePath.split('/').pop();
  fileViewerName.textContent = filename;
  fileViewerContent.innerHTML = '<code>Loading...</code>';

  // Show viewer
  fileViewer.classList.remove('hidden');
  setTimeout(() => fileViewer.classList.add('open'), ANIMATION_DELAY_SHORT);

  // Update navigation UI
  updateFileNavigation();

  const res = await apiFetch(`/api/conversations/${convId}/files/content?path=${encodeURIComponent(filePath)}`, { silent: true });
  if (!res) {
    fileViewerContent.innerHTML = `
      <div class="file-viewer-error">
        ${ICONS.error}
        <p>Failed to load file</p>
      </div>`;
    return;
  }
  const data = await res.json();

  if (data.error) {
    fileViewerContent.innerHTML = `
      <div class="file-viewer-error">
        ${ICONS.error}
        <p>${escapeHtml(data.error)}</p>
      </div>`;
    return;
  }

  // CSV/TSV preview - render as table
  if (data.csv) {
    fileViewerContent.innerHTML = renderDataPreview(data);
    attachCopyHandlers(fileViewerContent);
    return;
  }

  // Parquet preview - render as table with column types
  if (data.parquet) {
    fileViewerContent.innerHTML = renderDataPreview(data);
    attachCopyHandlers(fileViewerContent);
    return;
  }

  // Jupyter notebook preview
  if (data.notebook) {
    fileViewerContent.innerHTML = renderNotebookPreview(data);
    // Apply syntax highlighting to code cells
    fileViewerContent.querySelectorAll('pre code').forEach(block => {
      if (window.hljs && !block.dataset.highlighted) {
        hljs.highlightElement(block);
      }
    });
    return;
  }

  if (data.binary) {
    const fileUrl = `/api/conversations/${convId}/files/download?path=${encodeURIComponent(filePath)}&inline=true`;

    // Check if it's an image - render inline with option to open full size
    if (IMAGE_EXTS.has(data.ext)) {
      fileViewerContent.innerHTML = `
        <div class="file-viewer-preview">
          <img src="${fileUrl}" alt="${escapeHtml(data.name)}" class="file-viewer-image" title="Click to open full size" />
          <button class="file-viewer-fullsize-btn" title="Open full size">
            ${ICONS.openExternal}
          </button>
        </div>`;
      // Click handlers for opening full size
      const img = fileViewerContent.querySelector('.file-viewer-image');
      const btn = fileViewerContent.querySelector('.file-viewer-fullsize-btn');
      const openFullSize = () => window.open(fileUrl, '_blank');
      img.addEventListener('click', openFullSize);
      btn.addEventListener('click', openFullSize);
      return;
    }

    // Check if it's previewable in browser (PDF, etc.)
    if (PREVIEWABLE_EXTS.has(data.ext)) {
      fileViewerContent.innerHTML = `
        <div class="file-viewer-error">
          ${ICONS.document || ICONS.file}
          <p>${escapeHtml(data.name)}</p>
          <p style="font-size: 12px; opacity: 0.7; margin-bottom: 12px;">${formatFileSize(data.size)}</p>
          <button class="file-viewer-open-btn" onclick="window.open('${fileUrl}', '_blank')">
            ${ICONS.openExternal} Open in new tab
          </button>
        </div>`;
      return;
    }

    // Non-previewable binary
    fileViewerContent.innerHTML = `
      <div class="file-viewer-error">
        ${ICONS.file}
        <p>Binary file cannot be previewed</p>
        <p style="font-size: 12px; opacity: 0.7; margin-bottom: 12px;">${formatFileSize(data.size)}</p>
        <button class="file-viewer-open-btn" onclick="window.open('/api/conversations/${convId}/files/download?path=${encodeURIComponent(filePath)}', '_blank')">
          ${ICONS.openExternal} Download
        </button>
      </div>`;
    return;
  }

  if (data.truncated) {
    fileViewerContent.innerHTML = `
      <div class="file-viewer-error">
        ${ICONS.document || ICONS.file}
        <p>File too large to preview</p>
        <p style="font-size: 12px; opacity: 0.7;">${formatFileSize(data.size)} (max 500KB)</p>
      </div>`;
    return;
  }

  const fileUrl = `/api/conversations/${convId}/files/download?path=${encodeURIComponent(filePath)}&inline=true`;

  // Markdown preview - render as formatted HTML
  if (data.ext === 'md' || data.ext === 'markdown') {
    fileViewerContent.innerHTML = `
      <div class="markdown-preview">
        <div class="markdown-body">${renderMarkdown(data.content)}</div>
      </div>
      <button class="file-viewer-open-tab-btn" title="Open in new tab">
        ${ICONS.openExternal}
      </button>`;
    const openBtn = fileViewerContent.querySelector('.file-viewer-open-tab-btn');
    if (openBtn) openBtn.addEventListener('click', () => window.open(fileUrl, '_blank'));
    return;
  }

  // JSON preview - collapsible tree
  if (data.ext === 'json') {
    const jsonHtml = renderJsonPreview(data.content);
    if (jsonHtml) {
      fileViewerContent.innerHTML = `
        ${jsonHtml}
        <button class="file-viewer-open-tab-btn" title="Open in new tab">
          ${ICONS.openExternal}
        </button>`;
      attachJsonHandlers(fileViewerContent);
      const openBtn = fileViewerContent.querySelector('.file-viewer-open-tab-btn');
      if (openBtn) openBtn.addEventListener('click', () => window.open(fileUrl, '_blank'));
      return;
    }
    // Fall through to plain text if JSON parsing fails
  }

  // Render content with syntax highlighting + button to open in new tab
  const langClass = data.language ? `language-${data.language}` : '';
  fileViewerContent.innerHTML = `
    <code class="${langClass}">${escapeHtml(data.content)}</code>
    <button class="file-viewer-open-tab-btn" title="Open in new tab">
      ${ICONS.openExternal}
    </button>`;

  // Apply syntax highlighting
  const codeEl = fileViewerContent.querySelector('code');
  if (window.hljs && data.language && !codeEl.dataset.highlighted) {
    hljs.highlightElement(codeEl);
  }

  // Attach click handler for open in tab button
  const openBtn = fileViewerContent.querySelector('.file-viewer-open-tab-btn');
  if (openBtn) {
    openBtn.addEventListener('click', () => window.open(fileUrl, '_blank'));
  }
}

// === File Navigation ===

/**
 * Update navigation UI (prev/next buttons, counter)
 */
function updateFileNavigation() {
  if (!fileViewer) return;

  // Get or create navigation container
  let navContainer = fileViewer.querySelector('.file-viewer-nav');
  if (!navContainer) {
    navContainer = document.createElement('div');
    navContainer.className = 'file-viewer-nav';
    navContainer.innerHTML = `
      <button class="file-nav-btn file-nav-prev" aria-label="Previous file">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="file-nav-counter"></span>
      <button class="file-nav-btn file-nav-next" aria-label="Next file">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    `;
    // Insert after the header
    const header = fileViewer.querySelector('.file-viewer-header');
    if (header) {
      header.after(navContainer);
    }

    // Attach click handlers
    navContainer.querySelector('.file-nav-prev').addEventListener('click', (e) => {
      e.stopPropagation();
      haptic();
      navigateFile(-1);
    });
    navContainer.querySelector('.file-nav-next').addEventListener('click', (e) => {
      e.stopPropagation();
      haptic();
      navigateFile(1);
    });
  }

  // Update state
  const hasPrev = currentFileIndex > 0;
  const hasNext = currentFileIndex < viewableFiles.length - 1;
  const total = viewableFiles.length;

  navContainer.querySelector('.file-nav-prev').disabled = !hasPrev;
  navContainer.querySelector('.file-nav-next').disabled = !hasNext;
  navContainer.querySelector('.file-nav-counter').textContent = total > 1 ? `${currentFileIndex + 1} / ${total}` : '';

  // Show/hide based on whether there are multiple files
  navContainer.classList.toggle('hidden', total <= 1);
}

/**
 * Navigate to adjacent file
 * @param {number} direction - -1 for previous, 1 for next
 */
function navigateFile(direction) {
  const newIndex = currentFileIndex + direction;
  if (newIndex < 0 || newIndex >= viewableFiles.length) return;

  const newPath = viewableFiles[newIndex];
  viewFile(newPath);
}

/**
 * Handle keyboard navigation in file viewer
 */
function handleFileViewerKeydown(e) {
  if (!fileViewer || fileViewer.classList.contains('hidden')) return;
  if (viewingDiff) return; // Don't navigate during diff view

  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    navigateFile(-1);
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    navigateFile(1);
  }
}

/**
 * Handle touch start for swipe navigation
 */
function handleFileViewerTouchStart(e) {
  if (viewingDiff) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchMoveX = touchStartX;
}

/**
 * Handle touch move for swipe navigation
 */
function handleFileViewerTouchMove(e) {
  if (viewingDiff) return;
  touchMoveX = e.touches[0].clientX;
}

/**
 * Handle touch end for swipe navigation
 */
function handleFileViewerTouchEnd(e) {
  if (viewingDiff) return;
  if (!fileViewer || fileViewer.classList.contains('hidden')) return;

  const deltaX = touchMoveX - touchStartX;
  const deltaY = e.changedTouches[0].clientY - touchStartY;

  // Only trigger if horizontal swipe is greater than vertical (avoid scroll interference)
  if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
    haptic();
    if (deltaX > 0) {
      // Swipe right = previous
      navigateFile(-1);
    } else {
      // Swipe left = next
      navigateFile(1);
    }
  }

  touchStartX = 0;
  touchStartY = 0;
  touchMoveX = 0;
}

/**
 * Close the file viewer
 */
export function closeFileViewer() {
  fileViewer.classList.remove('open');
  viewingDiff = null;
  currentFileIndex = -1;
  hideGranularToggle();
  setTimeout(() => {
    fileViewer.classList.add('hidden');
    fileViewerContent.innerHTML = '<code></code>';
  }, SLIDE_TRANSITION_DURATION);
}

/**
 * Check if file viewer is open
 */
export function isFileViewerOpen() {
  return fileViewer && fileViewer.classList.contains('open');
}

/**
 * Set viewing diff state
 */
export function setViewingDiff(diff) {
  viewingDiff = diff;
}

/**
 * Get viewing diff state
 */
export function getViewingDiff() {
  return viewingDiff;
}

// === File Search ===

function handleSearchInput(e) {
  const query = e.target.value.trim();

  clearTimeout(searchTimeout);

  if (!query) {
    exitSearchMode();
    return;
  }

  searchTimeout = setTimeout(() => searchFiles(query), DEBOUNCE_SEARCH);
}

async function searchFiles(query) {
  const convId = state.getCurrentConversationId();
  if (!convId) return;

  searchMode = true;
  fileTree.innerHTML = '<div class="file-tree-loading">Searching...</div>';

  const res = await apiFetch(
    `/api/conversations/${convId}/files/search?q=${encodeURIComponent(query)}`,
    { silent: true }
  );

  if (!res) {
    fileTree.innerHTML = `
      <div class="file-tree-empty">
        ${ICONS.error}
        <p>Search failed</p>
      </div>`;
    return;
  }

  const data = await res.json();

  if (data.error) {
    fileTree.innerHTML = `
      <div class="file-tree-empty">
        ${ICONS.error}
        <p>${escapeHtml(data.error)}</p>
      </div>`;
    return;
  }

  searchResults = data.results;
  renderSearchResults();
}

function renderSearchResults() {
  if (!searchResults || searchResults.length === 0) {
    fileTree.innerHTML = `<div class="file-tree-empty">No matches found</div>`;
    return;
  }

  fileTree.innerHTML = searchResults.map(r => `
    <div class="search-result-item" data-path="${escapeHtml(r.path)}" data-line="${r.line}">
      <div class="search-result-location">
        <span class="search-result-path">${escapeHtml(r.path)}</span>
        <span class="search-result-line">:${r.line}</span>
      </div>
      <div class="search-result-content">${escapeHtml(r.content.trim())}</div>
    </div>
  `).join('');

  // Attach click handlers
  fileTree.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      openFileAtLine(item.dataset.path, parseInt(item.dataset.line, 10));
    });
  });
}

async function openFileAtLine(filePath, line) {
  haptic();
  await viewFile(filePath);

  // Scroll to line after content loads
  setTimeout(() => {
    const codeEl = fileViewerContent.querySelector('code');
    if (!codeEl) return;

    // Split by newlines to find the target line
    const lines = codeEl.innerHTML.split('\n');
    if (line > 0 && line <= lines.length) {
      // Highlight the line
      lines[line - 1] = `<span class="highlight-line">${lines[line - 1]}</span>`;
      codeEl.innerHTML = lines.join('\n');

      // Scroll to highlighted line
      const highlighted = codeEl.querySelector('.highlight-line');
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'center' });
      }
    }
  }, 150);
}

/**
 * Exit search mode and return to normal file tree
 */
export function exitSearchMode() {
  searchMode = false;
  searchResults = null;
  if (fileSearchInput) {
    fileSearchInput.value = '';
  }
  loadFileTree(currentPath);
}

/**
 * Check if in search mode
 */
export function isSearchMode() {
  return searchMode;
}

/**
 * Reset search state (called when opening panel)
 */
export function resetSearchState() {
  searchMode = false;
  searchResults = null;
  if (fileSearchInput) {
    fileSearchInput.value = '';
  }
}

/**
 * Get icons object for use in other modules
 */
export function getIcons() {
  return ICONS;
}
