// A* Pathfinding algorithm for indoor navigation with room grouping
// Groups multiple features with same name into logical rooms

// Calculate Euclidean distance between two points
export const distance = (p1, p2) => {
  const dx = p1[0] - p2[0];
  const dy = p1[1] - p2[1];
  return Math.sqrt(dx * dx + dy * dy);
};

// Get centroid of a room feature
export const getCentroid = (room) => {
  let coords = [];

  if (room.geometry.type === "Polygon") {
    coords = room.geometry.coordinates[0];
  } else if (room.geometry.type === "MultiPolygon") {
    coords = room.geometry.coordinates[0][0];
  } else if (room.geometry.type === "LineString") {
    coords = room.geometry.coordinates;
  }

  if (coords.length === 0) return [0, 0];

  const sum = coords.reduce(
    (acc, coord) => {
      acc[0] += coord[0];
      acc[1] += coord[1];
      return acc;
    },
    [0, 0],
  );

  return [sum[0] / coords.length, sum[1] / coords.length];
};

// Get room floor
const getRoomFloor = (room) => {
  return (
    room.properties?.floor ||
    room.properties?.nivel ||
    room.properties?.level ||
    0
  );
};

// Get room name
const getRoomName = (room) => {
  return (
    room.properties?.name ||
    room.properties?.id ||
    room.properties?.room_id ||
    ""
  );
};

// Check if room is a stairwell/elevator/corridor
const isVerticalConnector = (roomName) => {
  const name = roomName.toLowerCase();
  return (
    name.includes("stair") ||
    name.includes("escada") ||
    name.includes("elevador") ||
    name.includes("elevator") ||
    name.includes("corredor") ||
    name.includes("corridor") ||
    name.includes("hallway") ||
    name.includes("lobby")
  );
};

// Check if room is a corridor/hallway (for routing through)
const isCorridor = (roomName) => {
  const name = roomName.toLowerCase();
  return (
    name.includes("hall") ||
    name.includes("corridor") ||
    name.includes("corredor") ||
    name.includes("hallway") ||
    name.includes("lobby") ||
    name.includes("passage") ||
    name.includes("passagem")
  );
};

// Check if a room is navigable (exclude structural elements)
const isNavigableRoom = (roomName) => {
  const name = roomName.toLowerCase();
  // Exclude architectural/structural elements
  if (
    name === "floor" ||
    name === "structure" ||
    name === "void" ||
    name === "exterior"
  ) {
    return false;
  }
  return true;
};

// Group rooms by name and floor to create logical "rooms"
const groupRoomsByName = (features) => {
  const roomGroups = new Map();

  features.forEach((feature) => {
    const name = getRoomName(feature);
    const floor = getRoomFloor(feature);
    const key = `${name}_F${floor}`; // Unique key for each room on each floor

    if (!roomGroups.has(key)) {
      roomGroups.set(key, {
        name,
        floor,
        features: [],
        centroid: null,
      });
    }

    roomGroups.get(key).features.push(feature);
  });

  // Calculate centroid for each room group
  roomGroups.forEach((room) => {
    const centroids = room.features.map((f) => getCentroid(f));
    const avgCentroid = [
      centroids.reduce((sum, c) => sum + c[0], 0) / centroids.length,
      centroids.reduce((sum, c) => sum + c[1], 0) / centroids.length,
    ];
    room.centroid = avgCentroid;
  });

  return roomGroups;
};

