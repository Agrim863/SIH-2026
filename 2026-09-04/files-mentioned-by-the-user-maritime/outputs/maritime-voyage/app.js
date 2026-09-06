import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/** Real-world vector basemap (OpenStreetMap via OpenFreeMap) — works with MapLibre globe */
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';

const PALETTE = {
  background: '#06131D',
  ocean: '#082638',
  land: '#17252D',
  borders: '#31434B',
  route: '#F4C542',
  port: '#65D9DD',
  destination: '#F4C542'
};

const COUNTRY_CODE = { India: 'IN', Australia: 'AU' };

/** Real port coordinates (WGS84) + mocked berth limits */
const ports = [
  ['Paradip', 'India', 20.2644, 86.6729, 14.5, 290, 45],
  ['Visakhapatnam', 'India', 17.6868, 83.2185, 16.0, 300, 50],
  ['Gangavaram', 'India', 17.6167, 83.2333, 21.0, 320, 55],
  ['Dhamra', 'India', 20.8217, 86.9625, 18.0, 290, 45],
  ['Gladstone', 'Australia', -23.8416, 151.2500, 16.1, 300, 50],
  ['Newcastle', 'Australia', -32.9267, 151.7817, 14.5, 250, 40]
].map(([name, country, lat, lng, maxDraft, maxLOA, maxBeam]) => ({
  name, country, lat, lng, maxDraft, maxLOA, maxBeam, code: COUNTRY_CODE[country] || country.slice(0, 2).toUpperCase()
}));

const vesselTypes = [
  ['handysize', 'Handysize', 10.2, 180, 28, 24],
  ['supramax', 'Supramax', 13, 200, 32, 34],
  ['panamax', 'Panamax', 13.8, 225, 32.3, 46],
  ['capesize', 'Capesize', 18, 290, 45, 62]
].map(([id, name, draft, loa, beam, scale]) => ({ id, name, draft, loa, beam, scale }));

/** Geographic offsets — vessels stand side-by-side just offshore of origin */
const VESSEL_OFFSETS = {
  handysize: { lng: -0.28, lat: -0.18 },
  supramax: { lng: -0.09, lat: -0.18 },
  panamax: { lng: 0.1, lat: -0.18 },
  capesize: { lng: 0.32, lat: -0.18 }
};

/** Camera / route timing (ms) — slowed for readable motion */
const TIMING = {
  flyToPort: 2100, // was 1400; +0.7s
  voyageOverview: 2200,
  routeReveal: 2600, // progressive LineString draw (~+1s)
  afterRouteSettle: 500,
  shipEmergeStagger: 180
};

const MOCK_VESSELS = {
  handysize: [
    { name: 'MV Coastal Pearl', dwt: 35000, loa: 178, draft: 10.0, rate: 16.8 },
    { name: 'MV Bay Runner', dwt: 38000, loa: 180, draft: 10.1, rate: 17.1 },
    { name: 'MV Harbour Light', dwt: 32000, loa: 175, draft: 9.8, rate: 16.4 }
  ],
  supramax: [
    { name: 'MV Ocean Trader', dwt: 58000, loa: 190, draft: 12.8, rate: 17.6 },
    { name: 'MV Pacific Star', dwt: 56000, loa: 189, draft: 12.6, rate: 17.9 },
    { name: 'MV Eastern Wind', dwt: 61000, loa: 199, draft: 12.9, rate: 18.2 }
  ],
  panamax: [
    { name: 'MV Meridian Bulk', dwt: 75000, loa: 225, draft: 13.2, rate: 18.4 },
    { name: 'MV Coral Bridge', dwt: 78000, loa: 225, draft: 13.5, rate: 18.9 },
    { name: 'MV Southern Cross', dwt: 74000, loa: 222, draft: 13.1, rate: 18.6 }
  ],
  capesize: [
    { name: 'MV Iron Giant', dwt: 180000, loa: 289, draft: 17.8, rate: 19.5 },
    { name: 'MV Cape Horizon', dwt: 175000, loa: 288, draft: 17.5, rate: 19.8 },
    { name: 'MV Ore Pathfinder', dwt: 182000, loa: 290, draft: 18.0, rate: 20.1 }
  ]
};

