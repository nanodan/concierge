const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Note: These tests require @duckdb/node-api to be installed
// They test the integration with the DuckDB service module

describe('duckdb module', () => {
  let tmpDir;
  let duckdb;
  let csvPath;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckdb-test-'));

    // Create a test CSV file
    csvPath = path.join(tmpDir, 'test.csv');
    const csvContent = 'id,name,value\n1,alice,100\n2,bob,200\n3,charlie,300\n';
    fs.writeFileSync(csvPath, csvContent);

    // Import duckdb module (uses dynamic import internally)
    duckdb = require('../lib/duckdb');
  });

  afterEach(async () => {
    // Clean up loaded tables
    const tables = duckdb.listTables();
    for (const table of tables) {
      await duckdb.dropTable(table.name);
    }

    // Clean up temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('isSupportedFile', () => {
    it('returns true for CSV files', () => {
      assert.equal(duckdb.isSupportedFile('data.csv'), true);
      assert.equal(duckdb.isSupportedFile('/path/to/file.CSV'), true);
    });

    it('returns true for TSV files', () => {
      assert.equal(duckdb.isSupportedFile('data.tsv'), true);
    });

    it('returns true for Parquet files', () => {
      assert.equal(duckdb.isSupportedFile('data.parquet'), true);
    });

    it('returns true for JSON files', () => {
      assert.equal(duckdb.isSupportedFile('data.json'), true);
      assert.equal(duckdb.isSupportedFile('data.jsonl'), true);
      assert.equal(duckdb.isSupportedFile('data.geojson'), true);
    });

    it('returns false for unsupported files', () => {
      assert.equal(duckdb.isSupportedFile('script.js'), false);
      assert.equal(duckdb.isSupportedFile('readme.md'), false);
      assert.equal(duckdb.isSupportedFile('image.png'), false);
    });
  });

  describe('SUPPORTED_EXTENSIONS', () => {
    it('contains expected extensions', () => {
      assert.equal(duckdb.SUPPORTED_EXTENSIONS.has('.csv'), true);
      assert.equal(duckdb.SUPPORTED_EXTENSIONS.has('.tsv'), true);
      assert.equal(duckdb.SUPPORTED_EXTENSIONS.has('.parquet'), true);
      assert.equal(duckdb.SUPPORTED_EXTENSIONS.has('.json'), true);
      assert.equal(duckdb.SUPPORTED_EXTENSIONS.has('.jsonl'), true);
      assert.equal(duckdb.SUPPORTED_EXTENSIONS.has('.geojson'), true);
    });
  });

  describe('loadFile', () => {
    it('loads a CSV file into a table', async () => {
      const result = await duckdb.loadFile(csvPath, 'test_table');

      assert.equal(result.tableName, 'test_table');
      assert.equal(Number(result.rowCount), 3);
      assert.equal(result.columns.length, 3);
      assert.equal(result.columns[0].name, 'id');
      assert.equal(result.columns[1].name, 'name');
      assert.equal(result.columns[2].name, 'value');
    });

    it('auto-generates table name if not provided', async () => {
      const result = await duckdb.loadFile(csvPath);

      assert.ok(result.tableName.startsWith('test_'));
      assert.equal(Number(result.rowCount), 3);
    });

    it('loads a GeoJSON file into a table', async () => {
      const geojsonPath = path.join(tmpDir, 'points.geojson');
      const geojsonContent = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { id: 1, name: 'alpha' },
            geometry: { type: 'Point', coordinates: [-72.0, 40.0] }
          },
          {
            type: 'Feature',
            properties: { id: 2, name: 'beta' },
            geometry: { type: 'Point', coordinates: [-73.0, 41.0] }
          }
        ]
      };
      fs.writeFileSync(geojsonPath, JSON.stringify(geojsonContent));

      const result = await duckdb.loadFile(geojsonPath, 'geo_data');

      assert.equal(result.tableName, 'geo_data');
      assert.equal(Number(result.rowCount), 2);
      assert.ok(result.columns.some(col => col.name === 'geometry'));
      assert.ok(result.columns.some(col => col.name === 'properties'));
    });

    it('throws error for non-existent file', async () => {
      const fakePath = path.join(tmpDir, 'nonexistent.csv');

      await assert.rejects(
        () => duckdb.loadFile(fakePath),
        /File not found/
      );
    });

    it('throws error for unsupported file type', async () => {
      const jsPath = path.join(tmpDir, 'script.js');
      fs.writeFileSync(jsPath, 'console.log("hello")');

      await assert.rejects(
        () => duckdb.loadFile(jsPath),
        /Unsupported file type/
      );
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      await duckdb.loadFile(csvPath, 'test_data');
    });

    it('runs a SELECT query', async () => {
      const result = await duckdb.query('SELECT * FROM test_data');

      assert.equal(result.columns.length, 3);
      assert.equal(result.rows.length, 3);
      assert.equal(result.truncated, false);
    });

    it('returns column names and types', async () => {
      const result = await duckdb.query('SELECT * FROM test_data LIMIT 1');

      assert.equal(result.columns[0].name, 'id');
      assert.equal(result.columns[1].name, 'name');
      assert.equal(result.columns[2].name, 'value');
    });

    it('respects limit parameter', async () => {
      const result = await duckdb.query('SELECT * FROM test_data', 1);

      assert.equal(result.rows.length, 1);
      assert.equal(result.truncated, true);
    });

    it('includes execution time', async () => {
      const result = await duckdb.query('SELECT * FROM test_data');

      assert.ok(typeof result.executionTimeMs === 'number');
      assert.ok(result.executionTimeMs >= 0);
    });

    it('handles date and timestamp values without [object Object]', async () => {
      // Query with date functions
      const result = await duckdb.query("SELECT DATE '2024-01-15' as date_col, TIMESTAMP '2024-01-15 10:30:00' as ts_col");

      assert.equal(result.rows.length, 1);
      const row = result.rows[0];

      // Values should be strings, not [object Object]
      assert.ok(typeof row[0] === 'string' || typeof row[0] === 'number', `date_col should be string or number, got ${typeof row[0]}`);
      assert.ok(typeof row[1] === 'string' || typeof row[1] === 'number', `ts_col should be string or number, got ${typeof row[1]}`);
      assert.ok(!String(row[0]).includes('[object'), `date_col should not be [object Object], got ${row[0]}`);
      assert.ok(!String(row[1]).includes('[object'), `ts_col should not be [object Object], got ${row[1]}`);
    });
  });

  describe('listTables', () => {
    it('returns empty array when no tables loaded', () => {
      const tables = duckdb.listTables();
      assert.deepEqual(tables, []);
    });

    it('returns loaded tables with metadata', async () => {
      await duckdb.loadFile(csvPath, 'my_table');

      const tables = duckdb.listTables();
      assert.equal(tables.length, 1);
      assert.equal(tables[0].name, 'my_table');
      assert.equal(tables[0].filePath, csvPath);
      assert.equal(Number(tables[0].rowCount), 3);
      assert.ok(tables[0].loadedAt);
    });
  });

  describe('dropTable', () => {
    it('drops an existing table', async () => {
      await duckdb.loadFile(csvPath, 'to_drop');
      assert.equal(duckdb.listTables().length, 1);

      const result = await duckdb.dropTable('to_drop');
      assert.equal(result, true);
      assert.equal(duckdb.listTables().length, 0);
    });

    it('returns false for non-existent table', async () => {
      const result = await duckdb.dropTable('nonexistent');
      assert.equal(result, false);
    });
  });

  describe('getTableInfo', () => {
    it('returns table info for loaded table', async () => {
      await duckdb.loadFile(csvPath, 'info_test');

      const info = await duckdb.getTableInfo('info_test');
      assert.equal(info.name, 'info_test');
      assert.equal(Number(info.rowCount), 3);
      assert.equal(info.columns.length, 3);
    });

    it('returns null for non-existent table', async () => {
      const info = await duckdb.getTableInfo('nonexistent');
      assert.equal(info, null);
    });
  });

  describe('profile', () => {
    it('profiles a CSV file', async () => {
      const result = await duckdb.profile(csvPath);

      assert.equal(result.file, 'test.csv');
      assert.equal(Number(result.rowCount), 3);
      assert.equal(result.columns.length, 3);
      assert.ok(typeof result.profileTimeMs === 'number');

      // Check column profiles
      const idCol = result.columns.find(c => c.name === 'id');
      assert.ok(idCol);
      assert.equal(Number(idCol.nullCount), 0);
      assert.equal(Number(idCol.distinctCount), 3);
    });

    it('includes numeric stats for numeric columns', async () => {
      const result = await duckdb.profile(csvPath);

      const valueCol = result.columns.find(c => c.name === 'value');
      assert.ok(valueCol);
      assert.ok('min' in valueCol);
      assert.ok('max' in valueCol);
      assert.ok('avg' in valueCol);
    });
  });

  describe('query history', () => {
    const testConvId = 'test-conv-history-' + Date.now();
    const testConvId2 = 'test-conv-history-2-' + Date.now();

    afterEach(async () => {
      // Clean up test history files
      await duckdb.deleteQueryHistory(testConvId);
      await duckdb.deleteQueryHistory(testConvId2);
    });

    it('loads empty history for new conversation', async () => {
      const history = await duckdb.loadQueryHistory(testConvId);
      assert.deepEqual(history, []);
    });

    it('saves and loads query history', async () => {
      await duckdb.saveQueryHistory(testConvId, ['SELECT 1', 'SELECT 2']);
      const history = await duckdb.loadQueryHistory(testConvId);
      assert.deepEqual(history, ['SELECT 1', 'SELECT 2']);
    });

    it('addToQueryHistory adds to front and deduplicates', async () => {
      await duckdb.saveQueryHistory(testConvId, ['SELECT 1', 'SELECT 2']);
      await duckdb.addToQueryHistory(testConvId, 'SELECT 3');
      let history = await duckdb.loadQueryHistory(testConvId);
      assert.deepEqual(history, ['SELECT 3', 'SELECT 1', 'SELECT 2']);

      // Adding duplicate should move it to front
      await duckdb.addToQueryHistory(testConvId, 'SELECT 1');
      history = await duckdb.loadQueryHistory(testConvId);
      assert.deepEqual(history, ['SELECT 1', 'SELECT 3', 'SELECT 2']);
    });

    it('clearQueryHistory removes all history', async () => {
      await duckdb.saveQueryHistory(testConvId, ['SELECT 1', 'SELECT 2']);
      await duckdb.clearQueryHistory(testConvId);
      const history = await duckdb.loadQueryHistory(testConvId);
      assert.deepEqual(history, []);
    });

    it('copyQueryHistory copies history between conversations', async () => {
      await duckdb.saveQueryHistory(testConvId, ['SELECT a', 'SELECT b']);
      await duckdb.copyQueryHistory(testConvId, testConvId2);

      const history2 = await duckdb.loadQueryHistory(testConvId2);
      assert.deepEqual(history2, ['SELECT a', 'SELECT b']);

      // Original should be unchanged
      const history1 = await duckdb.loadQueryHistory(testConvId);
      assert.deepEqual(history1, ['SELECT a', 'SELECT b']);
    });

    it('respects MAX_HISTORY limit', async () => {
      const queries = Array.from({ length: 30 }, (_, i) => `SELECT ${i}`);
      await duckdb.saveQueryHistory(testConvId, queries);
      const history = await duckdb.loadQueryHistory(testConvId);
      assert.equal(history.length, duckdb.MAX_HISTORY);
      assert.equal(history[0], 'SELECT 0');
    });
  });
});
