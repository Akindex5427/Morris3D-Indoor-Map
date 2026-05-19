const DEFAULT_THRESHOLDS = {
  straightMaxDegrees: 25,
  slightMaxDegrees: 60,
  turnMaxDegrees: 135,
  minInstructionDistanceMeters: 2,
  minSegmentDistanceMeters: 1.2,
  duplicatePointDistanceMeters: 0.35,
  landmarkDistanceMeters: 4.5,
  landmarkSegmentMinDistanceMeters: 14,
};

const ORDINALS = ["first", "second", "third", "fourth"];

export const computeBearing = (pointA, pointB) => {
  const lat1 = toRadians(pointA.lat);
  const lat2 = toRadians(pointB.lat);
  const deltaLng = toRadians(pointB.lng - pointA.lng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return normalizeDegrees((Math.atan2(y, x) * 180) / Math.PI);
};

export const computeTurnAngle = (prevPoint, currentPoint, nextPoint) => {
  const incomingBearing = computeBearing(prevPoint, currentPoint);
  const outgoingBearing = computeBearing(currentPoint, nextPoint);
  return normalizeSignedDegrees(outgoingBearing - incomingBearing);
};

export const classifyTurn = (angle, thresholds = DEFAULT_THRESHOLDS) => {
  const magnitude = Math.abs(angle);
  const side = angle >= 0 ? "right" : "left";

  if (magnitude <= thresholds.straightMaxDegrees) return "straight";
  if (magnitude <= thresholds.slightMaxDegrees) return `slight-${side}`;
  if (magnitude <= thresholds.turnMaxDegrees) return side;
  if (magnitude < 165) return `sharp-${side}`;
  return "u-turn";
};

export const estimateSegmentDistance = (points) => {
  if (!Array.isArray(points) || points.length < 2) return 0;

  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineDistance(points[index - 1], points[index]);
  }
  return total;
};

export const generateVerticalInstruction = (verticalSegment, options = {}) => {
  const connectorType = normalizeConnectorType(
    verticalSegment.connectorType,
    options.userPreference,
  );
  const fromFloor = normalizeFloorId(verticalSegment.fromFloor);
  const toFloor = normalizeFloorId(verticalSegment.toFloor);
  const connectorNoun = getConnectorNoun(connectorType, verticalSegment);

  const instruction = normalizeInstruction({
    id: options.id ?? `vertical-${fromFloor}-${toFloor}`,
    floorId: fromFloor,
    type: "vertical",
    text: `Take the ${connectorNoun} from ${formatFloor(fromFloor)} to ${formatFloor(toFloor)}.`,
    connectorType,
    fromFloor,
    toFloor,
    targetFloor: Number(String(toFloor).replace(/^F/i, "")),
    coordinate: verticalSegment.fromAccessPoint,
    icon: connectorType === "elevator" ? "E" : "^",
  });

  logInstructionDebug({
    routeType: options.routeType ?? "multi-floor",
    floorId: fromFloor,
    selectedVerticalConnector: verticalSegment,
    generatedInstructions: [instruction],
    enabled: options.debug,
  });

  return instruction;
};

