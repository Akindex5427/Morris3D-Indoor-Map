const DEFAULT_THRESHOLDS = {
  straightMaxDegrees: 25,
  slightMaxDegrees: 60,
  turnMaxDegrees: 135,
  minInstructionDistanceMeters: 2,
  minSegmentDistanceMeters: 1.2,
  duplicatePointDistanceMeters: 0.35,
  waypointLabelDistanceMeters: 4,
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
  const waypointLabels = normalizeWaypointLabels(options.waypointLabels ?? options.waypoints);
  const floorKey = normalizeFloorId(floorId);
  const analysis = analyzeRouteGeometry({
    points,
    graph,
    nodeIds: [],
    thresholds,
    waypointLabels,
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
      renderedRouteCoordinateCount: renderedPoints.length,
      simplifiedRouteCoordinateCount: points.length,
      orderedRouteCoordinates: points,
      bearings: analysis.bearings,
      turnAngles: analysis.turnAngles,
      classifiedTurnDirections: analysis.classifiedTurnDirections,
      meaningfulTurnCount: analysis.meaningfulTurns.length,
      waypointLabelsByTurn: analysis.meaningfulTurns.map((turn) => ({
        waypointIndex: turn.waypointIndex,
        label: turn.nearestWaypointLabel?.label ?? null,
        distanceMeters: turn.nearestWaypointLabel
          ? round(turn.nearestWaypointLabel.distanceMeters, 1)
          : null,
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
      waypointLabels,
      start: points[actionStartIndex],
      end: turn.coordinate,
      excludeLabel: turn.nearestWaypointLabel?.label,
      thresholds,
    });
    const turnText = buildTurnInstructionText({
      turnDirection: turn.turnDirection,
      waypointLabel: turn.nearestWaypointLabel?.label,
      approachLabel: landmark?.label,
      destinationName,
      isFinalTurn: turn.waypointIndex === points.length - 2,
    });

    if (
      segmentDistance >= thresholds.minInstructionDistanceMeters &&
      !landmark &&
      !turn.nearestWaypointLabel
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
          landmark || turn.nearestWaypointLabel ? segmentDistance : 0,
        turnDirection: turn.turnDirection,
        waypointLabelUsed:
          landmark?.label ?? turn.nearestWaypointLabel?.label ?? null,
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
      waypointLabels,
      start: points[actionStartIndex],
      end: points[points.length - 1],
      thresholds,
    });
    const text = analysis.meaningfulTurns.length === 0
      ? landmark
        ? `Continue straight past ${landmark.label} for ${formatDistance(remainingDistance)}.`
        : `Continue straight for ${formatDistance(remainingDistance)}.`
      : landmark
        ? `Continue past ${landmark.label} for ${formatDistance(remainingDistance)}.`
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
    waypointLabelsByTurn: analysis.meaningfulTurns.map((turn) => ({
      waypointIndex: turn.waypointIndex,
      label:
        instructions.find(
          (instruction) => instruction.id === `${floorKey}-turn-${turn.waypointIndex}`,
        )?.waypointLabelUsed ?? null,
      nearestTurnLabel: turn.nearestWaypointLabel?.label ?? null,
      nearestTurnLabelDistanceMeters: turn.nearestWaypointLabel
        ? round(turn.nearestWaypointLabel.distanceMeters, 1)
        : null,
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
          waypointLabels:
            options.waypointLabelsByFloor?.[segment.floorId] ??
            options.waypointLabelsByFloor?.[Number(segment.floorId)] ??
            options.waypointLabelsByFloor?.[normalizeFloorId(segment.floorId)] ??
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
      const segmentWaypointLabels = normalizeWaypointLabels(
        options.waypointLabelsByFloor?.[segment.floorId] ??
          options.waypointLabelsByFloor?.[Number(segment.floorId)] ??
          options.waypointLabelsByFloor?.[normalizeFloorId(segment.floorId)] ??
          [],
      );
      const simplifiedSegmentPoints = simplifyRoutePolyline(segmentPoints, {
        ...DEFAULT_THRESHOLDS,
        ...(options.thresholds ?? {}),
      });
      const segmentAnalysis = analyzeRouteGeometry({
        points: simplifiedSegmentPoints,
        graph: graphsByFloor[segment.floorId] ?? graphsByFloor[normalizeFloorId(segment.floorId)],
        nodeIds: segment.route?.debug?.graphNodeIds ?? [],
        thresholds: { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) },
        waypointLabels: segmentWaypointLabels,
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
        waypointLabelsByTurn: segmentAnalysis.meaningfulTurns.map((turn) => ({
          waypointIndex: turn.waypointIndex,
          label: turn.nearestWaypointLabel?.label ?? null,
          distanceMeters: turn.nearestWaypointLabel
            ? round(turn.nearestWaypointLabel.distanceMeters, 1)
            : null,
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
  waypointLabels = [],
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

    const nearestWaypointLabel = findNearestWaypointLabel(
      points[index],
      waypointLabels,
      thresholds.waypointLabelDistanceMeters,
    );

    waypoints.push({
      waypointIndex: index,
      coordinate: points[index],
      incomingBearing: bearings[index - 1]?.bearing,
      outgoingBearing: bearings[index]?.bearing,
      turnAngle: round(turnAngle, 1),
      turnDirection,
      intersectionChoice,
      nearestWaypointLabel,
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
      nearestWaypointLabel: waypoint.nearestWaypointLabel
        ? {
            label: waypoint.nearestWaypointLabel.label,
            distanceMeters: round(waypoint.nearestWaypointLabel.distanceMeters, 1),
          }
        : null,
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

function normalizeWaypointLabels(waypoints) {
  if (!Array.isArray(waypoints)) return [];

  return waypoints
    .map((waypoint) => {
      const label = waypoint?.label ?? waypoint?.name;
      const coords = waypoint?.coords;
      const point =
        waypoint?.lat !== undefined && waypoint?.lng !== undefined
          ? { lat: waypoint.lat, lng: waypoint.lng }
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
        label: String(label),
        point,
      };
    })
    .filter(Boolean);
}

function findNearestWaypointLabel(point, waypointLabels, maxDistanceMeters) {
  if (!point || !Array.isArray(waypointLabels) || waypointLabels.length === 0) {
    return null;
  }

  let nearest = null;
  for (const waypoint of waypointLabels) {
    const distanceMeters = haversineDistance(point, waypoint.point);
    if (distanceMeters > maxDistanceMeters) continue;
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      nearest = {
        ...waypoint,
        distanceMeters,
      };
    }
  }
  return nearest;
}

function findHelpfulLandmarkOnSegment({
  waypointLabels,
  start,
  end,
  excludeLabel,
  thresholds,
}) {
  if (
    !Array.isArray(waypointLabels) ||
    waypointLabels.length === 0 ||
    !start ||
    !end
  ) {
    return null;
  }

  const segmentDistance = haversineDistance(start, end);
  if (segmentDistance < thresholds.landmarkSegmentMinDistanceMeters) return null;

  const candidates = waypointLabels
    .filter((waypoint) => waypoint.label !== excludeLabel)
    .map((waypoint) => {
      const along = distanceAlongSegment(start, end, waypoint.point);
      return {
        ...waypoint,
        ...along,
      };
    })
    .filter(
      (waypoint) =>
        waypoint.t > 0.2 &&
        waypoint.t < 0.8 &&
        waypoint.crossTrackDistanceMeters <=
          thresholds.waypointLabelDistanceMeters,
    )
    .sort((left, right) => left.t - right.t);

  return candidates[0] ?? null;
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
  waypointLabel,
  approachLabel,
  destinationName,
  isFinalTurn,
}) {
  const turnText = turnDirectionToText(turnDirection);
  const lowerTurnText = lowercaseFirst(turnText);
  if (approachLabel) return `Continue past ${approachLabel}, then ${lowerTurnText}.`;
  if (waypointLabel) return `Continue to ${waypointLabel}, then ${lowerTurnText}.`;
  if (isFinalTurn) return `${turnText} toward ${destinationName}.`;
  return `${turnText}.`;
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
  waypointLabelsByTurn,
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
    waypointLabelsByTurn,
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
