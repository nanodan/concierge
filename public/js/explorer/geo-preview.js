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

const MAP_STYLE = {
  version: 8,
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-base',
      type: 'raster',
      source: 'osm-tiles',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

let mapLibreLoadPromise = null;
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
    ? Object.entries(feature.properties)
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

function bindFeatureHover(map, maplibregl) {
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
      'fill-color': '#2bd4ff',
      'fill-opacity': 0.34,
    },
  });

  map.addLayer({
    id: 'geo-polygon-outline-layer',
    type: 'line',
    source: sourceId,
    filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
    paint: {
      'line-color': '#00b8ff',
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
      'line-color': '#ff4da0',
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
      'circle-color': '#ff4d5a',
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4, 4,
        10, 6.5,
        14, 9,
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
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
      style: MAP_STYLE,
      center: [0, 0],
      zoom: 1,
      attributionControl: true,
    });

    const sourceId = 'geo-preview-source';

    map.on('load', () => {
      map.addSource(sourceId, {
        type: 'geojson',
        data: geojson,
      });
      addGeoLayers(map, sourceId);
      const releaseHoverBindings = bindFeatureHover(map, maplibregl);
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
