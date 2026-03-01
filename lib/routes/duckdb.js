/**
 * DuckDB Routes - REST API endpoints for data analysis
 */
const path = require('path');
const os = require('os');
const fsp = require('fs').promises;
const duckdb = require('../duckdb');
const { conversations } = require('../data');
const { sendError, withErrorHandling, isPathWithinCwd } = require('./helpers');

/**
 * Setup DuckDB API routes
 * @param {Express.Application} app - Express app instance
 */
function setupDuckDBRoutes(app) {
  // Load a file into DuckDB
  app.post('/api/duckdb/load', withErrorHandling(async (req, res) => {
    const { path: filePath, tableName, conversationId } = req.body;

    if (!filePath) {
      return sendError(res, 400, 'path is required');
    }

    // Resolve the file path
    let resolvedPath;
    if (conversationId) {
      const conv = conversations.get(conversationId);
      if (!conv) {
        return sendError(res, 404, 'Conversation not found');
      }
      const cwd = conv.cwd || process.env.HOME;
      resolvedPath = path.resolve(cwd, filePath);

      // Security: ensure path is within cwd
      if (!isPathWithinCwd(cwd, resolvedPath)) {
        return sendError(res, 403, 'Path outside conversation directory');
      }
    } else {
      resolvedPath = path.resolve(filePath);
    }

    // Check if file type is supported
    if (!duckdb.isSupportedFile(resolvedPath)) {
      return sendError(res, 400, `Unsupported file type. Supported: ${[...duckdb.SUPPORTED_EXTENSIONS].join(', ')}`);
    }

    const result = await duckdb.loadFile(resolvedPath, tableName);

    res.json({
      success: true,
      tableName: result.tableName,
      rowCount: result.rowCount,
      columns: result.columns
    });
  }));

  // Run a SQL query
  app.post('/api/duckdb/query', withErrorHandling(async (req, res) => {
    const { sql, limit = 1000, offset = 0 } = req.body;

    if (!sql) {
      return sendError(res, 400, 'sql is required');
    }

    // Basic SQL safety check - disallow dangerous operations
    const upperSql = sql.toUpperCase().trim();
    if (upperSql.startsWith('DROP') || upperSql.startsWith('DELETE') ||
        upperSql.startsWith('TRUNCATE') || upperSql.startsWith('ALTER')) {
      return sendError(res, 400, 'Only SELECT and DESCRIBE queries are allowed');
    }

    const result = await duckdb.query(sql, Math.min(limit, 10000), offset);

    res.json(result);
  }));

  // Profile a data file
  app.get('/api/duckdb/profile', withErrorHandling(async (req, res) => {
    const { path: filePath, conversationId } = req.query;

    if (!filePath) {
      return sendError(res, 400, 'path is required');
    }

    // Resolve the file path
    let resolvedPath;
    if (conversationId) {
      const conv = conversations.get(conversationId);
      if (!conv) {
        return sendError(res, 404, 'Conversation not found');
      }
      const cwd = conv.cwd || process.env.HOME;
      resolvedPath = path.resolve(cwd, filePath);

      // Security: ensure path is within cwd
      if (!isPathWithinCwd(cwd, resolvedPath)) {
        return sendError(res, 403, 'Path outside conversation directory');
      }
    } else {
      resolvedPath = path.resolve(filePath);
    }

    // Check if file type is supported
    if (!duckdb.isSupportedFile(resolvedPath)) {
      return sendError(res, 400, `Unsupported file type. Supported: ${[...duckdb.SUPPORTED_EXTENSIONS].join(', ')}`);
    }

    const result = await duckdb.profile(resolvedPath);

    res.json(result);
  }));

  // List loaded tables
  app.get('/api/duckdb/tables', withErrorHandling(async (_req, res) => {
    const tables = duckdb.listTables();
    res.json({ tables });
  }));

  // Get table info
  app.get('/api/duckdb/tables/:name', withErrorHandling(async (req, res) => {
    const { name } = req.params;
    const info = await duckdb.getTableInfo(name);

    if (!info) {
      return sendError(res, 404, 'Table not found');
    }

    res.json(info);
  }));

  // Drop a table
  app.delete('/api/duckdb/tables/:name', withErrorHandling(async (req, res) => {
    const { name } = req.params;
    const dropped = await duckdb.dropTable(name);

    if (!dropped) {
      return sendError(res, 404, 'Table not found');
    }

    res.json({ success: true });
  }));

  // --- Query History Endpoints ---

  // Get query history for a conversation
  app.get('/api/duckdb/history/:conversationId', withErrorHandling(async (req, res) => {
    const { conversationId } = req.params;

    // Verify conversation exists
    const conv = conversations.get(conversationId);
    if (!conv) {
      return sendError(res, 404, 'Conversation not found');
    }

    const history = await duckdb.loadQueryHistory(conversationId);
    res.json({ history, maxHistory: duckdb.MAX_HISTORY });
  }));

  // Save query history for a conversation
  app.put('/api/duckdb/history/:conversationId', withErrorHandling(async (req, res) => {
    const { conversationId } = req.params;
    const { history } = req.body;

    // Verify conversation exists
    const conv = conversations.get(conversationId);
    if (!conv) {
      return sendError(res, 404, 'Conversation not found');
    }

    if (!Array.isArray(history)) {
      return sendError(res, 400, 'history must be an array');
    }

    await duckdb.saveQueryHistory(conversationId, history);
    res.json({ success: true });
  }));

  // Add a single query to history
  app.post('/api/duckdb/history/:conversationId', withErrorHandling(async (req, res) => {
    const { conversationId } = req.params;
    const { sql } = req.body;

    // Verify conversation exists
    const conv = conversations.get(conversationId);
    if (!conv) {
      return sendError(res, 404, 'Conversation not found');
    }

    if (!sql || typeof sql !== 'string') {
      return sendError(res, 400, 'sql is required');
    }

    await duckdb.addToQueryHistory(conversationId, sql);
    res.json({ success: true });
  }));

  // Clear query history for a conversation
  app.delete('/api/duckdb/history/:conversationId', withErrorHandling(async (req, res) => {
    const { conversationId } = req.params;

    // Verify conversation exists
    const conv = conversations.get(conversationId);
    if (!conv) {
      return sendError(res, 404, 'Conversation not found');
    }

    await duckdb.clearQueryHistory(conversationId);
    res.json({ success: true });
  }));

  // Copy query history (for forking)
  app.post('/api/duckdb/history/:conversationId/copy', withErrorHandling(async (req, res) => {
    const { conversationId } = req.params;
    const { fromConversationId } = req.body;

    // Verify both conversations exist
    const destConv = conversations.get(conversationId);
    if (!destConv) {
      return sendError(res, 404, 'Destination conversation not found');
    }

    const sourceConv = conversations.get(fromConversationId);
    if (!sourceConv) {
      return sendError(res, 404, 'Source conversation not found');
    }

    await duckdb.copyQueryHistory(fromConversationId, conversationId);
    res.json({ success: true });
  }));

  // --- Export Endpoint (download to browser) ---

  // Export query results as a file (Parquet, CSV, JSON)
  app.post('/api/duckdb/export', withErrorHandling(async (req, res) => {
    const { sql, format = 'parquet', filename } = req.body;

    if (!sql) {
      return sendError(res, 400, 'sql is required');
    }

    // Validate format
    const validFormats = ['parquet', 'csv', 'json'];
    const fmt = format.toLowerCase();
    if (!validFormats.includes(fmt)) {
      return sendError(res, 400, `Invalid format. Valid formats: ${validFormats.join(', ')}`);
    }

    // Basic SQL safety check
    const upperSql = sql.toUpperCase().trim();
    if (upperSql.startsWith('DROP') || upperSql.startsWith('DELETE') ||
        upperSql.startsWith('TRUNCATE') || upperSql.startsWith('ALTER')) {
      return sendError(res, 400, 'Only SELECT queries can be exported');
    }

    // Generate temp file path
    const timestamp = Date.now();
    const tempPath = path.join(os.tmpdir(), `duckdb-export-${timestamp}.${fmt}`);

    try {
      // Export query to file
      const result = await duckdb.exportQuery(sql, fmt, tempPath);

      // Set response headers
      const safeFilename = (filename || `query-results`).replace(/[^a-zA-Z0-9_-]/g, '_');
      const downloadName = `${safeFilename}.${fmt}`;

      const mimeTypes = {
        parquet: 'application/octet-stream',
        csv: 'text/csv',
        json: 'application/json'
      };

      res.setHeader('Content-Type', mimeTypes[fmt]);
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      res.setHeader('X-Row-Count', result.rowCount);

      // Stream file to response
      const fileContent = await fsp.readFile(tempPath);
      res.send(fileContent);

      // Cleanup temp file
      await fsp.unlink(tempPath).catch(() => {});
    } catch (err) {
      // Cleanup on error
      await fsp.unlink(tempPath).catch(() => {});
      throw err;
    }
  }));

  // --- Save Endpoint (save to conversation cwd) ---

  // Save query results to conversation's working directory
  app.post('/api/duckdb/save', withErrorHandling(async (req, res) => {
    const { sql, format = 'parquet', filename = 'query-results', conversationId } = req.body;

    if (!sql) {
      return sendError(res, 400, 'sql is required');
    }

    if (!conversationId) {
      return sendError(res, 400, 'conversationId is required');
    }

    const conv = conversations.get(conversationId);
    if (!conv) {
      return sendError(res, 404, 'Conversation not found');
    }

    // Validate format
    const validFormats = ['parquet', 'csv', 'json'];
    const fmt = format.toLowerCase();
    if (!validFormats.includes(fmt)) {
      return sendError(res, 400, `Invalid format. Valid formats: ${validFormats.join(', ')}`);
    }

    // Basic SQL safety check
    const upperSql = sql.toUpperCase().trim();
    if (upperSql.startsWith('DROP') || upperSql.startsWith('DELETE') ||
        upperSql.startsWith('TRUNCATE') || upperSql.startsWith('ALTER')) {
      return sendError(res, 400, 'Only SELECT queries can be exported');
    }

    const cwd = conv.cwd || process.env.HOME;

    // Parse filename - may include relative path (e.g., "output/results")
    // Sanitize each path segment
    const rawPath = (filename || 'query-results').trim();
    const segments = rawPath.split('/').filter(Boolean);
    const sanitizedSegments = segments.map(seg => seg.replace(/[^a-zA-Z0-9_.-]/g, '_'));
    const relativePath = sanitizedSegments.join('/');

    let targetPath = path.join(cwd, `${relativePath}.${fmt}`);

    // Security: ensure path is within cwd
    if (!isPathWithinCwd(cwd, targetPath)) {
      return sendError(res, 403, 'Path outside conversation directory');
    }

    // Create parent directories if needed
    const parentDir = path.dirname(targetPath);
    await fsp.mkdir(parentDir, { recursive: true });

    // If file exists, append timestamp
    try {
      await fsp.access(targetPath);
      const timestamp = Date.now();
      const baseName = sanitizedSegments.pop();
      const dirPart = sanitizedSegments.join('/');
      const newRelative = dirPart ? `${dirPart}/${baseName}-${timestamp}` : `${baseName}-${timestamp}`;
      targetPath = path.join(cwd, `${newRelative}.${fmt}`);
    } catch {
      // File doesn't exist, use original path
    }

    // Export query to target file
    const result = await duckdb.exportQuery(sql, fmt, targetPath);

    res.json({
      success: true,
      path: targetPath,
      relativePath: path.relative(cwd, targetPath),
      rowCount: result.rowCount,
      format: fmt,
    });
  }));
}

module.exports = { setupDuckDBRoutes };
