const fs = require('fs');
const path = require('path');

const { conversations } = require('../data');
const bigquery = require('../bigquery');
const { sendError, withErrorHandling, isPathWithinCwd } = require('./helpers');

const activeJobsByConversation = new Map();

function resolveConversation(conversationId) {
  if (!conversationId) return null;
  return conversations.get(conversationId) || null;
}

function rememberActiveJob(conversationId, job, projectId) {
  if (!conversationId || !job?.jobId) return;
  activeJobsByConversation.set(conversationId, {
    jobId: job.jobId,
    projectId: projectId || job.projectId || null,
    location: job.location || null,
    startedAt: Date.now(),
  });
}

function clearActiveJob(conversationId, jobId = null) {
  if (!conversationId) return;
  if (!activeJobsByConversation.has(conversationId)) return;
  if (!jobId) {
    activeJobsByConversation.delete(conversationId);
    return;
  }
  const current = activeJobsByConversation.get(conversationId);
  if (current?.jobId === jobId) {
    activeJobsByConversation.delete(conversationId);
  }
}

function getActiveJob(conversationId) {
  return activeJobsByConversation.get(conversationId) || null;
}

function normalizeJobParams(conversationId, input) {
  const active = conversationId ? getActiveJob(conversationId) : null;
  return {
    jobId: input.jobId || active?.jobId || null,
    projectId: input.projectId || active?.projectId || null,
    location: input.location || active?.location || null,
  };
}

function normalizeExportFormat(format) {
  const fmt = String(format || '').trim().toLowerCase();
  return ['csv', 'json', 'parquet', 'geojson'].includes(fmt) ? fmt : null;
}

function rowToObject(columns, row) {
  const out = {};
  for (let i = 0; i < columns.length; i++) {
    out[columns[i].name] = row[i];
  }
  return out;
}

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function writeChunk(writable, chunk) {
  if (writable.write(chunk)) return;
  await new Promise((resolve, reject) => {
    writable.once('drain', resolve);
    writable.once('error', reject);
  });
}

async function finishWritable(writable) {
  await new Promise((resolve, reject) => {
    writable.once('finish', resolve);
    writable.once('error', reject);
    writable.end();
  });
}

async function streamBigQueryRowsAsDelimited({
  writable,
  format,
  projectId,
  jobId,
  location,
  onReady = null,
}) {
  const iterator = bigquery.iterateQueryRows({ projectId, jobId, location, maxResults: 10000 });
  const firstPage = await iterator.next();

  if (firstPage.done) {
    if (format === 'csv') {
      if (onReady) onReady({ columns: [], rowCount: 0 });
      await writeChunk(writable, '\n');
    } else {
      if (onReady) onReady({ columns: [], rowCount: 0 });
      await writeChunk(writable, '[]');
    }
    return { rowCount: 0 };
  }

  const page0 = firstPage.value;
  const columns = page0.schemaFields.map((field) => ({
    name: field.name,
    type: bigquery.formatFieldType(field),
  }));
  const rowCount = Number(page0.rowCount || 0);

  if (onReady) onReady({ columns, rowCount });

  if (format === 'csv') {
    const header = columns.map((col) => escapeCsv(col.name)).join(',');
    await writeChunk(writable, `${header}\n`);

    const writeCsvRows = async (rows) => {
      if (!rows || rows.length === 0) return;
      const lines = rows.map((row) => row.map((cell) => escapeCsv(cell)).join(',')).join('\n');
      await writeChunk(writable, `${lines}\n`);
    };

    await writeCsvRows(page0.rows);
    for await (const page of iterator) {
      await writeCsvRows(page.rows);
    }
  } else {
    let hasWritten = false;
    await writeChunk(writable, '[');

    const writeJsonRows = async (rows) => {
      for (const row of rows || []) {
        const json = JSON.stringify(rowToObject(columns, row));
        if (hasWritten) {
          await writeChunk(writable, ',');
        }
        await writeChunk(writable, json);
        hasWritten = true;
      }
    };

    await writeJsonRows(page0.rows);
    for await (const page of iterator) {
      await writeJsonRows(page.rows);
    }
    await writeChunk(writable, ']');
  }

  return { rowCount: rowCount || null, columns };
}

