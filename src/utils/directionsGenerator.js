/**
 * Turn-by-Turn Directions Generator
 * Converts route paths into human-readable navigation instructions
 * State-of-the-art navigation with enhanced descriptions
 */

// Calculate distance between two coordinates (in meters)
const calculateDistance = (coord1, coord2) => {
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;

  // Haversine formula for distance calculation
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
};

// Calculate bearing/direction between two points
const calculateBearing = (coord1, coord2) => {
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;

  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  let bearing = (Math.atan2(y, x) * 180) / Math.PI;
  bearing = (bearing + 360) % 360; // Normalize to 0-360

  return bearing;
};

// Enhanced bearing to cardinal direction with icons
const bearingToCardinalDirection = (bearing) => {
  let direction = "north";
  let icon = "↑";

  if (bearing >= 337.5 || bearing < 22.5) {
    direction = "north";
    icon = "↑";
  } else if (bearing >= 22.5 && bearing < 67.5) {
    direction = "northeast";
    icon = "↗";
  } else if (bearing >= 67.5 && bearing < 112.5) {
    direction = "east";
    icon = "→";
  } else if (bearing >= 112.5 && bearing < 157.5) {
    direction = "southeast";
    icon = "↘";
  } else if (bearing >= 157.5 && bearing < 202.5) {
    direction = "south";
    icon = "↓";
  } else if (bearing >= 202.5 && bearing < 247.5) {
    direction = "southwest";
    icon = "↙";
  } else if (bearing >= 247.5 && bearing < 292.5) {
    direction = "west";
    icon = "←";
  } else if (bearing >= 292.5 && bearing < 337.5) {
    direction = "northwest";
    icon = "↖";
  }

  return { name: direction, icon };
};

// Convert bearing to direction text (legacy)
const bearingToDirection = (bearing) => {
  return bearingToCardinalDirection(bearing).name;
};

// Calculate turn direction between two bearings with better descriptions
const calculateTurn = (bearing1, bearing2) => {
  let diff = bearing2 - bearing1;

  // Normalize difference to -180 to 180
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;

  const absDiff = Math.abs(diff);

  if (absDiff < 20) return "straight";
  if (absDiff < 60) return diff > 0 ? "slight right" : "slight left";
  if (absDiff < 120) return diff > 0 ? "right" : "left";
  if (absDiff < 160) return diff > 0 ? "sharp right" : "sharp left";
  return "back";
};

// Format distance for display with better formatting
const formatDistance = (meters) => {
  if (meters < 1) {
    return `${Math.round(meters * 100)} cm`;
  } else if (meters < 10) {
    return `${meters.toFixed(1)} m`;
  } else if (meters < 100) {
    return `${Math.round(meters)} m`;
  } else {
    return `${(meters / 1000).toFixed(2)} km`;
  }
};

// Check if room name indicates a vertical connector
const isStairwell = (name) => {
  const lower = name.toLowerCase();
  return lower.includes("stair") || lower.includes("escada");
};

const isElevator = (name) => {
  const lower = name.toLowerCase();
  return (
    lower.includes("elevator") ||
    lower.includes("elevador") ||
    lower.includes("lift")
  );
};

const isCorridor = (name) => {
  const lower = name.toLowerCase();
  return (
    lower.includes("corridor") ||
    lower.includes("corredor") ||
    lower.includes("hallway") ||
    lower.includes("hall") ||
    lower.includes("lobby") ||
    lower.includes("passage")
  );
};