// Build adjacency graph with corridor-aware routing
const buildRoomGraph = (roomGroups, targetFloor = null, options = {}) => {
  const { accessibility = "standard", preferences = "shortest" } = options;
  const graph = new Map();
  const rooms = Array.from(roomGroups.values());

  // Filter by floor if specified and exclude non-navigable rooms
  let filteredRooms =
    targetFloor !== null ? rooms.filter((r) => r.floor === targetFloor) : rooms;

  const beforeNavFilter = filteredRooms.length;

  // Filter based on accessibility requirements
  filteredRooms = filteredRooms.filter((r) => {
    // If wheelchair accessible needed, filter out stairs-only routes
    if (accessibility === "wheelchair") {
      // Allow elevators and corridors, exclude stairs
      return !r.name.toLowerCase().includes("stair");
    }
    // If avoiding stairs, exclude them
    if (accessibility === "stairs_avoid") {
      return !r.name.toLowerCase().includes("stair");
    }
    return true;
  });

  // Further filter to only include navigable rooms
  filteredRooms = filteredRooms.filter((r) => isNavigableRoom(r.name));
  const afterNavFilter = filteredRooms.length;

  console.log(
    `[Pathfinding] Graph building: ${beforeNavFilter} rooms before filters, ${afterNavFilter} after (accessibility: ${accessibility})`,
  );

  // Separate corridors from regular rooms for corridor-aware routing
  const corridors = filteredRooms.filter((r) => isCorridor(r.name));
  const stairs = filteredRooms.filter((r) =>
    r.name.toLowerCase().includes("stair"),
  );
  const elevators = filteredRooms.filter(
    (r) =>
      r.name.toLowerCase().includes("elevator") ||
      r.name.toLowerCase().includes("lift"),
  );
  const regularRooms = filteredRooms.filter(
    (r) => !isCorridor(r.name) && !stairs.includes(r) && !elevators.includes(r),
  );

  console.log(
    `[Pathfinding] Identified ${corridors.length} corridors, ${stairs.length} stairs, ${elevators.length} elevators, ${regularRooms.length} regular rooms`,
  );

  // Build adjacency list with accessibility and preference considerations
  filteredRooms.forEach((room) => {
    const key = `${room.name}_F${room.floor}`;
    const neighbors = [];
    const isRoomCorridor = isCorridor(room.name);
    const isRoomStairs = stairs.includes(room);
    const isRoomElevator = elevators.includes(room);

    // Find neighboring rooms
    filteredRooms.forEach((otherRoom) => {
      if (room.name === otherRoom.name && room.floor === otherRoom.floor) {
        return; // Skip same room
      }

      // Rooms on same floor
      if (room.floor === otherRoom.floor) {
        const dist = distance(room.centroid, otherRoom.centroid);
        const isOtherCorridor = isCorridor(otherRoom.name);
        const isOtherStairs = stairs.includes(otherRoom);
        const isOtherElevator = elevators.includes(otherRoom);

        // Different thresholds based on room types and preferences
        let threshold;
        let distanceWeight = dist;

        if (isRoomCorridor && isOtherCorridor) {
          // Corridor to corridor - prefer these connections
          threshold = 0.05;
          distanceWeight = dist * 0.8; // Lower cost for corridor-to-corridor
        } else if (isRoomCorridor || isOtherCorridor) {
          // Room to corridor or corridor to room - allow these
          threshold = 0.03; // Closer proximity needed
          distanceWeight = dist * 0.9; // Slight preference
        } else {
          // Room to room - only if very close (might be adjacent rooms)
          threshold = 0.015; // Must be very close
          distanceWeight = dist * 1.2; // Higher cost for direct room-to-room
        }

        // Apply preference penalties/bonuses
        if (preferences === "stairs_first") {
          if (isRoomStairs || isOtherStairs) {
            distanceWeight *= 0.7; // Prefer stairs
          } else if (isRoomElevator || isOtherElevator) {
            distanceWeight *= 1.2; // Penalize elevators
          }
        } else if (preferences === "elevator_first") {
          if (isRoomElevator || isOtherElevator) {
            distanceWeight *= 0.7; // Prefer elevators
          } else if (isRoomStairs || isOtherStairs) {
            distanceWeight *= 1.2; // Penalize stairs
          }
        }

        if (dist < threshold && dist > 0) {
          neighbors.push({
            key: `${otherRoom.name}_F${otherRoom.floor}`,
            name: otherRoom.name,
            floor: otherRoom.floor,
            distance: distanceWeight,
            isCorridor: isOtherCorridor,
          });
        }
      }
      // Vertical connections (between floors through stairs/elevators)
      else if (Math.abs(room.floor - otherRoom.floor) === 1) {
        // Check if either room is a stairwell/elevator
        if (
          isVerticalConnector(room.name) ||
          isVerticalConnector(otherRoom.name)
        ) {
          const dist = distance(room.centroid, otherRoom.centroid);
          const threshold = 0.02; // Larger threshold for vertical connections

          if (dist < threshold && dist > 0) {
            neighbors.push({
              key: `${otherRoom.name}_F${otherRoom.floor}`,
              name: otherRoom.name,
              floor: otherRoom.floor,
              distance: dist * 2, // Penalty for floor change
              isCorridor: isCorridor(otherRoom.name),
            });
          }
        }
      }
    });

    graph.set(key, {
      room,
      neighbors,
      centroid: room.centroid,
      isCorridor: isRoomCorridor,
    });
  });

  return graph;
};

