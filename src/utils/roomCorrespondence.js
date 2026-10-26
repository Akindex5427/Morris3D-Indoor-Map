import { geoAzimuthalEqualArea } from "d3-geo";
import { intersection } from "polyclip-ts";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader";
import IsValidOp from "jsts/org/locationtech/jts/operation/valid/IsValidOp";
import { correspondenceFloor, correspondenceLabel, exactAuthoritativeMatches } from "./roomCorrespondenceIdentity";

export const EARTH_RADIUS_METERS = 6371008.8;
export const OVERLAP_AREA_EPSILON = 1e-6; // numerical dust only: one square millimetre
const reader = new GeoJSONReader();
const polygonsOf = geometry => geometry?.type === "Polygon" ? [geometry.coordinates]
  : geometry?.type === "MultiPolygon" ? geometry.coordinates : null;
const validXY = p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const geographicPoints = feature => {
  try { return polygonsOf(feature.geometry)?.flat(2).filter(validXY) || []; }
  catch { return []; }
};
const boundsOf = points => points.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const descriptor = row => ({ key: row.key, floor: row.floor, label: row.label, area: row.area });

export function createMetricProjection(origin) {
  return geoAzimuthalEqualArea().rotate([-origin[0], -origin[1]]).scale(EARTH_RADIUS_METERS).translate([0, 0]);
}

function prepare(feature, projection, fallbackKey) {
  const props = feature.properties || {}, floor = correspondenceFloor(feature);
  const key = props.__roomSearchKey || fallbackKey;
  const polygons = polygonsOf(feature.geometry);
  if (!polygons?.length) throw new Error("Missing Polygon/MultiPolygon geometry");
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) throw new Error("Empty polygon");
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4 || !ring.every(validXY)) throw new Error("Invalid geographic ring coordinates");
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new Error("Unclosed polygon ring");
    }
  }
  const coordinates = polygons.map(p => p.map(r => r.map(point => projection(point.slice(0, 2)))));
  const metric = reader.read({ type: "MultiPolygon", coordinates });
  const validity = new IsValidOp(metric);
  if (!validity.isValid()) throw new Error(validity.getValidationError()?.getMessage() || "Invalid polygon topology");
  const area = metric.getArea();
  if (!Number.isFinite(area) || area <= OVERLAP_AREA_EPSILON) throw new Error("Zero or negligible polygon area");
  return { key, floor, label: correspondenceLabel(feature), feature, coordinates, area, bounds: boundsOf(coordinates.flat(2)) };
}

// A per-floor min-X index eliminates candidates to the right, then tests strict
// bounding-box overlap before any polygon clipping. All coordinates are cached.
export function createCorrespondenceIndex(datasets) {
  const started = performance.now();
  const features = [], issues = [], loadedFloors = [];
  for (let floor = 0; floor <= 7; floor++) {
    const data = datasets[floor];
    if (!data) continue;
    const crs = data.crs?.properties?.name;
    if (crs && !/4326|CRS84/i.test(crs)) {
      issues.push({ floor, reason: `Unsupported coordinate reference: ${crs}` }); continue;
    }
    loadedFloors.push(floor);
    (data.features || []).forEach((f, i) => features.push({ ...f, properties: { ...f.properties, floor,
      __roomSearchKey: f.properties?.__roomSearchKey || `F${floor}:row:${i}` } }));
  }
  const points = features.flatMap(geographicPoints);
  const extent = boundsOf(points);
  if (!points.length || extent[2] - extent[0] > 1 || extent[3] - extent[1] > 1) throw new Error("Room coordinates do not form a consistent local geographic extent");
  const origin = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
  const projection = createMetricProjection(origin), rows = new Map(), floors = new Map(), rejected = new Map();
  for (const feature of features) {
    const key = feature.properties.__roomSearchKey, floor = correspondenceFloor(feature);
    try {
      const row = prepare(feature, projection, key);
      rows.set(key, row);
      if (!floors.has(floor)) floors.set(floor, []);
      floors.get(floor).push(row);
    } catch (error) {
      const issue = { key, floor, label: correspondenceLabel(feature), reason: error.message };
      rejected.set(key, issue); issues.push(issue);
    }
  }
  floors.forEach(list => list.sort((a, b) => a.bounds[0] - b.bounds[0]));
  return { rows, floors, rejected, projection, origin, extent, issues, loadedFloors, features,
    cache: new Map(), preparationMs: performance.now() - started };
}