export const detectIntersectionChoice = ({
  graph,
  nodeId,
  previousPoint,
  nextPoint,
  thresholds = DEFAULT_THRESHOLDS,
}) => {
  if (!graph || !nodeId || !graph.nodes?.get(nodeId)) return null;

  const node = graph.nodes.get(nodeId);
  const neighbors = graph.adjacency?.get(nodeId) ?? [];
  if (neighbors.length < 3) return null;

  const current = graph.projection.unproject(node.point.x, node.point.y);
  const incomingBearing = computeBearing(previousPoint, current);
  const outgoingBearing = computeBearing(current, nextPoint);
  const outgoingAngle = normalizeSignedDegrees(outgoingBearing - incomingBearing);
  const outgoingTurn = classifyTurn(outgoingAngle, thresholds);
  const side = getTurnSide(outgoingTurn);

  if (!side) return null;

  const sameSideChoices = neighbors
    .map((neighbor) => {
      const neighborNode = graph.nodes.get(neighbor.nodeId);
      if (!neighborNode) return null;

      const neighborCoord = graph.projection.unproject(
        neighborNode.point.x,
        neighborNode.point.y,
      );
      if (haversineDistance(neighborCoord, previousPoint) < 0.75) return null;

      const bearing = computeBearing(current, neighborCoord);
      const angle = normalizeSignedDegrees(bearing - incomingBearing);
      const turn = classifyTurn(angle, thresholds);
      if (getTurnSide(turn) !== side) return null;

      return { angle, turn, nodeId: neighbor.nodeId };
    })
    .filter(Boolean)
    .sort((left, right) => Math.abs(left.angle) - Math.abs(right.angle));

  const actualIndex = sameSideChoices.findIndex(
    (choice) => Math.abs(choice.angle - outgoingAngle) <= 12,
  );

  if (actualIndex < 0 || actualIndex >= ORDINALS.length) return null;

  return {
    ordinal: ORDINALS[actualIndex],
    side,
    text: `Take the ${ORDINALS[actualIndex]} ${side}`,
  };
};

