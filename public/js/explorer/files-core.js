import { buildDeleteFileUrl } from './context.js';

export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export function getViewableFiles(entries) {
  return entries.filter((entry) => entry.type !== 'directory').map((entry) => entry.path);
}

export function getInlineDownloadUrl(context, filePath) {
  return context.getFileDownloadUrl(filePath, { inline: true });
}

export async function fetchDirectoryData(context, targetPath, apiFetch, options = {}) {
  const url = context.getFilesUrl(targetPath);
  if (!url) {
    return { ok: false, error: 'Context unavailable', data: null };
  }

  const res = await apiFetch(url, { silent: options.silent !== false });
  if (!res) {
    return { ok: false, error: 'Request failed', data: null };
  }

  const data = await res.json();
  if (data.error) {
    return { ok: false, error: data.error, data };
  }

  return { ok: true, data };
}

export async function deleteFilePath(filePath, apiFetch) {
  const res = await apiFetch(buildDeleteFileUrl(filePath), {
    method: 'DELETE'
  });

  if (!res) {
    return { ok: false, error: 'Request failed', data: null };
  }

  const data = await res.json();
  if (data.error) {
    return { ok: false, error: data.error, data };
  }

  return { ok: true, data };
}

export async function uploadFilesToContext(files, context, apiFetch, targetPath = '') {
  const uploaded = [];
  const failed = [];

  for (const file of files) {
    const url = context.getUploadUrl(file.name, targetPath);
    if (!url) {
      failed.push(file.name);
      continue;
    }

    const res = await apiFetch(url, { method: 'POST', body: file });
    if (res) {
      uploaded.push(file.name);
    } else {
      failed.push(file.name);
    }
  }

  return { uploaded, failed };
}