// A* pathfinding algorithm
const aStar = (graph, startKey, endKey) => {
  if (!graph.has(startKey) || !graph.has(endKey)) {
    console.warn(`Start or end room not in graph`);
    return null;
  }

  const openSet = new Set([startKey]);
  const closedSet = new Set();
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();

  gScore.set(startKey, 0);

  const startNode = graph.get(startKey);
  const endNode = graph.get(endKey);
  const heuristic = distance(startNode.centroid, endNode.centroid);
  fScore.set(startKey, heuristic);

  console.log(
    `[Pathfinding] A* starting: startKey=${startKey}, endKey=${endKey}, initial_heuristic=${heuristic.toFixed(
      6,
    )}`,
  );

  let iterations = 0;
  while (openSet.size > 0) {
    iterations++;

    // Find node in openSet with lowest fScore
    let current = null;
    let lowestF = Infinity;

    openSet.forEach((key) => {
      const f = fScore.get(key) || Infinity;
      if (f < lowestF) {
        lowestF = f;
        current = key;
      }
    });

    if (!current) {
      console.warn(
        `[Pathfinding] A* No valid current node found in iteration ${iterations}`,
      );
      break;
    }

    if (iterations <= 5 || iterations % 10 === 0) {
      console.log(
        `[Pathfinding] A* iteration ${iterations}: current=${current}, f=${lowestF.toFixed(
          6,
        )}, openSetSize=${openSet.size}`,
      );
    }

    if (current === endKey) {
      // Reconstruct path
      const path = [current];
      while (cameFrom.has(current)) {
        current = cameFrom.get(current);
        path.unshift(current);
      }
      console.log(
        `[Pathfinding] A* found path! Length: ${path.length}, iterations: ${iterations}`,
      );
      return path;
    }

    openSet.delete(current);
    closedSet.add(current);

    const currentNode = graph.get(current);
    if (!currentNode) {
      console.warn(`[Pathfinding] Current node not in graph: ${current}`);
      continue;
    }

    const currentG = gScore.has(current) ? gScore.get(current) : Infinity;
    console.log(
      `[Pathfinding] Processing ${current} with ${
        currentNode.neighbors.length
      } neighbors, gScore=${currentG.toFixed(6)}`,
    );

    currentNode.neighbors.forEach((neighbor) => {
      if (closedSet.has(neighbor.key)) {
        return; // Skip already processed nodes
      }

      const tentativeGScore = currentG + neighbor.distance;
      const neighborCurrentG = gScore.has(neighbor.key)
        ? gScore.get(neighbor.key)
        : Infinity;

      if (tentativeGScore < neighborCurrentG) {
        cameFrom.set(neighbor.key, current);
        gScore.set(neighbor.key, tentativeGScore);

        const neighborNode = graph.get(neighbor.key);
        if (!neighborNode) {
          console.warn(
            `[Pathfinding] Neighbor node not in graph: ${neighbor.key}`,
          );
          return;
        }

        const h = distance(neighborNode.centroid, endNode.centroid);
        fScore.set(neighbor.key, tentativeGScore + h);

        if (!openSet.has(neighbor.key)) {
          openSet.add(neighbor.key);
          if (iterations <= 5) {
            console.log(
              `[Pathfinding]   Added to openSet: ${
                neighbor.key
              }, g=${tentativeGScore.toFixed(6)}, h=${h.toFixed(6)}, f=${(
                tentativeGScore + h
              ).toFixed(6)}`,
            );
          }
        }
      }
    });
  }

  console.warn(
    `[Pathfinding] A* failed after ${iterations} iterations, openSet.size=${openSet.size}`,
  );
  return null; // No path found
};