export const generateRouteInstructions = ({
  routeResult,
  floorId,
  graph,
  startName = "start",
  destinationName = "destination",
  options = {},
}) => {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) };
  const renderedPoints = normalizeRoutePoints(routeResult);
  const points = simplifyRoutePolyline(renderedPoints, thresholds);
  const landmarks = normalizeRouteLandmarks(options.landmarks ?? []);
  const floorKey = normalizeFloorId(floorId);
  const analysis = analyzeRouteGeometry({
    points,
    graph,
    nodeIds: [],
    thresholds,
  });
  const usedLandmarkIds = new Set();

  if (points.length < 2) {
    const instructions = [
      normalizeInstruction({
        id: `${floorKey}-arrival`,
        floorId: floorKey,
        type: "arrival",
        text: `You have arrived at ${destinationName}.`,
        coordinate: points[0] ?? null,
      }),
    ];
    logInstructionDebug({
      routeType: options.routeType ?? "same-floor",
      floorId: floorKey,
      renderedRouteCoordinateCount: renderedPoints.length,
      simplifiedRouteCoordinateCount: points.length,
      orderedRouteCoordinates: points,
      bearings: analysis.bearings,
      turnAngles: analysis.turnAngles,
      classifiedTurnDirections: analysis.classifiedTurnDirections,
      meaningfulTurnCount: analysis.meaningfulTurns.length,
      landmarksByTurn: analysis.meaningfulTurns.map((turn) => ({
        waypointIndex: turn.waypointIndex,
        label: null,
        distanceMeters: null,
      })),
      generatedInstructions: instructions,
      enabled: options.debug,
    });
    return instructions;
  }

  const instructions = [
    normalizeInstruction({
      id: `${floorKey}-start`,
      floorId: floorKey,
      type: "start",
      text: `Start at ${startName}.`,
      coordinate: points[0],
      icon: ">",
    }),
  ];

  let actionStartIndex = 0;
  let cumulativeDistance = 0;

  for (const turn of analysis.meaningfulTurns) {
    const segmentDistance = estimateSegmentDistance(
      points.slice(actionStartIndex, turn.waypointIndex + 1),
    );
    cumulativeDistance += segmentDistance;
    const landmark = findHelpfulLandmarkOnSegment({
      landmarks,
      start: points[actionStartIndex],
      end: turn.coordinate,
      thresholds,
      usedLandmarkIds,
    });
    const turnText = buildTurnInstructionText({
      turnDirection: turn.turnDirection,
      approachLandmark: landmark,
      destinationName,
      isFinalTurn: turn.waypointIndex === points.length - 2,
    });

    if (
      segmentDistance >= thresholds.minInstructionDistanceMeters &&
      !landmark
    ) {
      instructions.push(
        normalizeInstruction({
          id: `${floorKey}-straight-${turn.waypointIndex}`,
          floorId: floorKey,
          type: "straight",
          text: `Continue straight for ${formatDistance(segmentDistance)}.`,
          distanceMeters: segmentDistance,
          turnDirection: "straight",
          coordinate: turn.coordinate,
          cumulativeDistance,
          icon: ">",
        }),
      );
    }

    instructions.push(
      normalizeInstruction({
        id: `${floorKey}-turn-${turn.waypointIndex}`,
        floorId: floorKey,
        type: "turn",
        text: turnText,
        distanceMeters:
          landmark ? segmentDistance : 0,
        turnDirection: turn.turnDirection,
        landmarkUsed: landmark?.label ?? null,
        coordinate: turn.coordinate,
        cumulativeDistance,
        icon: turn.turnDirection.includes("left")
          ? "<"
          : turn.turnDirection.includes("right")
            ? ">"
            : "U",
      }),
    );

    actionStartIndex = turn.waypointIndex;
  }

  const remainingDistance = estimateSegmentDistance(points.slice(actionStartIndex));
  cumulativeDistance += remainingDistance;

  if (remainingDistance >= thresholds.minInstructionDistanceMeters) {
    const landmark = findHelpfulLandmarkOnSegment({
      landmarks,
      start: points[actionStartIndex],
      end: points[points.length - 1],
      thresholds,
      usedLandmarkIds,
    });
    const text = analysis.meaningfulTurns.length === 0
      ? landmark
        ? `Continue straight, passing ${formatLandmarkWithSide(landmark)}, for ${formatDistance(remainingDistance)}.`
        : `Continue straight for ${formatDistance(remainingDistance)}.`
      : landmark
        ? `Continue, passing ${formatLandmarkWithSide(landmark)}, for ${formatDistance(remainingDistance)}.`
        : `Continue for ${formatDistance(remainingDistance)}.`;
    instructions.push(
      normalizeInstruction({
        id: `${floorKey}-final-straight`,
        floorId: floorKey,
        type: "straight",
        text,
        distanceMeters: remainingDistance,
        turnDirection: "straight",
        coordinate: points[points.length - 1],
        cumulativeDistance,
        icon: ">",
      }),
    );
  }

  instructions.push(
    normalizeInstruction({
      id: `${floorKey}-arrival`,
      floorId: floorKey,
      type: "arrival",
      text: `You have arrived at ${destinationName}.`,
      coordinate: points[points.length - 1],
      cumulativeDistance,
      icon: "x",
    }),
  );

  logInstructionDebug({
    routeType: options.routeType ?? "same-floor",
    floorId: floorKey,
    renderedRouteCoordinateCount: renderedPoints.length,
    simplifiedRouteCoordinateCount: points.length,
    orderedRouteCoordinates: points,
    bearings: analysis.bearings,
    turnAngles: analysis.turnAngles,
    classifiedTurnDirections: analysis.classifiedTurnDirections,
    meaningfulTurnCount: analysis.meaningfulTurns.length,
    landmarksByTurn: analysis.meaningfulTurns.map((turn) => ({
      waypointIndex: turn.waypointIndex,
      label:
        instructions.find(
          (instruction) => instruction.id === `${floorKey}-turn-${turn.waypointIndex}`,
        )?.landmarkUsed ?? null,
      nearestTurnLabel: null,
      nearestTurnLabelDistanceMeters: null,
    })),
    generatedInstructions: instructions,
    enabled: options.debug,
  });

  return instructions;
};

