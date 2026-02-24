const MAPLIBRE_VERSION = '4.7.1';
const MAPLIBRE_JS_URL = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
const MAPLIBRE_CSS_URL = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;

const GEOJSON_GEOMETRY_TYPES = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
]);

const BASEMAPS = {
  standard: {
    label: 'Standard',
    tiles: [
      'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
      'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
      'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
    ],
    attribution: '© OpenStreetMap contributors',
  },
  light: {
    label: 'Light',
    tiles: [
      'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    ],
    attribution: '© OpenStreetMap contributors © CARTO',
  },
  dark: {
    label: 'Dark',
    tiles: [
      'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    ],
    attribution: '© OpenStreetMap contributors © CARTO',
  },
};

const DEFAULT_BASEMAP = 'standard';
const BASEMAP_SOURCE_PREFIX = 'geo-basemap-src-';
const BASEMAP_LAYER_PREFIX = 'geo-basemap-layer-';

export const GEO_BASEMAP_OPTIONS = Object.entries(BASEMAPS).map(([id, config]) => ({
  id,
  label: config.label,
}));

function buildMapStyle(activeBasemap = DEFAULT_BASEMAP) {
  const sources = {};
  const layers = [];

  for (const [id, config] of Object.entries(BASEMAPS)) {
    const sourceId = `${BASEMAP_SOURCE_PREFIX}${id}`;
    const layerId = `${BASEMAP_LAYER_PREFIX}${id}`;

    sources[sourceId] = {
      type: 'raster',
      tiles: config.tiles,
      tileSize: 256,
      maxzoom: 19,
      attribution: config.attribution,
    };

    layers.push({
      id: layerId,
      type: 'raster',
      source: sourceId,
      minzoom: 0,
      maxzoom: 22,
      layout: {
        visibility: id === activeBasemap ? 'visible' : 'none',
      },
    });
  }

  return { version: 8, sources, layers };
}

let mapLibreLoadPromise = null;
const SOURCE_ID = 'geo-preview-source';
const FEATURE_ID_KEY = '__fid';
const DEFAULT_COLORS = {
  fill: '#2bd4ff',
  outline: '#00b8ff',
  line: '#ff4da0',
  point: '#ff4d5a',
};
const SELECTED_COLOR = '#ffe66d';
const THEMATIC_PALETTE = ['#5ec8ff', '#8bd450', '#ffd166', '#ff8c42', '#ef476f', '#b083ff', '#48c9b0', '#f78c6b'];

const INTERACTIVE_LAYER_IDS = [
  'geo-fill-layer',
  'geo-polygon-outline-layer',
  'geo-line-layer',
  'geo-point-layer',
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stringifyPropertyValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      const encoded = JSON.stringify(value);
      return encoded.length > 120 ? `${encoded.slice(0, 117)}...` : encoded;
    } catch {
      return '[object]';
    }
  }
  const text = String(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function ensureMapLibreCss() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[data-maplibre-css="true"]')) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = MAPLIBRE_CSS_URL;
  link.dataset.maplibreCss = 'true';
  document.head.appendChild(link);
}

export function ensureMapLibre() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Map preview requires a browser environment'));
  }

  if (window.maplibregl) {
    return Promise.resolve(window.maplibregl);
  }

  if (!mapLibreLoadPromise) {
    mapLibreLoadPromise = new Promise((resolve, reject) => {
      ensureMapLibreCss();

      const script = document.createElement('script');
      script.src = MAPLIBRE_JS_URL;
      script.async = true;

      script.onload = () => {
        if (window.maplibregl) {
          resolve(window.maplibregl);
          return;
        }
        reject(new Error('MapLibre loaded but window.maplibregl is unavailable'));
      };

      script.onerror = () => reject(new Error('Failed to load MapLibre assets'));
      document.head.appendChild(script);
    }).catch((err) => {
      mapLibreLoadPromise = null;
      throw err;
    });
  }

  return mapLibreLoadPromise;
}

function visitCoordinates(coords, onPoint) {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    onPoint(coords[0], coords[1]);
    return;
  }

  for (const child of coords) {
    visitCoordinates(child, onPoint);
  }
}

function updateBounds(bounds, lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

  bounds[0] = Math.min(bounds[0], lng);
  bounds[1] = Math.min(bounds[1], lat);
  bounds[2] = Math.max(bounds[2], lng);
  bounds[3] = Math.max(bounds[3], lat);
}

