import {
  getRoomCentroid,
  getRoomFloor,
  getRoomName,
  normalizeRoomName,
} from "./routeAnchors";
import { routeFeatureKey as getRoomDisplayId } from "./routeLabelIdentity";
import { getRoomLabelAnchor } from "./roomLabelAnchor";
import { routePolygonProximity } from "./routeProximity";

export const DEFAULT_LANDMARK_OPTIONS = {
  distanceThresholdMeters: 4.5,
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
      !isUsefulLandmarkName(normalizedName)
    ) {
      continue;
    }

    const centroid = getRoomCentroid(room);
    if (!centroid) continue;
    const anchor = getRoomLabelAnchor(room);
    const labelCoordinate = anchor ? { lng: anchor[0], lat: anchor[1] } : null;

    const projectedCentroid = projectLocalMeters(centroid, origin);
    const routeKey = routePoints?.length ? routePoints : routeResult?.renderCoordinates?.length
      ? routeResult.renderCoordinates : routeResult?.debug?.graphCoordinates?.length
        ? routeResult.debug.graphCoordinates : routeResult.coordinates;
    const roomAccess = routePolygonProximity(room.geometry, points, routeKey);
    if (!roomAccess || roomAccess.distanceMeters > settings.distanceThresholdMeters) continue;
    const distanceMeters = roomAccess.distanceMeters;

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
      labelCoords: anchor,
      roomCoordinate: centroid,
      roomCoords: [centroid.lng, centroid.lat],
      instructionEligible: true,
    });
  }

  logLandmarkDebug("candidates", candidates, options.debug);
  logLandmarkSegmentDebug("candidates by segment", candidates, options.debug);

  const bestByIdentity = new Map();
  for (const candidate of candidates) {
    const key = candidate.roomId;
    const existing = bestByIdentity.get(key);
    if (!existing || candidate.distanceMeters < existing.distanceMeters) {
      bestByIdentity.set(key, candidate);
    }
  }

  logLandmarkDebug("deduped", [...bestByIdentity.values()], options.debug);

  const perSegmentCounts = new Map();
  const selected = [];
  for (const candidate of [...bestByIdentity.values()].sort(compareLandmarks)) {
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

function getSideOfSegment(start, end, point) {
  const cross =
    (end.x - start.x) * (point.y - start.y) -
    (end.y - start.y) * (point.x - start.x);
  if (Math.abs(cross) < 0.01) return "ahead";
  return cross > 0 ? "left" : "right";
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