export const generateMultiFloorRouteInstructions = ({
  segments,
  graphsByFloor = {},
  startName,
  destinationName,
  options = {},
}) => {
  const instructions = [];
  const horizontalSegments = segments.filter((segment) => segment.type === "horizontal");
  const segmentDebug = [];
  const verticalDebug = [];

  for (const segment of segments) {
    if (segment.type === "horizontal") {
      const isFirstHorizontal = segment === horizontalSegments[0];
      const isLastHorizontal = segment === horizontalSegments[horizontalSegments.length - 1];
      const segmentInstructions = generateRouteInstructions({
        routeResult: segment.route,
        floorId: segment.floorId,
        graph: graphsByFloor[segment.floorId],
        startName: isFirstHorizontal ? startName : "vertical connector",
        destinationName: isLastHorizontal ? destinationName : "vertical connector",
        options: {
          ...options,
          landmarks:
            options.landmarksByFloor?.[segment.floorId] ??
            options.landmarksByFloor?.[Number(segment.floorId)] ??
            options.landmarksByFloor?.[normalizeFloorId(segment.floorId)] ??
            [],
          routeType: "multi-floor",
          debug: false,
        },
      });

      const filtered = segmentInstructions.filter((instruction) => {
        if (!isFirstHorizontal && instruction.type === "start") return false;
        if (!isLastHorizontal && instruction.type === "arrival") return false;
        return true;
      });
      if (!isFirstHorizontal && filtered[0]?.type !== "vertical") {
        filtered[0] = {
          ...filtered[0],
          text: `Exit on ${formatFloor(normalizeFloorId(segment.floorId))} and ${lowercaseFirst(filtered[0].text)}`,
          instruction: `Exit on ${formatFloor(normalizeFloorId(segment.floorId))} and ${lowercaseFirst(filtered[0].text)}`,
        };
      }
      instructions.push(...filtered);
      const segmentPoints = normalizeRoutePoints(segment.route);
      const simplifiedSegmentPoints = simplifyRoutePolyline(segmentPoints, {
        ...DEFAULT_THRESHOLDS,
        ...(options.thresholds ?? {}),
      });
      const segmentAnalysis = analyzeRouteGeometry({
        points: simplifiedSegmentPoints,
        graph: graphsByFloor[segment.floorId] ?? graphsByFloor[normalizeFloorId(segment.floorId)],
        nodeIds: segment.route?.debug?.graphNodeIds ?? [],
        thresholds: { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) },
      });
      segmentDebug.push({
        floorId: normalizeFloorId(segment.floorId),
        renderedRouteCoordinateCount: segmentPoints.length,
        simplifiedRouteCoordinateCount: simplifiedSegmentPoints.length,
        orderedRouteCoordinates: simplifiedSegmentPoints,
        computedBearings: segmentAnalysis.bearings,
        computedTurnAngles: segmentAnalysis.turnAngles,
        classifiedTurnDirections: segmentAnalysis.classifiedTurnDirections,
        meaningfulTurnCount: segmentAnalysis.meaningfulTurns.length,
        landmarksByTurn: segmentAnalysis.meaningfulTurns.map((turn) => ({
          waypointIndex: turn.waypointIndex,
          label: null,
          distanceMeters: null,
        })),
        instructionCount: filtered.length,
      });
      continue;
    }

    if (segment.type === "vertical-transition") {
      verticalDebug.push(segment);
      instructions.push(
        generateVerticalInstruction(segment, {
          ...options,
          id: `vertical-${instructions.length}`,
          routeType: "multi-floor",
          debug: false,
        }),
      );
    }
  }

  const normalizedInstructions = instructions.map((instruction, index) => ({
    ...instruction,
    id: String(instruction.id ?? index),
  }));

  logInstructionDebug({
    routeType: "multi-floor",
    floorSegments: segmentDebug,
    selectedVerticalConnector: verticalDebug,
    generatedInstructions: normalizedInstructions,
    enabled: options.debug,
  });

  return normalizedInstructions;
};