// Main function to find route between rooms
export const findRoute = (
  rooms,
  startRoom,
  endRoom,
  targetFloor = null,
  options = {},
) => {
  const { accessibility = "standard", preferences = "shortest" } = options;

  // Get start and end room names
  const startName = getRoomName(startRoom).toLowerCase();
  const endName = getRoomName(endRoom).toLowerCase();

  if (!startName || !endName) return null;

  console.log("[Pathfinding] Starting route search:");
  console.log(`  Start room: ${startName}, Floor: ${getRoomFloor(startRoom)}`);
  console.log(`  End room: ${endName}, Floor: ${getRoomFloor(endRoom)}`);
  console.log(`  Target floor: ${targetFloor}`);
  console.log(`  Accessibility: ${accessibility}, Preferences: ${preferences}`);

  // Group all features by name
  const roomGroups = groupRoomsByName(rooms);
  console.log(
    `[Pathfinding] Grouped ${roomGroups.size} room groups from ${rooms.length} features`,
  );

  // Determine which floor to search
  // If no target floor, try multi-floor routing
  const searchFloor = targetFloor !== null ? targetFloor : null;

  // Build graph with accessibility considerations
  const graph = buildRoomGraph(roomGroups, searchFloor, {
    accessibility,
    preferences,
  });
  console.log(`[Pathfinding] Built graph with ${graph.size} nodes`);

  // Find rooms in graph that match start and end names (case-insensitive)
  let startKey = null;
  let endKey = null;

  graph.forEach((node, key) => {
    const nodeName = node.room.name.toLowerCase();
    if (nodeName === startName) {
      startKey = key;
    }
    if (nodeName === endName) {
      endKey = key;
    }
  });

  if (!startKey || !endKey) {
    console.warn(
      `[Pathfinding] Could not find rooms: start="${startName}" (${startKey}), end="${endName}" (${endKey})`,
    );
    console.warn(
      `[Pathfinding] Available rooms in graph:`,
      Array.from(graph.keys()).slice(0, 20),
    );
    return null;
  }

  console.log(`[Pathfinding] Found start room: ${startKey}`);
  console.log(`[Pathfinding] Found end room: ${endKey}`);

  const startNode = graph.get(startKey);
  const endNode = graph.get(endKey);

  console.log(`[Pathfinding] Start neighbors: ${startNode.neighbors.length}`);
  if (startNode.neighbors.length > 0) {
    console.log(
      `[Pathfinding] Start neighbors list:`,
      startNode.neighbors.map((n) => n.name).join(", "),
    );
  } else {
    console.warn(
      `[Pathfinding] WARNING: Start room "${startNode.room.name}" has NO neighbors!`,
    );
  }

  console.log(`[Pathfinding] End neighbors: ${endNode.neighbors.length}`);
  if (endNode.neighbors.length > 0) {
    console.log(
      `[Pathfinding] End neighbors list:`,
      endNode.neighbors.map((n) => n.name).join(", "),
    );
  } else {
    console.warn(
      `[Pathfinding] WARNING: End room "${endNode.room.name}" has NO neighbors!`,
    );
  }

  console.log(
    `[Pathfinding] Distance between start and end: ${distance(
      startNode.centroid,
      endNode.centroid,
    ).toFixed(6)} degrees`,
  );

  // Run A* algorithm
  const pathKeys = aStar(graph, startKey, endKey);

  if (!pathKeys) {
    console.warn("No path found between rooms");
    return null;
  }

  // Convert path to coordinate arrays for visualization
  const pathCoords = pathKeys.map((key) => {
    const node = graph.get(key);
    return {
      coords: node.centroid,
      floor: node.room.floor,
      name: node.room.name,
      features: node.room.features,
      isCorridor: node.isCorridor,
    };
  });

  console.log(
    `[Pathfinding] Raw path: ${pathCoords.map((p) => p.name).join(" -> ")}`,
  );

  // Add corridor waypoints for smoother, more realistic paths
  const enhancedPath = addCorridorWaypoints(pathCoords);

  console.log(
    `[Pathfinding] Enhanced path with ${enhancedPath.length} waypoints`,
  );

  return enhancedPath;
};