const state = {
  origin: null,
  destination: null,
  cargo: null,
  route: null,
  routeAnimationComplete: false,
  selectedVesselType: null,
  selectedVessel: null
};

let map = null;
let portMarkers = [];
let vesselMarkers = [];
let animFrame = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function flash(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function setPaint(id, prop, value) {
  if (!map?.getLayer(id)) return;
  try {
    map.setPaintProperty(id, prop, value);
  } catch {
    /* unsupported on this layer */
  }
}

function setLayout(id, prop, value) {
  if (!map?.getLayer(id)) return;
  try {
    map.setLayoutProperty(id, prop, value);
  } catch {
    /* unsupported */
  }
}

function applyMeridianStyle() {
  if (!map) return;

  // OpenFreeMap dark: background ≈ land, water is a fill over real coastlines
  setPaint('background', 'background-color', PALETTE.land);
  setPaint('water', 'fill-color', PALETTE.ocean);
  setPaint('waterway', 'line-color', '#0a3a4e');

  for (const id of [
    'landcover_ice_shelf',
    'landcover_glacier',
    'landuse_residential',
    'landcover_wood',
    'landuse_park',
    'building'
  ]) {
    setPaint(id, 'fill-color', PALETTE.land);
    setPaint(id, 'fill-opacity', 0.85);
  }

  for (const id of ['boundary_state', 'boundary_country_z0-4', 'boundary_country_z5-']) {
    setPaint(id, 'line-color', PALETTE.borders);
    setPaint(id, 'line-opacity', 0.55);
  }

  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    const id = layer.id;
    if (
      layer.type === 'line' &&
      (id.includes('highway') || id.includes('railway') || id.includes('aeroway') || id.includes('road'))
    ) {
      setPaint(id, 'line-opacity', 0.1);
      setPaint(id, 'line-color', PALETTE.borders);
    }
  }

  // Zoom-aware labels: continents/countries when zoomed out; cities only when closer
  declutterPlaceLabels();
}

/** Hide dense local names; reveal detail only as the camera zooms in */
function declutterPlaceLabels() {
  if (!map) return;

  // Hide noisy local / water labels entirely for this product UI
  for (const id of [
    'place_other',
    'place_suburb',
    'place_village',
    'water_name',
    'highway_name_other',
    'highway_name_motorway',
    'road_oneway',
    'road_oneway_opposite'
  ]) {
    setLayout(id, 'visibility', 'none');
  }

  // Progressive place hierarchy (minzoom → maxzoom)
  const ranges = {
    place_country_major: [0, 5],
    place_country_minor: [1.5, 6],
    place_country_other: [2, 6],
    place_state: [4, 8],
    place_city_large: [4.5, 10],
    place_city: [5.5, 11],
    place_town: [7, 12]
  };

  for (const [id, [minZ, maxZ]] of Object.entries(ranges)) {
    if (!map.getLayer(id)) continue;
    try {
      map.setLayerZoomRange(id, minZ, maxZ);
      setLayout(id, 'visibility', 'visible');
      setPaint(id, 'text-color', '#8aa3ad');
      setPaint(id, 'text-halo-color', PALETTE.land);
      setPaint(id, 'text-halo-width', 1.2);
      setPaint(id, 'text-opacity', 0.85);
    } catch {
      /* ignore */
    }
  }
}