export const analyzeRouteGeometry = ({
  points,
  graph,
  nodeIds = [],
  thresholds = DEFAULT_THRESHOLDS,
}) => {
  const bearings = [];
  for (let index = 1; index < points.length; index += 1) {
    bearings.push({
      segmentIndex: index - 1,
      from: points[index - 1],
      to: points[index],
      bearing: round(computeBearing(points[index - 1], points[index]), 1),
      distanceMeters: round(haversineDistance(points[index - 1], points[index]), 1),
    });
  }

  const waypoints = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const turnAngle = computeTurnAngle(points[index - 1], points[index], points[index + 1]);
    const turnDirection = classifyTurn(turnAngle, thresholds);
    const intersectionChoice = detectIntersectionChoice({
      graph,
      nodeId: nodeIds[index],
      previousPoint: points[index - 1],
      nextPoint: points[index + 1],
      thresholds,
    });

    waypoints.push({
      waypointIndex: index,
      coordinate: points[index],
      incomingBearing: bearings[index - 1]?.bearing,
      outgoingBearing: bearings[index]?.bearing,
      turnAngle: round(turnAngle, 1),
      turnDirection,
      intersectionChoice,
    });
  }

  const meaningfulTurns = waypoints.filter(
    (waypoint) => waypoint.turnDirection !== "straight",
  );

  return {
    bearings,
    waypoints,
    meaningfulTurns,
    turnAngles: waypoints.map((waypoint) => ({
      waypointIndex: waypoint.waypointIndex,
      angle: waypoint.turnAngle,
    })),
    classifiedTurnDirections: waypoints.map((waypoint) => ({
      waypointIndex: waypoint.waypointIndex,
      turnDirection: waypoint.turnDirection,
      intersectionChoice: waypoint.intersectionChoice,
      nearestLandmark: null,
    })),
  };
};