function collectGeometryBounds(geometry, bounds) {
  if (!geometry || !geometry.type) return;

  if (geometry.type === 'GeometryCollection') {
    for (const nested of geometry.geometries || []) {
      collectGeometryBounds(nested, bounds);
    }
    return;
  }

  visitCoordinates(geometry.coordinates, (lng, lat) => updateBounds(bounds, lng, lat));
}

function hasValidBounds(bounds) {
  return Number.isFinite(bounds[0])
    && Number.isFinite(bounds[1])
    && Number.isFinite(bounds[2])
    && Number.isFinite(bounds[3]);
}

export function computeGeoBounds(featureCollection) {
  if (!featureCollection || !Array.isArray(featureCollection.features)) return null;

  const bounds = [Infinity, Infinity, -Infinity, -Infinity];

  for (const feature of featureCollection.features) {
    collectGeometryBounds(feature?.geometry, bounds);
  }

  return hasValidBounds(bounds) ? bounds : null;
}

function normalizeFeature(feature) {
  if (!feature || typeof feature !== 'object') return null;

  if (feature.type === 'Feature') {
    if (!feature.geometry || !GEOJSON_GEOMETRY_TYPES.has(feature.geometry.type)) return null;
    return {
      type: 'Feature',
      properties: feature.properties && typeof feature.properties === 'object' ? feature.properties : {},
      geometry: feature.geometry,
    };
  }

  if (GEOJSON_GEOMETRY_TYPES.has(feature.type)) {
    return {
      type: 'Feature',
      properties: {},
      geometry: feature,
    };
  }

  return null;
}

export function normalizeGeoJson(value) {
  if (!value || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    const features = value.map(normalizeFeature).filter(Boolean);
    return features.length ? { type: 'FeatureCollection', features } : null;
  }

  if (value.type === 'FeatureCollection') {
    const features = Array.isArray(value.features)
      ? value.features.map(normalizeFeature).filter(Boolean)
      : [];
    return { type: 'FeatureCollection', features };
  }

  const single = normalizeFeature(value);
  if (!single) return null;

  return {
    type: 'FeatureCollection',
    features: [single],
  };
}

function parseGeoJsonLines(raw) {
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;

  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      return null;
    }
  }

  return normalizeGeoJson(entries);
}

function collectGeometryTypes(features) {
  const types = new Set();
  for (const feature of features) {
    if (!feature?.geometry?.type) continue;
    types.add(feature.geometry.type);
  }
  return Array.from(types.values());
}

function summarizeGeoInfo(featureCollection) {
  const featureCount = featureCollection.features.length;
  const geometryTypes = collectGeometryTypes(featureCollection.features);
  const label = featureCount === 1 ? 'feature' : 'features';
  return `${featureCount.toLocaleString()} ${label}${geometryTypes.length ? ` (${geometryTypes.join(', ')})` : ''}`;
}

export function parseGeoSpatialContent(rawContent, ext = '') {
  const content = typeof rawContent === 'string' ? rawContent.trim() : '';
  if (!content) return { ok: false, reason: 'No geospatial content found' };

  const loweredExt = String(ext || '').toLowerCase();

  if (loweredExt === 'jsonl' || loweredExt === 'ndjson') {
    const lineCollection = parseGeoJsonLines(content);
    if (!lineCollection) return { ok: false, reason: 'JSONL content is not valid GeoJSON' };

    return {
      ok: lineCollection.features.length > 0,
      reason: lineCollection.features.length > 0 ? null : 'GeoJSON has no features',
      geojson: lineCollection,
      summary: summarizeGeoInfo(lineCollection),
      bounds: computeGeoBounds(lineCollection),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: 'File is not valid JSON' };
  }

  if (parsed?.type === 'Topology') {
    return { ok: false, reason: 'TopoJSON preview is not supported yet' };
  }

  const normalized = normalizeGeoJson(parsed);
  if (!normalized) {
    return { ok: false, reason: 'JSON is not recognized as GeoJSON' };
  }

  return {
    ok: normalized.features.length > 0,
    reason: normalized.features.length > 0 ? null : 'GeoJSON has no features',
    geojson: normalized,
    summary: summarizeGeoInfo(normalized),
    bounds: computeGeoBounds(normalized),
  };
}

