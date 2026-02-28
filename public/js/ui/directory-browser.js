// --- Directory browsing (for new conversation modal) ---
import { escapeHtml } from '../markdown.js';
import { showDialog } from '../utils.js';
import * as state from '../state.js';

const FAVORITES_STORAGE_KEY = 'directoryFavorites:v1';
const RECENTS_STORAGE_KEY = 'directoryRecentPaths:v1';
const FAVORITES_MAX = 20;
const RECENTS_MAX = 10;
const DEEP_SEARCH_DEBOUNCE_MS = 200;
const DEEP_SEARCH_MIN_QUERY_LENGTH = 2;

// DOM elements (set by init)
let browseBtn = null;
let dirBrowser = null;
let dirUpBtn = null;
let dirCurrentPath = null;
let dirFavoriteToggle = null;
let dirFilterInput = null;
let dirDeepSearchBtn = null;
let dirBreadcrumbs = null;
let dirFavorites = null;
let dirFavoritesList = null;
let dirRecents = null;
let dirRecentsList = null;
let dirSearchResults = null;
let dirSearchResultsList = null;
let dirList = null;
let dirStatus = null;
let dirNewBtn = null;
let dirSelectBtn = null;
let convCwdInput = null;

let currentDirs = [];
let filteredDirs = [];
let activeDirIndex = -1;
let deepSearchResults = [];
let deepSearchTruncated = false;
let deepSearchDebounceTimer = null;
let deepSearchRequestId = 0;
let deepSearchAbortController = null;

function normalizePathValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/\/+$/, '');
  return compact || '/';
}

function joinPath(basePath, childName) {
  const base = normalizePathValue(basePath);
  if (!base || base === '/') return `/${childName}`;
  return `${base}/${childName}`;
}

function getParentPath(currentPath) {
  const normalized = normalizePathValue(currentPath);
  if (!normalized || normalized === '/') return '/';
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '/';
  return normalized.slice(0, idx);
}

function clampArray(values, limit) {
  return values.slice(0, limit);
}

function readStoredPathList(key) {
  try {
    const value = localStorage.getItem(key);
    if (!value) return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizePathValue(item))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeStoredPathList(key, values) {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // Ignore storage write failures (e.g. private mode quota restrictions).
  }
}

function getFavoritePaths() {
  return readStoredPathList(FAVORITES_STORAGE_KEY);
}

function setFavoritePaths(paths) {
  writeStoredPathList(FAVORITES_STORAGE_KEY, clampArray(paths, FAVORITES_MAX));
}

function getRecentPaths() {
  return readStoredPathList(RECENTS_STORAGE_KEY);
}

function setRecentPaths(paths) {
  writeStoredPathList(RECENTS_STORAGE_KEY, clampArray(paths, RECENTS_MAX));
}

function upsertPathAtFront(values, item, maxSize) {
  const normalized = normalizePathValue(item);
  if (!normalized) return values;
  const deduped = values.filter((entry) => normalizePathValue(entry) !== normalized);
  return clampArray([normalized, ...deduped], maxSize);
}

function scoreLocalDirectory(name, queryLower, queryTokens) {
  const target = String(name || '').toLowerCase();
  if (!target) return null;
  if (queryTokens.length > 0 && !queryTokens.every((token) => target.includes(token))) return null;

  let score = 0;
  if (target === queryLower) score += 100;
  if (target.startsWith(queryLower)) score += 70;
  if (target.includes(queryLower)) score += 30;

  let ordered = true;
  let cursor = 0;
  for (const token of queryTokens) {
    const idx = target.indexOf(token, cursor);
    if (idx === -1) {
      ordered = false;
      break;
    }
    cursor = idx + token.length;
  }
  if (ordered) score += 8;

  score -= target.length / 200;
  return score;
}

function clearDeepSearchState() {
  if (deepSearchDebounceTimer) {
    clearTimeout(deepSearchDebounceTimer);
    deepSearchDebounceTimer = null;
  }
  if (deepSearchAbortController) {
    deepSearchAbortController.abort();
    deepSearchAbortController = null;
  }
  deepSearchResults = [];
  deepSearchTruncated = false;
  renderDeepSearchResults();
}

function setStatusMessage(message, { error = false } = {}) {
  if (!dirStatus) return;
  dirStatus.textContent = message || '';
  dirStatus.classList.toggle('error', !!error);
}

function setCwdInputValidity(valid) {
  if (!convCwdInput) return;
  convCwdInput.classList.toggle('input-error', !valid);
  if (valid) {
    convCwdInput.removeAttribute('aria-invalid');
  } else {
    convCwdInput.setAttribute('aria-invalid', 'true');
  }
}

