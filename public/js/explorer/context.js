// Shared explorer context adapters.
// These normalize URL and payload construction across conversation-scoped
// and cwd-scoped file/git operations.

function withQuery(basePath, params) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, value);
  }

  const qs = query.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function resolveValue(valueOrFn) {
  return typeof valueOrFn === 'function' ? valueOrFn() : valueOrFn;
}

export function buildDeleteFileUrl(filePath) {
  return withQuery('/api/files', { path: filePath });
}

export function createConversationContext(conversationIdOrGetter) {
  const getConversationId = () => resolveValue(conversationIdOrGetter);

  return {
    kind: 'conversation',
    supportsDataTab: true,

    getConversationId,
    isAvailable() {
      return !!getConversationId();
    },

    getFilesUrl(subpath = '') {
      const conversationId = getConversationId();
      if (!conversationId) return null;
      return withQuery(`/api/conversations/${conversationId}/files`, { path: subpath });
    },

    getFileContentUrl(filePath) {
      const conversationId = getConversationId();
      if (!conversationId) return null;
      return withQuery(`/api/conversations/${conversationId}/files/content`, { path: filePath });
    },

    getFileDownloadUrl(filePath, options = {}) {
      const conversationId = getConversationId();
      if (!conversationId) return null;
      return withQuery(`/api/conversations/${conversationId}/files/download`, {
        path: filePath,
        inline: options.inline ? 'true' : undefined,
      });
    },

    getFileSearchUrl(query) {
      const conversationId = getConversationId();
      if (!conversationId) return null;
      return withQuery(`/api/conversations/${conversationId}/files/search`, { q: query });
    },

    getUploadUrl(filename) {
      const conversationId = getConversationId();
      if (!conversationId) return null;
      return withQuery(`/api/conversations/${conversationId}/upload`, { filename });
    },

    getAttachExistingFilesUrl() {
      const conversationId = getConversationId();
      if (!conversationId) return null;
      return `/api/conversations/${conversationId}/attachments/from-files`;
    },

    getGitUrl(endpoint) {
      const conversationId = getConversationId();
      if (!conversationId) return null;
      return `/api/conversations/${conversationId}/git/${endpoint}`;
    },

    getDuckDbLoadBody(filePath, tableName) {
      const body = {
        path: filePath,
        conversationId: getConversationId(),
      };
      if (tableName) body.tableName = tableName;
      return body;
    },
  };
}

export function createCwdContext(cwdOrGetter) {
  const getCwd = () => resolveValue(cwdOrGetter);

  return {
    kind: 'cwd',
    supportsDataTab: false,

    getCwd,
    isAvailable() {
      return true;
    },

    getFilesUrl(targetPath = '') {
      return withQuery('/api/files', { path: targetPath });
    },

    getFileContentUrl(filePath) {
      return withQuery('/api/files/content', { path: filePath });
    },

    getFileDownloadUrl(filePath, options = {}) {
      return withQuery('/api/files/download', {
        path: filePath,
        inline: options.inline ? 'true' : undefined,
      });
    },

    getUploadUrl(filename, targetPath = '') {
      return withQuery('/api/files/upload', {
        path: targetPath,
        filename,
      });
    },

    getGitUrl(endpoint) {
      return withQuery(`/api/git/${endpoint}`, { cwd: getCwd() });
    },

    getDuckDbLoadBody(filePath, tableName) {
      const body = { path: filePath };
      if (tableName) body.tableName = tableName;
      return body;
    },
  };
}