export function buildFeatureMetadataHtml(feature) {
  const geometryType = feature?.geometry?.type || 'Feature';
  const props = feature?.properties && typeof feature.properties === 'object'
    ? Object.entries(feature.properties).filter(([key]) => !String(key).startsWith('__'))
    : [];

  if (!props.length) {
    return `
      <div class="geo-popup">
        <div class="geo-popup-title">${escapeHtml(geometryType)}</div>
        <div class="geo-popup-empty">No properties</div>
      </div>
    `;
  }

  const rows = props.slice(0, 12).map(([key, value]) => `
    <div class="geo-popup-row">
      <span class="geo-popup-key">${escapeHtml(key)}</span>
      <span class="geo-popup-value">${escapeHtml(stringifyPropertyValue(value))}</span>
    </div>
  `).join('');

  const extraCount = props.length > 12 ? `<div class="geo-popup-extra">+${props.length - 12} more</div>` : '';

  return `
    <div class="geo-popup">
      <div class="geo-popup-title">${escapeHtml(geometryType)}</div>
      ${rows}
      ${extraCount}
    </div>
  `;
}

function toNumberOrNull(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function defaultPointRadiusExpression() {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    4, 4,
    10, 6.5,
    14, 9,
  ];
}

function buildCategoricalColorExpression(field, categories, fallbackColor) {
  if (!categories.length) return fallbackColor;
  const expression = ['match', ['to-string', ['get', field]]];
  categories.forEach((value, idx) => {
    expression.push(value);
    expression.push(THEMATIC_PALETTE[idx % THEMATIC_PALETTE.length]);
  });
  expression.push(fallbackColor);
  return expression;
}

function buildNumericColorExpression(field, min, max, fallbackColor) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return fallbackColor;
  const mid = min + (max - min) / 2;
  return [
    'interpolate',
    ['linear'],
    ['coalesce', ['to-number', ['get', field]], min],
    min, '#4d9dff',
    mid, '#4ccf80',
    max, '#ff4d88',
  ];
}

function buildNumericRadiusExpression(field, min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return defaultPointRadiusExpression();
  }
  return [
    'interpolate',
    ['linear'],
    ['coalesce', ['to-number', ['get', field]], min],
    min, 4,
    max, 13,
  ];
}

function normalizeFieldOption(value) {
  return value && value !== '__none__' ? value : '';
}

function getFeatureId(feature) {
  const fid = feature?.properties?.[FEATURE_ID_KEY];
  if (fid === undefined || fid === null) return null;
  return String(fid);
}

function getFeatureIndex(container, fid) {
  const normalized = fid === undefined || fid === null ? null : String(fid);
  if (!normalized) return null;
  return container?._geoPreviewFeatureIndex?.get(normalized) || null;
}

function focusFeature(map, feature) {
  if (!map || !feature?.geometry) return;
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  collectGeometryBounds(feature.geometry, bounds);

  if (!hasValidBounds(bounds)) return;
  if (bounds[0] === bounds[2] && bounds[1] === bounds[3]) {
    map.easeTo({ center: [bounds[0], bounds[1]], zoom: Math.max(map.getZoom(), 12), duration: 250 });
    return;
  }

  map.fitBounds(
    [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ],
    { padding: 52, duration: 250, maxZoom: 15 }
  );
}

function setSelectedFeatureFilter(map, fid) {
  const matchFilter = fid
    ? ['==', ['to-string', ['get', FEATURE_ID_KEY]], String(fid)]
    : ['==', 1, 0];

  const selectableLayers = [
    'geo-selected-fill-layer',
    'geo-selected-outline-layer',
    'geo-selected-line-layer',
    'geo-selected-point-layer',
  ];

  selectableLayers.forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.setFilter(layerId, matchFilter);
    }
  });
}

export function prepareGeoJsonForMap(featureCollection) {
  const features = (featureCollection?.features || []).map((feature, idx) => {
    const properties = {
      ...(feature?.properties && typeof feature.properties === 'object' ? feature.properties : {}),
      [FEATURE_ID_KEY]: String(idx),
    };

    return {
      ...feature,
      properties,
    };
  });

  const fieldProfiles = new Map();

  for (const feature of features) {
    const properties = feature?.properties || {};
    for (const [key, raw] of Object.entries(properties)) {
      if (!key || key.startsWith('__')) continue;
      const current = fieldProfiles.get(key) || {
        key,
        numericCount: 0,
        stringCount: 0,
        min: Infinity,
        max: -Infinity,
        categories: new Map(),
      };

      const numeric = toNumberOrNull(raw);
      if (numeric !== null) {
        current.numericCount += 1;
        current.min = Math.min(current.min, numeric);
        current.max = Math.max(current.max, numeric);
      } else if (raw !== null && raw !== undefined && raw !== '') {
        current.stringCount += 1;
      }

      const category = stringifyPropertyValue(raw);
      if (category) {
        const prev = current.categories.get(category) || 0;
        current.categories.set(category, prev + 1);
      }

      fieldProfiles.set(key, current);
    }
  }

  return {
    geojson: { type: 'FeatureCollection', features },
    fieldProfiles,
  };
}

