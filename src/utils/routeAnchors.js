import { distance, lerpPoint, segmentIntersectsAnyPolygon } from "../../routing";

const MAX_GEOMETRY_SNAP_DISTANCE_METERS = 25;
const BOUNDARY_SAMPLE_SPACING_METERS = 1.25;
const MAX_BOUNDARY_SAMPLES = 160;
const EXPLICIT_ANCHOR_MAX_REASONABLE_DISTANCE_METERS = 8;
const GEOMETRY_ANCHOR_IMPROVEMENT_METERS = 1.5;

const isLikelyLngLatCoordinate = (coordinate) =>
  Array.isArray(coordinate) &&
  coordinate.length >= 2 &&
  Number.isFinite(coordinate[0]) &&
  Number.isFinite(coordinate[1]) &&
  Math.abs(coordinate[0]) <= 180 &&
  Math.abs(coordinate[1]) <= 90;

const canonicalizeRoomName = (value) => {
  if (!value) {
    return "";
  }

  return value
    .split(/\s+/)
    .map((token) => {
      if (token === "groups") {
        return "group";
      }

      if (token === "stuudy") {
        return "study";
      }

      return token;
    })
    .join(" ")
    .replace(/\bstudy group\b/g, "group study")
    .trim();
};

export const normalizeRoomName = (value) => canonicalizeRoomName(
  String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim(),
);

export const getRoomName = (room) =>
  room?.properties?.name ||
  room?.properties?.id ||
  room?.properties?.room_id ||
  "Unnamed Room";

export const getRoomFloor = (room) => {
  const rawFloor =
    room?.properties?.floor ??
    room?.properties?.nivel ??
    room?.properties?.level;
  const normalizedFloor = Number(rawFloor);
  return Number.isFinite(normalizedFloor) ? normalizedFloor : null;
};

export const getRoomGeometryType = (room) => room?.geometry?.type ?? null;

export const getRoomCentroid = (room) => {
  if (!roomGeometryUsesLngLat(room)) {
    return null;
  }

  const centroid = (ring) => {
    if (!Array.isArray(ring) || ring.length === 0) {
      return null;
    }

    let sumLng = 0;
    let sumLat = 0;

    for (const [lng, lat] of ring) {
      sumLng += lng;
      sumLat += lat;
    }

    return { lng: sumLng / ring.length, lat: sumLat / ring.length };
  };

  if (room?.geometry?.type === "Polygon") {
    return centroid(room.geometry.coordinates[0]);
  }

  if (room?.geometry?.type === "MultiPolygon") {
    return centroid(room.geometry.coordinates[0]?.[0]);
  }

  return null;
};

export const buildRoomAnchorIndex = (centerlinesGeoJSON) => {
  const anchors = new Map();
  collectRoomAnchors(centerlinesGeoJSON, anchors);
  return anchors;
};

export const resolveRoomRoutingTarget = ({
  room,
  floorId,
  router,
  roomAnchorIndex,
  role = "destination",
}) => {
  if (!room || !router) {
    return null;
  }

  const roomName = getRoomName(room);
  const geometryType = getRoomGeometryType(room);
  const centroid = getRoomCentroid(room);
  const hasGeographicGeometry = roomGeometryUsesLngLat(room);
  const debugBase = {
    roomName,
    geometryType,
    centroid,
    hasGeographicGeometry,
    floorId,
    postExtensionAdded: false,
  };

  if (!hasRoomAnchorIndex(roomAnchorIndex)) {
    return centroid
      ? {
          coordinates: centroid,
          debug: {
            ...debugBase,
            source: "room_centroid",
            snappedTarget: router.snapToGraph(centroid),
          },
        }
      : null;
  }

  const explicitAnchor = findExplicitRoomAnchor(
    roomName,
    centroid,
    router,
    roomAnchorIndex,
  );
  const geometryAnchor = findGeometryDerivedAnchor(room, router);

  if (
    explicitAnchor &&
    geometryAnchor &&
    explicitAnchor.score > EXPLICIT_ANCHOR_MAX_REASONABLE_DISTANCE_METERS &&
    geometryAnchor.score + GEOMETRY_ANCHOR_IMPROVEMENT_METERS <
      explicitAnchor.score
  ) {
    return {
      coordinates: geometryAnchor.coordinates,
      debug: {
        ...debugBase,
        source: createAnchorDebugSource(floorId, "geometry_anchor"),
        snappedTarget: geometryAnchor.snappedTarget,
        boundarySampleCount: geometryAnchor.sampleCount,
        replacedAnchorFeatureId: explicitAnchor.featureId,
        replacedAnchorRole: explicitAnchor.role,
      },
    };
  }

  if (explicitAnchor) {
    return {
      coordinates: explicitAnchor.coordinates,
      debug: {
        ...debugBase,
        source: createAnchorDebugSource(floorId, "centerline_anchor"),
        snappedTarget: explicitAnchor.snappedTarget,
        anchorCount: explicitAnchor.anchorCount,
        anchorFeatureId: explicitAnchor.featureId,
        anchorRole: explicitAnchor.role,
      },
    };
  }

  if (geometryAnchor) {
    return {
      coordinates: geometryAnchor.coordinates,
      debug: {
        ...debugBase,
        source: createAnchorDebugSource(floorId, "geometry_anchor"),
        snappedTarget: geometryAnchor.snappedTarget,
        boundarySampleCount: geometryAnchor.sampleCount,
      },
    };
  }

  if (role === "destination") {
    return {
      coordinates: null,
      debug: {
        ...debugBase,
        source: createAnchorDebugSource(floorId, "anchor_unresolved"),
        snappedTarget: null,
      },
    };
  }

  return centroid
    ? {
        coordinates: centroid,
        debug: {
          ...debugBase,
          source: createAnchorDebugSource(floorId, "centroid_fallback"),
          snappedTarget: router.snapToGraph(centroid),
        },
      }
    : null;
};

