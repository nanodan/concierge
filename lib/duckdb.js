/**
 * DuckDB Service Module
 * Singleton manager for DuckDB instance with file loading, querying, and profiling capabilities
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');

// Query history storage
const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'duckdb', 'history');
const MAX_HISTORY = 20;

let DuckDBInstance = null;
let instance = null;
let connection = null;
const loadedTables = new Map(); // tableName -> { filePath, loadedAt, rowCount }

// Supported file extensions for data files
const SUPPORTED_EXTENSIONS = new Set(['.csv', '.parquet', '.json', '.jsonl', '.tsv']);

// Default limits
const DEFAULT_QUERY_LIMIT = 1000;
const PROFILE_SAMPLE_SIZE = 10000;
const _QUERY_TIMEOUT_MS = 30000;

/**
 * Convert BigInt values to numbers for JSON serialization
 * @param {any} value - Value to convert
 * @returns {any} - Converted value
 */
function convertBigInt(value) {
  if (typeof value === 'bigint') {
    // Convert to number if safe, otherwise string
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(convertBigInt);
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = convertBigInt(v);
    }
    return result;
  }
  return value;
}

/**
 * Lazy-load the DuckDB module
 */
async function loadDuckDBModule() {
  if (!DuckDBInstance) {
    const duckdb = await import('@duckdb/node-api');
    DuckDBInstance = duckdb.DuckDBInstance;
  }
  return DuckDBInstance;
}

/**
 * Get or create the shared DuckDB instance
 * @returns {Promise<{instance: DuckDBInstance, connection: DuckDBConnection}>}
 */
async function getInstance() {
  if (!instance) {
    const DuckDB = await loadDuckDBModule();
    instance = await DuckDB.create(':memory:');
    connection = await instance.connect();
  }
  return { instance, connection };
}

/**
 * Generate a safe table name from a file path
 * @param {string} filePath - The file path
 * @returns {string} A safe table name
 */
function generateTableName(filePath) {
  const basename = path.basename(filePath, path.extname(filePath));
  // Sanitize: keep alphanumeric and underscores, replace others with underscore
  const sanitized = basename.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 50);
  // Add a short hash to avoid collisions
  const hash = crypto.createHash('md5').update(filePath).digest('hex').substring(0, 6);
  return `${sanitized}_${hash}`;
}

/**
 * Check if a file extension is supported
 * @param {string} filePath - The file path
 * @returns {boolean}
 */
function isSupportedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * Load a data file into DuckDB as a table
 * @param {string} filePath - Absolute path to the file
 * @param {string} [tableName] - Optional custom table name
 * @returns {Promise<{tableName: string, rowCount: number, columns: Array}>}
 */
