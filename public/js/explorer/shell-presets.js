import { FILE_ICONS } from '../file-utils.js';

const EMPTY_FOLDER_ICON = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
const ERROR_ICON = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

function noop() {}

export function createExplorerIcons(extra = {}) {
  return {
    ...FILE_ICONS,
    emptyFolder: EMPTY_FOLDER_ICON,
    error: ERROR_ICON,
    ...extra,
  };
}

export function renderStandardEmpty(container, icons, message = 'Empty folder') {
  if (!container) return;
  container.innerHTML = `
    <div class="file-tree-empty">
      ${icons.emptyFolder || ''}
      <p>${message}</p>
    </div>`;
}

export function renderStandardError(
  container,
  message,
  escapeHtml,
  icons,
  fallbackMessage = 'Failed to load files'
) {
  if (!container) return;
  container.innerHTML = `
    <div class="file-tree-empty">
      ${icons.error || ''}
      <p>${escapeHtml(message || fallbackMessage)}</p>
    </div>`;
}

export function createExplorerFeedbackHandlers({
  haptic = noop,
  showDialog = async () => true,
  showToast = noop,
  deleteTitle = 'Delete file?',
  deleteConfirmLabel = 'Delete',
  deleteMessageForName = (filename) => `Delete "${filename}"? This cannot be undone.`,
  uploadedPrefix = 'Uploaded',
  deletedMessage = 'Deleted',
  deleteFailedMessage = 'Delete failed',
}) {
  return {
    onDeleteConfirm: async (entry) => {
      const filename = entry.path.split('/').pop();
      haptic();
      return showDialog({
        title: deleteTitle,
        message: deleteMessageForName(filename),
        danger: true,
        confirmLabel: deleteConfirmLabel,
      });
    },
    onDeleteResult: (result) => {
      if (!result.ok) {
        showToast(result.error || deleteFailedMessage, { variant: 'error' });
        return;
      }
      showToast(deletedMessage);
    },
    onUploadResult: ({ uploaded }) => {
      (uploaded || []).forEach((name) => showToast(`${uploadedPrefix} ${name}`));
    },
  };
}