function hasRoomAnchorIndex(roomAnchorIndex) {
  return (
    roomAnchorIndex instanceof Map
      ? roomAnchorIndex.size > 0
      : Boolean(roomAnchorIndex?.size)
  );
}

function createAnchorDebugSource(floorId, suffix) {
  const normalizedFloorId = Number(floorId);
  return Number.isFinite(normalizedFloorId)
    ? `level${normalizedFloorId}_${suffix}`
    : `level_unknown_${suffix}`;
}

function collectRoomAnchors(input, anchors) {
  if (!input || typeof input !== "object") {
    return;
  }

  if (input.type === "FeatureCollection") {
    for (const feature of input.features || []) {
      collectRoomAnchors(feature, anchors);
    }
    return;
  }

  if (input.type === "Feature") {
    const featureMetadata = {
      featureId: input.id ?? input.properties?.OBJECTID ?? null,
      startroom: input.properties?.startroom ?? null,
      endroom: input.properties?.endroom ?? null,
    };
    collectGeometryAnchors(input.geometry, featureMetadata, anchors);
  }
}

function collectGeometryAnchors(geometry, featureMetadata, anchors) {
  if (!geometry || !featureMetadata) {
    return;
  }

  if (geometry.type === "LineString") {
    registerLineStringAnchors(geometry.coordinates, featureMetadata, anchors);
    return;
  }

  if (geometry.type === "MultiLineString") {
    for (const lineString of geometry.coordinates || []) {
      registerLineStringAnchors(lineString, featureMetadata, anchors);
    }
  }
}

function registerLineStringAnchors(lineString, featureMetadata, anchors) {
  if (!Array.isArray(lineString) || lineString.length < 2) {
    return;
  }

  registerRoomAnchor(anchors, featureMetadata.startroom, lineString[0], {
    featureId: featureMetadata.featureId,
    role: "startroom",
  });

  registerRoomAnchor(
    anchors,
    featureMetadata.endroom,
    lineString[lineString.length - 1],
    {
      featureId: featureMetadata.featureId,
      role: "endroom",
    },
  );
}

function registerRoomAnchor(anchors, roomName, coordinates, metadata) {
  const normalizedRoomName = normalizeRoomName(roomName);
  if (!normalizedRoomName || !Array.isArray(coordinates) || coordinates.length < 2) {
    return;
  }

  const existing = anchors.get(normalizedRoomName) ?? [];
  const key = createCoordinateKey(coordinates[0], coordinates[1]);

  if (!existing.some((anchor) => anchor.key === key)) {
    existing.push({
      key,
      coordinates: { lng: coordinates[0], lat: coordinates[1] },
      featureId: metadata.featureId,
      role: metadata.role,
    });
  }

  anchors.set(normalizedRoomName, existing);
}

