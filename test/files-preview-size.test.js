const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getPreviewSizeLimitForExtension } = require('../lib/routes/files');

describe('getPreviewSizeLimitForExtension', () => {
  it('uses the standard limit for normal text files', () => {
    const limit = getPreviewSizeLimitForExtension('js');
    assert.equal(limit, 500 * 1024);
  });

  it('uses the higher limit for large geospatial preview extensions', () => {
    const geojsonLimit = getPreviewSizeLimitForExtension('geojson');
    const jsonlLimit = getPreviewSizeLimitForExtension('jsonl');

    assert.equal(geojsonLimit, 20 * 1024 * 1024);
    assert.equal(jsonlLimit, 20 * 1024 * 1024);
  });
});
