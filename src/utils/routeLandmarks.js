import {
  getRoomCentroid,
  getRoomFloor,
  getRoomName,
  normalizeRoomName,
} from "./routeAnchors";

export const DEFAULT_LANDMARK_OPTIONS = {
  distanceThresholdMeters: 4.5,
  centroidDistanceThresholdMeters: 8,
  maxLandmarksPerSegment: 2,
  minAlongRouteSpacingMeters: 6,
  // Opposite-side pairs within this distance form a "between X and Y" corridor.
  // They are exempt from the same-side spacing filter.
  corridorPairMaxSpacingMeters: 8,
  maxInstructionLandmarks: 12,
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
    const labelCoordinate = getRoomLabelAnchor(room) ?? centroid;

    const projectedCentroid = projectLocalMeters(centroid, origin);
    const routeDistance = nearestPointOnRoute(projectedCentroid, projectedRoute);
    const roomAccess = nearestRoomAccessToRoute(
      room,
      projectedRoute,
      origin,
      projectedCentroid,
    );
    const polygonDistance = distanceFromRoomToRoute(room, projectedRoute, origin);
    const distanceMeters = Math.min(
      routeDistance.distanceMeters,
      polygonDistance,
      roomAccess.distanceMeters,
    );

    if (distanceMeters > settings.distanceThresholdMeters) {
      continue;
    }
    if (
      routeDistance.distanceMeters > settings.centroidDistanceThresholdMeters &&
      roomAccess.distanceMeters > settings.distanceThresholdMeters
    ) {
      continue;
    }

    const segmentIndex = roomAccess.segmentIndex;
    // Use the room centroid for side classification — it represents the room's
    // overall position.  The nearest boundary point (roomAccess.roomPoint) can
    // sit flush on the route edge, producing a near-zero cross-product that
    // mis-classifies the room as "ahead".
    const side = getSideOfSegment(
      projectedRoute[segmentIndex],
      projectedRoute[segmentIndex + 1],
      projectedCentroid,
    );
    const alongRouteMeters =
      (segmentStarts[segmentIndex] ?? 0) +
      (segmentLengths[segmentIndex] ?? 0) * roomAccess.t;
    const accessCoordinate = unprojectLocalMeters(roomAccess.routePoint, origin);

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
      t: roomAccess.t,
      coordinate: accessCoordinate,
      coords: [accessCoordinate.lng, accessCoordinate.lat],
      labelCoordinate,
      labelCoords: [labelCoordinate.lng, labelCoordinate.lat],
      roomCoordinate: centroid,
      roomCoords: [centroid.lng, centroid.lat],
      instructionEligible: true,
    });
  }

  logLandmarkDebug("candidates", candidates, options.debug);
  logLandmarkSegmentDebug("candidates by segment", candidates, options.debug);

  const bestByName = new Map();
  for (const candidate of candidates) {
    const key = normalizeRoomName(candidate.name);
    const existing = bestByName.get(key);
    if (!existing || candidate.distanceMeters < existing.distanceMeters) {
      bestByName.set(key, candidate);
    }
  }

  logLandmarkDebug("deduped", [...bestByName.values()], options.debug);

  const perSegmentCounts = new Map();
  const selected = [];
  for (const candidate of [...bestByName.values()].sort(compareLandmarks)) {
    const segmentCount = perSegmentCounts.get(candidate.segmentIndex) ?? 0;
    if (segmentCount >= settings.maxLandmarksPerSegment) continue;

    const blockedBySpacing = selected.some((landmark) => {
      const routeSpacing = Math.abs(
        landmark.alongRouteMeters - candidate.alongRouteMeters,
      );
      if (routeSpacing >= settings.minAlongRouteSpacingMeters) return false;

      // Opposite-side landmarks at the same route position form a "between X
      // and Y" corridor pair — exempt them from the spacing filter so both
      // sides can be included in a single instruction.
      const isOppositeSide =
        landmark.side !== "ahead" &&
        candidate.side !== "ahead" &&
        landmark.side !== candidate.side;
      if (isOppositeSide) {
        return routeSpacing >= (settings.corridorPairMaxSpacingMeters ?? 8);
      }

      return true;
    });
    if (blockedBySpacing) continue;

    perSegmentCounts.set(candidate.segmentIndex, segmentCount + 1);
    selected.push(candidate);
  }

  const result = selected
    .sort((left, right) => left.alongRouteMeters - right.alongRouteMeters)
    .slice(0, settings.maxInstructionLandmarks);

  logLandmarkDebug("selected", result, options.debug);
  logLandmarkSegmentDebug("selected by segment", result, options.debug);

  return result;
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

