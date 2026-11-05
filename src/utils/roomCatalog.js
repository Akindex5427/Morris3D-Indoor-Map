// Individual floor exports are authoritative for search and single-floor display.
// The combined export remains the F-ALL rendering source.
export const FLOOR_POLYGON_MAP = Object.freeze({
  '-1': '/rooms-basement-WGS.geojson',
  0: '/rooms-basement-WGS.geojson',
  1: '/rooms-level-01-WGS.geojson',
  2: '/rooms-level-02-WGS.geojson',
  3: '/rooms-level-03-WGS.geojson',
  4: '/rooms-level-04-WGS.geojson',
  5: '/rooms-level-5-WGS.geojson',
  6: '/rooms-level-6-WGS.geojson',
  7: '/rooms-level-7-WGS.geojson',
  all: '/rooms-all-WGS-v6.geojson',
});
export const ROOM_FLOORS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]);
// Ordered physical floors, not arithmetic on IDs (which may become nonconsecutive).
export function adjacentRoomFloors(floor, floorOrder = ROOM_FLOORS) {
  const index = floorOrder.indexOf(Number(floor));
  if (index < 0) throw new Error("Reference floor is not in the building floor configuration");
  return { above: floorOrder[index + 1] ?? null, below: floorOrder[index - 1] ?? null };
}
const NAME_FIELDS = ['name', 'roomname'];
const ID_FIELDS = ['room_id', 'id', 'number', 'OBJECTID', 'FID', 'FID_'];
const scalar = value => typeof value === 'string' ? value.trim()
  : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
export const normalizeSearchText = value => scalar(value).normalize('NFKD')
  .replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

export function roomIdentifiers(feature) {
  const props = feature?.properties || {};
  const identifiers = ID_FIELDS.flatMap(field => scalar(props[field]) ? [{ field, value: scalar(props[field]) }] : []);
  if (scalar(feature?.id)) identifiers.push({ field: 'feature.id', value: scalar(feature.id) });
  return identifiers;
}

export function roomName(feature) {
  return NAME_FIELDS.map(field => scalar(feature?.properties?.[field])).find(Boolean) || '';
}

function validGeometry(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
  return Array.isArray(polygons) && polygons.length > 0 && polygons.every(polygon =>
    Array.isArray(polygon) && polygon.length > 0 && polygon.every(ring => {
      if (!Array.isArray(ring) || ring.length < 4 || !ring.every(point =>
        Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
        Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)) return false;
      const first = ring[0], last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) return false;
      // Translate before summing to avoid cancellation at geographic magnitudes.
      const area = ring.slice(1).reduce((sum, point, i) => sum +
        (ring[i][0] - first[0]) * (point[1] - first[1]) -
        (point[0] - first[0]) * (ring[i][1] - first[1]), 0);
      return Math.abs(area) > 0;
    }));
}

export function buildFloorCatalog(data, floor, source = FLOOR_POLYGON_MAP[floor]) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error(`Invalid room FeatureCollection for F${floor}`);
  }
  const identities = data.features.map(feature => {
    const ids = roomIdentifiers(feature);
    // Prefer export identity to a semantic identifier that may repeat.
    const id = ['OBJECTID', 'FID', 'FID_', 'feature.id', 'room_id', 'id', 'number']
      .map(field => ids.find(item => item.field === field)).find(Boolean);
    return id ? `${id.field}:${id.value}` : null;
  });
  const counts = new Map();
  identities.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
  const entries = [], excluded = [];
  let unnamed = 0;
  const features = data.features.map((feature, index) => {
    const identity = identities[index];
    // Row suffix is internal provenance, never presented as a source room ID.
    const key = `${source}#F${floor}:${identity || 'row'}${!identity || counts.get(identity) > 1 ? `:${index}` : ''}`;
    const annotated = { ...feature, properties: { ...feature?.properties, floor, __roomSearchKey: key } };
    const name = roomName(feature), identifiers = roomIdentifiers(feature);
    if (!name) unnamed++;
    const reasons = [];
    if (!name && identifiers.length === 0) reasons.push('missing usable name and identifier');
    if (!validGeometry(feature?.geometry)) reasons.push('missing or invalid polygon geometry');
    if (reasons.length) excluded.push({ floor, source, index, identifiers, reasons });
    else {
      const label = name || `${identifiers[0].field} ${identifiers[0].value}`;
      const terms = [...NAME_FIELDS.map(field => feature?.properties?.[field]), ...identifiers.map(id => id.value)]
        .map(normalizeSearchText).filter(Boolean);
      entries.push({ key, floor, source, index, name, label, identifiers, terms, feature: annotated });
    }
    return annotated;
  });
  return { data: { ...data, features }, entries,
    summary: { floor, source, total: features.length, searchable: entries.length, unnamed,
      identifierOnly: entries.filter(entry => !entry.name).length, excludedCount: excluded.length, excluded } };
}