export function getGeoStyleOptions(fieldProfiles) {
  const options = [];
  for (const profile of fieldProfiles?.values?.() || []) {
    const isNumeric = profile.numericCount > 0 && profile.stringCount === 0;
    options.push({
      key: profile.key,
      label: profile.key,
      numeric: isNumeric,
    });
  }
  options.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  return options;
}

export function setGeoBasemap(container, basemapId) {
  const selected = BASEMAPS[basemapId] ? basemapId : DEFAULT_BASEMAP;
  if (container) {
    container._geoPreviewBasemap = selected;
  }

  const map = container?._geoPreviewMap;
  if (!map) return false;
  for (const id of Object.keys(BASEMAPS)) {
    const layerId = `${BASEMAP_LAYER_PREFIX}${id}`;
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', id === selected ? 'visible' : 'none');
    }
  }
  return true;
}

export function applyGeoThematicStyle(container, style = {}) {
  if (container) {
    container._geoPreviewStyle = {
      colorBy: normalizeFieldOption(style.colorBy),
      sizeBy: normalizeFieldOption(style.sizeBy),
    };
  }

  const map = container?._geoPreviewMap;
  const fieldProfiles = container?._geoPreviewFieldProfiles;
  if (!map || !fieldProfiles) return false;

  const colorBy = normalizeFieldOption(style.colorBy);
  const sizeBy = normalizeFieldOption(style.sizeBy);

  let fillColor = DEFAULT_COLORS.fill;
  let outlineColor = DEFAULT_COLORS.outline;
  let lineColor = DEFAULT_COLORS.line;
  let pointColor = DEFAULT_COLORS.point;
  let pointRadius = defaultPointRadiusExpression();

  if (colorBy && fieldProfiles.has(colorBy)) {
    const profile = fieldProfiles.get(colorBy);
    const isNumeric = profile.numericCount > 0 && profile.stringCount === 0;
    if (isNumeric) {
      const expression = buildNumericColorExpression(colorBy, profile.min, profile.max, DEFAULT_COLORS.fill);
      fillColor = expression;
      outlineColor = expression;
      lineColor = expression;
      pointColor = expression;
    } else {
      const categories = Array.from(profile.categories.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([value]) => value);
      const expression = buildCategoricalColorExpression(colorBy, categories, DEFAULT_COLORS.fill);
      fillColor = expression;
      outlineColor = expression;
      lineColor = expression;
      pointColor = expression;
    }
  }

  if (sizeBy && fieldProfiles.has(sizeBy)) {
    const profile = fieldProfiles.get(sizeBy);
    const isNumeric = profile.numericCount > 0 && profile.stringCount === 0;
    if (isNumeric) {
      pointRadius = buildNumericRadiusExpression(sizeBy, profile.min, profile.max);
    }
  }

  if (map.getLayer('geo-fill-layer')) map.setPaintProperty('geo-fill-layer', 'fill-color', fillColor);
  if (map.getLayer('geo-polygon-outline-layer')) map.setPaintProperty('geo-polygon-outline-layer', 'line-color', outlineColor);
  if (map.getLayer('geo-line-layer')) map.setPaintProperty('geo-line-layer', 'line-color', lineColor);
  if (map.getLayer('geo-point-layer')) {
    map.setPaintProperty('geo-point-layer', 'circle-color', pointColor);
    map.setPaintProperty('geo-point-layer', 'circle-radius', pointRadius);
  }

  return true;
}

export function selectGeoFeature(container, fid, options = {}) {
  const map = container?._geoPreviewMap;
  if (!map) return false;

  const normalized = fid === undefined || fid === null ? null : String(fid);
  setSelectedFeatureFilter(map, normalized);
  container._geoPreviewSelectedFeatureId = normalized;

  if (options.fit) {
    const feature = getFeatureIndex(container, normalized);
    if (feature) focusFeature(map, feature);
  }
  return true;
}