function mapInit() {
  const container = document.getElementById('map2d');
  if (!container) {
    flash('Map container missing');
    return;
  }

  map = new maplibregl.Map({
    container: 'map2d',
    style: MAP_STYLE,
    center: [112, 5],
    zoom: 2.8,
    minZoom: 0.8,
    maxZoom: 12,
    renderWorldCopies: false,
    attributionControl: { compact: true },
    canvasContextAttributes: { antialias: true }
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

  map.on('error', (e) => {
    console.error('MapLibre error', e?.error || e);
  });

  map.on('load', () => {
    applyMeridianStyle();
    map.resize();
    // Default to mercator; globe is applied when user toggles 3D
    if (typeof map.setProjection === 'function') {
      map.setProjection({ type: 'mercator' });
    }
  });

  map.on('style.load', () => {
    applyMeridianStyle();
    // Re-apply projection after style reload (required for globe)
    const mode = $('#app')?.dataset.mode || '2d';
    applyProjection(mode === '3d' ? 'globe' : 'mercator', false);
  });
}

function applyProjection(type, animate = true) {
  if (!map || typeof map.setProjection !== 'function') {
    flash('Globe projection requires MapLibre 5+');
    return;
  }

  map.setProjection({ type });

  if (type === 'globe') {
    // MapLibre 5+: atmosphere uses setSky (setFog was removed)
    if (typeof map.setSky === 'function') {
      map.setSky({
        'sky-color': '#06131D',
        'sky-horizon-blend': 0.12,
        'horizon-color': '#0c3a52',
        'horizon-fog-blend': 0.08,
        'fog-color': '#06131D',
        'fog-ground-blend': 0.4,
        'atmosphere-blend': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0,
          0.8,
          5,
          0.3,
          7,
          0
        ]
      });
    }
    if (animate) {
      map.easeTo({
        zoom: Math.min(map.getZoom(), 2.4),
        pitch: 0,
        bearing: 0,
        duration: 900
      });
    }
  } else if (typeof map.setSky === 'function') {
    map.setSky(undefined);
    if (animate) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
    }
  } else if (animate) {
    map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
  }

  requestAnimationFrame(() => map.resize());
}

function distanceNm(coords) {
  let n = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const p = Math.PI / 180;
    const x =
      Math.sin(((b[1] - a[1]) * p) / 2) ** 2 +
      Math.cos(a[1] * p) * Math.cos(b[1] * p) * Math.sin(((b[0] - a[0]) * p) / 2) ** 2;
    n += 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  return Math.round(n / 1.852);
}

function clearRouteLayers() {
  if (!map) return;
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
  for (const id of ['sea-route', 'sea-route-glow']) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource('sea-route')) map.removeSource('sea-route');
}

function clearPortMarkers() {
  portMarkers.forEach((m) => m.remove());
  portMarkers = [];
}

function clearVesselMarkers() {
  vesselMarkers.forEach((m) => m.remove());
  vesselMarkers = [];
  const ships = $('#ships');
  if (ships) {
    ships.classList.add('hidden');
    ships.innerHTML = '';
  }
}

function resetVoyageDownstream() {
  state.cargo = null;
  state.route = null;
  state.routeAnimationComplete = false;
  state.selectedVesselType = null;
  state.selectedVessel = null;
  clearRouteLayers();
  clearVesselMarkers();
  $('#intelligence')?.classList.add('hidden');
  $('#vessel-dock')?.classList.add('hidden');
  $('#cargo-step')?.classList.add('hidden');
  $('#planner')?.classList.remove('hidden');
}

function portMarker(port, kind) {
  if (!map) return;
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `geo-marker ${kind} pulse-in`;
  el.innerHTML = `<span class="marker-core"></span><b>${port.name} · ${port.code}</b><small>${kind.toUpperCase()}</small>`;
  const m = new maplibregl.Marker({ element: el, anchor: 'bottom' })
    .setLngLat([port.lng, port.lat])
    .addTo(map);
  portMarkers.push(m);
}

function renderPorts() {
  if (!map) return;
  clearPortMarkers();
  if (state.origin) portMarker(state.origin, 'origin');
  if (state.destination) portMarker(state.destination, 'destination');
}

function addRouteLayers(geojson) {
  clearRouteLayers();
  map.addSource('sea-route', { type: 'geojson', data: geojson });
  map.addLayer({
    id: 'sea-route-glow',
    type: 'line',
    source: 'sea-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': PALETTE.route,
      'line-width': 8,
      'line-blur': 4,
      'line-opacity': 0.35
    }
  });
  map.addLayer({
    id: 'sea-route',
    type: 'line',
    source: 'sea-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': PALETTE.route,
      'line-width': 2.5,
      'line-opacity': 0.98
    }
  });
}