async function loadFile(filePath, tableName) {
  const { connection: conn } = await getInstance();
  const ext = path.extname(filePath).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type: ${ext}. Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`);
  }

  // Check file exists
  try {
    await fsp.access(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  // Generate table name if not provided
  const name = tableName || generateTableName(filePath);

  // Drop existing table if it exists
  try {
    await conn.run(`DROP TABLE IF EXISTS "${name}"`);
  } catch {
    // Ignore errors
  }

  // Escape file path for SQL (replace single quotes)
  const escapedPath = filePath.replace(/'/g, "''");

  // Load file based on extension
  let sql;
  if (ext === '.csv') {
    sql = `CREATE TABLE "${name}" AS SELECT * FROM read_csv_auto('${escapedPath}')`;
  } else if (ext === '.tsv') {
    sql = `CREATE TABLE "${name}" AS SELECT * FROM read_csv_auto('${escapedPath}', delim='\t')`;
  } else if (ext === '.parquet') {
    sql = `CREATE TABLE "${name}" AS SELECT * FROM read_parquet('${escapedPath}')`;
  } else if (ext === '.json' || ext === '.jsonl') {
    sql = `CREATE TABLE "${name}" AS SELECT * FROM read_json_auto('${escapedPath}')`;
  }

  await conn.run(sql);

  // Get table info (rowCount already converted by query())
  const countResult = await query(`SELECT COUNT(*) as cnt FROM "${name}"`, 1);
  const rowCount = countResult.rows[0]?.[0] || 0;

  // Get column info
  const columnsResult = await query(`DESCRIBE "${name}"`, 1000);
  const columns = columnsResult.rows.map(row => ({
    name: row[0],
    type: row[1],
    nullable: row[2] === 'YES'
  }));

  // Track loaded table
  loadedTables.set(name, {
    filePath,
    loadedAt: new Date().toISOString(),
    rowCount,
    columns
  });

  return { tableName: name, rowCount, columns };
}

/**
 * Run a SQL query and return results
 * @param {string} sql - The SQL query
 * @param {number} [limit] - Maximum rows to return
 * @param {number} [offset] - Rows to skip
 * @returns {Promise<{columns: Array, rows: Array, rowCount: number, totalRows?: number, truncated: boolean, executionTimeMs: number}>}
 */
async function query(sql, limit = DEFAULT_QUERY_LIMIT, offset = 0) {
  const { connection: conn } = await getInstance();
  const startTime = Date.now();

  // Add LIMIT and OFFSET if not already present (for safety/pagination)
  const upperSql = sql.toUpperCase();
  let finalSql = sql;

  // Only add limit/offset if not already present and it's a SELECT
  if (upperSql.trim().startsWith('SELECT') && !upperSql.includes(' LIMIT ')) {
    finalSql = `${sql} LIMIT ${limit + 1}`;
    if (offset > 0) {
      finalSql += ` OFFSET ${offset}`;
    }
  }

  const reader = await conn.runAndReadAll(finalSql);
  const executionTimeMs = Date.now() - startTime;

  const columnNames = reader.columnNames();
  const columnTypes = reader.columnTypes();
  const columns = columnNames.map((name, i) => ({
    name,
    type: columnTypes[i]?.toString() || 'UNKNOWN'
  }));

  let rows = reader.getRows();
  let truncated = false;

  // Check if we got more rows than requested (indicating truncation)
  if (rows.length > limit) {
    rows = rows.slice(0, limit);
    truncated = true;
  }

  // Convert BigInt values for JSON serialization
  rows = convertBigInt(rows);

  return {
    columns,
    rows,
    rowCount: rows.length,
    truncated,
    executionTimeMs
  };
}

/**
 * Profile a data file - get statistics about columns
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<Object>} Profile information
 */
async function profile(filePath) {
  const startTime = Date.now();

  // Load file into a temporary table for profiling
  const tempName = `_profile_${Date.now()}`;
  const { tableName, rowCount, columns } = await loadFile(filePath, tempName);

  try {
    const { connection: conn } = await getInstance();

    // Use sample for large tables
    const sampleBased = rowCount > PROFILE_SAMPLE_SIZE;
    const sampleSuffix = sampleBased ? ` USING SAMPLE ${PROFILE_SAMPLE_SIZE}` : '';

    // Build profile query for each column
    const profiledColumns = [];

    for (const col of columns) {
      const colName = `"${col.name}"`;
      const colType = col.type.toUpperCase();

      // Base stats
      const statsQuery = `
        SELECT
          COUNT(*) - COUNT(${colName}) as null_count,
          COUNT(DISTINCT ${colName}) as distinct_count
        FROM "${tableName}"${sampleSuffix}
      `;

      const statsResult = await query(statsQuery, 1);
      const [nullCount, distinctCount] = statsResult.rows[0] || [0, 0];

      const colProfile = {
        name: col.name,
        type: col.type,
        nullable: col.nullable,
        nullCount: Number(nullCount),
        distinctCount: Number(distinctCount)
      };

      // Numeric stats for numeric types
      if (['INTEGER', 'BIGINT', 'DOUBLE', 'FLOAT', 'DECIMAL', 'NUMERIC', 'HUGEINT', 'SMALLINT', 'TINYINT'].some(t => colType.includes(t))) {
        const numStatsQuery = `
          SELECT
            MIN(${colName}) as min_val,
            MAX(${colName}) as max_val,
            AVG(${colName}) as avg_val
          FROM "${tableName}"${sampleSuffix}
        `;
        const numResult = await query(numStatsQuery, 1);
        const [minVal, maxVal, avgVal] = numResult.rows[0] || [null, null, null];
        colProfile.min = minVal;
        colProfile.max = maxVal;
        colProfile.avg = avgVal !== null ? Math.round(avgVal * 100) / 100 : null;
      }

      // Top values for string/categorical columns with low cardinality
      if (colType.includes('VARCHAR') || colType.includes('STRING')) {
        if (distinctCount <= 20) {
          const topQuery = `
            SELECT ${colName}, COUNT(*) as cnt
            FROM "${tableName}"${sampleSuffix}
            WHERE ${colName} IS NOT NULL
            GROUP BY ${colName}
            ORDER BY cnt DESC
            LIMIT 5
          `;
          const topResult = await query(topQuery, 5);
          colProfile.topValues = topResult.rows.map(r => r[0]);
        }
      }

      profiledColumns.push(colProfile);
    }

    // Clean up temp table
    await conn.run(`DROP TABLE IF EXISTS "${tableName}"`);
    loadedTables.delete(tableName);

    const profileTimeMs = Date.now() - startTime;

    return {
      file: path.basename(filePath),
      filePath,
      rowCount,
      columns: profiledColumns,
      sampleBased,
      sampleSize: sampleBased ? PROFILE_SAMPLE_SIZE : rowCount,
      profileTimeMs
    };
  } catch (err) {
    // Clean up on error
    try {
      const { connection: conn } = await getInstance();
      await conn.run(`DROP TABLE IF EXISTS "${tempName}"`);
      loadedTables.delete(tempName);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * List all currently loaded tables
 * @returns {Array<{name: string, filePath: string, loadedAt: string, rowCount: number, columns: Array}>}
 */
function listTables() {
  return Array.from(loadedTables.entries()).map(([name, info]) => ({
    name,
    ...info
  }));
}

/**
 * Drop a loaded table
 * @param {string} tableName - The table name to drop
 * @returns {Promise<boolean>} True if dropped, false if not found
 */
async function dropTable(tableName) {
  if (!loadedTables.has(tableName)) {
    return false;
  }

  const { connection: conn } = await getInstance();
  await conn.run(`DROP TABLE IF EXISTS "${tableName}"`);
  loadedTables.delete(tableName);
  return true;
}

/**
 * Get table schema/info
 * @param {string} tableName - The table name
 * @returns {Promise<{name: string, columns: Array, rowCount: number} | null>}
 */
async function getTableInfo(tableName) {
  if (!loadedTables.has(tableName)) {
    return null;
  }

  const info = loadedTables.get(tableName);
  return {
    name: tableName,
    ...info
  };
}

/**
 * Close the DuckDB connection (for cleanup)
 */
async function close() {
  if (connection) {
    await connection.close();
    connection = null;
  }
  if (instance) {
    await instance.close();
    instance = null;
  }
  loadedTables.clear();
}

// --- Query History Storage ---

/**
 * Get the file path for a conversation's query history
 * @param {string} conversationId - The conversation ID
 * @returns {string} File path
 */
function getHistoryPath(conversationId) {
  return path.join(HISTORY_DIR, `${conversationId}.json`);
}

/**
 * Ensure history directory exists
 */
function ensureHistoryDir() {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

/**
 * Load query history for a conversation
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<string[]>} Array of SQL queries (most recent first)
 */
async function loadQueryHistory(conversationId) {
  try {
    const raw = await fsp.readFile(getHistoryPath(conversationId), 'utf8');
    const history = JSON.parse(raw);
    return Array.isArray(history) ? history : [];
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[DUCKDB] Failed to load query history for ${conversationId}:`, err.message);
    }
    return [];
  }
}