function findExplicitRoomAnchor(roomName, centroid, router, roomAnchorIndex) {
  const anchors = roomAnchorIndex?.get(normalizeRoomName(roomName)) ?? [];
  if (anchors.length === 0) {
    return null;
  }

  const graph = router.getGraph();
  const centroidPoint = centroid
    ? graph.projection.project(centroid.lng, centroid.lat)
    : null;

  let bestAnchor = null;

  for (const anchor of anchors) {
    const snappedTarget = router.snapToGraph(anchor.coordinates);
    const resolvedCoordinates = snappedTarget?.point ?? anchor.coordinates;
    const anchorPoint = graph.projection.project(
      resolvedCoordinates.lng,
      resolvedCoordinates.lat,
    );
    const score =
      (centroidPoint ? distance(centroidPoint, anchorPoint) : 0) +
      (snappedTarget?.kind === "edge" ? 0.05 : 0);

    if (!bestAnchor || score < bestAnchor.score) {
      bestAnchor = {
        ...anchor,
        coordinates: resolvedCoordinates,
        snappedTarget,
        anchorCount: anchors.length,
        score,
      };
    }
  }

  return bestAnchor;
}

function findGeometryDerivedAnchor(room, router) {
  if (!roomGeometryUsesLngLat(room)) {
    return null;
  }

  const graph = router.getGraph();
  const boundarySamples = sampleRoomBoundary(room, graph.projection);

  let bestAnchor = null;

  for (const sample of boundarySamples) {
    const snappedTarget = router.snapToGraph(sample.coordinate);
    if (
      !snappedTarget ||
      snappedTarget.distanceMeters > MAX_GEOMETRY_SNAP_DISTANCE_METERS
    ) {
      continue;
    }

    const snappedPoint = graph.projection.project(
      snappedTarget.point.lng,
      snappedTarget.point.lat,
    );

    if (
      graph.obstaclePolygons.length > 0 &&
      segmentIntersectsAnyPolygon(
        sample.projected,
        snappedPoint,
        graph.obstaclePolygons,
      )
    ) {
      continue;
    }

    const score =
      distance(sample.projected, snappedPoint) +
      (snappedTarget.kind === "edge" ? 0.05 : 0);

    if (!bestAnchor || score < bestAnchor.score) {
      bestAnchor = {
        coordinates: snappedTarget.point,
        snappedTarget,
        sampleCount: boundarySamples.length,
        score,
      };
    }
  }

  return bestAnchor;
}

function sampleRoomBoundary(room, projection) {
  const rings = getExteriorRings(room);
  const samples = [];
  const seen = new Set();

  const addSample = (point) => {
    const key = createCoordinateKey(point.x, point.y, 3);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    const coordinate = projection.unproject(point.x, point.y);
    samples.push({
      projected: point,
      coordinate,
    });
  };

  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 2) {
      continue;
    }

    const projectedRing = ring.map(([lng, lat]) => projection.project(lng, lat));

    for (let index = 1; index < projectedRing.length; index += 1) {
      const start = projectedRing[index - 1];
      const end = projectedRing[index];
      const segmentLength = distance(start, end);
      const steps = Math.max(
        1,
        Math.ceil(segmentLength / BOUNDARY_SAMPLE_SPACING_METERS),
      );

      for (let step = 0; step < steps; step += 1) {
        addSample(lerpPoint(start, end, step / steps));
      }
    }

    addSample(projectedRing[projectedRing.length - 1]);
  }

  if (samples.length <= MAX_BOUNDARY_SAMPLES) {
    return samples;
  }

  const reducedSamples = [];
  const interval = samples.length / MAX_BOUNDARY_SAMPLES;

  for (let index = 0; index < MAX_BOUNDARY_SAMPLES; index += 1) {
    reducedSamples.push(samples[Math.floor(index * interval)]);
  }

  return reducedSamples;
}

function getExteriorRings(room) {
  if (room?.geometry?.type === "Polygon") {
    return [room.geometry.coordinates[0]];
  }

  if (room?.geometry?.type === "MultiPolygon") {
    return room.geometry.coordinates
      .map((polygon) => polygon[0])
      .filter(Boolean);
  }

  return [];
}

function roomGeometryUsesLngLat(room) {
  const rings = getExteriorRings(room);

  if (rings.length === 0) {
    return false;
  }

  return rings.every(
    (ring) =>
      Array.isArray(ring) &&
      ring.length > 0 &&
      ring.every((coordinate) => isLikelyLngLatCoordinate(coordinate)),
  );
}

function createCoordinateKey(x, y, precision = 8) {
  return `${Number(x).toFixed(precision)}:${Number(y).toFixed(precision)}`;
}
