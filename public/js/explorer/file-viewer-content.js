import {
  parseGeoSpatialContent,
  mountGeoPreview,
  unmountGeoPreview,
  resizeGeoPreview,
  prepareGeoJsonForMap,
  getGeoStyleOptions,
  GEO_BASEMAP_OPTIONS,
  setGeoBasemap,
  applyGeoThematicStyle,
  selectGeoFeature,
  fitGeoPreviewToBounds,
} from './geo-preview.js';

const DEFAULT_PREVIEWABLE_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);
const GEO_PREVIEW_EXTS = new Set(['geojson', 'json', 'topojson', 'jsonl', 'ndjson']);
const JSON_PREVIEW_EXTS = new Set(['json', 'geojson', 'topojson']);

const DEFAULT_OPEN_EXTERNAL_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

function toSafeString(value) {
  return value === null || value === undefined ? '' : String(value);
}

function highlightCodeBlocks(container) {
  if (!container || !window.hljs) return;

  container.querySelectorAll('pre code, code[class^="language-"]').forEach((block) => {
    if (!block.dataset.highlighted) {
      hljs.highlightElement(block);
    }
  });
}

function attachOpenButton(container, selector, url) {
  const openBtn = container.querySelector(selector);
  if (openBtn) {
    openBtn.addEventListener('click', () => window.open(url, '_blank'));
  }
}

function renderDataPreview(data, { escapeHtml, enableCopyCells }) {
  const columns = data.columns || [];
  const rows = data.rows || [];
  const isParquet = !!data.parquet;

  const headerCells = columns.map((col) => {
    if (isParquet && typeof col === 'object') {
      const colType = escapeHtml(toSafeString(col.type));
      const colName = escapeHtml(toSafeString(col.name));
      return `<th title="Type: ${colType}">${colName}<span class="col-type-badge">${colType}</span></th>`;
    }
    return `<th>${escapeHtml(toSafeString(col))}</th>`;
  }).join('');

  const dataRows = rows.map((row, idx) =>
    `<tr><td class="row-num">${idx + 1}</td>${(row || []).map((cell) => {
      const cellStr = toSafeString(cell);
      const truncated = cellStr.length > 100 ? `${cellStr.slice(0, 100)}...` : cellStr;
      if (!enableCopyCells) {
        return `<td>${escapeHtml(truncated)}</td>`;
      }
      return `<td class="copyable-cell" data-value="${escapeHtml(cellStr)}" title="Click to copy">${escapeHtml(truncated)}</td>`;
    }).join('')}</tr>`
  ).join('');

  const colNames = isParquet ? columns.map((c) => c.name) : columns;
  const colCount = colNames.length;
  const totalRows = data.totalRows?.toLocaleString?.() || '0';
  const rowDisplay = data.truncated ? `Showing ${rows.length} of ${totalRows}` : `${totalRows}`;
  const infoBadge = `<div class="data-preview-info">${rowDisplay} rows × ${colCount} cols</div>`;
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

function attachCopyHandlers(container) {
  if (!container || !navigator?.clipboard?.writeText) return;

  container.querySelectorAll('.copyable-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const value = cell.dataset.value || '';
      navigator.clipboard.writeText(value).then(() => {
        cell.classList.add('copied');
        setTimeout(() => cell.classList.remove('copied'), 1000);
      }).catch(() => {});
    });
  });
}