function buildBreadcrumbSegments(pathValue) {
  const normalized = normalizePathValue(pathValue);
  if (!normalized || normalized === '/') {
    return [{ label: '/', path: '/' }];
  }

  if (normalized.startsWith('/')) {
    const parts = normalized.slice(1).split('/').filter(Boolean);
    const segments = [{ label: '/', path: '/' }];
    let current = '/';
    for (const part of parts) {
      current = current === '/' ? `/${part}` : `${current}/${part}`;
      segments.push({ label: part, path: current });
    }
    return segments;
  }

  // Fallback for non-posix paths.
  return [{ label: normalized, path: normalized }];
}

function renderBreadcrumbs() {
  if (!dirBreadcrumbs) return;
  const currentPath = state.getCurrentBrowsePath() || convCwdInput?.value || '';
  const segments = buildBreadcrumbSegments(currentPath);
  dirBreadcrumbs.innerHTML = segments.map((segment, index) => {
    const separator = index < segments.length - 1
      ? '<span class="dir-breadcrumb-sep">/</span>'
      : '';
    return (
      `<button type="button" class="dir-breadcrumb-btn" data-path="${escapeHtml(segment.path)}">`
      + `${escapeHtml(segment.label)}`
      + '</button>'
      + separator
    );
  }).join('');
}

function renderFavoriteToggle() {
  if (!dirFavoriteToggle) return;
  const currentPath = normalizePathValue(state.getCurrentBrowsePath());
  const favorites = getFavoritePaths();
  const isFavorite = !!currentPath && favorites.includes(currentPath);
  dirFavoriteToggle.innerHTML = isFavorite ? '&#9733;' : '&#9734;';
  dirFavoriteToggle.setAttribute('aria-label', isFavorite ? 'Remove from favorites' : 'Add to favorites');
  dirFavoriteToggle.title = isFavorite ? 'Remove from favorites' : 'Add to favorites';
  dirFavoriteToggle.classList.toggle('active', isFavorite);
}

function renderPathChipSection(sectionEl, listEl, paths, sectionClass) {
  if (!sectionEl || !listEl) return;
  if (!paths.length) {
    sectionEl.classList.add('hidden');
    listEl.innerHTML = '';
    return;
  }

  sectionEl.classList.remove('hidden');
  listEl.innerHTML = paths.map((entryPath) => {
    const label = entryPath.split('/').filter(Boolean).pop() || entryPath;
    return (
      `<button type="button" class="dir-chip ${sectionClass}" data-path="${escapeHtml(entryPath)}" title="${escapeHtml(entryPath)}">`
      + `${escapeHtml(label)}`
      + '</button>'
    );
  }).join('');
}

function renderFavorites() {
  renderPathChipSection(dirFavorites, dirFavoritesList, getFavoritePaths(), 'dir-favorite-chip');
}

function renderRecents() {
  const favorites = new Set(getFavoritePaths());
  const recents = getRecentPaths().filter((entry) => !favorites.has(entry));
  renderPathChipSection(dirRecents, dirRecentsList, recents, 'dir-recent-chip');
}

function updateActiveDirItem() {
  if (!dirList) return;
  const items = dirList.querySelectorAll('.dir-item');
  if (!items.length) {
    activeDirIndex = -1;
    dirList.removeAttribute('aria-activedescendant');
    return;
  }

  if (activeDirIndex < 0 || activeDirIndex >= items.length) activeDirIndex = 0;

  items.forEach((item, index) => {
    const isActive = index === activeDirIndex;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-selected', isActive ? 'true' : 'false');
    if (isActive) {
      dirList.setAttribute('aria-activedescendant', item.id);
    }
  });
}

function renderLocalDirectoryList() {
  if (!dirList) return;

  const query = (dirFilterInput?.value || '').trim().toLowerCase();
  if (!query) {
    filteredDirs = [...currentDirs];
  } else {
    const tokens = query.split(/\s+/).filter(Boolean);
    const ranked = currentDirs
      .map((name) => ({ name, score: scoreLocalDirectory(name, query, tokens) }))
      .filter((item) => item.score !== null)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
    filteredDirs = ranked.map((item) => item.name);
  }

  if (filteredDirs.length === 0) {
    dirList.innerHTML = '<div class="dir-empty">No folders in this location</div>';
    activeDirIndex = -1;
    dirList.removeAttribute('aria-activedescendant');
  } else {
    dirList.innerHTML = filteredDirs.map((name, index) => {
      const fullPath = joinPath(state.getCurrentBrowsePath(), name);
      return (
        `<button type="button" class="dir-item" id="dir-item-${index}" role="option" data-name="${escapeHtml(name)}" data-path="${escapeHtml(fullPath)}">`
        + '<span class="dir-item-icon">&#x1F4C1;</span>'
        + `<span class="dir-item-name">${escapeHtml(name)}</span>`
        + '</button>'
      );
    }).join('');
    activeDirIndex = 0;
    updateActiveDirItem();
  }
}