// Get boundary points of a room (for corridor edge routing)
const getRoomBoundaryPoints = (room, targetPoint) => {
  const coords = [];

  room.features.forEach((feature) => {
    if (feature.geometry.type === "Polygon") {
      coords.push(...feature.geometry.coordinates[0]);
    } else if (feature.geometry.type === "MultiPolygon") {
      coords.push(...feature.geometry.coordinates[0][0]);
    } else if (feature.geometry.type === "LineString") {
      coords.push(...feature.geometry.coordinates);
    }
  });

  if (coords.length === 0) return null;

  // Find the point on the boundary closest to the target
  let closestPoint = coords[0];
  let minDist = distance(coords[0], targetPoint);

  coords.forEach((coord) => {
    const dist = distance(coord, targetPoint);
    if (dist < minDist) {
      minDist = dist;
      closestPoint = coord;
    }
  });

  return closestPoint;
};

// Get edges/boundary segments of a room
const getRoomEdges = (room) => {
  const allCoords = [];

  room.features.forEach((feature) => {
    if (feature.geometry.type === "Polygon") {
      allCoords.push(...feature.geometry.coordinates[0]);
    } else if (feature.geometry.type === "MultiPolygon") {
      allCoords.push(...feature.geometry.coordinates[0][0]);
    } else if (feature.geometry.type === "LineString") {
      allCoords.push(...feature.geometry.coordinates);
    }
  });

  return allCoords;
};

// Get multiple evenly spaced points along a corridor using edge-based routing
const getCorridorPathPoints = (room, fromPoint, toPoint, numPoints = 2) => {
  const edges = getRoomEdges(room);

  if (edges.length < 3) return [];

  // Find entry and exit points on corridor boundary
  const entryPoint = getRoomBoundaryPoints(room, fromPoint);
  const exitPoint = getRoomBoundaryPoints(room, toPoint);

  if (!entryPoint || !exitPoint) return [];

  // Find indices of entry and exit in edge array
  let entryIdx = 0;
  let exitIdx = edges.length - 1;
  let minEntryDist = Infinity;
  let minExitDist = Infinity;

  edges.forEach((coord, idx) => {
    const distToEntry = distance(coord, entryPoint);
    const distToExit = distance(coord, exitPoint);

    if (distToEntry < minEntryDist) {
      minEntryDist = distToEntry;
      entryIdx = idx;
    }
    if (distToExit < minExitDist) {
      minExitDist = distToExit;
      exitIdx = idx;
    }
  });

  // Create waypoints along the edges from entry to exit
  const waypoints = [];

  if (entryIdx === exitIdx) {
    // Same edge, simple interpolation
    for (let i = 1; i <= numPoints; i++) {
      const t = i / (numPoints + 1);
      waypoints.push([
        entryPoint[0] + (exitPoint[0] - entryPoint[0]) * t,
        entryPoint[1] + (exitPoint[1] - entryPoint[1]) * t,
      ]);
    }
  } else {
    // Follow edges around the corridor boundary
    const step = Math.ceil(Math.abs(exitIdx - entryIdx) / (numPoints + 1));
    const direction = exitIdx > entryIdx ? 1 : -1;

    for (let i = 1; i <= numPoints; i++) {
      const idx = entryIdx + i * step * direction;
      const boundedIdx = ((idx % edges.length) + edges.length) % edges.length;

      if (edges[boundedIdx]) {
        waypoints.push(edges[boundedIdx]);
      }
    }
  }

  return waypoints;
};