function nearestRoomAccessToRoute(room, route, origin, projectedCentroid) {
  const roomPoints = [projectedCentroid];
  for (const ring of getExteriorRings(room)) {
    for (const coord of ring) {
      if (Array.isArray(coord) && coord.length >= 2) {
        roomPoints.push(projectLocalMeters({ lng: coord[0], lat: coord[1] }, origin));
      }
    }
  }

  let best = null;
  for (const roomPoint of roomPoints) {
    for (let index = 1; index < route.length; index += 1) {
      const projected = nearestPointOnSegment(roomPoint, route[index - 1], route[index]);
      const distanceMeters = pointDistance(roomPoint, projected.point);
      if (!best || distanceMeters < best.distanceMeters) {
        best = {
          distanceMeters,
          segmentIndex: index - 1,
          t: projected.t,
          roomPoint,
          routePoint: projected.point,
        };
      }
    }
  }

  return (
    best ?? {
      distanceMeters: Infinity,
      segmentIndex: 0,
      t: 0,
      roomPoint: projectedCentroid,
      routePoint: route[0],
    }
  );
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

function getRoomLabelAnchor(room) {
  const polygons = getPolygonRings(room);
  const bestRings = polygons.reduce((best, rings) => {
    const exterior = rings?.[0];
    if (!exterior || exterior.length < 3) return best;
    const area = Math.abs(ringArea(exterior));
    return !best || area > best.area ? { rings, area } : best;
  }, null)?.rings;
  if (!bestRings?.length) return null;

  const centroid = polygonRingCentroid(bestRings[0]);
  if (centroid && pointInPolygonRings(centroid, bestRings)) {
    return { lng: centroid[0], lat: centroid[1] };
  }

  const surfacePoint = pointOnSurface(bestRings);
  return surfacePoint ? { lng: surfacePoint[0], lat: surfacePoint[1] } : null;
}

function getPolygonRings(room) {
  if (room?.geometry?.type === "Polygon") return [room.geometry.coordinates].filter(Boolean);
  if (room?.geometry?.type === "MultiPolygon") return room.geometry.coordinates.filter(Boolean);
  return [];
}

function ringArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[index + 1];
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
}

function polygonRingCentroid(ring) {
  const area = ringArea(ring);
  if (Math.abs(area) < 1e-14) return null;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[index + 1];
    const cross = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  return [cx / (6 * area), cy / (6 * area)];
}

function pointInPolygonRing([px, py], ring) {
  let inside = false;
  for (let index = 0, prev = ring.length - 1; index < ring.length; prev = index++) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[prev];
    if (
      (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygonRings(point, rings) {
  const [exterior, ...holes] = rings;
  if (!exterior || !pointInPolygonRing(point, exterior)) return false;
  return !holes.some((hole) => pointInPolygonRing(point, hole));
}

function pointOnSurface(rings) {
  const exterior = rings[0];
  if (!exterior?.length) return null;
  const lngs = exterior.map((coord) => coord[0]);
  const lats = exterior.map((coord) => coord[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const candidates = [];
  const steps = 8;

  for (let xIndex = 1; xIndex < steps; xIndex += 1) {
    for (let yIndex = 1; yIndex < steps; yIndex += 1) {
      candidates.push([
        minLng + ((maxLng - minLng) * xIndex) / steps,
        minLat + ((maxLat - minLat) * yIndex) / steps,
      ]);
    }
  }

  return candidates
    .filter((point) => pointInPolygonRings(point, rings))
    .sort(
      (left, right) =>
        distanceToPolygonEdges(right, rings) - distanceToPolygonEdges(left, rings),
    )[0] ?? null;
}

function distanceToPolygonEdges(point, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      best = Math.min(best, distanceToSegment(point, ring[index], ring[index + 1]));
    }
  }
  return best;
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
  );
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dy * t));
}