function renderJsonNode(value, isLast, escapeHtml) {
  const comma = isLast ? '' : ',';

  if (value === null) return `<span class="json-null">null</span>${comma}`;
  if (typeof value === 'boolean') return `<span class="json-bool">${value}</span>${comma}`;
  if (typeof value === 'number') return `<span class="json-num">${value}</span>${comma}`;

  if (typeof value === 'string') {
    const escaped = escapeHtml(value);
    const truncated = escaped.length > 200 ? `${escaped.slice(0, 200)}...` : escaped;
    return `<span class="json-str">"${truncated}"</span>${comma}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return `<span class="json-bracket">[]</span>${comma}`;
    const items = value.map((item, i) =>
      `<div class="json-line">${renderJsonNode(item, i === value.length - 1, escapeHtml)}</div>`
    ).join('');
    return `<details class="json-collapsible" open><summary class="json-bracket">[<span class="json-count">${value.length} items</span></summary><div class="json-children">${items}</div><span class="json-bracket">]</span>${comma}</details>`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return `<span class="json-bracket">{}</span>${comma}`;
    const items = keys.map((key, i) =>
      `<div class="json-line"><span class="json-key">"${escapeHtml(key)}"</span>: ${renderJsonNode(value[key], i === keys.length - 1, escapeHtml)}</div>`
    ).join('');
    return `<details class="json-collapsible" open><summary class="json-bracket">{<span class="json-count">${keys.length} keys</span></summary><div class="json-children">${items}</div><span class="json-bracket">}</span>${comma}</details>`;
  }

  return `<span>${escapeHtml(toSafeString(value))}</span>${comma}`;
}

function renderJsonPreview(content, escapeHtml) {
  try {
    const data = JSON.parse(content);
    const html = renderJsonNode(data, true, escapeHtml);
    return `
      <div class="json-preview">
        <div class="json-toolbar">
          <button class="json-expand-all" title="Expand all">Expand All</button>
          <button class="json-collapse-all" title="Collapse all">Collapse All</button>
        </div>
        <div class="json-content">${html}</div>
      </div>
    `;
  } catch {
    return null;
  }
}

function attachJsonHandlers(container) {
  const expandBtn = container.querySelector('.json-expand-all');
  const collapseBtn = container.querySelector('.json-collapse-all');

  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      container.querySelectorAll('.json-collapsible').forEach((el) => { el.open = true; });
    });
  }

  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      container.querySelectorAll('.json-collapsible').forEach((el) => { el.open = false; });
    });
  }
}

function renderGeoFeatureSummary(feature, previewKeys, escapeHtml) {
  const properties = feature?.properties && typeof feature.properties === 'object'
    ? feature.properties
    : {};
  const snippets = [];

  previewKeys.forEach((key) => {
    if (!(key in properties)) return;
    const value = toSafeString(properties[key]);
    if (!value) return;
    const trimmed = value.length > 48 ? `${value.slice(0, 45)}...` : value;
    snippets.push(`${escapeHtml(key)}: ${escapeHtml(trimmed)}`);
  });

  if (!snippets.length) return '<span class="geo-preview-table-empty">No properties</span>';
  return snippets.join('<span class="geo-preview-table-sep">•</span>');
}

function renderGeoPreview(container, {
  geoResult,
  fileUrl,
  openExternalIcon,
  escapeHtml,
  rawContent,
  rawDisabled = false,
  rawPreviewSize = null,
  formatFileSize,
  onRefresh = null,
}) {
  const summary = escapeHtml(geoResult.summary || 'GeoJSON map preview');
  const rawText = escapeHtml(toSafeString(rawContent));
  const rawDisabledLimit = Number.isFinite(Number(rawPreviewSize))
    ? formatFileSize(Number(rawPreviewSize))
    : '500KB';
  const { geojson: mapGeoJson, fieldProfiles } = prepareGeoJsonForMap(geoResult.geojson);
  const styleOptions = getGeoStyleOptions(fieldProfiles);
  const numericOptions = styleOptions.filter((option) => option.numeric);
  const previewKeys = styleOptions.slice(0, 2).map((option) => option.key);
  const allFeatures = mapGeoJson.features || [];
  const visibleFeatures = allFeatures.slice(0, 200);
  const tableRowsHtml = visibleFeatures.map((feature, idx) => {
    const fid = feature?.properties?.__fid || String(idx);
    const geom = escapeHtml(toSafeString(feature?.geometry?.type || 'Unknown'));
    const summaryHtml = renderGeoFeatureSummary(feature, previewKeys, escapeHtml);
    return `
      <button class="geo-preview-table-row" data-fid="${escapeHtml(fid)}" title="Focus feature">
        <span class="geo-preview-table-index">${idx + 1}</span>
        <span class="geo-preview-table-geom">${geom}</span>
        <span class="geo-preview-table-summary">${summaryHtml}</span>
      </button>
    `;
  }).join('');
  const truncationNotice = allFeatures.length > visibleFeatures.length
    ? `<div class="geo-preview-table-truncated">Showing ${visibleFeatures.length} of ${allFeatures.length} features</div>`
    : '';

  const basemapOptionsHtml = GEO_BASEMAP_OPTIONS.map((option) =>
    `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`
  ).join('');
  const colorOptionsHtml = ['<option value="__none__">Color: Geometry</option>']
    .concat(styleOptions.map((option) =>
      `<option value="${escapeHtml(option.key)}">Color: ${escapeHtml(option.label)}</option>`
    ))
    .join('');
  const sizeOptionsHtml = ['<option value="__none__">Size: Default</option>']
    .concat(numericOptions.map((option) =>
      `<option value="${escapeHtml(option.key)}">Size: ${escapeHtml(option.label)}</option>`
    ))
    .join('');
  const rawButtonAttrs = rawDisabled
    ? ' disabled title="Raw view disabled for large files"'
    : '';
  const rawPanelHtml = rawDisabled
    ? `
      <div class="geo-preview-raw-disabled">
        <p>Raw view is disabled above ${rawDisabledLimit} to keep the app responsive.</p>
        <button class="geo-preview-open-raw-btn">${openExternalIcon} Open file in new tab</button>
      </div>
    `
    : `<pre><code class="language-json">${rawText}</code></pre>`;

  container.innerHTML = `
    <div class="geo-preview">
      <div class="geo-preview-toolbar">
        <span class="geo-preview-badge">Map</span>
        <span class="geo-preview-meta">${summary}</span>
        <div class="geo-preview-controls">
          <select class="geo-preview-select" data-role="geo-basemap" aria-label="Basemap">
            ${basemapOptionsHtml}
          </select>
          <select class="geo-preview-select" data-role="geo-color-by" aria-label="Color by">
            ${colorOptionsHtml}
          </select>
          <select class="geo-preview-select" data-role="geo-size-by" aria-label="Size by">
            ${sizeOptionsHtml}
          </select>
          <button class="geo-preview-fit-btn" data-role="geo-fit" title="Return to bounds">Fit</button>
          <button class="geo-preview-fit-btn geo-preview-refresh-btn" data-role="geo-refresh" title="Reload file from disk">Refresh</button>
        </div>
        <div class="geo-preview-view-toggle" role="tablist" aria-label="Geo preview mode">
          <button class="geo-preview-view-btn active" data-view="map" role="tab" aria-selected="true">Map</button>
          <button class="geo-preview-view-btn" data-view="raw" role="tab" aria-selected="false"${rawButtonAttrs}>Raw</button>
        </div>
      </div>
      <div class="geo-preview-panel geo-preview-panel-map" data-role="geo-panel-map">
        <div class="geo-preview-map-wrap">
          <div class="geo-preview-map" data-role="geo-map"></div>
          <div class="geo-preview-status" data-role="geo-status">Loading map preview...</div>
        </div>
        <div class="geo-preview-table-wrap">
          <div class="geo-preview-table-header">Features</div>
          <div class="geo-preview-table" data-role="geo-table">${tableRowsHtml}</div>
          ${truncationNotice}
        </div>
      </div>
      <div class="geo-preview-panel geo-preview-panel-raw hidden" data-role="geo-panel-raw">
        ${rawPanelHtml}
      </div>
    </div>
    <button class="file-viewer-open-tab-btn" title="Open in new tab">${openExternalIcon}</button>
  `;

  attachOpenButton(container, '.file-viewer-open-tab-btn', fileUrl);
  if (rawDisabled) {
    attachOpenButton(container, '.geo-preview-open-raw-btn', fileUrl);
  }
  highlightCodeBlocks(container);

  const mapElement = container.querySelector('[data-role="geo-map"]');
  const statusElement = container.querySelector('[data-role="geo-status"]');
  const mapPanel = container.querySelector('[data-role="geo-panel-map"]');
  const rawPanel = container.querySelector('[data-role="geo-panel-raw"]');
  const viewButtons = container.querySelectorAll('.geo-preview-view-btn');
  const table = container.querySelector('[data-role="geo-table"]');
  const tableRows = table ? Array.from(table.querySelectorAll('.geo-preview-table-row')) : [];
  const basemapSelect = container.querySelector('[data-role="geo-basemap"]');
  const colorSelect = container.querySelector('[data-role="geo-color-by"]');
  const sizeSelect = container.querySelector('[data-role="geo-size-by"]');
  const fitBtn = container.querySelector('[data-role="geo-fit"]');
  const refreshBtn = container.querySelector('[data-role="geo-refresh"]');

  const setSelectedRow = (fid) => {
    if (!tableRows.length) return;
    tableRows.forEach((row) => {
      const selected = row.dataset.fid === fid;
      row.classList.toggle('active', selected);
      if (selected) {
        row.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  const applyStyleSelections = () => {
    applyGeoThematicStyle(container, {
      colorBy: colorSelect?.value || '__none__',
      sizeBy: sizeSelect?.value || '__none__',
    });
  };

  const setView = (view) => {
    const mapActive = view === 'map';
    if (mapPanel) mapPanel.classList.toggle('hidden', !mapActive);
    if (rawPanel) rawPanel.classList.toggle('hidden', mapActive);
    viewButtons.forEach((btn) => {
      const isActive = btn.dataset.view === view;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    if (mapActive) {
      setTimeout(() => resizeGeoPreview(container), 0);
    }
  };

  viewButtons.forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view || 'map'));
  });

  if (basemapSelect) {
    basemapSelect.addEventListener('change', () => {
      setGeoBasemap(container, basemapSelect.value);
    });
  }

  if (colorSelect) colorSelect.addEventListener('change', applyStyleSelections);
  if (sizeSelect) sizeSelect.addEventListener('change', applyStyleSelections);
  if (fitBtn) {
    fitBtn.addEventListener('click', () => {
      fitGeoPreviewToBounds(container);
    });
  }

  if (refreshBtn && typeof onRefresh === 'function') {
    refreshBtn.addEventListener('click', async () => {
      if (refreshBtn.disabled) return;
      refreshBtn.disabled = true;
      const originalLabel = refreshBtn.textContent;
      refreshBtn.textContent = 'Refreshing...';
      try {
        await onRefresh();
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = originalLabel;
      }
    });
  }

  tableRows.forEach((row) => {
    row.addEventListener('click', () => {
      const fid = row.dataset.fid;
      selectGeoFeature(container, fid, { fit: true });
      setSelectedRow(fid);
    });
  });

  void mountGeoPreview({
    container,
    mapElement,
    statusElement,
    geojson: mapGeoJson,
    bounds: geoResult.bounds,
    basemap: basemapSelect?.value || 'standard',
    fieldProfiles,
    onFeatureSelect: (fid) => {
      setSelectedRow(fid);
    },
  }).then((result) => {
    if (!result?.ok) return;
    applyStyleSelections();
  });
}

function renderNotebookOutput(output, escapeHtml) {
  if (output.output_type === 'stream') {
    const streamClass = output.name === 'stderr' ? 'nb-output-stderr' : 'nb-output-stdout';
    return `<div class="nb-output ${streamClass}"><pre>${escapeHtml(toSafeString(output.text))}</pre></div>`;
  }

  if (output.output_type === 'error') {
    const traceback = (output.traceback || [])
      .map((line) => toSafeString(line).replace(/\x1b\[[0-9;]*m/g, ''))
      .join('\n');
    return `
      <div class="nb-output nb-output-error">
        <div class="nb-error-name">${escapeHtml(toSafeString(output.ename))}: ${escapeHtml(toSafeString(output.evalue))}</div>
        <pre>${escapeHtml(traceback)}</pre>
      </div>
    `;
  }

  if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
    const data = output.data || {};

    if (data['image/png']) {
      return `<div class="nb-output nb-output-image"><img src="data:image/png;base64,${data['image/png']}" alt="output"></div>`;
    }
    if (data['image/jpeg']) {
      return `<div class="nb-output nb-output-image"><img src="data:image/jpeg;base64,${data['image/jpeg']}" alt="output"></div>`;
    }
    if (data['image/svg+xml']) {
      return `<div class="nb-output nb-output-image">${data['image/svg+xml']}</div>`;
    }
    if (data['text/html']) {
      return `<div class="nb-output nb-output-html">${data['text/html']}</div>`;
    }
    if (data['text/plain']) {
      return `<div class="nb-output nb-output-text"><pre>${escapeHtml(toSafeString(data['text/plain']))}</pre></div>`;
    }
  }

  return '';
}

function renderNotebookPreview(data, { escapeHtml, renderMarkdown }) {
  const cells = data.cells || [];
  const metadata = data.metadata || {};
  const language = metadata.language_info?.name || 'python';

  const cellsHtml = cells.map((cell) => {
    const source = toSafeString(cell.source);

    if (cell.type === 'markdown') {
      if (renderMarkdown) {
        return `<div class="nb-cell nb-markdown"><div class="nb-cell-content markdown-body">${renderMarkdown(source)}</div></div>`;
      }
      return `<div class="nb-cell nb-markdown"><div class="nb-cell-content"><pre>${escapeHtml(source)}</pre></div></div>`;
    }

    if (cell.type === 'raw') {
      return `<div class="nb-cell nb-raw"><div class="nb-cell-content"><pre>${escapeHtml(source)}</pre></div></div>`;
    }

    const execCount = cell.execution_count !== null && cell.execution_count !== undefined
      ? cell.execution_count
      : ' ';
    const outputs = (cell.outputs || []).map((output) => renderNotebookOutput(output, escapeHtml)).join('');

    return `
      <div class="nb-cell nb-code">
        <div class="nb-cell-input">
          <span class="nb-exec-count">[${execCount}]:</span>
          <pre><code class="language-${language}">${escapeHtml(source)}</code></pre>
        </div>
        ${outputs ? `<div class="nb-cell-outputs">${outputs}</div>` : ''}
      </div>
    `;
  }).join('');

  const kernelName = metadata.kernelspec?.display_name || metadata.kernelspec?.name || '';
  const headerInfo = kernelName ? `<div class="nb-header">${escapeHtml(kernelName)}</div>` : '';
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

export function renderFileViewerContent({
  container,
  data,
  filePath,
  context,
  icons = {},
  escapeHtml,
  renderMarkdown = null,
  formatFileSize,
  imageExts,
  previewableExts = DEFAULT_PREVIEWABLE_EXTS,
  enableCopyCells = true,
  onRefresh = null,
}) {
  if (!container || !data || !context) return false;

  unmountGeoPreview(container);

  const ext = toSafeString(data.ext).toLowerCase();
  const fileUrl = context.getFileDownloadUrl(filePath, { inline: true });
  const downloadUrl = context.getFileDownloadUrl(filePath);
  const fileLikeIcon = icons.document || icons.file || '';
  const openExternalIcon = icons.openExternal || DEFAULT_OPEN_EXTERNAL_ICON;

  if (data.csv || data.parquet) {
    container.innerHTML = renderDataPreview(data, { escapeHtml, enableCopyCells });
    if (enableCopyCells) {
      attachCopyHandlers(container);
    }
    return true;
  }

  if (data.notebook) {
    container.innerHTML = renderNotebookPreview(data, { escapeHtml, renderMarkdown });
    highlightCodeBlocks(container);
    return true;
  }

  if (data.binary) {
    if (imageExts.has(ext)) {
      container.innerHTML = `
        <div class="file-viewer-preview">
          <img src="${fileUrl}" alt="${escapeHtml(toSafeString(data.name))}" class="file-viewer-image" title="Click to open full size">
          <button class="file-viewer-fullsize-btn" title="Open full size">${openExternalIcon}</button>
        </div>
      `;
      const openFullSize = () => window.open(fileUrl, '_blank');
      const img = container.querySelector('.file-viewer-image');
      const btn = container.querySelector('.file-viewer-fullsize-btn');
      if (img) img.addEventListener('click', openFullSize);
      if (btn) btn.addEventListener('click', openFullSize);
      return true;
    }

    if (previewableExts.has(ext)) {
      container.innerHTML = `
        <div class="file-viewer-error">
          ${fileLikeIcon}
          <p>${escapeHtml(toSafeString(data.name))}</p>
          <p style="font-size: 12px; opacity: 0.7; margin-bottom: 12px;">${formatFileSize(data.size)}</p>
          <button class="file-viewer-open-btn">${openExternalIcon} Open in new tab</button>
        </div>
      `;
      attachOpenButton(container, '.file-viewer-open-btn', fileUrl);
      return true;
    }

    container.innerHTML = `
      <div class="file-viewer-error">
        ${icons.file || fileLikeIcon}
        <p>Binary file cannot be previewed</p>
        <p style="font-size: 12px; opacity: 0.7; margin-bottom: 12px;">${formatFileSize(data.size)}</p>
        <button class="file-viewer-open-btn">${openExternalIcon} Download</button>
      </div>
    `;
    attachOpenButton(container, '.file-viewer-open-btn', downloadUrl);
    return true;
  }

  if (data.truncated) {
    const maxPreview = Number.isFinite(Number(data.maxPreviewSize))
      ? formatFileSize(Number(data.maxPreviewSize))
      : '500KB';
    const sizeErrorTitle = GEO_PREVIEW_EXTS.has(ext)
      ? 'File too large for map preview'
      : 'File too large to preview';
    container.innerHTML = `
      <div class="file-viewer-error">
        ${fileLikeIcon}
        <p>${sizeErrorTitle}</p>
        <p style="font-size: 12px; opacity: 0.7;">${formatFileSize(data.size)} (max ${maxPreview})</p>
      </div>
    `;
    return true;
  }

  const content = toSafeString(data.content);

  if (GEO_PREVIEW_EXTS.has(ext)) {
    const geoResult = parseGeoSpatialContent(content, ext);
    if (geoResult.ok && geoResult.geojson) {
      renderGeoPreview(container, {
        geoResult,
        fileUrl,
        openExternalIcon,
        escapeHtml,
        rawContent: data.rawTruncated ? '' : content,
        rawDisabled: !!data.rawTruncated,
        rawPreviewSize: data.rawPreviewSize,
        formatFileSize,
        onRefresh,
      });
      return true;
    }
  }

  if (ext === 'md' || ext === 'markdown') {
    const rendered = renderMarkdown ? renderMarkdown(content) : `<pre>${escapeHtml(content)}</pre>`;
    container.innerHTML = `
      <div class="markdown-preview">
        <div class="markdown-body">${rendered}</div>
      </div>
      <button class="file-viewer-open-tab-btn" title="Open in new tab">${openExternalIcon}</button>
    `;
    attachOpenButton(container, '.file-viewer-open-tab-btn', fileUrl);
    return true;
  }

  if (JSON_PREVIEW_EXTS.has(ext)) {
    const jsonHtml = renderJsonPreview(content, escapeHtml);
    if (jsonHtml) {
      container.innerHTML = `
        ${jsonHtml}
        <button class="file-viewer-open-tab-btn" title="Open in new tab">${openExternalIcon}</button>
      `;
      attachJsonHandlers(container);
      attachOpenButton(container, '.file-viewer-open-tab-btn', fileUrl);
      return true;
    }
  }

  const langClass = data.language ? `language-${data.language}` : '';
  container.innerHTML = `
    <code class="${langClass}">${escapeHtml(content)}</code>
    <button class="file-viewer-open-tab-btn" title="Open in new tab">${openExternalIcon}</button>
  `;
  highlightCodeBlocks(container);
  attachOpenButton(container, '.file-viewer-open-tab-btn', fileUrl);
  return true;
}