/**
 * Save query history for a conversation
 * @param {string} conversationId - The conversation ID
 * @param {string[]} history - Array of SQL queries (most recent first)
 */
async function saveQueryHistory(conversationId, history) {
  ensureHistoryDir();
  const trimmed = history.slice(0, MAX_HISTORY);
  await fsp.writeFile(getHistoryPath(conversationId), JSON.stringify(trimmed, null, 2));
}

/**
 * Add a query to history (deduplicates and maintains order)
 * @param {string} conversationId - The conversation ID
 * @param {string} sql - The SQL query to add
 */
async function addToQueryHistory(conversationId, sql) {
  const history = await loadQueryHistory(conversationId);
  // Remove duplicates
  const filtered = history.filter(q => q !== sql);
  // Add to front
  filtered.unshift(sql);
  await saveQueryHistory(conversationId, filtered);
}

/**
 * Clear query history for a conversation
 * @param {string} conversationId - The conversation ID
 */
async function clearQueryHistory(conversationId) {
  try {
    await fsp.unlink(getHistoryPath(conversationId));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[DUCKDB] Failed to clear query history for ${conversationId}:`, err.message);
    }
  }
}

/**
 * Copy query history from one conversation to another (for forking)
 * @param {string} fromConvId - Source conversation ID
 * @param {string} toConvId - Destination conversation ID
 */
async function copyQueryHistory(fromConvId, toConvId) {
  const history = await loadQueryHistory(fromConvId);
  if (history.length > 0) {
    await saveQueryHistory(toConvId, history);
  }
}

/**
 * Delete query history when conversation is deleted
 * @param {string} conversationId - The conversation ID
 */
async function deleteQueryHistory(conversationId) {
  await clearQueryHistory(conversationId);
}

module.exports = {
  getInstance,
  loadFile,
  query,
  profile,
  listTables,
  dropTable,
  getTableInfo,
  close,
  isSupportedFile,
  SUPPORTED_EXTENSIONS,
  // Query history
  loadQueryHistory,
  saveQueryHistory,
  addToQueryHistory,
  clearQueryHistory,
  copyQueryHistory,
  deleteQueryHistory,
  MAX_HISTORY
};