// Generate turn-by-turn directions from route path with cardinal directions
export const generateDirections = (routePath) => {
  if (!routePath || routePath.length < 2) {
    return [];
  }

  const directions = [];
  let cumulativeDistance = 0;
  let previousBearing = null;
  let segmentDistance = 0;

  // Calculate initial bearing from start to first waypoint
  const initialBearing = calculateBearing(
    routePath[0].coords,
    routePath[1].coords,
  );
  const initialDirection = bearingToCardinalDirection(initialBearing);

  // Start instruction with cardinal direction
  directions.push({
    id: 0,
    type: "start",
    instruction: `Head ${initialDirection.name} from ${routePath[0].name}`,
    floor: routePath[0].floor,
    distance: 0,
    cumulativeDistance: 0,
    location: routePath[0].name,
    coords: routePath[0].coords,
    bearing: initialBearing,
    direction: initialDirection,
  });

  for (let i = 1; i < routePath.length; i++) {
    const current = routePath[i];
    const previous = routePath[i - 1];
    const next = i < routePath.length - 1 ? routePath[i + 1] : null;

    const distanceToNext = calculateDistance(previous.coords, current.coords);
    segmentDistance += distanceToNext;
    cumulativeDistance += distanceToNext;

    // Check for floor changes
    if (current.floor !== previous.floor) {
      const floorDiff = current.floor - previous.floor;
      const floorChangeType = isStairwell(previous.name)
        ? "stairs"
        : isElevator(previous.name)
          ? "elevator"
          : "stairs/elevator";

      const direction = floorDiff > 0 ? "up" : "down";
      const floorText =
        floorDiff > 0 ? `Floor ${current.floor}` : `Floor ${current.floor}`;

      directions.push({
        id: directions.length,
        type: "floor_change",
        instruction: `Take ${floorChangeType} ${direction} to ${floorText}`,
        floor: previous.floor,
        targetFloor: current.floor,
        distance: segmentDistance,
        cumulativeDistance: cumulativeDistance,
        location: previous.name,
        coords: previous.coords,
        icon: floorChangeType === "elevator" ? "🛗" : "🪜",
      });

      segmentDistance = 0;
      previousBearing = null;
      continue;
    }

    // Calculate bearing for current segment
    const currentBearing = calculateBearing(previous.coords, current.coords);
    const currentDirection = bearingToCardinalDirection(currentBearing);

    // Determine if we need to add a turn instruction
    if (previousBearing !== null) {
      const turn = calculateTurn(previousBearing, currentBearing);

      // Add turn instruction if significant turn
      if (turn !== "straight" && segmentDistance > 3) {
        let turnInstruction = "";

        if (turn === "back") {
          turnInstruction = `Turn around and head ${currentDirection.name}`;
        } else if (turn.includes("slight right")) {
          turnInstruction = `Bear right and head ${currentDirection.name}`;
        } else if (turn.includes("slight left")) {
          turnInstruction = `Bear left and head ${currentDirection.name}`;
        } else if (turn.includes("right")) {
          turnInstruction = `Turn right and head ${currentDirection.name}`;
        } else if (turn.includes("left")) {
          turnInstruction = `Turn left and head ${currentDirection.name}`;
        } else {
          turnInstruction = `Head ${currentDirection.name}`;
        }

        // Add location context if not in a corridor
        const locationContext = isCorridor(current.name)
          ? ""
          : ` towards ${current.name}`;

        directions.push({
          id: directions.length,
          type: "turn",
          instruction: `${turnInstruction}${locationContext}`,
          floor: current.floor,
          distance: segmentDistance,
          cumulativeDistance: cumulativeDistance,
          location: current.name,
          coords: current.coords,
          turn: turn,
          bearing: currentBearing,
          direction: currentDirection,
          icon: turn.includes("left")
            ? "↰"
            : turn.includes("right")
              ? "↱"
              : "↑",
        });

        segmentDistance = 0;
      }
    }

    // Check if we're entering a significant room (not a corridor)
    if (!isCorridor(current.name) && i < routePath.length - 1) {
      const nextBearing = next
        ? calculateBearing(current.coords, next.coords)
        : null;

      // If this is not the destination and it's a significant location
      if (i < routePath.length - 2 && segmentDistance > 5) {
        directions.push({
          id: directions.length,
          type: "waypoint",
          instruction: `Pass through ${current.name}`,
          floor: current.floor,
          distance: segmentDistance,
          cumulativeDistance: cumulativeDistance,
          location: current.name,
          coords: current.coords,
          icon: "📍",
        });
        segmentDistance = 0;
      }
    }

    previousBearing = currentBearing;
  }

  // Destination instruction
  const lastPoint = routePath[routePath.length - 1];
  const lastBearing = calculateBearing(
    routePath[routePath.length - 2].coords,
    lastPoint.coords,
  );
  const lastDirection = bearingToCardinalDirection(lastBearing);

  directions.push({
    id: directions.length,
    type: "destination",
    instruction: `You have arrived at ${lastPoint.name}`,
    floor: lastPoint.floor,
    distance: segmentDistance,
    cumulativeDistance: cumulativeDistance,
    location: lastPoint.name,
    coords: lastPoint.coords,
    bearing: lastBearing,
    direction: lastDirection,
    icon: "🎯",
  });

  return directions;
};

// Generate speech text from directions
export const generateSpeechText = (directions) => {
  if (!directions || directions.length === 0) return "";

  const texts = directions
    .map((dir) => dir?.text ?? dir?.instruction)
    .filter(Boolean);

  return joinSpeechSentences(texts);
};

