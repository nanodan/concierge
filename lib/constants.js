/**
 * Backend constants
 * All values support environment variable overrides
 */

// File upload limits
const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE, 10) || 50 * 1024 * 1024; // 50MB default

// Process management
const PROCESS_TIMEOUT_MS = parseInt(process.env.PROCESS_TIMEOUT_MS, 10) || 5 * 60 * 1000; // 5 minutes

// Tool results
const TOOL_RESULT_MAX_LENGTH = parseInt(process.env.TOOL_RESULT_MAX_LENGTH, 10) || 10000;

// File serving
const MAX_FILE_PREVIEW_SIZE = parseInt(process.env.MAX_FILE_PREVIEW_SIZE, 10) || 100 * 1024; // 100KB

// Stats caching
const STATS_CACHE_TTL_MS = parseInt(process.env.STATS_CACHE_TTL_MS, 10) || 30000; // 30 seconds

// Git operations
const GIT_MAX_BUFFER = parseInt(process.env.GIT_MAX_BUFFER, 10) || 10 * 1024 * 1024; // 10MB

module.exports = {
  MAX_UPLOAD_SIZE,
  PROCESS_TIMEOUT_MS,
  TOOL_RESULT_MAX_LENGTH,
  MAX_FILE_PREVIEW_SIZE,
  STATS_CACHE_TTL_MS,
  GIT_MAX_BUFFER,
};
