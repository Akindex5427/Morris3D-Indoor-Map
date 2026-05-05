/**
 * geometry.ts
 * -----------
 * Shared geometry helpers for indoor routing.
 *
 * All projected coordinates are planar meters.
 * GeoJSON coordinates are [lng, lat] in WGS84.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Point2D {
  x: number;
  y: number;
}

export type Ring = [number, number][];
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LocalProjection {
  originLng: number;
  originLat: number;
  project: (lng: number, lat: number) => Point2D;
  unproject: (x: number, y: number) => { lng: number; lat: number };
}

export interface SegmentIntersection {
  point: Point2D;
  t: number;
  u: number;
  kind: 'cross' | 'touch';
}

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------

const EARTH_RADIUS_METERS = 6378137;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function createLocalProjection(originLng: number, originLat: number): LocalProjection {
  const originLngRad = originLng * DEG_TO_RAD;
  const originLatRad = originLat * DEG_TO_RAD;
  const cosOriginLat = Math.cos(originLatRad);

  return {
    originLng,
    originLat,
    project(lng: number, lat: number): Point2D {
      return {
        x: (lng * DEG_TO_RAD - originLngRad) * EARTH_RADIUS_METERS * cosOriginLat,
        y: (lat * DEG_TO_RAD - originLatRad) * EARTH_RADIUS_METERS,
      };
    },
    unproject(x: number, y: number): { lng: number; lat: number } {
      return {
        lng: ((x / (EARTH_RADIUS_METERS * cosOriginLat)) + originLngRad) * RAD_TO_DEG,
        lat: ((y / EARTH_RADIUS_METERS) + originLatRad) * RAD_TO_DEG,
      };
    },
  };
}

export function mercatorProject(lng: number, lat: number): Point2D {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = (lng * Math.PI * EARTH_RADIUS_METERS) / 180;
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const y = (Math.log((1 + sinLat) / (1 - sinLat)) * EARTH_RADIUS_METERS) / 2;
  return { x, y };
}

export function mercatorUnproject(x: number, y: number): { lng: number; lat: number } {
  const lng = (x / EARTH_RADIUS_METERS) * RAD_TO_DEG;
  const lat = (Math.atan(Math.exp(y / EARTH_RADIUS_METERS)) * 360) / Math.PI - 90;
  return { lng, lat };
}

export function projectRingWith(
  ring: Ring,
  project: (lng: number, lat: number) => Point2D
): Ring {
  return ring.map(([lng, lat]) => {
    const point = project(lng, lat);
    return [point.x, point.y];
  });
}

export function projectPolygonWith(
  polygon: Polygon,
  project: (lng: number, lat: number) => Point2D
): Polygon {
  return polygon.map((ring) => projectRingWith(ring, project));
}

export function projectMultiPolygonWith(
  multipolygon: MultiPolygon,
  project: (lng: number, lat: number) => Point2D
): MultiPolygon {
  return multipolygon.map((polygon) => projectPolygonWith(polygon, project));
}

export function projectRing(ring: Ring): Ring {
  return projectRingWith(ring, mercatorProject);
}

export function projectPolygon(polygon: Polygon): Polygon {
  return projectPolygonWith(polygon, mercatorProject);
}

export function projectMultiPolygon(multipolygon: MultiPolygon): MultiPolygon {
  return projectMultiPolygonWith(multipolygon, mercatorProject);
}

// ---------------------------------------------------------------------------
// Basic math
// ---------------------------------------------------------------------------

export function distanceSquared(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

export function distance(a: Point2D, b: Point2D): number {
  return Math.sqrt(distanceSquared(a, b));
}

export function lerpPoint(a: Point2D, b: Point2D, t: number): Point2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

export function closestPointOnSegment(
  point: Point2D,
  segmentStart: Point2D,
  segmentEnd: Point2D
): { point: Point2D; t: number; distanceMeters: number } {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return {
      point: { ...segmentStart },
      t: 0,
      distanceMeters: distance(point, segmentStart),
    };
  }

  const rawT = ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, rawT));
  const projected = lerpPoint(segmentStart, segmentEnd, t);

  return {
    point: projected,
    t,
    distanceMeters: distance(point, projected),
  };
}

export function pointOnSegment(
  point: Point2D,
  segmentStart: Point2D,
  segmentEnd: Point2D,
  toleranceMeters = 1e-6
): boolean {
  const closest = closestPointOnSegment(point, segmentStart, segmentEnd);
  return closest.distanceMeters <= toleranceMeters;
}

// ---------------------------------------------------------------------------
// Point-in-polygon
// ---------------------------------------------------------------------------

function pointInRing(px: number, py: number, ring: Ring): boolean {
  let inside = false;
  const count = ring.length;

  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersects = yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointOnRingBoundary(
  point: Point2D,
  ring: Ring,
  toleranceMeters = 1e-4
): boolean {
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];

    if (
      pointOnSegment(
        point,
        { x: start[0], y: start[1] },
        { x: end[0], y: end[1] },
        toleranceMeters
      )
    ) {
      return true;
    }
  }

  return false;
}

export function pointInPolygon(point: Point2D, polygon: Polygon): boolean {
  if (polygon.length === 0) {
    return false;
  }

  if (pointOnRingBoundary(point, polygon[0])) {
    return true;
  }

  if (!pointInRing(point.x, point.y, polygon[0])) {
    return false;
  }

  for (let index = 1; index < polygon.length; index += 1) {
    if (pointOnRingBoundary(point, polygon[index])) {
      return false;
    }

    if (pointInRing(point.x, point.y, polygon[index])) {
      return false;
    }
  }

  return true;
}

export function pointInMultiPolygon(point: Point2D, multipolygon: MultiPolygon): boolean {
  return multipolygon.some((polygon) => pointInPolygon(point, polygon));
}

// ---------------------------------------------------------------------------
// Segment intersection
// ---------------------------------------------------------------------------

export function segmentIntersectionPoint(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D,
  epsilon = 1e-9
): SegmentIntersection | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;

  if (Math.abs(denominator) <= epsilon) {
    return null;
  }

  const diff = { x: c.x - a.x, y: c.y - a.y };
  const t = (diff.x * s.y - diff.y * s.x) / denominator;
  const u = (diff.x * r.y - diff.y * r.x) / denominator;

  if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) {
    return null;
  }

  const clampedT = Math.max(0, Math.min(1, t));
  const clampedU = Math.max(0, Math.min(1, u));
  const point = lerpPoint(a, b, clampedT);
  const touchesEndpoint =
    clampedT <= epsilon ||
    clampedT >= 1 - epsilon ||
    clampedU <= epsilon ||
    clampedU >= 1 - epsilon;

  return {
    point,
    t: clampedT,
    u: clampedU,
    kind: touchesEndpoint ? 'touch' : 'cross',
  };
}

export function segmentIntersectsSegment(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D
): boolean {
  const intersection = segmentIntersectionPoint(a, b, c, d);
  return intersection !== null && intersection.kind === 'cross';
}

export function segmentIntersectsPolygon(
  a: Point2D,
  b: Point2D,
  polygon: Polygon
): boolean {
  for (const ring of polygon) {
    const count = ring.length;

    for (let i = 0, j = count - 1; i < count; j = i++) {
      const c: Point2D = { x: ring[j][0], y: ring[j][1] };
      const d: Point2D = { x: ring[i][0], y: ring[i][1] };

      if (segmentIntersectsSegment(a, b, c, d)) {
        return true;
      }
    }
  }

  const midpoint = lerpPoint(a, b, 0.5);
  return pointInPolygon(midpoint, polygon);
}

export function segmentIntersectsAnyPolygon(
  a: Point2D,
  b: Point2D,
  polygons: MultiPolygon
): boolean {
  return polygons.some((polygon) => segmentIntersectsPolygon(a, b, polygon));
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

export function computeBounds(polygons: MultiPolygon): AABB {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return { minX, minY, maxX, maxY };
}