function fitVoyageOverview(duration = 1400) {
  if (!map || !state.origin || !state.destination) return;
  const bounds = new maplibregl.LngLatBounds(
    [state.origin.lng, state.origin.lat],
    [state.origin.lng, state.origin.lat]
  );
  bounds.extend([state.destination.lng, state.destination.lat]);
  if (state.route?.geometry?.coordinates) {
    for (const c of state.route.geometry.coordinates) bounds.extend(c);
  }
  map.fitBounds(bounds, {
    padding: { top: 110, bottom: 260, left: 340, right: 340 },
    duration,
    maxZoom: 4.8
  });
}

function flyToPort(port, zoom = 5.6) {
  if (!map) return Promise.resolve();
  return new Promise((resolve) => {
    map.flyTo({
      center: [port.lng, port.lat],
      zoom,
      duration: TIMING.flyToPort,
      essential: true,
      curve: 1.2,
      speed: 0.6
    });
    map.once('moveend', () => resolve());
  });
}

function options(kind, query = '') {
  const q = query.toLowerCase();
  return ports
    .filter((p) => {
      if (p === state.origin || p === state.destination) return false;
      if (kind === 'destination' && state.origin && p.country === state.origin.country) return false;
      if (kind === 'origin' && state.destination && p.country === state.destination.country) return false;
      return p.name.toLowerCase().includes(q);
    })
    .map(
      (p) =>
        `<button type="button" data-${kind}="${p.name}"><b>${p.name}</b><small>${p.country} · ${p.lat.toFixed(2)}°, ${p.lng.toFixed(2)}°</small></button>`
    )
    .join('');
}

function wireResults(kind) {
  $$(`[data-${kind}]`).forEach((b) => {
    b.onclick = () => selectPort(kind, b.dataset[kind]);
  });
}

function confirmedPortHtml(port) {
  return `<div class="selected-port"><b>✓ ${port.name}</b><small>${port.country} · ${port.code} · ${port.lat.toFixed(2)}°, ${port.lng.toFixed(2)}°</small></div>`;
}

function drawSearches() {
  const originEl = $('#origin-results');
  const destEl = $('#destination-results');

  if (state.origin) {
    originEl.innerHTML = confirmedPortHtml(state.origin);
    $('#origin-search').classList.add('hidden');
    $('#origin-step .step-dot').classList.remove('active');
    $('#origin-step .step-dot').classList.add('done');
    $('#origin-step .step-dot').textContent = '✓';
  } else {
    originEl.innerHTML = options('origin', $('#origin-search').value);
    $('#origin-search').classList.remove('hidden');
    wireResults('origin');
  }

  if (state.destination) {
    destEl.innerHTML = confirmedPortHtml(state.destination);
    $('#destination-search').classList.add('hidden');
    $('#destination-step .step-dot').classList.remove('active');
    $('#destination-step .step-dot').classList.add('done');
    $('#destination-step .step-dot').textContent = '✓';
  } else if (!$('#destination-step').classList.contains('hidden')) {
    destEl.innerHTML = options('destination', $('#destination-search').value);
    $('#destination-search').classList.remove('hidden');
    wireResults('destination');
  }
}