export function searchRooms(entries, query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const compact = normalized.replace(/ /g, '');
  const tokens = normalized.split(' ');
  return entries.map(entry => {
    const score = entry.terms.some(term => term === normalized) ? 0
      : entry.terms.some(term => term.replace(/ /g, '') === compact) ? 1
      : entry.terms.some(term => term.includes(normalized)) ? 2
      : entry.terms.some(term => term.replace(/ /g, '').includes(compact)) ? 3
      : tokens.every(token => entry.terms.some(term => term.includes(token))) ? 4 : Infinity;
    return { entry, score };
  }).filter(result => Number.isFinite(result.score))
    .sort((a, b) => a.score - b.score || a.entry.floor - b.entry.floor ||
      a.entry.label.localeCompare(b.entry.label) || a.entry.index - b.entry.index)
    .map(result => result.entry);
}

// One published snapshot per completed source. Display, search and routing share
// these promises; a late response cannot overwrite a newer explicit reload.
export function createRoomCatalogStore(fetcher = (...args) => fetch(...args)) {
  const floors = new Map(), pending = new Map(), errors = new Map(), versions = new Map(), listeners = new Set();
  let snapshot;
  const publish = () => {
    snapshot = { entries: ROOM_FLOORS.flatMap(floor => floors.get(floor)?.entries || []),
      summaries: ROOM_FLOORS.flatMap(floor => floors.get(floor)?.summary || []),
      loadedFloors: ROOM_FLOORS.filter(floor => floors.has(floor)),
      loadingFloors: [...pending.keys()], errors: [...errors].map(([floor, error]) => ({ floor, message: error.message })),
      datasets: Object.fromEntries([...floors].map(([floor, result]) => [floor, result.data])) };
    listeners.forEach(listener => listener());
  };
  publish();
  const loadFloor = (requested, { reload = false } = {}) => {
    const floor = Number(requested) === -1 ? 0 : Number(requested);
    if (!ROOM_FLOORS.includes(floor)) return Promise.reject(new Error('Unsupported room floor'));
    if (!reload && pending.has(floor)) return pending.get(floor);
    if (!reload && floors.has(floor)) return Promise.resolve(floors.get(floor).data);
    const version = (versions.get(floor) || 0) + 1;
    versions.set(floor, version);
    errors.delete(floor);
    const promise = Promise.resolve().then(async () => {
      const response = await fetcher(FLOOR_POLYGON_MAP[floor]);
      if (!response.ok) throw new Error(`Unable to load F${floor} rooms`);
      const result = buildFloorCatalog(await response.json(), floor);
      if (versions.get(floor) === version) floors.set(floor, result);
      return result.data;
    }).catch(error => {
      if (versions.get(floor) === version) errors.set(floor, error);
      throw error;
    }).finally(() => {
      if (versions.get(floor) === version) { pending.delete(floor); publish(); }
    });
    pending.set(floor, promise);
    publish();
    return promise;
  };
  return { loadFloor, loadAll: () => Promise.allSettled(ROOM_FLOORS.map(floor => loadFloor(floor))),
    getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
}

export const roomCatalogStore = createRoomCatalogStore();

// Search identity is separate from the routing engine's legacy name-based IDs.
export const isHighlightedRoom = (props, selected) => selected != null &&
  (props.__roomSearchKey ? props.__roomSearchKey === selected : props.__displayFeatureKey ? props.__displayFeatureKey === selected :
    (props.id || props.name || props.room_id || props.OBJECTID || null) === selected);