function candidatesIn(index, floor, bounds) {
  const list = index.floors.get(floor) || [];
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (list[mid].bounds[0] < bounds[2]) lo = mid + 1; else hi = mid; }
  return list.slice(0, lo).filter(row => row.bounds[2] > bounds[0] && row.bounds[1] < bounds[3] && row.bounds[3] > bounds[1]);
}

export function intersectRows(reference, candidate) {
  const coordinates = intersection(reference.coordinates, candidate.coordinates);
  if (!coordinates.length) return null;
  const area = reader.read({ type: "MultiPolygon", coordinates }).getArea();
  if (!Number.isFinite(area)) throw new Error("Intersection area is not finite");
  if (area <= OVERLAP_AREA_EPSILON) return null;
  // Clamp only floating-point overshoot; substantial overshoot is an error.
  if (area > Math.min(reference.area, candidate.area) + Math.max(OVERLAP_AREA_EPSILON, area * 1e-8)) throw new Error("Intersection exceeds an input area");
  const intersectionArea = Math.min(area, reference.area, candidate.area);
  return { ...descriptor(candidate), intersectionArea,
    referencePercent: 100 * intersectionArea / reference.area,
    candidatePercent: 100 * intersectionArea / candidate.area };
}

export function analyzeCorrespondence(index, referenceKey) {
  if (index.cache.has(referenceKey)) return { ...index.cache.get(referenceKey), cacheHit: true };
  const reference = index.rows.get(referenceKey);
  if (!reference) throw new Error(index.rejected.get(referenceKey)?.reason || "Reference footprint is unavailable");
  const started = performance.now(), groups = [], errors = [];
  let candidatesTested = 0;
  const targetFloors = Array.from({ length: 8 }, (_, f) => f).filter(f => f !== reference.floor)
    .sort((a, b) => Math.abs(a - reference.floor) - Math.abs(b - reference.floor) || a - b);
  for (const floor of targetFloors) {
    const matches = [], failures = [];
    for (const candidate of candidatesIn(index, floor, reference.bounds)) {
      candidatesTested++;
      try { const result = intersectRows(reference, candidate); if (result) matches.push(result); }
      catch (error) { failures.push({ key: candidate.key, floor, label: candidate.label, reason: error.message }); }
    }
    errors.push(...failures);
    matches.sort((a, b) => b.intersectionArea - a.intersectionArea || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
    groups.push({ floor, direction: floor > reference.floor ? "above" : "below", matches,
      available: index.loadedFloors.includes(floor), skipped: index.issues.filter(issue => issue.floor === floor).length,
      failures: failures.length });
  }
  const result = { status: "ready", reference: descriptor(reference), groups, errors, issues: index.issues,
    candidatesTested, analysisMs: performance.now() - started, preparationMs: index.preparationMs,
    origin: index.origin, cacheHit: false };
  if (index.cache.size >= 100) index.cache.delete(index.cache.keys().next().value);
  index.cache.set(referenceKey, result);
  return result;
}

export function resolveAndAnalyze(index, feature) {
  const key = feature?.properties?.__roomSearchKey;
  if (key) return analyzeCorrespondence(index, key);
  const exact = exactAuthoritativeMatches(feature, index.features);
  if (exact.length === 1) return analyzeCorrespondence(index, exact[0].properties.__roomSearchKey);
  const reference = prepare(feature, index.projection, "combined-selection"), choices = [], failures = [];
  for (const candidate of candidatesIn(index, reference.floor, reference.bounds)) {
    try { const overlap = intersectRows(reference, candidate); if (overlap) choices.push(overlap); }
    catch (error) { failures.push({ key: candidate.key, reason: error.message }); }
  }
  choices.sort((a, b) => b.intersectionArea - a.intersectionArea || a.key.localeCompare(b.key));
  return { status: "choose-reference", reference: descriptor(reference), choices, errors: failures, issues: index.issues };
}
