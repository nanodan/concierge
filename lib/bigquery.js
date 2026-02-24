const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BIGQUERY_API_BASE = 'https://bigquery.googleapis.com/bigquery/v2';
const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const METADATA_PROJECT_URL = 'http://metadata.google.internal/computeMetadata/v1/project/project-id';
const BIGQUERY_SCOPES = ['https://www.googleapis.com/auth/bigquery'];
const ACCESS_TOKEN_SKEW_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;

let tokenCache = null;
let projectCache = null;

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getWellKnownAdcPath() {
  if (process.platform === 'win32') {
    if (!process.env.APPDATA) return null;
    return path.join(process.env.APPDATA, 'gcloud', 'application_default_credentials.json');
  }
  return path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
}

function clearTokenCache() {
  tokenCache = null;
}

function clearProjectCache() {
  projectCache = null;
}

function clearAdcCaches() {
  clearTokenCache();
  clearProjectCache();
}

async function fileExists(filePath) {
  if (!filePath) return false;
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function loadAdcCredentials() {
  const explicitPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || null;
  if (explicitPath && await fileExists(explicitPath)) {
    const json = await readJson(explicitPath);
    return {
      source: 'google_application_credentials',
      filePath: explicitPath,
      json,
    };
  }

  const wellKnownPath = getWellKnownAdcPath();
  if (wellKnownPath && await fileExists(wellKnownPath)) {
    const json = await readJson(wellKnownPath);
    return {
      source: 'application_default_credentials',
      filePath: wellKnownPath,
      json,
    };
  }

  return null;
}

function buildServiceAccountAssertion(serviceAccountJson) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  const claimSet = {
    iss: serviceAccountJson.client_email,
    scope: BIGQUERY_SCOPES.join(' '),
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaims = base64UrlEncode(JSON.stringify(claimSet));
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), serviceAccountJson.private_key);
  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

async function requestToken(params, errorPrefix) {
  const body = new URLSearchParams(params);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error_description || json.error || res.statusText;
    throw new Error(`${errorPrefix}: ${msg}`);
  }

  return json;
}

async function getTokenFromAuthorizedUser(adcJson) {
  if (!adcJson.client_id || !adcJson.client_secret || !adcJson.refresh_token) {
    throw new Error('ADC authorized_user file is missing required fields');
  }

  const token = await requestToken({
    client_id: adcJson.client_id,
    client_secret: adcJson.client_secret,
    refresh_token: adcJson.refresh_token,
    grant_type: 'refresh_token',
  }, 'ADC token refresh failed');

  return {
    accessToken: token.access_token,
    expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
    source: 'adc_authorized_user',
    quotaProjectId: adcJson.quota_project_id || null,
    principal: adcJson.client_id || null,
  };
}