// Add intermediate waypoints along corridor edges for smoother, more natural paths
const addCorridorWaypoints = (pathCoords) => {
  if (pathCoords.length < 2) return pathCoords;

  const enhancedPath = [];

  for (let i = 0; i < pathCoords.length; i++) {
    const current = pathCoords[i];
    enhancedPath.push(current);

    // Add intermediate waypoints between rooms if they're far apart
    if (i < pathCoords.length - 1) {
      const next = pathCoords[i + 1];
      const dist = distance(current.coords, next.coords);

      // If distance is significant and involves corridors, add waypoints
      if (dist > 0.008) {
        // Lowered threshold for more waypoints
        const currentIsCorridor = isCorridor(current.name);
        const nextIsCorridor = isCorridor(next.name);

        // If transitioning to/from corridor, add boundary waypoints
        if (currentIsCorridor !== nextIsCorridor) {
          let waypointCoord;

          if (currentIsCorridor) {
            // Exiting corridor - use point on corridor edge closest to next room
            waypointCoord = getRoomBoundaryPoints(current, next.coords);
          } else {
            // Entering corridor - use point on corridor edge closest to current room
            waypointCoord = getRoomBoundaryPoints(next, current.coords);
          }

          if (waypointCoord) {
            enhancedPath.push({
              coords: waypointCoord,
              floor: current.floor,
              name: currentIsCorridor ? current.name : next.name,
              features: currentIsCorridor ? current.features : next.features,
              isWaypoint: true,
            });
          }
        }
        // If both are corridors and far apart, add multiple waypoints along corridor path
        else if (currentIsCorridor && nextIsCorridor && dist > 0.015) {
          // Determine number of waypoints based on distance
          const numWaypoints = Math.min(Math.floor(dist / 0.01), 5); // Max 5 waypoints

          // Get corridor path points
          const prevCoords = i > 0 ? pathCoords[i - 1].coords : current.coords;
          const nextNextCoords =
            i < pathCoords.length - 2 ? pathCoords[i + 2].coords : next.coords;

          const corridorPoints = getCorridorPathPoints(
            current,
            prevCoords,
            nextNextCoords,
            numWaypoints,
          );

          if (corridorPoints.length > 0) {
            corridorPoints.forEach((point) => {
              enhancedPath.push({
                coords: point,
                floor: current.floor,
                name: current.name,
                features: current.features,
                isWaypoint: true,
              });
            });
          } else {
            // Fallback to simple interpolation
            for (let j = 1; j <= numWaypoints; j++) {
              const t = j / (numWaypoints + 1);
              const interpolated = [
                current.coords[0] + (next.coords[0] - current.coords[0]) * t,
                current.coords[1] + (next.coords[1] - current.coords[1]) * t,
              ];
              enhancedPath.push({
                coords: interpolated,
                floor: current.floor,
                name: current.name,
                features: current.features,
                isWaypoint: true,
              });
            }
          }
        }
        // Room to room transitions - create corner-bending waypoints
        else if (!currentIsCorridor && !nextIsCorridor && dist > 0.008) {
          // Get boundary points where path enters/exits rooms
          const currentExit = getRoomBoundaryPoints(current, next.coords);
          const nextEntry = getRoomBoundaryPoints(next, current.coords);

          if (currentExit && nextEntry) {
            // Add exit point from current room
            enhancedPath.push({
              coords: currentExit,
              floor: current.floor,
              name: current.name,
              features: current.features,
              isWaypoint: true,
            });

            // If the points are still far apart, add a midpoint bend
            const exitToEntryDist = distance(currentExit, nextEntry);
            if (exitToEntryDist > 0.01) {
              // Create L-shaped bend (perpendicular waypoint)
              const midpoint = [
                currentExit[0] + (nextEntry[0] - currentExit[0]) * 0.5,
                currentExit[1] + (nextEntry[1] - currentExit[1]) * 0.5,
              ];
              enhancedPath.push({
                coords: midpoint,
                floor: current.floor,
                name: "bend",
                features: current.features,
                isWaypoint: true,
              });
            }

            // Add entry point to next room
            enhancedPath.push({
              coords: nextEntry,
              floor: next.floor,
              name: next.name,
              features: next.features,
              isWaypoint: true,
            });
          }
        }
      }
    }
  }

  console.log(
    `[Pathfinding] Enhanced path from ${pathCoords.length} to ${enhancedPath.length} points with corridor waypoints`,
  );
  return enhancedPath;
};

