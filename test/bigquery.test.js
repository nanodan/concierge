const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const {
  clearAdcCaches,
  parseRows,
  normalizeQueryResponse,
  serializeResults,
  saveResultsToFile,
} = require('../lib/bigquery');

describe('bigquery helpers', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigquery-test-'));
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('clears ADC caches without throwing', () => {
    clearAdcCaches();
    assert.equal(typeof clearAdcCaches, 'function');
  });

  it('parses nested/repeated row values', () => {
    const schema = [
      { name: 'id', type: 'INTEGER' },
      { name: 'ok', type: 'BOOLEAN' },
      { name: 'tags', type: 'STRING', mode: 'REPEATED' },
      {
        name: 'meta',
        type: 'RECORD',
        fields: [
          { name: 'name', type: 'STRING' },
          { name: 'score', type: 'FLOAT' },
        ],
      },
    ];

    const rows = [
      {
        f: [
          { v: '42' },
          { v: 'true' },
          { v: [{ v: 'a' }, { v: 'b' }] },
          {
            v: {
              f: [
                { v: 'alice' },
                { v: '99.5' },
              ],
            },
          },
        ],
      },
    ];

    assert.deepEqual(parseRows(schema, rows), [
      [42, true, ['a', 'b'], { name: 'alice', score: 99.5 }],
    ]);
  });

  it('normalizes query response into table-friendly shape', () => {
    const normalized = normalizeQueryResponse({
      jobComplete: true,
      jobReference: { jobId: 'job-1', projectId: 'p1', location: 'US' },
      schema: {
        fields: [
          { name: 'id', type: 'INT64' },
          { name: 'labels', type: 'STRING', mode: 'REPEATED' },
        ],
      },
      rows: [
        { f: [{ v: '1' }, { v: [{ v: 'x' }] }] },
      ],
      totalRows: '10',
      pageToken: 'next-page',
      totalBytesProcessed: '12345',
      cacheHit: true,
    });

    assert.equal(normalized.jobComplete, true);
    assert.equal(normalized.job.jobId, 'job-1');
    assert.deepEqual(normalized.columns, [
      { name: 'id', type: 'INT64' },
      { name: 'labels', type: 'ARRAY<STRING>' },
    ]);
    assert.deepEqual(normalized.rows, [[1, ['x']]]);
    assert.equal(normalized.rowCount, 10);
    assert.equal(normalized.truncated, true);
    assert.equal(normalized.totalBytesProcessed, '12345');
    assert.equal(normalized.cacheHit, true);
  });

  it('saves json and csv files with unique names', async () => {
    const columns = [
      { name: 'id', type: 'INT64' },
      { name: 'name', type: 'STRING' },
    ];
    const rows = [
      [1, 'alice'],
      [2, 'bob'],
    ];

    const first = await saveResultsToFile({
      cwd: tmpDir,
      filename: 'results',
      format: 'json',
      columns,
      rows,
    });
    const second = await saveResultsToFile({
      cwd: tmpDir,
      filename: 'results',
      format: 'json',
      columns,
      rows,
    });
    const csv = await saveResultsToFile({
      cwd: tmpDir,
      filename: 'results',
      format: 'csv',
      columns,
      rows,
    });

    assert.equal(path.basename(first.path), 'results.json');
    assert.equal(path.basename(second.path), 'results-2.json');
    assert.equal(path.basename(csv.path), 'results.csv');
    assert.ok(fs.existsSync(first.path));
    assert.ok(fs.existsSync(second.path));
    assert.ok(fs.existsSync(csv.path));
  });

  it('serializes geojson when latitude/longitude columns are present', async () => {
    const payload = await serializeResults({
      format: 'geojson',
      columns: [
        { name: 'id', type: 'INT64' },
        { name: 'lat', type: 'FLOAT64' },
        { name: 'lon', type: 'FLOAT64' },
      ],
      rows: [
        [1, 37.77, -122.42],
        [2, 40.71, -74.0],
      ],
    });

    assert.equal(payload.extension, 'geojson');
    assert.equal(payload.mimeType, 'application/geo+json');
    const parsed = JSON.parse(payload.content);
    assert.equal(parsed.type, 'FeatureCollection');
    assert.equal(parsed.features.length, 2);
    assert.deepEqual(parsed.features[0].geometry, {
      type: 'Point',
      coordinates: [-122.42, 37.77],
    });
  });

  it('serializes geojson from BigQuery geography WKT point values', async () => {
    const payload = await serializeResults({
      format: 'geojson',
      columns: [
        { name: 'Location', type: 'GEOGRAPHY' },
      ],
      rows: [
        ['POINT(-72 40)'],
      ],
    });

    const parsed = JSON.parse(payload.content);
    assert.equal(parsed.type, 'FeatureCollection');
    assert.equal(parsed.features.length, 1);
    assert.deepEqual(parsed.features[0].geometry, {
      type: 'Point',
      coordinates: [-72, 40],
    });
  });

  it('serializes WKT polygon geography values regardless of column name', async () => {
    const payload = await serializeResults({
      format: 'geojson',
      columns: [
        { name: 'ZoneShape', type: 'GEOGRAPHY' },
      ],
      rows: [
        ['POLYGON((-72 40, -71 40, -71 41, -72 41, -72 40))'],
      ],
    });

    const parsed = JSON.parse(payload.content);
    assert.equal(parsed.features.length, 1);
    assert.equal(parsed.features[0].geometry.type, 'Polygon');
    assert.deepEqual(parsed.features[0].geometry.coordinates[0][0], [-72, 40]);
  });

  it('serializes parquet as binary', async () => {
    const payload = await serializeResults({
      format: 'parquet',
      columns: [
        { name: 'id', type: 'INT64' },
        { name: 'name', type: 'STRING' },
      ],
      rows: [
        [1, 'alice'],
        [2, 'bob'],
      ],
    });

    assert.equal(payload.extension, 'parquet');
    assert.equal(payload.mimeType, 'application/octet-stream');
    assert.ok(Buffer.isBuffer(payload.content));
    assert.ok(payload.content.length > 0);
  });

  it('saves parquet and geojson files', async () => {
    const columns = [
      { name: 'id', type: 'INT64' },
      { name: 'lat', type: 'FLOAT64' },
      { name: 'lon', type: 'FLOAT64' },
    ];
    const rows = [[1, 35.0, -120.0]];

    const parquetResult = await saveResultsToFile({
      cwd: tmpDir,
      filename: 'bigquery-export',
      format: 'parquet',
      columns,
      rows,
    });

    const geoResult = await saveResultsToFile({
      cwd: tmpDir,
      filename: 'bigquery-export',
      format: 'geojson',
      columns,
      rows,
    });

    assert.equal(path.extname(parquetResult.path), '.parquet');
    assert.equal(path.extname(geoResult.path), '.geojson');
    assert.ok(fs.existsSync(parquetResult.path));
    assert.ok(fs.existsSync(geoResult.path));
  });
});
