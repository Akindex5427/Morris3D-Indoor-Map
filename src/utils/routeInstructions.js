const DEFAULT_THRESHOLDS = {
  straightMaxDegrees: 35,
  slightMaxDegrees: 60,
  turnMaxDegrees: 135,
  minInstructionDistanceMeters: 2,
  minSegmentDistanceMeters: 1.2,
  minTurnLegDistanceMeters: 2.5,
  meaningfulTurnMinDegrees: 35,
  duplicatePointDistanceMeters: 0.35,
  landmarkDistanceMeters: 4.5,
  landmarkSegmentMinDistanceMeters: 14,
  landmarkTurnRadiusMeters: 6,
  landmarkBeforeAfterMeters: 10,
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
  return `sharp-${side}`;
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
  const connectorType = normalizeConnectorType(verticalSegment, options.userPreference);
  const fromFloor = normalizeFloorId(verticalSegment.fromFloor);
  const toFloor = normalizeFloorId(verticalSegment.toFloor);
  const connectorNoun = getConnectorNoun(connectorType, verticalSegment);

  const instruction = normalizeInstruction({
    id: options.id ?? `vertical-${fromFloor}-${toFloor}`,
    floorId: fromFloor,
    type: "vertical",
    text: `Take the ${connectorNoun} to ${formatFloor(toFloor)}.`,
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
  const startLabel = normalizePlaceLabel(startName, "start");
  const destinationLabel = normalizePlaceLabel(destinationName, "destination");
  const renderedPoints = normalizeRoutePoints(routeResult);
  const points = simplifyRoutePolyline(renderedPoints, thresholds);
  const floorKey = normalizeFloorId(floorId);
  const analysis = analyzeRouteGeometry({
    points,
    graph,
    nodeIds: [],
    thresholds,
  });
  const routeMeasures = computeRouteMeasures(points);
  const landmarks = enrichLandmarksForRoute({
    landmarks: normalizeRouteLandmarks(options.landmarks ?? []),
    points,
    routeMeasures,
    turns: analysis.meaningfulTurns,
    thresholds,
  });
  const usedLandmarkIds = new Set();

  if (points.length < 2) {
    const instructions = [
      normalizeInstruction({
        id: `${floorKey}-arrival`,
        floorId: floorKey,
        type: "arrival",
        text: `You have arrived at ${destinationLabel}.`,
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
      selectedLandmarks: landmarks,
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
      text: `Start at ${startLabel}.`,
      coordinate: points[0],
      outgoingBearing: points.length >= 2 ? round(computeBearing(points[0], points[1]), 1) : null,
      icon: ">",
    }),
  ];

  const SEPARATE_PASSING_MIN_METERS = 25;
  let actionStartIndex = 0;
  let cumulativeDistance = 0;

  for (const turn of analysis.meaningfulTurns) {
    const segmentDistance = estimateSegmentDistance(
      points.slice(actionStartIndex, turn.waypointIndex + 1),
    );
    cumulativeDistance += segmentDistance;
    const isLong = segmentDistance >= thresholds.minInstructionDistanceMeters;
    const shouldSeparatePassing = segmentDistance > SEPARATE_PASSING_MIN_METERS;

    const actionStartAlong = routeMeasures[actionStartIndex] ?? 0;
    const turnAlong = routeMeasures[turn.waypointIndex] ?? actionStartAlong;
    const approachLandmarks = findLandmarksOnRouteWindow({
      landmarks,
      startAlong: actionStartAlong,
      endAlong: turnAlong,
      thresholds,
      usedLandmarkIds,
      limit: 2,
      preferNearEnd: true,
    });
    const approachIds = new Set(approachLandmarks.map((l) => l.id));
    const atLandmark = findLandmarkNearRoutePosition({
      landmarks,
      alongRouteMeters: turnAlong,
      radiusMeters: thresholds.landmarkTurnRadiusMeters,
      thresholds,
      usedLandmarkIds,
      excludeIds: approachIds,
    });

    // Long segments: emit a separate "passing" instruction so the turn stays
    // concise.  Short segments: fold approach landmarks into the turn text.
    let turnApproachLandmarks = approachLandmarks;

    if (shouldSeparatePassing && approachLandmarks.length > 0) {
      instructions.push(
        normalizeInstruction({
          id: `${floorKey}-passing-${turn.waypointIndex}`,
          floorId: floorKey,
          type: "straight",
          text: buildStraightInstructionText({
            landmarks: approachLandmarks,
            distance: segmentDistance,
            isAfterTurn: instructions.length > 1,
          }),
          distanceMeters: segmentDistance,
          coordinate: approachLandmarks[0].coordinate,
          outgoingBearing: actionStartIndex + 1 < points.length ? round(computeBearing(points[actionStartIndex], points[actionStartIndex + 1]), 1) : null,
          cumulativeDistance,
          icon: ">",
        }),
      );
      for (const lm of approachLandmarks) usedLandmarkIds.add(lm.id);
      turnApproachLandmarks = [];
    } else if (isLong && approachLandmarks.length === 0 && !atLandmark) {
      instructions.push(
        normalizeInstruction({
          id: `${floorKey}-straight-${turn.waypointIndex}`,
          floorId: floorKey,
          type: "straight",
          text: `Continue straight for ${formatDistance(segmentDistance)}.`,
          distanceMeters: segmentDistance,
          turnDirection: "straight",
          coordinate: turn.coordinate,
          outgoingBearing: actionStartIndex + 1 < points.length ? round(computeBearing(points[actionStartIndex], points[actionStartIndex + 1]), 1) : null,
          cumulativeDistance,
          icon: ">",
        }),
      );
      turnApproachLandmarks = [];
    }

    const turnText = buildTurnInstructionText({
      turnDirection: turn.turnDirection,
      approachLandmarks: turnApproachLandmarks,
      atLandmark,
      destinationName: destinationLabel,
      segmentDistance,
      isFinalTurn: turn.waypointIndex === points.length - 2,
    });

    for (const lm of turnApproachLandmarks) usedLandmarkIds.add(lm.id);
    if (atLandmark) usedLandmarkIds.add(atLandmark.id);

    instructions.push(
      normalizeInstruction({
        id: `${floorKey}-turn-${turn.waypointIndex}`,
        floorId: floorKey,
        type: "turn",
        text: turnText,
        distanceMeters: (atLandmark || turnApproachLandmarks.length > 0) ? segmentDistance : 0,
        turnDirection: turn.turnDirection,
        landmarkUsed: atLandmark?.label ?? turnApproachLandmarks[0]?.label ?? null,
        coordinate: turn.coordinate,
        outgoingBearing: turn.waypointIndex + 1 < points.length ? round(computeBearing(points[turn.waypointIndex], points[turn.waypointIndex + 1]), 1) : null,
        cumulativeDistance,
        icon: getTurnIcon(turn.turnDirection),
      }),
    );

    actionStartIndex = turn.waypointIndex;
  }

  const remainingDistance = estimateSegmentDistance(points.slice(actionStartIndex));
  cumulativeDistance += remainingDistance;

  const remainingLandmarks = findLandmarksOnRouteWindow({
    landmarks,
    startAlong: routeMeasures[actionStartIndex] ?? 0,
    endAlong: routeMeasures[points.length - 1] ?? 0,
    thresholds,
    usedLandmarkIds,
    limit: 2,
  });
  const arrivalLandmark = findLandmarkNearRoutePosition({
    landmarks,
    alongRouteMeters: routeMeasures[points.length - 1] ?? 0,
    radiusMeters: 8,
    thresholds,
    usedLandmarkIds,
    excludeIds: new Set(remainingLandmarks.map((l) => l.id)),
  });

  if (remainingDistance >= thresholds.minInstructionDistanceMeters) {
    instructions.push(
      normalizeInstruction({
        id: `${floorKey}-final-straight`,
        floorId: floorKey,
        type: "straight",
        text: buildFinalApproachText({
          landmarks: remainingLandmarks,
          distance: remainingDistance,
          isAfterTurn: analysis.meaningfulTurns.length > 0,
          destinationName: destinationLabel,
          isConnectorApproach: options.connectorApproach === true,
        }),
        distanceMeters: remainingDistance,
        turnDirection: "straight",
        coordinate: remainingLandmarks[0]?.coordinate ?? points[points.length - 1],
        outgoingBearing: actionStartIndex + 1 < points.length ? round(computeBearing(points[actionStartIndex], points[actionStartIndex + 1]), 1) : null,
        cumulativeDistance,
        icon: ">",
      }),
    );
    for (const lm of remainingLandmarks) usedLandmarkIds.add(lm.id);
  }

  if (arrivalLandmark) usedLandmarkIds.add(arrivalLandmark.id);

  instructions.push(
    normalizeInstruction({
      id: `${floorKey}-arrival`,
      floorId: floorKey,
      type: "arrival",
      text: buildArrivalInstructionText({ destinationName: destinationLabel, nearLandmark: arrivalLandmark }),
      coordinate: points[points.length - 1],
      outgoingBearing: null,
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
    selectedLandmarks: landmarks,
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

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex];
    if (segment.type === "horizontal") {
      const isFirstHorizontal = segment === horizontalSegments[0];
      const isLastHorizontal = segment === horizontalSegments[horizontalSegments.length - 1];

      // Determine connector names for approach / exit instructions.
      const prevSegment = segments[segmentIndex - 1];
      const nextSegment = segments[segmentIndex + 1];
      const prevVertical = prevSegment?.type === "vertical-transition" ? prevSegment : null;
      const nextVertical = nextSegment?.type === "vertical-transition" ? nextSegment : null;

      const connectorDestName = nextVertical
        ? getConnectorDisplayName(nextVertical.connectorType, nextVertical.connectorName)
        : null;
      const connectorStartName = prevVertical
        ? getConnectorDisplayName(prevVertical.connectorType, prevVertical.connectorName)
        : null;

      const segmentInstructions = generateRouteInstructions({
        routeResult: segment.route,
        floorId: segment.floorId,
        graph: graphsByFloor[segment.floorId] ?? graphsByFloor[normalizeFloorId(segment.floorId)],
        startName: isFirstHorizontal ? startName : (connectorStartName ?? "vertical connector"),
        destinationName: isLastHorizontal ? destinationName : (connectorDestName ?? "vertical connector"),
        options: {
          ...options,
          landmarks:
            options.landmarksByFloor?.[segment.floorId] ??
            options.landmarksByFloor?.[Number(segment.floorId)] ??
            options.landmarksByFloor?.[normalizeFloorId(segment.floorId)] ??
            [],
          routeType: "multi-floor",
          debug: false,
          // Use connector-aware phrasing ("Proceed to the stairs.") for short
          // final approaches that end at a vertical connector, not the destination.
          connectorApproach: !isLastHorizontal,
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

  const meaningfulTurns = waypoints.filter((waypoint) => {
    if (waypoint.turnDirection === "straight") return false;

    const incomingDistance =
      bearings[waypoint.waypointIndex - 1]?.distanceMeters ?? 0;
    const outgoingDistance = bearings[waypoint.waypointIndex]?.distanceMeters ?? 0;
    const hasMeaningfulLegs =
      incomingDistance >= thresholds.minTurnLegDistanceMeters &&
      outgoingDistance >= thresholds.minTurnLegDistanceMeters;
    const isStrongTurn =
      Math.abs(waypoint.turnAngle) >= thresholds.meaningfulTurnMinDegrees;

    return hasMeaningfulLegs && isStrongTurn;
  });

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

  while (changed && pass < 8) {
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
      const shortestLeg = Math.min(incomingDistance, outgoingDistance);
      const isNearCollinear = magnitude <= thresholds.straightMaxDegrees;
      const isTinyNoiseBend =
        shortestLeg < thresholds.minSegmentDistanceMeters &&
        magnitude <= thresholds.meaningfulTurnMinDegrees;

      if (isNearCollinear || isTinyNoiseBend) {
        changed = true;
        continue;
      }

      next.push(current);
    }

    next.push(simplified[simplified.length - 1]);
    simplified = next;
  }

  // Douglas–Peucker pass: removes any intermediate point whose perpendicular
  // Keep this as a local bearing-run simplification. A global line simplifier
  // can erase visible doglegs whose endpoints nearly align.
  return simplified;
}

// Maximum absolute distance between two opposite-side landmarks for them to
// be treated as a corridor pair ("between X and Y").
const CORRIDOR_PAIR_MAX_METERS = 12;

function computeRouteMeasures(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const measures = [0];
  for (let index = 1; index < points.length; index += 1) {
    measures[index] = measures[index - 1] + haversineDistance(points[index - 1], points[index]);
  }
  return measures;
}

function enrichLandmarksForRoute({
  landmarks,
  points,
  routeMeasures,
  turns,
  thresholds,
}) {
  if (!Array.isArray(landmarks) || landmarks.length === 0 || points.length < 2) {
    return [];
  }

  return landmarks
    .map((landmark) => {
      const routePosition = nearestLandmarkRoutePosition({
        landmark,
        points,
        routeMeasures,
      });
      if (!routePosition) return null;

      const nearestTurn = findNearestTurnToAlongRoute({
        turns,
        routeMeasures,
        alongRouteMeters: routePosition.alongRouteMeters,
      });
      const nearTurn =
        nearestTurn &&
        nearestTurn.distanceMeters <= thresholds.landmarkTurnRadiusMeters;

      return {
        ...landmark,
        side: routePosition.side ?? landmark.side ?? null,
        point: routePosition.routePoint,
        routePoint: routePosition.routePoint,
        coordinate: routePosition.routePoint,
        coords: [routePosition.routePoint.lng, routePosition.routePoint.lat],
        segmentIndex: routePosition.segmentIndex,
        t: routePosition.t,
        distanceMeters: Math.min(
          routePosition.crossTrackDistanceMeters,
          landmark.distanceMeters ?? Infinity,
        ),
        crossTrackDistanceMeters: routePosition.crossTrackDistanceMeters,
        alongRouteMeters: routePosition.alongRouteMeters,
        nearTurn,
        turnWaypointIndex: nearTurn ? nearestTurn.turn.waypointIndex : null,
        distanceToTurnMeters: nearestTurn?.distanceMeters ?? null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.alongRouteMeters - right.alongRouteMeters);
}

function nearestLandmarkRoutePosition({ landmark, points, routeMeasures }) {
  const routeAccessPoint = landmark?.point ?? landmark?.roomCoordinate;
  const sidePoint = landmark?.roomCoordinate ?? landmark?.point;
  if (!routeAccessPoint || !sidePoint) return null;

  let best = null;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const projected = projectPointToSegment(routeAccessPoint, start, end);
    const segmentDistance = haversineDistance(start, end);
    const alongRouteMeters =
      (routeMeasures[index - 1] ?? 0) + segmentDistance * projected.t;
    const side = sideOfRouteSegment(start, end, sidePoint) ?? landmark.side ?? null;
    const candidate = {
      ...projected,
      segmentIndex: index - 1,
      alongRouteMeters,
      side,
    };
    if (!best || candidate.crossTrackDistanceMeters < best.crossTrackDistanceMeters) {
      best = candidate;
    }
  }

  return best;
}

function projectPointToSegment(point, start, end) {
  const projectedPoint = projectLocalMeters(point, start);
  const segmentEnd = projectLocalMeters(end, start);
  const lengthSquared = segmentEnd.x * segmentEnd.x + segmentEnd.y * segmentEnd.y;
  const rawT =
    lengthSquared > 0
      ? (projectedPoint.x * segmentEnd.x + projectedPoint.y * segmentEnd.y) /
        lengthSquared
      : 0;
  const t = Math.max(0, Math.min(1, rawT));
  const closestMeters = {
    x: segmentEnd.x * t,
    y: segmentEnd.y * t,
  };
  return {
    t,
    routePoint: unprojectLocalMeters(closestMeters, start),
    crossTrackDistanceMeters: Math.hypot(
      projectedPoint.x - closestMeters.x,
      projectedPoint.y - closestMeters.y,
    ),
  };
}

function sideOfRouteSegment(start, end, point) {
  const projectedPoint = projectLocalMeters(point, start);
  const segmentEnd = projectLocalMeters(end, start);
  const cross = segmentEnd.x * projectedPoint.y - segmentEnd.y * projectedPoint.x;
  if (Math.abs(cross) < 0.01) return null;
  return cross > 0 ? "left" : "right";
}

function unprojectLocalMeters(point, origin) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng =
    metersPerDegreeLat * Math.cos(toRadians(origin.lat));
  return {
    lng: origin.lng + point.x / metersPerDegreeLng,
    lat: origin.lat + point.y / metersPerDegreeLat,
  };
}

function findNearestTurnToAlongRoute({ turns, routeMeasures, alongRouteMeters }) {
  if (!Array.isArray(turns) || turns.length === 0) return null;

  let nearest = null;
  for (const turn of turns) {
    const turnAlong = routeMeasures[turn.waypointIndex];
    if (!Number.isFinite(turnAlong)) continue;
    const distanceMeters = Math.abs(turnAlong - alongRouteMeters);
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      nearest = { turn, distanceMeters };
    }
  }
  return nearest;
}

function findLandmarksOnRouteWindow({
  landmarks,
  startAlong,
  endAlong,
  thresholds,
  usedLandmarkIds,
  limit = 3,
  preferNearEnd = false,
}) {
  if (!Array.isArray(landmarks) || landmarks.length === 0) return [];

  const windowStart = Math.min(startAlong, endAlong);
  const windowEnd = Math.max(startAlong, endAlong);
  const segmentDistance = windowEnd - windowStart;
  if (segmentDistance < thresholds.landmarkSegmentMinDistanceMeters) return [];

  const candidates = landmarks
    .filter((lm) => !usedLandmarkIds?.has(lm.id))
    .filter((lm) => {
      if (!Number.isFinite(lm.alongRouteMeters)) return false;
      if (lm.crossTrackDistanceMeters > thresholds.landmarkDistanceMeters) return false;
      return (
        lm.alongRouteMeters > windowStart + Math.min(1, segmentDistance * 0.04) &&
        lm.alongRouteMeters < windowEnd - Math.min(1, segmentDistance * 0.04)
      );
    })
    .map((lm) => ({
      ...lm,
      t: segmentDistance > 0 ? (lm.alongRouteMeters - windowStart) / segmentDistance : 0,
      distanceFromWindowEndMeters: windowEnd - lm.alongRouteMeters,
    }))
    .sort((a, b) =>
      preferNearEnd
        ? a.distanceFromWindowEndMeters - b.distanceFromWindowEndMeters
        : a.alongRouteMeters - b.alongRouteMeters,
    );

  if (candidates.length < 2) {
    return candidates
      .sort(compareLandmarkVisibility)
      .slice(0, limit)
      .sort((a, b) => a.alongRouteMeters - b.alongRouteMeters);
  }

  const corridorPair = findCorridorPair(candidates);
  if (corridorPair) {
    const pair = corridorPair.sort((a, b) => a.alongRouteMeters - b.alongRouteMeters);
    if (limit <= 2) return pair;
    const others = candidates
      .filter((candidate) => !pair.some((paired) => paired.id === candidate.id))
      .slice(0, limit - 2)
      .sort((a, b) => a.alongRouteMeters - b.alongRouteMeters);
    return [...pair, ...others];
  }

  return candidates
    .sort(compareLandmarkVisibility)
    .slice(0, limit)
    .sort((a, b) => a.alongRouteMeters - b.alongRouteMeters);
}

function findCorridorPair(candidates) {
  let best = null;
  for (const left of candidates.filter((candidate) => candidate.side === "left")) {
    for (const right of candidates.filter((candidate) => candidate.side === "right")) {
      const spacing = Math.abs(left.alongRouteMeters - right.alongRouteMeters);
      if (spacing > CORRIDOR_PAIR_MAX_METERS) continue;
      const visibilityScore =
        spacing +
        ((left.crossTrackDistanceMeters ?? left.distanceMeters ?? 0) +
          (right.crossTrackDistanceMeters ?? right.distanceMeters ?? 0)) *
          2;
      if (!best || visibilityScore < best.visibilityScore) {
        best = { pair: [left, right], spacing, visibilityScore };
      }
    }
  }
  return best?.pair ?? null;
}

function compareLandmarkVisibility(left, right) {
  const leftDistance = left.crossTrackDistanceMeters ?? left.distanceMeters ?? Infinity;
  const rightDistance = right.crossTrackDistanceMeters ?? right.distanceMeters ?? Infinity;
  if (Math.abs(leftDistance - rightDistance) > 0.25) {
    return leftDistance - rightDistance;
  }
  return left.alongRouteMeters - right.alongRouteMeters;
}

function findLandmarkNearRoutePosition({
  landmarks,
  alongRouteMeters,
  radiusMeters,
  thresholds,
  usedLandmarkIds,
  excludeIds,
}) {
  if (!Array.isArray(landmarks) || !Number.isFinite(alongRouteMeters)) return null;
  let best = null;
  for (const lm of landmarks) {
    if (usedLandmarkIds?.has(lm.id)) continue;
    if (excludeIds?.has(lm.id)) continue;
    if (lm.crossTrackDistanceMeters > (thresholds?.landmarkDistanceMeters ?? DEFAULT_THRESHOLDS.landmarkDistanceMeters)) continue;
    const dist = Math.abs(lm.alongRouteMeters - alongRouteMeters);
    if (dist <= radiusMeters && (!best || dist < best._nearDist)) {
      best = { ...lm, _nearDist: dist };
    }
  }
  return best;
}

function findLandmarksOnSegment({
  landmarks,
  start,
  end,
  thresholds,
  usedLandmarkIds,
  limit = 3,
}) {
  if (!Array.isArray(landmarks) || landmarks.length === 0 || !start || !end) {
    return [];
  }
  const segmentDistance = haversineDistance(start, end);
  if (segmentDistance < thresholds.landmarkSegmentMinDistanceMeters) return [];

  const candidates = landmarks
    .filter((lm) => !usedLandmarkIds?.has(lm.id))
    .map((lm) => ({ ...lm, ...distanceAlongSegment(start, end, lm.point) }))
    .filter(
      (lm) =>
        lm.t > 0.05 &&
        lm.t < 0.95 &&
        lm.crossTrackDistanceMeters <= thresholds.landmarkDistanceMeters,
    )
    .sort((a, b) => a.t - b.t);

  if (candidates.length < 2) return candidates.slice(0, limit);

  // Prefer a corridor pair (one landmark on each side at a similar route
  // position) over two same-side landmarks — it enables the "between X and Y"
  // instruction pattern.
  const corridorMaxT =
    segmentDistance > 0 ? CORRIDOR_PAIR_MAX_METERS / segmentDistance : 1;
  const leftCandidate  = candidates.find((c) => c.side === "left");
  const rightCandidate = candidates.find((c) => c.side === "right");

  if (
    leftCandidate &&
    rightCandidate &&
    Math.abs(leftCandidate.t - rightCandidate.t) <= corridorMaxT
  ) {
    const pair = [leftCandidate, rightCandidate].sort((a, b) => a.t - b.t);
    if (limit <= 2) return pair;
    const others = candidates
      .filter((c) => c.id !== leftCandidate.id && c.id !== rightCandidate.id)
      .slice(0, limit - 2);
    return [...pair, ...others];
  }

  return candidates.slice(0, limit);
}

function findLandmarkNearPoint({ landmarks, point, radiusMeters, usedLandmarkIds, excludeIds }) {
  if (!Array.isArray(landmarks) || !point) return null;
  let best = null;
  for (const lm of landmarks) {
    if (usedLandmarkIds?.has(lm.id)) continue;
    if (excludeIds?.has(lm.id)) continue;
    const dist = haversineDistance(point, lm.point);
    if (dist <= radiusMeters && (!best || dist < best._nearDist)) {
      best = { ...lm, _nearDist: dist };
    }
  }
  return best;
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

// Returns the perpendicular distance (in metres) from `point` to the infinite
// line through `lineStart` → `lineEnd`, clamped to the segment endpoints.
function perpendicularDistanceMeters(point, lineStart, lineEnd) {
  const p = projectLocalMeters(point, lineStart);
  const e = projectLocalMeters(lineEnd, lineStart);
  const lenSq = e.x * e.x + e.y * e.y;
  if (lenSq < 1e-10) return haversineDistance(point, lineStart);
  const t = Math.max(0, Math.min(1, (p.x * e.x + p.y * e.y) / lenSq));
  return Math.hypot(p.x - e.x * t, p.y - e.y * t);
}

// Recursive Douglas–Peucker simplification.
// Removes intermediate points that deviate less than `epsilonMeters` from
// the straight line between the first and last point of the current window.
function douglasPeucker(points, epsilonMeters) {
  if (points.length < 3) return points;

  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = 0;
  let maxIdx = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistanceMeters(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilonMeters) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilonMeters);
    const right = douglasPeucker(points.slice(maxIdx), epsilonMeters);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
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
  approachLandmarks = [],
  atLandmark = null,
  destinationName,
  segmentDistance,
  isFinalTurn,
}) {
  const turnText = turnDirectionToText(turnDirection);
  const lower = lowercaseFirst(turnText);

  // Highest priority: a room right at the corner ("At X, turn left.")
  if (atLandmark) {
    if (isFinalTurn) return `At ${atLandmark.label}, ${lower} toward ${destinationName}.`;
    return `At ${atLandmark.label}, ${lower}.`;
  }

  // Two approach landmarks on opposite sides: "between X and Y"
  if (approachLandmarks.length >= 2) {
    const left = approachLandmarks.find((l) => l.side === "left");
    const right = approachLandmarks.find((l) => l.side === "right");
    if (left && right) {
      const isClose = segmentDistance === undefined || segmentDistance <= 25;
      if (isFinalTurn) {
        return isClose
          ? `${turnText} between ${left.label} and ${right.label}, toward ${destinationName}.`
          : `Continue between ${left.label} on your left and ${right.label} on your right, then ${lower} toward ${destinationName}.`;
      }
      return isClose
        ? `${turnText} between ${left.label} and ${right.label}.`
        : `Continue between ${left.label} on your left and ${right.label} on your right, then ${lower}.`;
    }
  }

  // Single approach landmark
  if (approachLandmarks.length > 0) {
    const lm = approachLandmarks[0];
    const landmarkText = formatLandmarkWithSide(lm);
    const isClose = segmentDistance === undefined || segmentDistance <= 25;
    if (isFinalTurn) {
      return isClose
        ? `${turnText} after ${landmarkText}, toward ${destinationName}.`
        : `Continue past ${landmarkText}, then ${lower} toward ${destinationName}.`;
    }
    return isClose
      ? `${turnText} after ${landmarkText}.`
      : `Continue past ${landmarkText}, then ${lower}.`;
  }

  if (isFinalTurn) return `${turnText} toward ${destinationName}.`;
  return `${turnText}.`;
}

function buildStraightInstructionText({ landmarks = [], distance, isAfterTurn }) {
  const prefix = isAfterTurn ? "Continue" : "Continue straight";

  if (landmarks.length >= 2) {
    const left = landmarks.find((l) => l.side === "left");
    const right = landmarks.find((l) => l.side === "right");
    if (left && right) {
      return `${prefix} between ${left.label} on your left and ${right.label} on your right.`;
    }
    const side = landmarks[0].side;
    if (side === "left" || side === "right") {
      const names = landmarks.slice(0, 2).map((l) => l.label).join(", then ");
      return `${prefix}. Pass ${names} on your ${side}.`;
    }
  }

  if (landmarks.length === 1) {
    const lm = landmarks[0];
    if (lm.side === "left" || lm.side === "right") {
      return `${prefix}. Pass ${lm.label} on your ${lm.side}.`;
    }
    return `${prefix} toward ${lm.label}.`;
  }

  return `${prefix} for ${formatDistance(distance)}.`;
}

const DESTINATION_AHEAD_THRESHOLD = 15;

function buildFinalApproachText({
  landmarks = [],
  distance,
  isAfterTurn,
  destinationName,
  isConnectorApproach = false,
}) {
  const prefix = isAfterTurn ? "Continue" : "Continue straight";
  const isLongApproach = distance >= DESTINATION_AHEAD_THRESHOLD;

  if (isLongApproach) {
    if (landmarks.length >= 2) {
      const left = landmarks.find((l) => l.side === "left");
      const right = landmarks.find((l) => l.side === "right");
      if (left && right) {
        return `${prefix} between ${left.label} on your left and ${right.label} on your right toward ${destinationName}.`;
      }
    }
    if (landmarks.length === 1) {
      const lm = landmarks[0];
      if (lm.side === "left" || lm.side === "right") {
        return `Pass ${lm.label} on your ${lm.side}, then continue toward ${destinationName}.`;
      }
    }
    return `${prefix} toward ${destinationName}.`;
  }

  // Short final segment (< 15 m)
  if (isConnectorApproach) {
    return `Proceed to ${destinationName}.`;
  }
  if (landmarks.length >= 2) {
    const left = landmarks.find((l) => l.side === "left");
    const right = landmarks.find((l) => l.side === "right");
    if (left && right) {
      return `Your destination, ${destinationName}, is ahead between ${left.label} and ${right.label}.`;
    }
  }
  if (landmarks.length === 1) {
    const lm = landmarks[0];
    if (lm.side === "left") return `Your destination, ${destinationName}, is just ahead with ${lm.label} on your left.`;
    if (lm.side === "right") return `Your destination, ${destinationName}, is just ahead with ${lm.label} on your right.`;
  }
  return `Your destination, ${destinationName}, is just ahead.`;
}

function buildArrivalInstructionText({ destinationName, nearLandmark }) {
  if (!nearLandmark) return `You have arrived at ${destinationName}.`;
  const { side } = nearLandmark;
  if (side === "left" || side === "right") {
    return `You have arrived at ${destinationName}, with ${nearLandmark.label} on your ${side}.`;
  }
  return `You have arrived at ${destinationName}, near ${nearLandmark.label}.`;
}

function getTurnIcon(turnDirection) {
  if (turnDirection.includes("left")) return "<";
  if (turnDirection.includes("right")) return ">";
  if (turnDirection === "u-turn") return "U";
  return ">";
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

function normalizeConnectorType(connector, userPreference) {
  const typeText =
    typeof connector === "string"
      ? connector
      : [
          connector?.connectorType,
          connector?.type,
          connector?.connectorName,
          connector?.name,
        ]
          .filter(Boolean)
          .join(" ");
  const normalized = String(typeText ?? "").toLowerCase();

  if (/\belevators?\b|\blifts?\b/.test(normalized)) return "elevator";
  if (/\baccessible\b/.test(normalized)) return "elevator";
  if (/\bstairs?\b|\bstair\s*case\b|\bstaircase\b/.test(normalized)) return "stairs";

  if (userPreference === "accessible" || userPreference === "elevator" || userPreference === "elevator_first") {
    return "elevator";
  }

  return "stairs";
}

function getConnectorNoun(connectorType, verticalSegment) {
  if (connectorType === "elevator") return "elevator";

  const name = String(verticalSegment.connectorName ?? "").toLowerCase();
  if (name.includes("stair case") || name.includes("staircase")) {
    return "staircase";
  }

  return "stairs";
}

// Returns a definite-article display name for use in approach instructions.
// e.g. "the elevator", "the staircase", "the stairs"
function getConnectorDisplayName(connectorType, connectorName) {
  const inferredType = normalizeConnectorType({
    connectorType,
    connectorName,
  });
  if (inferredType === "elevator") return "the elevator";
  const name = String(connectorName ?? "").toLowerCase();
  if (name.includes("stair case") || name.includes("staircase")) return "the staircase";
  return "the stairs";
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
  selectedLandmarks,
  selectedVerticalConnector,
  generatedInstructions,
  enabled,
}) {
  const shouldLog =
    enabled !== false &&
    (typeof import.meta === "undefined" || import.meta.env?.DEV !== false);

  if (!shouldLog) return;

  const label = `[RouteInstructions] ${routeType ?? "route"} – floor ${floorId}`;
  console.group(label);

  console.log("coordinates →", {
    rendered: renderedRouteCoordinateCount,
    simplified: simplifiedRouteCoordinateCount,
  });

  console.log("turns →", {
    detected: meaningfulTurnCount,
    angles: turnAngles?.map(
      (t) => `${(t.angle ?? t).toFixed?.(1) ?? t}° → ${t.direction ?? ""}`,
    ),
    classified: classifiedTurnDirections,
  });

  if (Array.isArray(selectedLandmarks) && selectedLandmarks.length > 0) {
    console.group(`landmarks → ${selectedLandmarks.length} selected`);
    for (const lm of selectedLandmarks) {
      console.log(
        `  ${lm.name ?? lm.label} | side: ${lm.side} | seg: ${lm.segmentIndex} | dist: ${lm.distanceMeters?.toFixed?.(1)}m | along: ${lm.alongRouteMeters?.toFixed?.(1)}m`,
      );
    }
    console.groupEnd();
  } else {
    console.log("landmarks → none");
  }

  if (Array.isArray(generatedInstructions) && generatedInstructions.length > 0) {
    console.group(`instructions → ${generatedInstructions.length} steps`);
    for (const [index, instr] of generatedInstructions.entries()) {
      console.log(
        `  ${index + 1}. [${instr.type}] ${instr.instruction}` +
          (instr.outgoingBearing != null ? ` (bearing ${instr.outgoingBearing}°)` : ""),
      );
    }
    console.groupEnd();
  }

  if (selectedVerticalConnector) {
    console.log("vertical connector →", selectedVerticalConnector);
  }

  if (floorSegments) console.log("floor segments →", floorSegments);

  console.groupEnd();
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

function normalizePlaceLabel(label, fallback) {
  const text = String(label ?? "").trim();
  return text || fallback;
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
