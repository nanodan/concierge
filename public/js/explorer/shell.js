import { fetchDirectoryData, getViewableFiles, deleteFilePath, uploadFilesToContext } from './files-core.js';
import { renderFileTreeView } from './file-tree-ui.js';
import { createFileViewerNavigation } from './file-viewer-nav.js';
import { renderFileViewerContent } from './file-viewer-content.js';

function noop() {}

function renderDefaultError(container, message, escapeHtml) {
  if (!container) return;
  container.innerHTML = `<div class="file-tree-empty"><p>${escapeHtml(message || 'Failed to load files')}</p></div>`;
}

function renderDefaultEmpty(container) {
  if (!container) return;
  container.innerHTML = '<div class="file-tree-empty"><p>Empty folder</p></div>';
}

function renderViewerError(container, message, escapeHtml, iconHtml = '') {
  if (!container) return;
  container.innerHTML = `
    <div class="file-viewer-error">
      ${iconHtml}
      <p>${escapeHtml(message)}</p>
    </div>`;
}

export function createExplorerShell({
  context,
  apiFetch,
  treeContainer,
  viewer,
  viewerName,
  viewerContent,
  escapeHtml,
  renderMarkdown,
  formatFileSize,
  getFileIcon,
  imageExts,
  icons = {},
  animationDelayMs = 0,
  closeDelayMs = 0,
  iconTag = 'span',
  includeExtAttr = false,
  transformEntries = (entries) => entries,
  getDeletePath = (entry) => entry.path,
  getExtraButtonHtml = () => '',
  extraButtonSelector = null,
  onExtra = null,
  onItemActivate = noop,
  onDirectoryPathChanged = noop,
  onDirectoryLoaded = noop,
  onDeleteConfirm = async () => true,
  onDeleteResult = noop,
  onUploadResult = noop,
  onViewerWillOpen = noop,
  onViewerWillClose = noop,
  onViewerDidClose = noop,
  onNavigateHaptic = noop,
  isNavigationBlocked = () => false,
  resolveUploadTargetPath = (path) => path,
  renderEmpty = renderDefaultEmpty,
  renderError = renderDefaultError,
}) {
  let currentPath = '';
  let viewableFiles = [];
  let currentFileIndex = -1;

  const viewerNavigation = createFileViewerNavigation({
    fileViewer: viewer,
    onNavigate: (direction) => navigateFile(direction),
    onHaptic: onNavigateHaptic,
    isNavigationBlocked,
  });

  function setCurrentPath(path) {
    currentPath = path || '';
    onDirectoryPathChanged(currentPath);
  }

  function getCurrentPath() {
    return currentPath;
  }

  function isViewerOpen() {
    return !!viewer && viewer.classList.contains('open');
  }

  function updateViewerNavigation() {
    viewerNavigation?.update(currentFileIndex, viewableFiles.length);
  }

  async function loadDirectory(path) {
    setCurrentPath(path);
    if (!treeContainer) return { ok: false, error: 'Missing tree container' };

    treeContainer.innerHTML = '<div class="file-tree-loading">Loading...</div>';

    const result = await fetchDirectoryData(context, currentPath, apiFetch);
    if (!result.ok) {
      viewableFiles = [];
      currentFileIndex = -1;
      renderError(treeContainer, result.error, escapeHtml);
      return result;
    }

    const data = result.data;
    const rawEntries = data.entries || [];
    const entries = transformEntries(rawEntries) || [];

    if (entries.length === 0) {
      viewableFiles = [];
      currentFileIndex = -1;
      renderEmpty(treeContainer);
      onDirectoryLoaded(data, entries, currentPath);
      return result;
    }

    viewableFiles = getViewableFiles(entries);
    currentFileIndex = -1;

    renderFileTreeView({
      container: treeContainer,
      entries,
      context,
      getFileIcon,
      formatFileSize,
      imageExts,
      escapeHtml,
      iconTag,
      includeExtAttr,
      getDeletePath,
      getExtraButtonHtml,
      extraButtonSelector,
      onItemActivate,
      onDirectoryOpen: (nextPath) => loadDirectory(nextPath),
      onFileOpen: (filePath) => viewFile(filePath),
      onDelete: async (deletePath, entry) => {
        const confirmed = await onDeleteConfirm(entry, deletePath);
        if (!confirmed) return;

        const deleteResult = await deleteFilePath(deletePath, apiFetch);
        onDeleteResult(deleteResult, entry, deletePath);
        if (deleteResult.ok) {
          await loadDirectory(currentPath);
        }
      },
      onExtra,
    });

    onDirectoryLoaded(data, entries, currentPath);
    return result;
  }

  async function refreshDirectory() {
    return loadDirectory(currentPath);
  }

  async function uploadFiles(files) {
    if (!files || !files.length) return { uploaded: [], failed: [] };
    const targetPath = resolveUploadTargetPath(currentPath);
    const result = await uploadFilesToContext(files, context, apiFetch, targetPath);
    onUploadResult(result, targetPath);
    await refreshDirectory();
    return result;
  }

  async function viewFile(filePath) {
    if (!context.isAvailable()) return false;
    if (!viewer || !viewerContent || !viewerName) return false;

    const geoCleanup = viewerContent?._geoPreviewCleanup;
    if (typeof geoCleanup === 'function') {
      geoCleanup();
      delete viewerContent._geoPreviewCleanup;
    }

    onViewerWillOpen(filePath);

    currentFileIndex = viewableFiles.indexOf(filePath);
    const filename = filePath.split('/').pop();
    viewerName.textContent = filename;
    viewerContent.innerHTML = '<code>Loading...</code>';

    viewer.classList.remove('hidden');
    setTimeout(() => viewer.classList.add('open'), animationDelayMs);
    updateViewerNavigation();

    const res = await apiFetch(context.getFileContentUrl(filePath), { silent: true });
    if (!res) {
      renderViewerError(viewerContent, 'Failed to load file', escapeHtml, icons.error || '');
      return false;
    }

    const data = await res.json();
    if (data.error) {
      renderViewerError(viewerContent, data.error, escapeHtml, icons.error || '');
      return false;
    }

    renderFileViewerContent({
      container: viewerContent,
      data,
      filePath,
      context,
      icons,
      escapeHtml,
      renderMarkdown,
      formatFileSize,
      imageExts,
      enableCopyCells: true,
    });

    return true;
  }

  function navigateFile(direction) {
    const newIndex = currentFileIndex + direction;
    if (newIndex < 0 || newIndex >= viewableFiles.length) return;
    void viewFile(viewableFiles[newIndex]);
  }

  function closeViewer() {
    if (!viewer || !viewerContent) return;

    const geoCleanup = viewerContent?._geoPreviewCleanup;
    if (typeof geoCleanup === 'function') {
      geoCleanup();
      delete viewerContent._geoPreviewCleanup;
    }

    onViewerWillClose();
    viewer.classList.remove('open');
    currentFileIndex = -1;

    setTimeout(() => {
      viewer.classList.add('hidden');
      viewerContent.innerHTML = '<code></code>';
      onViewerDidClose();
    }, closeDelayMs);
  }

  return {
    setCurrentPath,
    getCurrentPath,
    loadDirectory,
    refreshDirectory,
    uploadFiles,
    viewFile,
    closeViewer,
    isViewerOpen,
    handleViewerKeydown: (e) => viewerNavigation?.handleKeydown(e),
    handleViewerTouchStart: (e) => viewerNavigation?.handleTouchStart(e),
    handleViewerTouchMove: (e) => viewerNavigation?.handleTouchMove(e),
    handleViewerTouchEnd: (e) => viewerNavigation?.handleTouchEnd(e),
  };
}