// Calculate total route distance
export const calculateRouteDistance = (pathCoords) => {
  if (!pathCoords || pathCoords.length < 2) return 0;

  let totalDistance = 0;
  for (let i = 1; i < pathCoords.length; i++) {
    totalDistance += distance(pathCoords[i - 1].coords, pathCoords[i].coords);
  }

  return totalDistance;
};

// ============================================================================
// ENHANCED A* WITH NAVIGATION MESH INTEGRATION
// ============================================================================

/**
 * A* pathfinding using navigation graph with smooth path generation
 * @param {Map} graph - Navigation graph from buildNavigationGraph
 * @param {Array} startNode - Starting navigation node
 * @param {Array} endNode - Ending navigation node
 * @returns {Array<[x, y]>} - Array of waypoints forming the path
 */
export const aStarNavigationMesh = (
  graph,
  startNode,
  endNode,
  heuristic = null,
) => {
  if (!startNode || !endNode) {
    console.warn("[A* NavMesh] Invalid start or end node");
    return null;
  }

  const startId = startNode.id;
  const endId = endNode.id;

  const openSet = new Set([startId]);
  const closedSet = new Set();
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();

  gScore.set(startId, 0);

  const defaultHeuristic = (node) =>
    distance([node.x, node.y], [endNode.x, endNode.y]);
  const h = heuristic || defaultHeuristic;

  fScore.set(startId, h(startNode));

  console.log(
    `[A* NavMesh] Starting pathfinding from node ${startId} to ${endId}`,
  );

  let iterations = 0;
  const maxIterations = 10000;

  while (openSet.size > 0 && iterations < maxIterations) {
    iterations++;

    // Find node with lowest fScore
    let current = null;
    let lowestF = Infinity;

    openSet.forEach((nodeId) => {
      const f = fScore.get(nodeId) || Infinity;
      if (f < lowestF) {
        lowestF = f;
        current = nodeId;
      }
    });

    if (current === endId) {
      // Reconstruct path
      const path = [];
      let curr = current;
      while (cameFrom.has(curr)) {
        const node = graph.get(curr)?.node;
        if (node) {
          path.unshift([node.x, node.y]);
        }
        curr = cameFrom.get(curr);
      }
      // Add start node
      if (graph.has(curr)) {
        const startN = graph.get(curr)?.node;
        if (startN) path.unshift([startN.x, startN.y]);
      }

      console.log(
        `[A* NavMesh] Path found! Length: ${path.length}, Iterations: ${iterations}`,
      );
      return path;
    }

    openSet.delete(current);
    closedSet.add(current);

    const currentNode = graph.get(current);
    if (!currentNode) continue;

    const currentG = gScore.get(current) || Infinity;

    for (const neighbor of currentNode.neighbors) {
      if (closedSet.has(neighbor.nodeId)) continue;

      const tentativeG = currentG + neighbor.distance;
      const neighborG = gScore.get(neighbor.nodeId) || Infinity;

      if (tentativeG < neighborG) {
        cameFrom.set(neighbor.nodeId, current);
        gScore.set(neighbor.nodeId, tentativeG);

        const neighborNode = graph.get(neighbor.nodeId)?.node;
        if (neighborNode) {
          const hValue = h(neighborNode);
          fScore.set(neighbor.nodeId, tentativeG + hValue);

          if (!openSet.has(neighbor.nodeId)) {
            openSet.add(neighbor.nodeId);
          }
        }
      }
    }
  }

  console.warn(`[A* NavMesh] No path found after ${iterations} iterations`);
  return null;
};