function isUsefulLandmarkName(normalizedName) {
  if (!normalizedName) return false;
  const ignoredContains = [
    "floor",
    "wall",
    "exterior",
    "facade",
    "roof",
    "ceiling",
    "structure",
  ];
  const ignoredExact = new Set(["stairs area", "stair area"]);
  return (
    !ignoredExact.has(normalizedName) &&
    !ignoredContains.some((token) => normalizedName.includes(token))
  );
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

function unprojectLocalMeters(point, origin) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng =
    metersPerDegreeLat * Math.cos((origin.lat * Math.PI) / 180);
  return {
    lng: origin.lng + point.x / metersPerDegreeLng,
    lat: origin.lat + point.y / metersPerDegreeLat,
  };
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeFloorId(floorId) {
  const text = String(floorId);
  return text.startsWith("F") ? text : `F${text}`;
}

function logLandmarkDebug(stage, landmarks, enabled) {
  const shouldLog =
    enabled !== false &&
    (typeof import.meta === "undefined" || import.meta.env?.DEV !== false);
  if (!shouldLog || !landmarks?.length) return;

  const label = `[Landmarks:${stage}] ${landmarks.length} item(s)`;
  console.group(label);
  console.table(
    landmarks.map((lm) => ({
      name: lm.name ?? lm.label ?? "—",
      side: lm.side ?? "—",
      seg: lm.segmentIndex ?? "—",
      dist: lm.distanceMeters != null ? `${lm.distanceMeters.toFixed(2)} m` : "—",
      along: lm.alongRouteMeters != null ? `${lm.alongRouteMeters.toFixed(2)} m` : "—",
    })),
  );
  console.groupEnd();
}

function logLandmarkSegmentDebug(stage, landmarks, enabled) {
  const shouldLog =
    enabled !== false &&
    (typeof import.meta === "undefined" || import.meta.env?.DEV !== false);
  if (!shouldLog) return;

  const items = Array.isArray(landmarks) ? landmarks : [];
  const grouped = items.reduce((acc, landmark) => {
    const segmentKey = landmark.segmentIndex ?? "unknown";
    acc[segmentKey] = acc[segmentKey] || [];
    acc[segmentKey].push(landmark);
    return acc;
  }, {});

  console.group(`[Landmarks:${stage}]`);
  if (Object.keys(grouped).length === 0) {
    console.log("none");
  } else {
    for (const [segmentIndex, segmentLandmarks] of Object.entries(grouped)) {
      console.group(`segment ${segmentIndex}`);
      console.table(segmentLandmarks.map(formatLandmarkDebugRow));
      console.groupEnd();
    }
  }
  console.groupEnd();
}

function formatLandmarkDebugRow(landmark) {
  const labelCoordinate = landmark.labelCoordinate;
  const routeCoordinate = landmark.coordinate;
  return {
    name: landmark.name ?? landmark.label ?? "-",
    side: landmark.side ?? "-",
    segment: landmark.segmentIndex ?? "-",
    distanceMeters:
      landmark.distanceMeters != null
        ? Number(landmark.distanceMeters.toFixed(2))
        : "-",
    alongMeters:
      landmark.alongRouteMeters != null
        ? Number(landmark.alongRouteMeters.toFixed(2))
        : "-",
    routeLng:
      routeCoordinate?.lng != null
        ? Number(routeCoordinate.lng.toFixed(7))
        : "-",
    routeLat:
      routeCoordinate?.lat != null
        ? Number(routeCoordinate.lat.toFixed(7))
        : "-",
    labelLng:
      labelCoordinate?.lng != null
        ? Number(labelCoordinate.lng.toFixed(7))
        : "-",
    labelLat:
      labelCoordinate?.lat != null
        ? Number(labelCoordinate.lat.toFixed(7))
        : "-",
  };
}