export function fitGeoPreviewToBounds(container) {
  const map = container?._geoPreviewMap;
  if (!map) return false;

  const selected = container._geoPreviewSelectedFeatureId;
  if (selected) {
    const feature = getFeatureIndex(container, selected);
    if (feature) {
      focusFeature(map, feature);
      return true;
    }
  }

  fitGeoBounds(map, container?._geoPreviewBounds || null);
  return true;
}

function bindFeatureHover(map, maplibregl, onFeatureSelect) {
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'geo-preview-popup',
    maxWidth: '280px',
  });

  const handlers = [];
  const register = (eventName, layerId, fn) => {
    map.on(eventName, layerId, fn);
    handlers.push([eventName, layerId, fn]);
  };

  const closePopup = () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  };

  for (const layerId of INTERACTIVE_LAYER_IDS) {
    register('mousemove', layerId, (event) => {
      const feature = event?.features?.[0];
      if (!feature) return;

      map.getCanvas().style.cursor = 'pointer';
      popup
        .setLngLat(event.lngLat)
        .setHTML(buildFeatureMetadataHtml(feature))
        .addTo(map);
    });

    register('mouseleave', layerId, closePopup);

    register('click', layerId, (event) => {
      const feature = event?.features?.[0];
      const fid = getFeatureId(feature);
      if (fid && onFeatureSelect) {
        onFeatureSelect(fid, feature);
      }
    });
  }

  return () => {
    closePopup();
    for (const [eventName, layerId, fn] of handlers) {
      try {
        map.off(eventName, layerId, fn);
      } catch {}
    }
  };
}