/**
 * Hybrid routing: Use navigation mesh for fine-grained pathing
 * Falls back to room-level routing if navigation mesh unavailable
 */
export const findRouteIntelligent = (
  startPoint,
  endPoint,
  navGraph,
  navNodes,
  geojsonData,
  options = {},
) => {
  const { smoothing = "catmull", useNavMesh = true } = options;

  try {
    // Attempt navigation mesh routing
    if (useNavMesh && navGraph && navNodes && navNodes.length > 100) {
      console.log("[Routing] Using intelligent navigation mesh pathfinding");

      // Find nearest nodes to start and end points
      const startNode = findNearestNavNode(startPoint, navNodes);
      const endNode = findNearestNavNode(endPoint, navNodes);

      if (startNode && endNode) {
        // Run A* on navigation mesh
        const rawPath = aStarNavigationMesh(navGraph, startNode, endNode);

        if (rawPath && rawPath.length > 0) {
          // Apply path smoothing
          const smoothedPath = smoothPath(rawPath, smoothing);
          console.log(
            `[Routing] Generated ${rawPath.length} waypoints, smoothed to ${smoothedPath.length}`,
          );
          return smoothedPath;
        }
      }
    }
  } catch (err) {
    console.warn("[Routing] Navigation mesh routing failed:", err.message);
  }

  // Fallback to room-level routing
  console.log("[Routing] Falling back to room-level pathfinding");
  return null;
};

/**
 * Find nearest navigation node to a point
 */
function findNearestNavNode(point, nodes, maxDist = 0.1) {
  let nearest = null;
  let minDist = maxDist;

  for (const node of nodes) {
    const dist = distance([node.x, node.y], point);
    if (dist < minDist) {
      minDist = dist;
      nearest = node;
    }
  }

  return nearest;
}

/**
 * Apply path smoothing to waypoint sequence
 */
function smoothPath(waypoints, method = "catmull") {
  // Import path smoothing logic
  if (waypoints.length <= 2) return waypoints;

  try {
    // Simple linear smoothing as fallback
    if (method === "catmull" && waypoints.length > 2) {
      return catmullRomSmooth(waypoints, 10);
    }
  } catch (err) {
    console.warn("[PathSmoothing] Smoothing failed, returning raw path:", err);
  }

  return waypoints;
}

/**
 * Simple Catmull-Rom smoothing
 */
function catmullRomSmooth(points, resolution = 10) {
  const smoothed = [];

  for (let i = 0; i < points.length - 1; i++) {
    smoothed.push(points[i]);

    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    // Generate curve segment
    for (let t = 1; t < resolution; t++) {
      const tt = t / resolution;
      const tt2 = tt * tt;
      const tt3 = tt2 * tt;

      const point = [
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * tt +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * tt2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * tt3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * tt +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * tt2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * tt3),
      ];
      smoothed.push(point);
    }
  }

  smoothed.push(points[points.length - 1]);
  return smoothed;
}
