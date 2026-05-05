import { NAMED_FEATURE_COLORS } from "./featureColors";

export const DEFAULT_WALL_COLOR = [235, 238, 242, 190];
const DEFAULT_WALL_HEIGHT = 3;
const MIN_VISIBLE_ALPHA = 1;
const DEG_TO_RAD = Math.PI / 180;

function parseNumericValue(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampByte(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.min(255, Math.round(parsed)));
}

function parseAlpha(value) {
  if (value === undefined || value === null) {
    return DEFAULT_WALL_COLOR[3];
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_WALL_COLOR[3];
  }

  const alpha = parsed <= 1 ? parsed * 255 : parsed;
  const clamped = clampByte(alpha);
  return clamped >= MIN_VISIBLE_ALPHA ? clamped : DEFAULT_WALL_COLOR[3];
}

function parseHexColor(normalized) {
  const rawHex = normalized.slice(1);
  const hex =
    rawHex.length === 3 || rawHex.length === 4
      ? rawHex
          .split("")
          .map((char) => char + char)
          .join("")
      : rawHex;

  if (hex.length !== 6 && hex.length !== 8) {
    return null;
  }

  const channels = [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];

  if (channels.some((channel) => !Number.isFinite(channel))) {
    return null;
  }

  const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : null;
  return [...channels, parseAlpha(alpha)];
}

export function parseWallColor(colorValue) {
  if (Array.isArray(colorValue) && colorValue.length >= 3) {
    return [
      clampByte(colorValue[0]) ?? DEFAULT_WALL_COLOR[0],
      clampByte(colorValue[1]) ?? DEFAULT_WALL_COLOR[1],
      clampByte(colorValue[2]) ?? DEFAULT_WALL_COLOR[2],
      parseAlpha(colorValue[3]),
    ];
  }

  if (typeof colorValue !== "string") {
    return DEFAULT_WALL_COLOR;
  }

  const normalized = colorValue.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_WALL_COLOR;
  }

  if (normalized.startsWith("#")) {
    return parseHexColor(normalized) ?? DEFAULT_WALL_COLOR;
  }

  const namedColor = NAMED_FEATURE_COLORS[normalized];
  if (namedColor) {
    return [...namedColor, DEFAULT_WALL_COLOR[3]];
  }

  const rgbMatch = normalized.match(
    /^rgba?\((\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\)$/,
  );
  if (rgbMatch) {
    return [
      clampByte(rgbMatch[1]) ?? DEFAULT_WALL_COLOR[0],
      clampByte(rgbMatch[2]) ?? DEFAULT_WALL_COLOR[1],
      clampByte(rgbMatch[3]) ?? DEFAULT_WALL_COLOR[2],
      parseAlpha(rgbMatch[4]),
    ];
  }

  return DEFAULT_WALL_COLOR;
}

function getWallZRange(properties = {}) {
  const baseHeight =
    parseNumericValue(
      properties.base_height ??
        properties.base_heigh ??
        properties.baseHeight ??
        properties.baseheight,
    ) ?? 0;
  const topHeight = parseNumericValue(properties.height);
  const resolvedTop = topHeight ?? baseHeight + DEFAULT_WALL_HEIGHT;

  if (resolvedTop <= baseHeight) {
    return null;
  }

  return {
    bottom: baseHeight,
    top: resolvedTop,
  };
}

function getLineCoordinateSets(geometry) {
  if (!geometry) {
    return [];
  }

  if (geometry.type === "LineString") {
    return [geometry.coordinates || []];
  }

  if (geometry.type === "MultiLineString") {
    return geometry.coordinates || [];
  }

  return [];
}

function isValidLngLat(coord) {
  return (
    Array.isArray(coord) &&
    coord.length >= 2 &&
    Number.isFinite(Number(coord[0])) &&
    Number.isFinite(Number(coord[1]))
  );
}

function getRenderableLine(line) {
  return (line || [])
    .filter(isValidLngLat)
    .map((coord) => [Number(coord[0]), Number(coord[1])]);
}

function getOrigin(coordinates) {
  const totals = coordinates.reduce(
    (acc, coord) => {
      acc.lng += coord[0];
      acc.lat += coord[1];
      return acc;
    },
    { lng: 0, lat: 0 },
  );

  return [totals.lng / coordinates.length, totals.lat / coordinates.length];
}