function normalizeRoutePoints(routeResult) {
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

function simplifyRoutePolyline(points, thresholds = DEFAULT_THRESHOLDS) {
  if (!Array.isArray(points) || points.length < 3) return points ?? [];

  const cleaned = [];
  for (const point of points) {
    const previous = cleaned[cleaned.length - 1];
    if (
      previous &&
      haversineDistance(previous, point) < thresholds.duplicatePointDistanceMeters
    ) {
      continue;
    }
    cleaned.push(point);
  }

  if (cleaned.length < 3) return cleaned;

  let simplified = cleaned;
  let changed = true;
  let pass = 0;

  while (changed && pass < 4) {
    changed = false;
    pass += 1;
    const next = [simplified[0]];

    for (let index = 1; index < simplified.length - 1; index += 1) {
      const previous = next[next.length - 1];
      const current = simplified[index];
      const following = simplified[index + 1];
      const incomingDistance = haversineDistance(previous, current);
      const outgoingDistance = haversineDistance(current, following);
      const angle = computeTurnAngle(previous, current, following);
      const magnitude = Math.abs(angle);
      const isTinySegment =
        Math.min(incomingDistance, outgoingDistance) <
        thresholds.minSegmentDistanceMeters;

      if (
        magnitude < thresholds.straightMaxDegrees ||
        (isTinySegment && magnitude < thresholds.slightMaxDegrees)
      ) {
        changed = true;
        continue;
      }

      next.push(current);
    }

    next.push(simplified[simplified.length - 1]);
    simplified = next;
  }

  return simplified;
}

function findHelpfulLandmarkOnSegment({
  landmarks,
  start,
  end,
  thresholds,
  usedLandmarkIds,
}) {
  if (
    !Array.isArray(landmarks) ||
    landmarks.length === 0 ||
    !start ||
    !end
  ) {
    return null;
  }

  const segmentDistance = haversineDistance(start, end);
  if (segmentDistance < thresholds.landmarkSegmentMinDistanceMeters) return null;

  const candidates = landmarks
    .filter((landmark) => !usedLandmarkIds?.has(landmark.id))
    .map((landmark) => {
      const along = distanceAlongSegment(start, end, landmark.point);
      return {
        ...landmark,
        ...along,
      };
    })
    .filter(
      (waypoint) =>
        waypoint.t > 0.2 &&
        waypoint.t < 0.8 &&
        waypoint.crossTrackDistanceMeters <=
          thresholds.landmarkDistanceMeters,
    )
    .sort((left, right) => left.t - right.t);

  const landmark = candidates[0] ?? null;
  if (landmark?.id) usedLandmarkIds?.add(landmark.id);
  return landmark;
}

function normalizeRouteLandmarks(landmarks) {
  if (!Array.isArray(landmarks)) return [];

  return landmarks
    .map((landmark, index) => {
      const label = landmark?.label ?? landmark?.name;
      const coordinate = landmark?.coordinate;
      const coords = landmark?.coords;
      const point =
        coordinate?.lat !== undefined && coordinate?.lng !== undefined
          ? { lat: coordinate.lat, lng: coordinate.lng }
          : landmark?.lat !== undefined && landmark?.lng !== undefined
            ? { lat: landmark.lat, lng: landmark.lng }
            : Array.isArray(coords) && coords.length >= 2
              ? { lng: coords[0], lat: coords[1] }
              : null;

      if (
        !label ||
        !point ||
        !Number.isFinite(point.lat) ||
        !Number.isFinite(point.lng)
      ) {
        return null;
      }

      return {
        ...landmark,
        id: landmark.id ?? landmark.roomId ?? `${label}-${index}`,
        label: String(label),
        side:
          landmark.side === "left" || landmark.side === "right"
            ? landmark.side
            : null,
        point,
      };
    })
    .filter(Boolean);
}

function distanceAlongSegment(start, end, point) {
  const origin = projectLocalMeters(start, start);
  const segmentEnd = projectLocalMeters(end, start);
  const projectedPoint = projectLocalMeters(point, start);
  const dx = segmentEnd.x - origin.x;
  const dy = segmentEnd.y - origin.y;
  const lengthSquared = dx * dx + dy * dy;
  const rawT =
    lengthSquared > 0
      ? ((projectedPoint.x - origin.x) * dx + (projectedPoint.y - origin.y) * dy) /
        lengthSquared
      : 0;
  const t = Math.max(0, Math.min(1, rawT));
  const closest = {
    x: origin.x + dx * t,
    y: origin.y + dy * t,
  };
  return {
    t,
    crossTrackDistanceMeters: Math.hypot(
      projectedPoint.x - closest.x,
      projectedPoint.y - closest.y,
    ),
  };
}

function projectLocalMeters(point, origin) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng =
    metersPerDegreeLat * Math.cos(toRadians(origin.lat));
  return {
    x: (point.lng - origin.lng) * metersPerDegreeLng,
    y: (point.lat - origin.lat) * metersPerDegreeLat,
  };
}

function buildTurnInstructionText({
  turnDirection,
  approachLandmark,
  destinationName,
  isFinalTurn,
}) {
  const turnText = turnDirectionToText(turnDirection);
  const lowerTurnText = lowercaseFirst(turnText);
  if (approachLandmark) {
    return `Continue past ${formatLandmarkWithSide(approachLandmark)}, then ${lowerTurnText}.`;
  }
  if (isFinalTurn) return `${turnText} toward ${destinationName}.`;
  return `${turnText}.`;
}

function formatLandmarkWithSide(landmark) {
  if (!landmark?.side) return landmark?.label ?? "the landmark";
  return `${landmark.label} on your ${landmark.side}`;
}

function normalizeInstruction(instruction) {
  const coordinate = instruction.coordinate ?? null;
  const distanceMeters =
    instruction.distanceMeters === undefined
      ? undefined
      : Math.round(instruction.distanceMeters * 10) / 10;

  return {
    ...instruction,
    text: instruction.text,
    instruction: instruction.text,
    floorId: normalizeFloorId(instruction.floorId),
    floor: Number(String(instruction.floorId).replace(/^F/i, "")),
    distanceMeters,
    distance: distanceMeters ?? 0,
    coordinate,
    coords: coordinate ? [coordinate.lng, coordinate.lat] : undefined,
  };
}