async function selectPort(kind, name) {
  const port = ports.find((p) => p.name === name);
  if (!port) return;

  if (kind === 'origin') {
    const originChanged = state.origin && state.origin.name !== port.name;
    state.origin = port;
    if (originChanged) resetVoyageDownstream();
    if (state.destination && state.destination.country === port.country) {
      state.destination = null;
      resetVoyageDownstream();
    }

    $('#welcome').classList.add('hidden');
    $('#planner').classList.remove('hidden');
    $('#origin-step').classList.remove('hidden');
    $('#destination-step').classList.remove('hidden');
    if (!state.destination) $('#cargo-step').classList.add('hidden');
    drawSearches();
    renderPorts();
    clearVesselMarkers();
    await flyToPort(port, 5.5);
    $('#destination-search')?.focus();
  } else {
    if (state.destination && state.destination.name !== port.name) {
      resetVoyageDownstream();
    }
    state.destination = port;
    state.cargo = null;
    state.route = null;
    state.routeAnimationComplete = false;
    state.selectedVesselType = null;
    state.selectedVessel = null;
    clearRouteLayers();
    clearVesselMarkers();
    $('#intelligence')?.classList.add('hidden');
    $('#vessel-dock')?.classList.add('hidden');

    $('#planner').classList.remove('hidden');
    $('#destination-step').classList.remove('hidden');
    $('#cargo-step').classList.remove('hidden');
    const cargoDot = $('#cargo-step .step-dot');
    cargoDot.classList.add('active');
    cargoDot.classList.remove('done');
    cargoDot.textContent = '3';
    drawSearches();
    renderPorts();
    await flyToPort(port, 5.5);
    fitVoyageOverview(TIMING.voyageOverview);
    flash('Destination confirmed — select cargo to calculate voyage');
  }
}

function constrainingPorts() {
  return [state.origin, state.destination].filter(Boolean).map((port) => {
    // Prototype: slightly tighter destination limits so 1–2 classes gray out with clear reasons
    if (state.destination && port.name === state.destination.name) {
      return {
        ...port,
        maxDraft: Math.min(port.maxDraft, 14.0),
        maxLOA: Math.min(port.maxLOA, 220)
      };
    }
    return port;
  });
}

function compatibilityIssues(vessel) {
  const issues = [];
  for (const port of constrainingPorts()) {
    if (vessel.draft > port.maxDraft) {
      issues.push({
        port: port.name,
        metric: 'Draft',
        value: vessel.draft,
        limit: port.maxDraft,
        message: `Draft ${vessel.draft.toFixed(1)} m exceeds ${port.name} limit ${port.maxDraft.toFixed(1)} m`
      });
    }
    if (vessel.loa > port.maxLOA) {
      issues.push({
        port: port.name,
        metric: 'LOA',
        value: vessel.loa,
        limit: port.maxLOA,
        message: `LOA ${vessel.loa.toFixed(1)} m exceeds ${port.name} berth limit ${port.maxLOA.toFixed(1)} m`
      });
    }
    if (vessel.beam > port.maxBeam) {
      issues.push({
        port: port.name,
        metric: 'Beam',
        value: vessel.beam,
        limit: port.maxBeam,
        message: `Beam ${vessel.beam.toFixed(1)} m exceeds ${port.name} limit ${port.maxBeam.toFixed(1)} m`
      });
    }
  }
  return issues;
}

function compatible(vessel) {
  return compatibilityIssues(vessel).length === 0;
}

function issueSummary(vessel) {
  const issues = compatibilityIssues(vessel);
  return issues[0]?.message || 'Incompatible';
}

function animateRoute() {
  if (!map || !state.route) return;
  const all = state.route.geometry.coordinates;
  const source = map.getSource('sea-route');
  if (!source) return;

  const start = performance.now();
  const duration = TIMING.routeReveal;

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    // Ease-out so the end of the voyage settles gently
    const eased = 1 - (1 - t) ** 2;
    const i = Math.max(2, Math.ceil(eased * all.length));
    source.setData({
      type: 'Feature',
      properties: state.route.properties || {},
      geometry: { type: 'LineString', coordinates: all.slice(0, i) }
    });
    if (t < 1) {
      animFrame = requestAnimationFrame(frame);
    } else {
      animFrame = null;
      onRouteAnimationComplete();
    }
  }

  animFrame = requestAnimationFrame(frame);
}

async function onRouteAnimationComplete() {
  state.routeAnimationComplete = true;
  flash('Voyage route complete — opening origin for vessel classes');
  if (state.origin && map) {
    await flyToPort(state.origin, 6.2);
  }
  drawShips();
  drawAnalysis();
  flash('Select a vessel class at origin');
}

/**
 * Water-only path from precomputed ocean A* routes (never chords across land).
 * Generated offline with @arcnautical/maritime-routing — see scripts/generate-routes.mjs
 */
