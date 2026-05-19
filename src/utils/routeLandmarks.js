import {
  getRoomCentroid,
  getRoomFloor,
  getRoomName,
  normalizeRoomName,
} from "./routeAnchors";

export const DEFAULT_LANDMARK_OPTIONS = {
  distanceThresholdMeters: 4.5,
  maxLandmarksPerSegment: 1,
  minAlongRouteSpacingMeters: 6,
  maxInstructionLandmarks: 8,
};

export function normalizeRouteGeometry(routeResult) {
  const coordinates =
    routeResult?.renderCoordinates?.length
      ? routeResult.renderCoordinates
      : routeResult?.debug?.graphCoordinates?.length
        ? routeResult.debug.graphCoordinates
        : routeResult?.coordinates ?? [];

  return coordinates
    .map((point) => ({
      lat: point.lat,
      lng: point.lng,
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

export function findRouteLandmarks({
  routeResult,
  routePoints,
  rooms = [],
  floorId,
  startRoom = null,
  endRoom = null,
  options = {},
}) {
  const settings = { ...DEFAULT_LANDMARK_OPTIONS, ...options };
  const points = routePoints?.length ? routePoints : normalizeRouteGeometry(routeResult);
  if (!Array.isArray(points) || points.length < 2 || !Array.isArray(rooms)) {
    return [];
  }

  const origin = points[0];
  const projectedRoute = points.map((point) => projectLocalMeters(point, origin));
  const segmentLengths = [];
  const segmentStarts = [];
  let routeLength = 0;

  for (let index = 1; index < projectedRoute.length; index += 1) {
    segmentStarts.push(routeLength);
    const length = pointDistance(projectedRoute[index - 1], projectedRoute[index]);
    segmentLengths.push(length);
    routeLength += length;
  }

  const excludedIds = new Set(
    [startRoom, endRoom]
      .map((room) => getRoomDisplayId(room))
      .filter(Boolean),
  );
  const excludedNames = new Set(
    [startRoom, endRoom]
      .map((room) => normalizeRoomName(getRoomName(room)))
      .filter(Boolean),
  );

  const candidates = [];
  for (const room of rooms) {
    const roomFloor = getRoomFloor(room);
    if (floorId !== undefined && floorId !== null && Number(roomFloor) !== Number(floorId)) {
      continue;
    }

    const roomId = getRoomDisplayId(room);
    const roomName = getRoomName(room);
    const normalizedName = normalizeRoomName(roomName);
    if (
      !roomId ||
      !normalizedName ||
      excludedIds.has(roomId) ||
      excludedNames.has(normalizedName) ||
      !isUsefulLandmarkName(normalizedName)
    ) {
      continue;
    }

    const centroid = getRoomCentroid(room);
    if (!centroid) continue;

    const projectedCentroid = projectLocalMeters(centroid, origin);
    const routeDistance = nearestPointOnRoute(projectedCentroid, projectedRoute);
    const polygonDistance = distanceFromRoomToRoute(room, projectedRoute, origin);
    const distanceMeters = Math.min(routeDistance.distanceMeters, polygonDistance);
    if (distanceMeters > settings.distanceThresholdMeters) {
      continue;
    }

    const segmentIndex = routeDistance.segmentIndex;
    const side = getSideOfSegment(
      projectedRoute[segmentIndex],
      projectedRoute[segmentIndex + 1],
      projectedCentroid,
    );
    const alongRouteMeters =
      (segmentStarts[segmentIndex] ?? 0) +
      (segmentLengths[segmentIndex] ?? 0) * routeDistance.t;

    candidates.push({
      id: roomId,
      roomId,
      name: roomName,
      label: roomName,
      floor: roomFloor,
      floorId: normalizeFloorId(roomFloor),
      side,
      distanceMeters,
      alongRouteMeters,
      segmentIndex,
      t: routeDistance.t,
      coordinate: centroid,
      coords: [centroid.lng, centroid.lat],
      instructionEligible: true,
    });
  }

  const bestByName = new Map();
  for (const candidate of candidates) {
    const key = normalizeRoomName(candidate.name);
    const existing = bestByName.get(key);
    if (!existing || candidate.distanceMeters < existing.distanceMeters) {
      bestByName.set(key, candidate);
    }
  }

  const perSegmentCounts = new Map();
  const selected = [];
  for (const candidate of [...bestByName.values()].sort(compareLandmarks)) {
    const segmentCount = perSegmentCounts.get(candidate.segmentIndex) ?? 0;
    if (segmentCount >= settings.maxLandmarksPerSegment) continue;
    if (
      selected.some(
        (landmark) =>
          Math.abs(landmark.alongRouteMeters - candidate.alongRouteMeters) <
          settings.minAlongRouteSpacingMeters,
      )
    ) {
      continue;
    }

    perSegmentCounts.set(candidate.segmentIndex, segmentCount + 1);
    selected.push(candidate);
  }

  return selected
    .sort((left, right) => left.alongRouteMeters - right.alongRouteMeters)
    .slice(0, settings.maxInstructionLandmarks);
}

export function groupLandmarksByFloor(landmarks = []) {
  return landmarks.reduce((grouped, landmark) => {
    const floorKey = String(landmark.floor);
    grouped[floorKey] = grouped[floorKey] || [];
    grouped[floorKey].push(landmark);
    grouped[normalizeFloorId(landmark.floor)] = grouped[floorKey];
    return grouped;
  }, {});
}

function nearestPointOnRoute(point, route) {
  let best = null;
  for (let index = 1; index < route.length; index += 1) {
    const projected = nearestPointOnSegment(point, route[index - 1], route[index]);
    const distanceMeters = pointDistance(point, projected.point);
    if (!best || distanceMeters < best.distanceMeters) {
      best = {
        distanceMeters,
        segmentIndex: index - 1,
        t: projected.t,
      };
    }
  }
  return best ?? { distanceMeters: Infinity, segmentIndex: 0, t: 0 };
}

function distanceFromRoomToRoute(room, route, origin) {
  const rings = getExteriorRings(room);
  let best = Infinity;

  for (const ring of rings) {
    const projectedRing = ring
      .filter((coord) => Array.isArray(coord) && coord.length >= 2)
      .map(([lng, lat]) => projectLocalMeters({ lng, lat }, origin));

    for (let routeIndex = 1; routeIndex < route.length; routeIndex += 1) {
      const routeStart = route[routeIndex - 1];
      const routeEnd = route[routeIndex];

      for (let ringIndex = 1; ringIndex < projectedRing.length; ringIndex += 1) {
        const ringStart = projectedRing[ringIndex - 1];
        const ringEnd = projectedRing[ringIndex];
        if (segmentsIntersect(routeStart, routeEnd, ringStart, ringEnd)) {
          return 0;
        }
        best = Math.min(
          best,
          segmentDistance(routeStart, routeEnd, ringStart, ringEnd),
        );
      }
    }
  }

  return best;
}

function segmentDistance(a, b, c, d) {
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b),
  );
}

function pointToSegmentDistance(point, start, end) {
  return pointDistance(point, nearestPointOnSegment(point, start, end).point);
}

function nearestPointOnSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const rawT =
    lengthSquared > 0
      ? ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
      : 0;
  const t = Math.max(0, Math.min(1, rawT));
  return {
    t,
    point: {
      x: start.x + dx * t,
      y: start.y + dy * t,
    },
  };
}

function getSideOfSegment(start, end, point) {
  const cross =
    (end.x - start.x) * (point.y - start.y) -
    (end.y - start.y) * (point.x - start.x);
  if (Math.abs(cross) < 0.01) return "ahead";
  return cross > 0 ? "left" : "right";
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function compareLandmarks(left, right) {
  if (left.segmentIndex !== right.segmentIndex) {
    return left.segmentIndex - right.segmentIndex;
  }
  if (Math.abs(left.distanceMeters - right.distanceMeters) > 0.25) {
    return left.distanceMeters - right.distanceMeters;
  }
  return left.alongRouteMeters - right.alongRouteMeters;
}

function getExteriorRings(room) {
  if (room?.geometry?.type === "Polygon") return [room.geometry.coordinates[0]];
  if (room?.geometry?.type === "MultiPolygon") {
    return room.geometry.coordinates.map((polygon) => polygon[0]).filter(Boolean);
  }
  return [];
}

function isUsefulLandmarkName(normalizedName) {
  if (!normalizedName) return false;
  const ignored = ["floor", "wall", "exterior", "facade", "roof", "ceiling"];
  return !ignored.some((token) => normalizedName.includes(token));
}

function getRoomDisplayId(room) {
  return (
    room?.properties?.id ||
    room?.properties?.name ||
    room?.properties?.room_id ||
    room?.properties?.OBJECTID ||
    null
  );
}

function projectLocalMeters(point, origin) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng =
    metersPerDegreeLat * Math.cos((origin.lat * Math.PI) / 180);
  return {
    x: (point.lng - origin.lng) * metersPerDegreeLng,
    y: (point.lat - origin.lat) * metersPerDegreeLat,
  };
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeFloorId(floorId) {
  const text = String(floorId);
  return text.startsWith("F") ? text : `F${text}`;
}
