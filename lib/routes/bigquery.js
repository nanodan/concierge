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

    const cwd = conv.cwd || process.env.HOME;
    const allRows = await bigquery.fetchAllQueryRows({
      projectId: params.projectId,
      jobId: params.jobId,
      location: params.location,
    });

    const columns = allRows.schemaFields.map((field) => ({
      name: field.name,
      type: bigquery.formatFieldType(field),
    }));

    const saved = await bigquery.saveResultsToFile({
      cwd,
      filename,
      format,
      columns,
      rows: allRows.rows,
    });

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
}

module.exports = {
  setupBigQueryRoutes,
};