// Generate speech for a single direction step
export const generateStepSpeech = (direction) => {
  if (!direction) return "";

  const raw = direction.text ?? direction.instruction ?? "";
  return normalizeSpeechText(raw);
};

function normalizeSpeechText(text) {
  return String(text)
    .replace(/\s*[–—]\s*/g, " to ")    // en-dash/em-dash ranges → "to" (e.g. "Journals A–D")
    .replace(/\bF(\d+)\b/g, "Floor $1") // F1 → Floor 1 (defensive, shouldn't appear in text)
    .replace(/([^.!?])$/, "$1.")         // ensure sentence ends with a period for natural TTS pause
    .trim();
}

const joinSpeechSentences = (sentences) =>
  sentences
    .map((sentence) => String(sentence).trim())
    .filter(Boolean)
    .map((sentence) => (/[.!?]$/.test(sentence) ? sentence : `${sentence}.`))
    .join(" ");

// Calculate total route statistics
export const calculateRouteStats = (routePath) => {
  if (!routePath || routePath.length < 2) {
    return {
      totalDistance: 0,
      estimatedTime: 0,
      floors: [],
      floorChanges: 0,
    };
  }

  let totalDistance = 0;
  const floorsSet = new Set();
  let floorChanges = 0;

  for (let i = 1; i < routePath.length; i++) {
    const current = routePath[i];
    const previous = routePath[i - 1];

    totalDistance += calculateDistance(previous.coords, current.coords);
    floorsSet.add(current.floor);

    if (current.floor !== previous.floor) {
      floorChanges++;
    }
  }

  // Add first floor
  floorsSet.add(routePath[0].floor);

  // Estimate walking time (average walking speed: 1.4 m/s)
  // Add 30 seconds for each floor change
  const estimatedTime = totalDistance / 1.4 + floorChanges * 30;

  return {
    totalDistance,
    estimatedTime,
    floors: Array.from(floorsSet).sort((a, b) => a - b),
    floorChanges,
  };
};

// Export route as formatted JSON for sharing
export const exportRouteAsJSON = (routePath, directions, stats) => {
  return {
    metadata: {
      exportDate: new Date().toISOString(),
      version: "2.0",
      format: "indoor-route",
    },
    route: {
      start: routePath?.[0]?.name || "Unknown",
      end: routePath?.[routePath.length - 1]?.name || "Unknown",
      stats,
      waypoints: routePath,
    },
    directions,
    accessibility: {
      wcag: "2.1 AA",
      speechSupport: true,
      ariaLabels: true,
    },
  };
};

// Export route as human-readable text
export const exportRouteAsText = (routePath, directions, stats) => {
  let text = "=== INDOOR NAVIGATION ROUTE ===\n\n";

  text += `FROM: ${routePath?.[0]?.name || "Start"} (Floor ${routePath?.[0]?.floor || 0})\n`;
  text += `TO: ${routePath?.[routePath.length - 1]?.name || "End"} (Floor ${routePath?.[routePath.length - 1]?.floor || 0})\n\n`;

  text += `TOTAL DISTANCE: ${formatDistance(stats.totalDistance)}\n`;
  text += `ESTIMATED TIME: ${Math.round(stats.estimatedTime / 60)} minutes\n`;
  text += `FLOOR CHANGES: ${stats.floorChanges}\n`;
  text += `FLOORS INVOLVED: ${stats.floors.join(", ")}\n\n`;

  text += "DIRECTIONS:\n";
  text += "----------\n";

  directions.forEach((dir, idx) => {
    text += `${idx + 1}. ${dir.instruction}\n`;
    if (dir.distance > 0) {
      text += `   Distance: ${formatDistance(dir.distance)}\n`;
    }
  });

  return text;
};

// Generate shareable route URL
export const generateRouteShareLink = (startRoom, endRoom, floor = null) => {
  const params = new URLSearchParams({
    start: startRoom,
    end: endRoom,
    ...(floor !== null && { floor }),
    timestamp: Date.now(),
  });
  return `${window.location.origin}${window.location.pathname}?route=${params.toString()}`;
};

// Generate QR code data for route sharing
export const generateRouteQRData = (startRoom, endRoom, floor = null) => {
  const link = generateRouteShareLink(startRoom, endRoom, floor);
  // Returns data suitable for QR code generation
  // Can be used with libraries like qrcode.js
  return {
    url: link,
    type: "indoor-route-v2",
    startRoom,
    endRoom,
    floor,
  };
};
