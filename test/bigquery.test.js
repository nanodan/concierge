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
});