async function buildWaterOnlyRoute(origin, destination) {
  const key = `${origin.name}->${destination.name}`;
  const reverseKey = `${destination.name}->${origin.name}`;

  const response = await fetch('/maritime-routes.json');
  if (!response.ok) throw new Error('Maritime route catalog missing');
  const catalog = await response.json();

  let feature = catalog[key];
  if (!feature && catalog[reverseKey]) {
    const coords = catalog[reverseKey].geometry.coordinates.slice().reverse();
    feature = {
      type: 'Feature',
      properties: { ...catalog[reverseKey].properties, pair: key },
      geometry: { type: 'LineString', coordinates: coords }
    };
  }
  if (!feature?.geometry?.coordinates?.length) {
    throw new Error(`No water route for ${key}`);
  }

  const coordinates = feature.geometry.coordinates.map((c) => [c[0], c[1]]);
  coordinates[0] = [origin.lng, origin.lat];
  coordinates[coordinates.length - 1] = [destination.lng, destination.lat];

  return {
    type: 'Feature',
    properties: { ...(feature.properties || {}), pair: key },
    geometry: { type: 'LineString', coordinates }
  };
}

async function calculateMaritimeRoute() {
  if (!state.origin || !state.destination || !state.cargo) return;

  clearRouteLayers();
  state.route = null;
  state.routeAnimationComplete = false;
  clearVesselMarkers();

  try {
    const feature = await buildWaterOnlyRoute(state.origin, state.destination);
    state.route = feature;
    const coords = feature.geometry.coordinates;

    if (!map) {
      state.routeAnimationComplete = true;
      drawShips();
      drawAnalysis();
      return;
    }

    const empty = {
      type: 'Feature',
      properties: feature.properties || {},
      geometry: { type: 'LineString', coordinates: coords.slice(0, 2) }
    };
    addRouteLayers(empty);
    fitVoyageOverview(TIMING.voyageOverview);
    setTimeout(() => animateRoute(), TIMING.afterRouteSettle);
  } catch (err) {
    console.error(err);
    flash('Unable to calculate the maritime route');
  }
}

function shipModelHtml(vessel, ok) {
  const size = vessel.scale;
  return `
    <div class="ship-3d" style="--ship-w:${size}px">
      <div class="ship-3d-hull"></div>
      <div class="ship-3d-super"></div>
      <div class="ship-3d-bridge"></div>
    </div>
    <b>${vessel.name}</b>
    <small>${ok ? vessel.draft + 'm draft · compatible' : '✕ ' + issueSummary(vessel)}</small>
  `;
}

function drawShips() {
  if (!state.routeAnimationComplete || !state.origin) return;

  clearVesselMarkers();
  const shipsEl = $('#ships');
  shipsEl.classList.remove('hidden');
  shipsEl.innerHTML = '';

  vesselTypes.forEach((v, index) => {
    const ok = compatible(v);
    const offset = VESSEL_OFFSETS[v.id] || { lng: 0, lat: 0 };
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `ship-geo ship-marker ship-lineup ${ok ? '' : 'disabled'} ${state.selectedVesselType === v.id ? 'selected' : ''}`;
    el.dataset.vessel = v.id;
    el.style.animationDelay = `${index * TIMING.shipEmergeStagger}ms`;
    el.title = ok ? `${v.name} · ${v.draft}m draft` : issueSummary(v);
    el.innerHTML = shipModelHtml(v, ok);

    if (ok) {
      el.onclick = () => selectVesselType(v.id);
    }

    if (map) {
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([state.origin.lng + offset.lng, state.origin.lat + offset.lat])
        .addTo(map);
      vesselMarkers.push(marker);
    } else {
      shipsEl.appendChild(el);
    }
  });
}

function selectVesselType(id) {
  state.selectedVesselType = id;
  state.selectedVessel = null;
  drawShips();
  drawAnalysis();
  drawDrawer();
  flash(`${vesselTypes.find((v) => v.id === id).name} selected`);
}

