const DEFAULT_THRESHOLDS = {
  straightMaxDegrees: 25,
  slightMaxDegrees: 60,
  turnMaxDegrees: 135,
  minInstructionDistanceMeters: 2,
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
  const points = normalizeRoutePoints(routeResult);
  const floorKey = normalizeFloorId(floorId);
  const analysis = analyzeRouteGeometry({
    points,
    graph,
    nodeIds: routeResult?.debug?.graphNodeIds ?? [],
    thresholds,
  });

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
      orderedRouteCoordinates: points,
      bearings: analysis.bearings,
      turnAngles: analysis.turnAngles,
      classifiedTurnDirections: analysis.classifiedTurnDirections,
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
      text: `Start on ${formatFloor(floorKey)}.`,
      coordinate: points[0],
      icon: ">",
    }),
  ];

  let straightRun = 0;
  let cumulativeDistance = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const distanceIntoWaypoint = haversineDistance(previous, current);
    const nextDistance = haversineDistance(current, next);
    straightRun += distanceIntoWaypoint;
    cumulativeDistance += distanceIntoWaypoint;

    const analysisAtWaypoint = analysis.waypoints[index - 1];
    const angle = analysisAtWaypoint?.turnAngle ?? computeTurnAngle(previous, current, next);
    const turnDirection =
      analysisAtWaypoint?.turnDirection ?? classifyTurn(angle, thresholds);

    if (turnDirection === "straight") {
      continue;
    }

    if (straightRun >= thresholds.minInstructionDistanceMeters) {
      instructions.push(
        normalizeInstruction({
          id: `${floorKey}-straight-${index}`,
          floorId: floorKey,
          type: "straight",
          text: `Go straight for ${formatDistance(straightRun)}.`,
          distanceMeters: straightRun,
          turnDirection: "straight",
          coordinate: current,
          cumulativeDistance,
          icon: ">",
        }),
      );
    }

    const intersectionChoice = detectIntersectionChoice({
      graph,
      nodeId: routeResult?.debug?.graphNodeIds?.[index],
      previousPoint: previous,
      nextPoint: next,
      thresholds,
    });
    const turnText = intersectionChoice?.text ?? turnDirectionToText(turnDirection);
    const text = `${turnText}${nextDistance >= 1 ? ` and continue for ${formatDistance(nextDistance)}` : ""}.`;

    instructions.push(
      normalizeInstruction({
        id: `${floorKey}-turn-${index}`,
        floorId: floorKey,
        type: "turn",
        text,
        distanceMeters: nextDistance,
        turnDirection,
        coordinate: current,
        cumulativeDistance,
        icon: turnDirection.includes("left") ? "<" : turnDirection.includes("right") ? ">" : "U",
      }),
    );

    straightRun = 0;
  }

  const lastSegmentDistance = haversineDistance(
    points[points.length - 2],
    points[points.length - 1],
  );
  straightRun += lastSegmentDistance;
  cumulativeDistance += lastSegmentDistance;

  if (straightRun >= thresholds.minInstructionDistanceMeters) {
    instructions.push(
      normalizeInstruction({
        id: `${floorKey}-final-straight`,
        floorId: floorKey,
        type: "straight",
        text: `Continue straight for ${formatDistance(straightRun)}.`,
        distanceMeters: straightRun,
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
    orderedRouteCoordinates: points,
    bearings: analysis.bearings,
    turnAngles: analysis.turnAngles,
    classifiedTurnDirections: analysis.classifiedTurnDirections,
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
      const segmentAnalysis = analyzeRouteGeometry({
        points: segmentPoints,
        graph: graphsByFloor[segment.floorId] ?? graphsByFloor[normalizeFloorId(segment.floorId)],
        nodeIds: segment.route?.debug?.graphNodeIds ?? [],
        thresholds: { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) },
      });
      segmentDebug.push({
        floorId: normalizeFloorId(segment.floorId),
        orderedRouteCoordinates: segmentPoints,
        computedBearings: segmentAnalysis.bearings,
        computedTurnAngles: segmentAnalysis.turnAngles,
        classifiedTurnDirections: segmentAnalysis.classifiedTurnDirections,
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

  return {
    bearings,
    waypoints,
    turnAngles: waypoints.map((waypoint) => ({
      waypointIndex: waypoint.waypointIndex,
      angle: waypoint.turnAngle,
    })),
    classifiedTurnDirections: waypoints.map((waypoint) => ({
      waypointIndex: waypoint.waypointIndex,
      turnDirection: waypoint.turnDirection,
      intersectionChoice: waypoint.intersectionChoice,
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
  orderedRouteCoordinates,
  bearings,
  turnAngles,
  classifiedTurnDirections,
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
    orderedRouteCoordinates,
    computedBearings: bearings,
    computedTurnAngles: turnAngles,
    classifiedTurnDirections,
    selectedVerticalConnector,
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