async function getTokenFromServiceAccount(adcJson) {
  if (!adcJson.client_email || !adcJson.private_key) {
    throw new Error('Service account JSON is missing client_email/private_key');
  }

  const assertion = buildServiceAccountAssertion(adcJson);
  const token = await requestToken({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }, 'Service account token exchange failed');

  return {
    accessToken: token.access_token,
    expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
    source: 'adc_service_account',
    quotaProjectId: adcJson.project_id || null,
    principal: adcJson.client_email || null,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function getTokenFromMetadataServer() {
  const res = await fetchWithTimeout(METADATA_TOKEN_URL, {
    headers: { 'Metadata-Flavor': 'Google' },
  });

  if (!res.ok) {
    throw new Error(`Metadata token request failed (${res.status})`);
  }

  const json = await res.json();
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000,
    source: 'metadata_server',
    quotaProjectId: null,
    principal: 'metadata-default-service-account',
  };
}

async function getTokenFromGcloudCli() {
  const { stdout } = await execFileAsync('gcloud', ['auth', 'application-default', 'print-access-token']);
  const accessToken = String(stdout || '').trim();
  if (!accessToken) {
    throw new Error('gcloud returned empty access token');
  }

  return {
    accessToken,
    expiresAt: Date.now() + 45 * 60 * 1000,
    source: 'gcloud_cli',
    quotaProjectId: null,
    principal: 'gcloud-application-default',
  };
}

async function resolveAdcToken(forceRefresh = false) {
  if (!forceRefresh && tokenCache && tokenCache.accessToken && tokenCache.expiresAt > Date.now() + ACCESS_TOKEN_SKEW_MS) {
    return tokenCache;
  }

  const errors = [];

  try {
    const adc = await loadAdcCredentials();
    if (adc?.json) {
      if (adc.json.type === 'authorized_user') {
        const token = await getTokenFromAuthorizedUser(adc.json);
        token.credentialSource = adc.source;
        token.filePath = adc.filePath;
        token.defaultProjectId = adc.json.quota_project_id || null;
        tokenCache = token;
        return token;
      }

      if (adc.json.type === 'service_account') {
        const token = await getTokenFromServiceAccount(adc.json);
        token.credentialSource = adc.source;
        token.filePath = adc.filePath;
        token.defaultProjectId = adc.json.project_id || null;
        tokenCache = token;
        return token;
      }

      errors.push(`Unsupported ADC credential type: ${adc.json.type}`);
    }
  } catch (err) {
    errors.push(err.message);
  }

  try {
    const token = await getTokenFromMetadataServer();
    tokenCache = token;
    return token;
  } catch (err) {
    errors.push(err.message);
  }

  try {
    const token = await getTokenFromGcloudCli();
    tokenCache = token;
    return token;
  } catch (err) {
    errors.push(err.message);
  }

  throw new Error(
    `BigQuery ADC unavailable. Run: gcloud auth application-default login && gcloud config set project <project-id>. Details: ${errors.join(' | ')}`
  );
}

async function getGcloudDefaultProject() {
  if (projectCache && projectCache.value) {
    return projectCache.value;
  }

  try {
    const { stdout } = await execFileAsync('gcloud', ['config', 'get-value', 'project']);
    const value = String(stdout || '').trim();
    if (value && value !== '(unset)') {
      projectCache = { value, source: 'gcloud_config' };
      return value;
    }
  } catch {
    // ignore
  }

  return null;
}

async function getMetadataProjectId() {
  try {
    const res = await fetchWithTimeout(METADATA_PROJECT_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}

async function getDefaultProjectId(tokenInfo = null) {
  if (tokenInfo?.defaultProjectId) return tokenInfo.defaultProjectId;
  if (tokenInfo?.quotaProjectId) return tokenInfo.quotaProjectId;

  const gcloudProject = await getGcloudDefaultProject();
  if (gcloudProject) return gcloudProject;

  return getMetadataProjectId();
}

async function getAuthStatus(forceRefresh = false) {
  try {
    const tokenInfo = await resolveAdcToken(forceRefresh);
    const defaultProjectId = await getDefaultProjectId(tokenInfo);

    return {
      configured: true,
      connected: true,
      authMode: 'adc',
      source: tokenInfo.source,
      credentialSource: tokenInfo.credentialSource || null,
      principal: tokenInfo.principal || null,
      defaultProjectId: defaultProjectId || null,
      quotaProjectId: tokenInfo.quotaProjectId || null,
      expiresAt: tokenInfo.expiresAt || null,
      message: defaultProjectId
        ? `ADC ready (project: ${defaultProjectId})`
        : 'ADC ready (set a default project with gcloud config set project <project-id>)',
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      authMode: 'adc',
      source: null,
      credentialSource: null,
      principal: null,
      defaultProjectId: null,
      quotaProjectId: null,
      expiresAt: null,
      message: err.message,
    };
  }
}

async function requestBigQuery(url, options = {}, { forceRefreshToken = false } = {}) {
  let tokenInfo = await resolveAdcToken(forceRefreshToken);

  const doRequest = async (token) => fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(tokenInfo.quotaProjectId ? { 'X-Goog-User-Project': tokenInfo.quotaProjectId } : {}),
      ...(options.headers || {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let res = await doRequest(tokenInfo.accessToken);
  if (res.status === 401) {
    clearTokenCache();
    tokenInfo = await resolveAdcToken(true);
    res = await doRequest(tokenInfo.accessToken);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.error || res.statusText;
    throw new Error(msg || 'BigQuery request failed');
  }

  return json;
}

function formatFieldType(field) {
  const base = field.type === 'RECORD' && Array.isArray(field.fields)
    ? `RECORD<${field.fields.map((f) => `${f.name}:${formatFieldType(f)}`).join(',')}>`
    : field.type;

  if (field.mode === 'REPEATED') {
    return `ARRAY<${base}>`;
  }
  return base;
}

function parseFieldValue(field, rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  if (field.mode === 'REPEATED') {
    const values = Array.isArray(rawValue) ? rawValue : [];
    const itemField = { ...field, mode: 'NULLABLE' };
    return values.map((item) => {
      const value = item && typeof item === 'object' && 'v' in item ? item.v : item;
      return parseFieldValue(itemField, value);
    });
  }

  if (field.type === 'RECORD' || field.type === 'STRUCT') {
    const fields = Array.isArray(field.fields) ? field.fields : [];
    const f = Array.isArray(rawValue?.f) ? rawValue.f : [];
    const out = {};
    for (let i = 0; i < fields.length; i++) {
      out[fields[i].name] = parseFieldValue(fields[i], f[i]?.v);
    }
    return out;
  }

  switch (field.type) {
    case 'BOOL':
    case 'BOOLEAN':
      return rawValue === true || rawValue === 'true';
    case 'INT64':
    case 'INTEGER': {
      const asNum = Number(rawValue);
      if (Number.isSafeInteger(asNum)) return asNum;
      return String(rawValue);
    }
    case 'FLOAT':
    case 'FLOAT64':
    case 'NUMERIC':
    case 'BIGNUMERIC': {
      const asNum = Number(rawValue);
      return Number.isFinite(asNum) ? asNum : String(rawValue);
    }
    default:
      return rawValue;
  }
}

function parseRows(schemaFields, rows) {
  if (!Array.isArray(schemaFields) || !Array.isArray(rows)) return [];
  return rows.map((row) => {
    const fields = Array.isArray(row?.f) ? row.f : [];
    return schemaFields.map((field, idx) => parseFieldValue(field, fields[idx]?.v));
  });
}

function normalizeQueryResponse(raw) {
  const schemaFields = raw?.schema?.fields || [];
  const columns = schemaFields.map((field) => ({
    name: field.name,
    type: formatFieldType(field),
  }));
  const rows = parseRows(schemaFields, raw?.rows || []);
  const rowCount = Number(raw?.totalRows || rows.length || 0);

  return {
    jobComplete: Boolean(raw?.jobComplete),
    job: raw?.jobReference
      ? {
          jobId: raw.jobReference.jobId,
          projectId: raw.jobReference.projectId,
          location: raw.jobReference.location || null,
        }
      : null,
    columns,
    rows,
    rowCount,
    truncated: Boolean(raw?.pageToken),
    pageToken: raw?.pageToken || null,
    totalBytesProcessed: raw?.totalBytesProcessed || null,
    cacheHit: raw?.cacheHit === true,
  };
}

async function listProjects() {
  const projects = [];
  let pageToken = null;
  let guard = 0;

  do {
    const params = new URLSearchParams();
    if (pageToken) params.set('pageToken', pageToken);
    const url = `${BIGQUERY_API_BASE}/projects${params.toString() ? `?${params.toString()}` : ''}`;
    const data = await requestBigQuery(url);

    for (const item of data.projects || []) {
      projects.push({
        id: item.id,
        friendlyName: item.friendlyName || item.projectReference?.projectId || item.id,
        numericId: item.numericId || null,
      });
    }

    pageToken = data.nextPageToken || null;
    guard++;
  } while (pageToken && guard < 100);

  return projects;
}

async function startQuery({ projectId, sql, maxResults = 1000 }) {
  const data = await requestBigQuery(`${BIGQUERY_API_BASE}/projects/${encodeURIComponent(projectId)}/queries`, {
    method: 'POST',
    body: {
      query: sql,
      useLegacySql: false,
      maxResults: Math.max(1, Math.min(Number(maxResults) || 1000, 5000)),
      timeoutMs: 1000,
    },
  });

  return { raw: data, ...normalizeQueryResponse(data) };
}

async function getQueryStatus({ projectId, jobId, location, maxResults = 1000, pageToken = null }) {
  const params = new URLSearchParams({
    maxResults: String(Math.max(1, Math.min(Number(maxResults) || 1000, 5000))),
    timeoutMs: '1000',
  });
  if (location) params.set('location', location);
  if (pageToken) params.set('pageToken', pageToken);

  const url = `${BIGQUERY_API_BASE}/projects/${encodeURIComponent(projectId)}/queries/${encodeURIComponent(jobId)}?${params.toString()}`;
  const data = await requestBigQuery(url);

  return { raw: data, ...normalizeQueryResponse(data) };
}

async function cancelQuery({ projectId, jobId, location }) {
  const params = new URLSearchParams();
  if (location) params.set('location', location);
  const url = `${BIGQUERY_API_BASE}/projects/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(jobId)}/cancel${params.toString() ? `?${params.toString()}` : ''}`;
  const data = await requestBigQuery(url, {
    method: 'POST',
    body: {},
  });

  return {
    cancelled: Boolean(data?.job?.status?.state === 'DONE' || data?.kind),
    job: data?.job || null,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllQueryRows({ projectId, jobId, location }) {
  const schemaFields = [];
  const rawRows = [];
  let pageToken = null;
  let waitCount = 0;

  while (true) {
    const result = await getQueryStatus({
      projectId,
      jobId,
      location,
      maxResults: 10000,
      pageToken,
    });

    const fields = result.raw?.schema?.fields || [];
    if (schemaFields.length === 0 && fields.length > 0) {
      schemaFields.push(...fields);
    }

    if (Array.isArray(result.raw?.rows) && result.raw.rows.length > 0) {
      rawRows.push(...result.raw.rows);
    }

    pageToken = result.raw?.pageToken || null;

    if (result.raw?.jobComplete && !pageToken) {
      return {
        schemaFields,
        rows: parseRows(schemaFields, rawRows),
        rowCount: Number(result.raw?.totalRows || rawRows.length || 0),
      };
    }

    if (!result.raw?.jobComplete && !pageToken) {
      waitCount++;
      if (waitCount > 180) {
        throw new Error('Query is still running. Try again in a moment.');
      }
      await delay(500);
    } else {
      waitCount = 0;
    }
  }
}

function sanitizeFilename(filename) {
  const base = String(filename || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return base || 'bigquery-results';
}

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function ensureUniquePath(basePath) {
  for (let i = 0; i < 200; i++) {
    const candidate = i === 0 ? basePath : `${basePath.replace(/(\.[^/.]+)?$/, '')}-${i + 1}${path.extname(basePath)}`;
    try {
      await fsp.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error('Unable to allocate unique filename');
}

async function saveResultsToFile({ cwd, filename, format, columns, rows }) {
  const safeFormat = format === 'csv' ? 'csv' : 'json';
  const safeName = sanitizeFilename(filename);
  const withExt = safeName.endsWith(`.${safeFormat}`) ? safeName : `${safeName}.${safeFormat}`;
  const targetPath = await ensureUniquePath(path.join(cwd, withExt));

  let content;
  if (safeFormat === 'json') {
    const objects = rows.map((row) => {
      const out = {};
      columns.forEach((col, idx) => {
        out[col.name] = row[idx];
      });
      return out;
    });
    content = JSON.stringify(objects, null, 2);
  } else {
    const header = columns.map((col) => escapeCsv(col.name)).join(',');
    const lines = rows.map((row) => row.map((cell) => escapeCsv(cell)).join(','));
    content = [header, ...lines].join('\n');
  }

  await fsp.writeFile(targetPath, content, 'utf8');
  return {
    path: targetPath,
    rowCount: rows.length,
    format: safeFormat,
  };
}

module.exports = {
  BIGQUERY_SCOPES,
  clearAdcCaches,
  getAuthStatus,
  getDefaultProjectId,
  listProjects,
  startQuery,
  getQueryStatus,
  cancelQuery,
  fetchAllQueryRows,
  saveResultsToFile,
  parseRows,
  normalizeQueryResponse,
  formatFieldType,
};