function createLngLatProjector(origin) {
  const latRad = origin[1] * DEG_TO_RAD;
  const metersPerDegreeLat =
    111132.92 -
    559.82 * Math.cos(2 * latRad) +
    1.175 * Math.cos(4 * latRad);
  const metersPerDegreeLng =
    111412.84 * Math.cos(latRad) -
    93.5 * Math.cos(3 * latRad) +
    0.118 * Math.cos(5 * latRad);

  return ([lng, lat]) => [
    (lng - origin[0]) * metersPerDegreeLng,
    (lat - origin[1]) * metersPerDegreeLat,
  ];
}

function pushVertex(target, normalTarget, texCoordTarget, position, normal, uv) {
  target.push(position[0], position[1], position[2]);
  normalTarget.push(normal[0], normal[1], normal[2]);
  texCoordTarget.push(uv[0], uv[1]);
}

function pushTriangle(target, normalTarget, texCoordTarget, vertices, normal) {
  pushVertex(target, normalTarget, texCoordTarget, vertices[0], normal, [0, 0]);
  pushVertex(target, normalTarget, texCoordTarget, vertices[1], normal, [1, 0]);
  pushVertex(target, normalTarget, texCoordTarget, vertices[2], normal, [1, 1]);
}

function pushWallSegment({
  positions,
  normals,
  texCoords,
  start,
  end,
  bottom,
  top,
}) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);

  if (length === 0) {
    return;
  }

  const outwardNormal = [-dy / length, dx / length, 0];
  const inwardNormal = [dy / length, -dx / length, 0];
  const startBottom = [start[0], start[1], bottom];
  const endBottom = [end[0], end[1], bottom];
  const endTop = [end[0], end[1], top];
  const startTop = [start[0], start[1], top];

  pushTriangle(
    positions,
    normals,
    texCoords,
    [startBottom, endBottom, endTop],
    outwardNormal,
  );
  pushTriangle(
    positions,
    normals,
    texCoords,
    [startBottom, endTop, startTop],
    outwardNormal,
  );

  pushTriangle(
    positions,
    normals,
    texCoords,
    [startBottom, startTop, endTop],
    inwardNormal,
  );
  pushTriangle(
    positions,
    normals,
    texCoords,
    [startBottom, endTop, endBottom],
    inwardNormal,
  );
}

function buildFeatureWallMesh(lineCoordinateSets, origin, zRange) {
  const project = createLngLatProjector(origin);
  const positions = [];
  const normals = [];
  const texCoords = [];

  for (const line of lineCoordinateSets) {
    const renderableLine = getRenderableLine(line);
    if (renderableLine.length < 2) {
      continue;
    }

    for (let index = 0; index < renderableLine.length - 1; index += 1) {
      pushWallSegment({
        positions,
        normals,
        texCoords,
        start: project(renderableLine[index]),
        end: project(renderableLine[index + 1]),
        bottom: zRange.bottom,
        top: zRange.top,
      });
    }
  }

  if (positions.length === 0) {
    return null;
  }

  return {
    attributes: {
      positions: { size: 3, value: new Float32Array(positions) },
      normals: { size: 3, value: new Float32Array(normals) },
      texCoords: { size: 2, value: new Float32Array(texCoords) },
    },
  };
}

function getWallFeatures(input) {
  if (!input) {
    return [];
  }

  if (input.type === "FeatureCollection") {
    return input.features || [];
  }

  if (input.type === "Feature") {
    return [input];
  }

  if (input.type === "LineString" || input.type === "MultiLineString") {
    return [{ type: "Feature", geometry: input, properties: {} }];
  }

  return [];
}

export function buildWallMeshes(geojson) {
  return getWallFeatures(geojson).flatMap((feature, featureIndex) => {
    const lineCoordinateSets = getLineCoordinateSets(feature.geometry);
    const validCoordinates = lineCoordinateSets.flatMap((line) =>
      getRenderableLine(line),
    );
    const zRange = getWallZRange(feature.properties || {});

    if (lineCoordinateSets.length === 0 || validCoordinates.length < 2 || !zRange) {
      return [];
    }

    const origin = getOrigin(validCoordinates);
    const mesh = buildFeatureWallMesh(lineCoordinateSets, origin, zRange);

    if (!mesh) {
      return [];
    }

    return [
      {
        id: feature.id ?? feature.properties?.id ?? featureIndex,
        name: feature.properties?.name ?? "wall",
        origin: [origin[0], origin[1], 0],
        color: parseWallColor(feature.properties?.color),
        bottom: zRange.bottom,
        top: zRange.top,
        mesh,
      },
    ];
  });
}