function renderDeepSearchResults() {
  if (!dirSearchResults || !dirSearchResultsList) return;

  if (!deepSearchResults.length) {
    dirSearchResults.classList.add('hidden');
    dirSearchResultsList.innerHTML = '';
    return;
  }

  dirSearchResults.classList.remove('hidden');
  dirSearchResultsList.innerHTML = deepSearchResults.map((entry, index) => (
    `<button type="button" class="dir-item dir-item-secondary" data-path="${escapeHtml(entry.path)}" id="dir-deep-item-${index}">`
    + '<span class="dir-item-icon">&#x1F4C1;</span>'
    + `<span class="dir-item-name">${escapeHtml(entry.relPath || entry.name || entry.path)}</span>`
    + '</button>'
  )).join('');

  if (deepSearchTruncated) {
    dirSearchResultsList.insertAdjacentHTML(
      'beforeend',
      '<div class="dir-empty dir-search-note">Showing top matches. Narrow query for more precise results.</div>'
    );
  }
}

async function fetchBrowseData(dirPath) {
  const qs = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
  try {
    const response = await fetch(`/api/browse${qs}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      return { ok: false, error: payload.error || `Request failed (${response.status})`, path: payload.path };
    }
    return { ok: true, data: payload };
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to browse directory' };
  }
}

async function applyBrowseData(payload, { preserveFilter = false } = {}) {
  state.setCurrentBrowsePath(payload.path);
  currentDirs = Array.isArray(payload.dirs) ? [...payload.dirs] : [];
  currentDirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  if (dirCurrentPath) dirCurrentPath.textContent = payload.path;
  if (convCwdInput) convCwdInput.value = payload.path;
  setCwdInputValidity(true);
  if (!preserveFilter && dirFilterInput) dirFilterInput.value = '';

  renderBreadcrumbs();
  renderFavoriteToggle();
  renderFavorites();
  renderRecents();
  renderLocalDirectoryList();
  clearDeepSearchState();
  setStatusMessage(currentDirs.length ? `${currentDirs.length} folder${currentDirs.length === 1 ? '' : 's'}` : 'No subdirectories');
}

// --- Directory browser ---
export async function browseTo(dirPath, options = {}) {
  const result = await fetchBrowseData(dirPath);
  if (!result.ok) {
    setStatusMessage(result.error || 'Failed to browse directory', { error: true });
    return false;
  }
  await applyBrowseData(result.data, options);
  return true;
}

async function browseToInputPath() {
  const raw = convCwdInput?.value?.trim() || '';
  if (!raw) return false;

  const ok = await browseTo(raw, { preserveFilter: false });
  if (!ok) {
    setCwdInputValidity(false);
    setStatusMessage('Directory not found or not accessible', { error: true });
    return false;
  }
  setCwdInputValidity(true);
  return true;
}

function addRecentPath(entryPath) {
  const current = getRecentPaths();
  const next = upsertPathAtFront(current, entryPath, RECENTS_MAX);
  setRecentPaths(next);
}

function toggleCurrentFavorite() {
  const currentPath = normalizePathValue(state.getCurrentBrowsePath());
  if (!currentPath) return;

  const favorites = getFavoritePaths();
  const exists = favorites.includes(currentPath);
  const next = exists
    ? favorites.filter((entry) => entry !== currentPath)
    : upsertPathAtFront(favorites, currentPath, FAVORITES_MAX);
  setFavoritePaths(next);
  renderFavoriteToggle();
  renderFavorites();
  renderRecents();
}

function confirmSelection() {
  const currentPath = normalizePathValue(state.getCurrentBrowsePath()) || normalizePathValue(convCwdInput?.value);
  if (!currentPath || !convCwdInput) return;
  convCwdInput.value = currentPath;
  addRecentPath(currentPath);
  renderRecents();
  dirBrowser.classList.add('hidden');
}

async function runDeepSearch(force = false) {
  const base = normalizePathValue(state.getCurrentBrowsePath() || convCwdInput?.value);
  const query = (dirFilterInput?.value || '').trim();
  if (!base || query.length < DEEP_SEARCH_MIN_QUERY_LENGTH) {
    clearDeepSearchState();
    return;
  }
  if (!force && filteredDirs.length > 0) {
    deepSearchResults = [];
    deepSearchTruncated = false;
    renderDeepSearchResults();
    return;
  }

  if (deepSearchAbortController) deepSearchAbortController.abort();
  const AbortControllerCtor = globalThis.AbortController;
  if (!AbortControllerCtor) return;
  const controller = new AbortControllerCtor();
  deepSearchAbortController = controller;
  const requestId = ++deepSearchRequestId;
  setStatusMessage('Searching nested folders...');

  const qs = new URLSearchParams({
    base,
    q: query,
    limit: '50',
    depth: '4',
  });

  try {
    const response = await fetch(`/api/browse/search?${qs.toString()}`, { signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (requestId !== deepSearchRequestId) return;
    if (!response.ok || payload.error) {
      deepSearchResults = [];
      deepSearchTruncated = false;
      renderDeepSearchResults();
      setStatusMessage(payload.error || `Search failed (${response.status})`, { error: true });
      return;
    }

    deepSearchResults = Array.isArray(payload.results) ? payload.results : [];
    deepSearchTruncated = !!payload.truncated;
    renderDeepSearchResults();
    if (deepSearchResults.length > 0) {
      setStatusMessage(`Found ${deepSearchResults.length} nested match${deepSearchResults.length === 1 ? '' : 'es'}`);
    } else {
      setStatusMessage('No nested matches found');
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
    deepSearchResults = [];
    deepSearchTruncated = false;
    renderDeepSearchResults();
    setStatusMessage(err.message || 'Directory search failed', { error: true });
  }
}

function queueDeepSearch(force = false) {
  if (deepSearchDebounceTimer) clearTimeout(deepSearchDebounceTimer);
  deepSearchDebounceTimer = setTimeout(() => {
    deepSearchDebounceTimer = null;
    void runDeepSearch(force);
  }, DEEP_SEARCH_DEBOUNCE_MS);
}

function setActiveIndex(nextIndex) {
  if (filteredDirs.length === 0) {
    activeDirIndex = -1;
    updateActiveDirItem();
    return;
  }
  activeDirIndex = Math.max(0, Math.min(filteredDirs.length - 1, nextIndex));
  updateActiveDirItem();
}

function moveActiveIndex(delta) {
  if (filteredDirs.length === 0) return;
  const start = activeDirIndex < 0 ? 0 : activeDirIndex;
  setActiveIndex(start + delta);
}

async function openActiveDirectory() {
  if (filteredDirs.length === 0) return;
  const index = activeDirIndex < 0 ? 0 : activeDirIndex;
  const name = filteredDirs[index];
  if (!name) return;
  await browseTo(joinPath(state.getCurrentBrowsePath(), name));
}

async function openDirectoryBrowser() {
  dirBrowser.classList.remove('hidden');
  const seedPath = convCwdInput.value.trim() || state.getCurrentBrowsePath() || '';
  const ok = await browseTo(seedPath);
  if (!ok) {
    await browseTo('');
  }
  dirFilterInput?.focus();
}

function renderSectionPathFromEvent(target, selector) {
  const button = target.closest(selector);
  if (!button) return null;
  return button.dataset.path || null;
}

function handleDirectoryBrowserKeyboard(e) {
  if (dirBrowser.classList.contains('hidden')) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    dirBrowser.classList.add('hidden');
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    confirmSelection();
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveActiveIndex(1);
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveActiveIndex(-1);
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    void openActiveDirectory();
    return;
  }

  if (e.key === 'Backspace' && document.activeElement === dirFilterInput && !dirFilterInput.value.trim()) {
    e.preventDefault();
    void browseTo(getParentPath(state.getCurrentBrowsePath()));
  }
}

function attachSectionPathHandler(containerEl, selector) {
  if (!containerEl) return;
  containerEl.addEventListener('click', (event) => {
    const targetPath = renderSectionPathFromEvent(event.target, selector);
    if (!targetPath) return;
    void browseTo(targetPath);
  });
}

export function initDirectoryBrowser(elements) {
  browseBtn = elements.browseBtn;
  dirBrowser = elements.dirBrowser;
  dirUpBtn = elements.dirUpBtn;
  dirCurrentPath = elements.dirCurrentPath;
  dirFavoriteToggle = elements.dirFavoriteToggle;
  dirFilterInput = elements.dirFilterInput;
  dirDeepSearchBtn = elements.dirDeepSearchBtn;
  dirBreadcrumbs = elements.dirBreadcrumbs;
  dirFavorites = elements.dirFavorites;
  dirFavoritesList = elements.dirFavoritesList;
  dirRecents = elements.dirRecents;
  dirRecentsList = elements.dirRecentsList;
  dirSearchResults = elements.dirSearchResults;
  dirSearchResultsList = elements.dirSearchResultsList;
  dirList = elements.dirList;
  dirStatus = elements.dirStatus;
  dirNewBtn = elements.dirNewBtn;
  dirSelectBtn = elements.dirSelectBtn;
  convCwdInput = elements.convCwdInput;

  currentDirs = [];
  filteredDirs = [];
  activeDirIndex = -1;
  clearDeepSearchState();
}

// --- Event listener setup for directory browser elements ---
export function setupDirectoryBrowserEventListeners() {
  if (!browseBtn || !dirBrowser) return;

  browseBtn.addEventListener('click', () => {
    const isHidden = dirBrowser.classList.contains('hidden');
    if (isHidden) {
      void openDirectoryBrowser();
    } else {
      dirBrowser.classList.add('hidden');
    }
  });

  dirUpBtn?.addEventListener('click', () => {
    void browseTo(getParentPath(state.getCurrentBrowsePath()));
  });

  dirFavoriteToggle?.addEventListener('click', () => {
    toggleCurrentFavorite();
  });

  dirSelectBtn?.addEventListener('click', () => {
    confirmSelection();
  });

  dirNewBtn?.addEventListener('click', async () => {
    const name = await showDialog({
      title: 'New folder',
      input: true,
      placeholder: 'Folder name',
      confirmLabel: 'Create'
    });
    if (!name || !name.trim()) return;
    const newPath = joinPath(state.getCurrentBrowsePath(), name.trim());
    let response;
    try {
      response = await fetch('/api/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath }),
      });
    } catch (err) {
      setStatusMessage(err.message || 'Failed to create folder', { error: true });
      return;
    }

    const data = await response.json().catch(() => ({}));
    if (response.ok && data.ok) {
      await browseTo(newPath);
      addRecentPath(newPath);
      renderRecents();
    } else {
      setStatusMessage(data.error || `Failed to create folder (${response.status})`, { error: true });
    }
  });

  dirFilterInput?.addEventListener('input', () => {
    renderLocalDirectoryList();
    const query = dirFilterInput.value.trim();
    if (query.length >= DEEP_SEARCH_MIN_QUERY_LENGTH && filteredDirs.length === 0) {
      queueDeepSearch(false);
    } else {
      clearDeepSearchState();
      const count = filteredDirs.length;
      setStatusMessage(count ? `${count} folder${count === 1 ? '' : 's'}` : 'No folders in this location');
    }
  });

  dirDeepSearchBtn?.addEventListener('click', () => {
    queueDeepSearch(true);
  });

  dirBreadcrumbs?.addEventListener('click', (event) => {
    const targetPath = renderSectionPathFromEvent(event.target, '.dir-breadcrumb-btn');
    if (!targetPath) return;
    void browseTo(targetPath);
  });

  attachSectionPathHandler(dirFavoritesList, '.dir-chip');
  attachSectionPathHandler(dirRecentsList, '.dir-chip');
  attachSectionPathHandler(dirSearchResultsList, '.dir-item');

  dirList?.addEventListener('click', (event) => {
    const item = event.target.closest('.dir-item');
    if (!item) return;
    const itemPath = item.dataset.path;
    if (!itemPath) return;
    void browseTo(itemPath);
  });

  dirList?.addEventListener('mousemove', (event) => {
    const item = event.target.closest('.dir-item');
    if (!item) return;
    const index = Number.parseInt(item.id.replace('dir-item-', ''), 10);
    if (Number.isFinite(index) && index !== activeDirIndex) {
      activeDirIndex = index;
      updateActiveDirItem();
    }
  });

  dirBrowser.addEventListener('keydown', handleDirectoryBrowserKeyboard);

  convCwdInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    if (dirBrowser.classList.contains('hidden')) {
      dirBrowser.classList.remove('hidden');
    }
    void browseToInputPath();
  });

  convCwdInput?.addEventListener('blur', () => {
    if (!convCwdInput.value.trim()) {
      setCwdInputValidity(true);
      return;
    }
    void browseToInputPath();
  });
}