function normalizeConnectorType(connectorType, userPreference) {
  if (userPreference === "accessible" || userPreference === "elevator") {
    return connectorType === "elevator" ? "elevator" : "stairs";
  }
  return connectorType === "elevator" ? "elevator" : "stairs";
}

function getConnectorNoun(connectorType, verticalSegment) {
  if (connectorType === "elevator") return "elevator";

  const name = String(verticalSegment.connectorName ?? "").toLowerCase();
  if (name.includes("stair case") || name.includes("staircase")) {
    return "staircase";
  }

  return "stairs";
}

function turnDirectionToText(turnDirection) {
  switch (turnDirection) {
    case "slight-left":
      return "Bear slightly left";
    case "slight-right":
      return "Bear slightly right";
    case "left":
      return "Turn left";
    case "right":
      return "Turn right";
    case "sharp-left":
      return "Make a sharp left";
    case "sharp-right":
      return "Make a sharp right";
    case "u-turn":
      return "Make a U-turn";
    default:
      return "Continue straight";
  }
}

function getTurnSide(turnDirection) {
  if (turnDirection === "left" || turnDirection === "slight-left" || turnDirection === "sharp-left") {
    return "left";
  }
  if (turnDirection === "right" || turnDirection === "slight-right" || turnDirection === "sharp-right") {
    return "right";
  }
  return null;
}

function haversineDistance(pointA, pointB) {
  const earthRadiusMeters = 6371000;
  const lat1 = toRadians(pointA.lat);
  const lat2 = toRadians(pointB.lat);
  const deltaLat = toRadians(pointB.lat - pointA.lat);
  const deltaLng = toRadians(pointB.lng - pointA.lng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(distanceMeters) {
  const rounded = Math.max(1, Math.round(distanceMeters));
  return `${rounded} meter${rounded === 1 ? "" : "s"}`;
}

function logInstructionDebug({
  routeType,
  floorId,
  floorSegments,
  renderedRouteCoordinateCount,
  simplifiedRouteCoordinateCount,
  orderedRouteCoordinates,
  bearings,
  turnAngles,
  classifiedTurnDirections,
  meaningfulTurnCount,
  landmarksByTurn,
  selectedVerticalConnector,
  generatedInstructions,
  enabled,
}) {
  const shouldLog =
    enabled !== false &&
    (typeof import.meta === "undefined" || import.meta.env?.DEV !== false);

  if (!shouldLog) return;

  console.log("[RouteInstructions] analysis", {
    routeType,
    floorId,
    floorSegments,
    renderedRouteCoordinateCount,
    simplifiedRouteCoordinateCount,
    orderedRouteCoordinates,
    computedBearings: bearings,
    computedTurnAngles: turnAngles,
    classifiedTurnDirections,
    meaningfulTurnCount,
    turnAngles: turnAngles?.map((turn) => turn.angle),
    landmarksByTurn,
    selectedVerticalConnector,
    generatedInstructionCount: generatedInstructions?.length ?? 0,
    generatedInstructionList: generatedInstructions,
  });
}

function round(value, decimals = 1) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function formatFloor(floorId) {
  return `Floor ${String(floorId).replace(/^F/i, "")}`;
}

function lowercaseFirst(text) {
  if (!text) return "";
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function normalizeFloorId(floorId) {
  const text = String(floorId);
  return text.startsWith("F") ? text : `F${text}`;
}

function normalizeDegrees(degrees) {
  return (degrees + 360) % 360;
}

function normalizeSignedDegrees(degrees) {
  let normalized = normalizeDegrees(degrees);
  if (normalized > 180) normalized -= 360;
  return normalized;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}