function addGeoLayers(map, sourceId) {
  map.addLayer({
    id: 'geo-fill-layer',
    type: 'fill',
    source: sourceId,
    filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
    paint: {
      'fill-color': DEFAULT_COLORS.fill,
      'fill-opacity': 0.34,
    },
  });

  map.addLayer({
    id: 'geo-polygon-outline-layer',
    type: 'line',
    source: sourceId,
    filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
    paint: {
      'line-color': DEFAULT_COLORS.outline,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4, 1.4,
        10, 2.5,
        14, 3.2,
      ],
      'line-opacity': 0.95,
    },
  });

  map.addLayer({
    id: 'geo-line-layer',
    type: 'line',
    source: sourceId,
    filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
    paint: {
      'line-color': DEFAULT_COLORS.line,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4, 2,
        10, 4,
        14, 6,
      ],
      'line-opacity': 0.98,
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  });

  map.addLayer({
    id: 'geo-point-layer',
    type: 'circle',
    source: sourceId,
    filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
    paint: {
      'circle-color': DEFAULT_COLORS.point,
      'circle-radius': defaultPointRadiusExpression(),
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  });

  map.addLayer({
    id: 'geo-selected-fill-layer',
    type: 'fill',
    source: sourceId,
    filter: ['==', 1, 0],
    paint: {
      'fill-color': SELECTED_COLOR,
      'fill-opacity': 0.22,
    },
  });

  map.addLayer({
    id: 'geo-selected-outline-layer',
    type: 'line',
    source: sourceId,
    filter: ['==', 1, 0],
    paint: {
      'line-color': SELECTED_COLOR,
      'line-width': 4,
      'line-opacity': 1,
    },
  });

  map.addLayer({
    id: 'geo-selected-line-layer',
    type: 'line',
    source: sourceId,
    filter: ['==', 1, 0],
    paint: {
      'line-color': SELECTED_COLOR,
      'line-width': 7,
      'line-opacity': 1,
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  });

  map.addLayer({
    id: 'geo-selected-point-layer',
    type: 'circle',
    source: sourceId,
    filter: ['==', 1, 0],
    paint: {
      'circle-color': SELECTED_COLOR,
      'circle-radius': 11,
      'circle-stroke-color': '#1b1f24',
      'circle-stroke-width': 2,
    },
  });
}

function fitGeoBounds(map, bounds) {
  if (!bounds) {
    map.easeTo({ center: [0, 0], zoom: 1, duration: 0 });
    return;
  }

  if (bounds[0] === bounds[2] && bounds[1] === bounds[3]) {
    map.easeTo({
      center: [bounds[0], bounds[1]],
      zoom: 12,
      duration: 0,
    });
    return;
  }

  map.fitBounds(
    [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ],
    {
      padding: 28,
      duration: 0,
      maxZoom: 14,
    }
  );
}

export function unmountGeoPreview(container) {
  const cleanup = container?._geoPreviewCleanup;
  if (typeof cleanup === 'function') {
    cleanup();
  }
  if (typeof container?._geoPreviewReleaseHover === 'function') {
    container._geoPreviewReleaseHover();
    delete container._geoPreviewReleaseHover;
  }
  if (container && container._geoPreviewMap) {
    delete container._geoPreviewMap;
  }
  if (container && container._geoPreviewCleanup) {
    delete container._geoPreviewCleanup;
  }
  if (container && container._geoPreviewFeatureIndex) {
    delete container._geoPreviewFeatureIndex;
  }
  if (container && container._geoPreviewFieldProfiles) {
    delete container._geoPreviewFieldProfiles;
  }
  if (container && container._geoPreviewSelectedFeatureId) {
    delete container._geoPreviewSelectedFeatureId;
  }
  if (container && container._geoPreviewBounds) {
    delete container._geoPreviewBounds;
  }
  if (container && container._geoPreviewBasemap) {
    delete container._geoPreviewBasemap;
  }
  if (container && container._geoPreviewStyle) {
    delete container._geoPreviewStyle;
  }
}

export function resizeGeoPreview(container) {
  const map = container?._geoPreviewMap;
  if (map && typeof map.resize === 'function') {
    map.resize();
  }
}

export async function mountGeoPreview({
  container,
  mapElement,
  statusElement,
  geojson,
  bounds,
  basemap = DEFAULT_BASEMAP,
  fieldProfiles = null,
  onFeatureSelect = null,
}) {
  if (!container || !mapElement || !geojson) return { ok: false, error: 'Missing map target' };

  unmountGeoPreview(container);

  if (statusElement) {
    statusElement.textContent = 'Loading map renderer...';
  }

  try {
    const maplibregl = await ensureMapLibre();

    if (!container.isConnected || !container.contains(mapElement)) {
      return { ok: false, error: 'Map container was detached before render' };
    }

    const map = new maplibregl.Map({
      container: mapElement,
      style: buildMapStyle(basemap),
      center: [0, 0],
      zoom: 1,
      attributionControl: true,
    });

    map.on('load', () => {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: geojson,
      });
      addGeoLayers(map, SOURCE_ID);
      setGeoBasemap(container, container._geoPreviewBasemap || basemap);
      const releaseHoverBindings = bindFeatureHover(map, maplibregl, (fid, feature) => {
        selectGeoFeature(container, fid, { fit: false });
        if (onFeatureSelect) onFeatureSelect(fid, feature);
      });
      applyGeoThematicStyle(container, container._geoPreviewStyle || {});
      setSelectedFeatureFilter(map, container._geoPreviewSelectedFeatureId || null);
      fitGeoBounds(map, bounds);
      map.resize();
      if (statusElement) {
        statusElement.classList.add('hidden');
      }

      container._geoPreviewReleaseHover = releaseHoverBindings;
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    const resizeTimer = setTimeout(() => map.resize(), 120);
    container._geoPreviewMap = map;
    container._geoPreviewBasemap = BASEMAPS[container._geoPreviewBasemap]
      ? container._geoPreviewBasemap
      : (BASEMAPS[basemap] ? basemap : DEFAULT_BASEMAP);
    container._geoPreviewFieldProfiles = fieldProfiles;
    container._geoPreviewBounds = bounds || null;
    container._geoPreviewFeatureIndex = new Map(
      (geojson.features || [])
        .map((feature) => [getFeatureId(feature), feature])
        .filter(([fid]) => !!fid)
    );

    const cleanup = () => {
      clearTimeout(resizeTimer);
      if (typeof container._geoPreviewReleaseHover === 'function') {
        container._geoPreviewReleaseHover();
        delete container._geoPreviewReleaseHover;
      }
      try {
        map.remove();
      } catch {}
      if (container._geoPreviewMap === map) {
        delete container._geoPreviewMap;
      }
    };

    container._geoPreviewCleanup = cleanup;

    return { ok: true };
  } catch (err) {
    if (statusElement) {
      statusElement.textContent = `Unable to load map preview: ${err.message || 'unknown error'}`;
      statusElement.classList.remove('hidden');
      statusElement.classList.add('error');
    }

    return {
      ok: false,
      error: err.message || 'Failed to initialize map preview',
    };
  }
}