/**
 * Setup BigQuery API routes
 * @param {Express.Application} app - Express app instance
 */
function setupBigQueryRoutes(app) {
  app.get('/api/bigquery/auth/status', withErrorHandling(async (req, res) => {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const status = await bigquery.getAuthStatus(forceRefresh);
    res.json(status);
  }));

  app.post('/api/bigquery/auth/refresh', withErrorHandling(async (_req, res) => {
    bigquery.clearAdcCaches();
    const status = await bigquery.getAuthStatus(true);
    res.json(status);
  }));

  app.get('/api/bigquery/projects', withErrorHandling(async (_req, res) => {
    const projects = await bigquery.listProjects();
    res.json({ projects });
  }));

  app.post('/api/bigquery/query/start', withErrorHandling(async (req, res) => {
    const { conversationId, projectId, sql, maxResults = 1000 } = req.body || {};

    if (!conversationId) {
      return sendError(res, 400, 'conversationId is required');
    }

    const conv = resolveConversation(conversationId);
    if (!conv) {
      return sendError(res, 404, 'Conversation not found');
    }

    if (!projectId) {
      return sendError(res, 400, 'projectId is required');
    }

    if (!sql || typeof sql !== 'string') {
      return sendError(res, 400, 'sql is required');
    }

    const result = await bigquery.startQuery({ projectId, sql, maxResults });

    if (result.jobComplete) {
      clearActiveJob(conversationId, result.job?.jobId);
    } else {
      rememberActiveJob(conversationId, result.job, projectId);
    }

    const { raw: _raw, ...payload } = result;
    res.json({ source: 'bigquery', ...payload });
  }));

  app.get('/api/bigquery/query/status', withErrorHandling(async (req, res) => {
    const conversationId = req.query.conversationId || null;
    const params = normalizeJobParams(conversationId, {
      jobId: req.query.jobId,
      projectId: req.query.projectId,
      location: req.query.location,
    });

    if (!params.projectId) {
      return sendError(res, 400, 'projectId is required');
    }
    if (!params.jobId) {
      return sendError(res, 400, 'jobId is required');
    }

    const result = await bigquery.getQueryStatus({
      projectId: params.projectId,
      jobId: params.jobId,
      location: params.location,
      maxResults: req.query.maxResults,
      pageToken: req.query.pageToken || null,
    });

    if (result.jobComplete) {
      clearActiveJob(conversationId, params.jobId);
    } else if (conversationId) {
      rememberActiveJob(conversationId, result.job, params.projectId);
    }

    const { raw: _raw, ...payload } = result;
    res.json({ source: 'bigquery', ...payload });
  }));

  app.post('/api/bigquery/query/cancel', withErrorHandling(async (req, res) => {
    const conversationId = req.body?.conversationId || null;
    const params = normalizeJobParams(conversationId, {
      jobId: req.body?.jobId,
      projectId: req.body?.projectId,
      location: req.body?.location,
    });

    if (!params.projectId) {
      return sendError(res, 400, 'projectId is required');
    }
    if (!params.jobId) {
      return sendError(res, 400, 'jobId is required');
    }

    const result = await bigquery.cancelQuery(params);
    clearActiveJob(conversationId, params.jobId);

    res.json({
      success: true,
      ...result,
    });
  }));

  app.post('/api/bigquery/query/save', withErrorHandling(async (req, res) => {
    const {
      conversationId,
      filename = 'bigquery-results',
      format = 'json',
    } = req.body || {};

    if (!conversationId) {
      return sendError(res, 400, 'conversationId is required');
    }

    const conv = resolveConversation(conversationId);
    if (!conv) {
      return sendError(res, 404, 'Conversation not found');
    }

    const params = normalizeJobParams(conversationId, {
      jobId: req.body?.jobId,
      projectId: req.body?.projectId,
      location: req.body?.location,
    });

    if (!params.projectId) {
      return sendError(res, 400, 'projectId is required');
    }
    if (!params.jobId) {
      return sendError(res, 400, 'jobId is required');
    }

    const safeFormat = normalizeExportFormat(format);
    if (!safeFormat) {
      return sendError(res, 400, 'format must be one of: csv, json, parquet, geojson');
    }

    const cwd = conv.cwd || process.env.HOME;
    let saved;
    if (safeFormat === 'csv' || safeFormat === 'json') {
      const targetPath = await bigquery.allocateSavePath({
        cwd,
        filename,
        format: safeFormat,
      });
      const fileStream = fs.createWriteStream(targetPath, { encoding: 'utf8' });
      const streamed = await streamBigQueryRowsAsDelimited({
        writable: fileStream,
        format: safeFormat,
        projectId: params.projectId,
        jobId: params.jobId,
        location: params.location,
      });
      await finishWritable(fileStream);
      saved = {
        path: targetPath,
        rowCount: streamed.rowCount || 0,
        format: safeFormat,
      };
    } else {
      const allRows = await bigquery.fetchAllQueryRows({
        projectId: params.projectId,
        jobId: params.jobId,
        location: params.location,
      });

      const columns = allRows.schemaFields.map((field) => ({
        name: field.name,
        type: bigquery.formatFieldType(field),
      }));

      saved = await bigquery.saveResultsToFile({
        cwd,
        filename,
        format: safeFormat,
        columns,
        rows: allRows.rows,
      });
    }

    const resolvedPath = path.resolve(saved.path);
    if (!isPathWithinCwd(cwd, resolvedPath)) {
      return sendError(res, 500, 'Saved file path escaped conversation cwd');
    }

    res.json({
      success: true,
      path: resolvedPath,
      relativePath: path.relative(cwd, resolvedPath),
      rowCount: saved.rowCount,
      format: saved.format,
    });
  }));

  app.post('/api/bigquery/query/download', withErrorHandling(async (req, res) => {
    const {
      conversationId,
      filename = 'bigquery-results',
      format = 'json',
    } = req.body || {};

    if (!conversationId) {
      return sendError(res, 400, 'conversationId is required');
    }

    const conv = resolveConversation(conversationId);
    if (!conv) {
      return sendError(res, 404, 'Conversation not found');
    }

    const params = normalizeJobParams(conversationId, {
      jobId: req.body?.jobId,
      projectId: req.body?.projectId,
      location: req.body?.location,
    });

    if (!params.projectId) {
      return sendError(res, 400, 'projectId is required');
    }
    if (!params.jobId) {
      return sendError(res, 400, 'jobId is required');
    }

    const safeFormat = normalizeExportFormat(format);
    if (!safeFormat) {
      return sendError(res, 400, 'format must be one of: csv, json, parquet, geojson');
    }

    const safeFilename = String(filename || 'bigquery-results').trim().replace(/[^a-zA-Z0-9._-]/g, '_') || 'bigquery-results';
    if (safeFormat === 'csv' || safeFormat === 'json') {
      const extension = safeFormat === 'csv' ? 'csv' : 'json';
      const mimeType = safeFormat === 'csv' ? 'text/csv' : 'application/json';
      const downloadName = safeFilename.endsWith(`.${extension}`) ? safeFilename : `${safeFilename}.${extension}`;

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      res.setHeader('Cache-Control', 'no-store');

      let rowCount = 0;
      await streamBigQueryRowsAsDelimited({
        writable: res,
        format: safeFormat,
        projectId: params.projectId,
        jobId: params.jobId,
        location: params.location,
        onReady: ({ rowCount: readyCount }) => {
          rowCount = Number(readyCount || 0);
          res.setHeader('X-Row-Count', String(rowCount));
        },
      });
      res.end();
      return;
    }

    const allRows = await bigquery.fetchAllQueryRows({
      projectId: params.projectId,
      jobId: params.jobId,
      location: params.location,
    });

    const columns = allRows.schemaFields.map((field) => ({
      name: field.name,
      type: bigquery.formatFieldType(field),
    }));

    const payload = await bigquery.serializeResults({
      format: safeFormat,
      columns,
      rows: allRows.rows,
    });

    const downloadName = safeFilename.endsWith(`.${payload.extension}`) ? safeFilename : `${safeFilename}.${payload.extension}`;

    res.setHeader('Content-Type', payload.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('X-Row-Count', String(Number(allRows.rowCount || allRows.rows.length || 0)));
    res.setHeader('Cache-Control', 'no-store');
    res.send(payload.content);
  }));
}

module.exports = {
  setupBigQueryRoutes,
};