function drawAnalysis() {
  if (!(state.route && state.cargo && state.routeAnimationComplete)) return;
  const nm = distanceNm(state.route.geometry.coordinates);
  const rate = 17.2 + nm / 7000 + (state.cargo === 'ironOre' ? 0.4 : 0);
  const type = vesselTypes.find((v) => v.id === state.selectedVesselType) || vesselTypes[2];
  const cargoLabel =
    state.cargo === 'ironOre' ? 'IRON ORE' : state.cargo === 'thermalCoal' ? 'THERMAL COAL' : 'LIMESTONE';

  $('#intelligence').classList.remove('hidden');
  $('#intel-title').innerHTML = `<small>${type.name.toUpperCase()} · ${cargoLabel}</small>${state.origin.name} <i>→</i> ${state.destination.name}`;
  $('#spot-rate').innerHTML = `$${rate.toFixed(2)} <small>/ MT</small>`;
  $('#forecast-range').textContent = `$${(rate - 0.3).toFixed(2)} – $${(rate + 1.9).toFixed(2)}`;
}

function drawDrawer() {
  if (!state.selectedVesselType) return;
  const type = vesselTypes.find((v) => v.id === state.selectedVesselType);
  const list = MOCK_VESSELS[state.selectedVesselType] || [];

  $('#vessel-dock').classList.remove('hidden');
  $('#dock-class').textContent = type.name;
  $('#vessel-count').textContent = `${list.length} vessels found`;
  $('#vessel-list').innerHTML = list
    .map((v, i) => {
      const active =
        state.selectedVessel?.name === v.name || (!state.selectedVessel && i === 0);
      return `<article class="vessel-card ${active ? 'active' : ''}" data-vessel-name="${v.name}">
        <div class="mini-ship"></div>
        <div class="vessel-info">
          <span>${v.name}</span>
          <b>${v.dwt.toLocaleString()} DWT · ${v.loa}m LOA · ${v.draft}m draft</b>
        </div>
        <div class="vessel-rate"><b>$${v.rate.toFixed(2)}</b><span>/ MT</span></div>
        <button type="button" class="select-vessel" data-select-vessel="${v.name}">${active ? 'Selected ✓' : 'Select'}</button>
      </article>`;
    })
    .join('');

  // Default-select first vessel if none chosen
  if (!state.selectedVessel && list[0]) {
    state.selectedVessel = list[0];
  }

  $$('[data-select-vessel]').forEach((btn) => {
    btn.onclick = () => {
      const name = btn.dataset.selectVessel;
      state.selectedVessel = list.find((v) => v.name === name) || null;
      drawDrawer();
      flash(`${name} selected`);
    };
  });
}

function onCargoSelected(cargoId) {
  state.cargo = cargoId;
  state.route = null;
  state.routeAnimationComplete = false;
  state.selectedVesselType = null;
  state.selectedVessel = null;
  clearVesselMarkers();
  clearRouteLayers();
  $('#intelligence').classList.add('hidden');
  $('#vessel-dock').classList.add('hidden');

  $('#cargo-step .step-dot').classList.remove('active');
  $('#cargo-step .step-dot').classList.add('done');
  $('#cargo-step .step-dot').textContent = '✓';
  $('#planner').classList.add('hidden');

  flash('Cargo selected — calculating maritime route');
  calculateMaritimeRoute();
}

function setMapMode(mode) {
  $$('.mode').forEach((x) => x.classList.toggle('active', x.dataset.mode === mode));
  $('#app').dataset.mode = mode;
  applyProjection(mode === '3d' ? 'globe' : 'mercator', true);
}

// ——— Wire UI ———
$('#welcome-action').onclick = () => {
  $('#welcome').classList.add('hidden');
  $('#origin-search').focus();
};

['origin', 'destination'].forEach((k) => {
  $(`#${k}-search`).oninput = (e) => {
    $(`#${k}-results`).innerHTML = options(k, e.target.value);
    wireResults(k);
  };
});

$$('[data-cargo]').forEach((b) => {
  b.onclick = () => onCargoSelected(b.dataset.cargo);
});

$$('.mode').forEach((b) => {
  b.onclick = () => setMapMode(b.dataset.mode);
});

window.addEventListener('load', () => {
  mapInit();
  drawSearches();
});
