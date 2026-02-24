const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'explorer', 'geo-preview.js')).href;

describe('explorer geo preview helpers', async () => {
  const {
    normalizeGeoJson,
    computeGeoBounds,
    parseGeoSpatialContent,
    buildFeatureMetadataHtml,
    prepareGeoJsonForMap,
    getGeoStyleOptions,
  } = await import(moduleUrl);

  it('normalizes geometry object into a feature collection', () => {
    const normalized = normalizeGeoJson({
      type: 'Point',
      coordinates: [-73.9857, 40.7484],
    });

    assert.equal(normalized.type, 'FeatureCollection');
    assert.equal(normalized.features.length, 1);
    assert.equal(normalized.features[0].geometry.type, 'Point');
  });

  it('computes bounds from multi-geometry feature collections', () => {
    const bounds = computeGeoBounds({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-122.4, 37.8] },
          properties: {},
        },
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-122.6, 37.7],
              [-122.3, 37.9],
            ],
          },
          properties: {},
        },
      ],
    });

    assert.deepEqual(bounds, [-122.6, 37.7, -122.3, 37.9]);
  });

  it('parses GeoJSON feature collection payloads', () => {
    const parsed = parseGeoSpatialContent(JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'A' },
          geometry: { type: 'Point', coordinates: [10, 20] },
        },
      ],
    }), 'geojson');

    assert.equal(parsed.ok, true);
    assert.equal(parsed.geojson.type, 'FeatureCollection');
    assert.equal(parsed.geojson.features.length, 1);
    assert.match(parsed.summary, /1 feature/i);
  });

  it('parses line-delimited GeoJSON files', () => {
    const parsed = parseGeoSpatialContent(
      '{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]},"properties":{}}\n'
      + '{"type":"Feature","geometry":{"type":"Point","coordinates":[2,1]},"properties":{}}',
      'jsonl'
    );

    assert.equal(parsed.ok, true);
    assert.equal(parsed.geojson.features.length, 2);
    assert.deepEqual(parsed.bounds, [0, 0, 2, 1]);
  });

  it('rejects non-GeoJSON JSON payloads and TopoJSON', () => {
    const plain = parseGeoSpatialContent(JSON.stringify({ foo: 'bar' }), 'json');
    assert.equal(plain.ok, false);

    const topo = parseGeoSpatialContent(JSON.stringify({ type: 'Topology', objects: {} }), 'topojson');
    assert.equal(topo.ok, false);
    assert.match(topo.reason, /TopoJSON/i);
  });

  it('builds escaped feature metadata popup html', () => {
    const html = buildFeatureMetadataHtml({
      geometry: { type: 'Point' },
      properties: {
        name: '<script>alert(1)</script>',
        count: 42,
      },
    });

    assert.match(html, /Point/);
    assert.match(html, /name/);
    assert.match(html, /count/);
    assert.doesNotMatch(html, /<script>/i);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  it('handles features without properties in popup html', () => {
    const html = buildFeatureMetadataHtml({
      geometry: { type: 'LineString' },
      properties: {},
    });

    assert.match(html, /LineString/);
    assert.match(html, /No properties/);
  });

  it('adds stable feature ids and profiles style fields', () => {
    const prepared = prepareGeoJsonForMap({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { category: 'a', score: 10 },
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
        {
          type: 'Feature',
          properties: { category: 'b', score: 25 },
          geometry: { type: 'Point', coordinates: [1, 1] },
        },
      ],
    });

    assert.equal(prepared.geojson.features[0].properties.__fid, '0');
    assert.equal(prepared.geojson.features[1].properties.__fid, '1');

    const options = getGeoStyleOptions(prepared.fieldProfiles);
    const category = options.find((item) => item.key === 'category');
    const score = options.find((item) => item.key === 'score');

    assert.ok(category);
    assert.equal(category.numeric, false);
    assert.ok(score);
    assert.equal(score.numeric, true);
  });
});
