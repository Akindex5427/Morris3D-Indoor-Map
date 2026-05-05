export const NAMED_FEATURE_COLORS = {
  black: [50, 50, 50],
  blue: [0, 0, 255],
  brown: [165, 42, 42],
  coral: [255, 127, 80],
  cyan: [0, 255, 255],
  darkcyan: [0, 139, 139],
  darkorange: [255, 140, 0],
  darkviolet: [148, 0, 211],
  forestgreen: [34, 139, 34],
  gold: [255, 215, 0],
  gray: [100, 100, 100],
  green: [0, 128, 0],
  grey: [100, 100, 100],
  ightskyblue: [135, 206, 250],
  indigo: [75, 0, 130],
  lightblue: [173, 216, 230],
  lightcoral: [240, 128, 128],
  lightcyan: [224, 255, 255],
  lightgray: [150, 150, 150],
  lightgreen: [144, 238, 144],
  lightgrey: [150, 150, 150],
  lightpink: [255, 182, 193],
  lime: [0, 255, 0],
  magenta: [255, 0, 255],
  magneta: [255, 0, 255],
  maroon: [128, 0, 0],
  navy: [0, 0, 128],
  orange: [255, 165, 0],
  palegreen: [152, 251, 152],
  pink: [255, 192, 203],
  purple: [128, 0, 128],
  red: [255, 0, 0],
  rosybrown: [188, 143, 143],
  royalblue: [65, 105, 225],
  salmon: [250, 128, 114],
  seagreen: [46, 139, 87],
  silver: [192, 192, 192],
  tan: [210, 180, 140],
  teal: [0, 128, 128],
  violet: [238, 130, 238],
  white: [220, 220, 220],
  yellow: [255, 255, 0],
  yellowgreen: [154, 205, 50],
};

const DEFAULT_COLOR = [100, 150, 200];

export function parseFeatureColor(colorValue) {
  if (!colorValue) {
    return DEFAULT_COLOR;
  }

  if (Array.isArray(colorValue) && colorValue.length >= 3) {
    return colorValue.slice(0, 3);
  }

  if (typeof colorValue !== "string") {
    return DEFAULT_COLOR;
  }

  const normalized = colorValue.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_COLOR;
  }

  if (NAMED_FEATURE_COLORS[normalized]) {
    return NAMED_FEATURE_COLORS[normalized];
  }

  if (normalized.startsWith("#")) {
    const hex = normalized.slice(1);
    const expandedHex =
      hex.length === 3
        ? hex
            .split("")
            .map((char) => char + char)
            .join("")
        : hex;

    if (expandedHex.length === 6) {
      return [
        parseInt(expandedHex.slice(0, 2), 16),
        parseInt(expandedHex.slice(2, 4), 16),
        parseInt(expandedHex.slice(4, 6), 16),
      ];
    }
  }

  const rgbMatch = normalized.match(
    /^rgba?\((\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\)$/,
  );
  if (rgbMatch) {
    return rgbMatch.slice(1, 4).map((value) => Number(value));
  }

  return DEFAULT_COLOR;
}

export function hasFeatureColor(colorValue) {
  if (Array.isArray(colorValue)) {
    return colorValue.length >= 3;
  }

  return typeof colorValue === "string" && colorValue.trim().length > 0;
}

export function countFeaturesMissingColor(features = []) {
  return features.filter(
    (feature) => !hasFeatureColor(feature?.properties?.color),
  ).length;
}

export function countFeaturesMissingBaseHeight(features = []) {
  return features.filter(
    (feature) => getExplicitBaseHeight(feature?.properties) === null,
  ).length;
}

export function enrichMissingFeatureColors(
  features = [],
  referenceFeatures = [],
  options = {},
) {
  const floor =
    Number.isFinite(Number(options.floor)) ? Number(options.floor) : null;
  const scopedReferenceFeatures =
    floor === null
      ? referenceFeatures
      : referenceFeatures.filter(
          (feature) => getFeatureFloor(feature?.properties) === floor,
        );

  const referenceByBoundingBox = new Map();
  const colorsByName = new Map();

  for (const feature of scopedReferenceFeatures) {
    const color = feature?.properties?.color;
    if (!hasFeatureColor(color)) {
      continue;
    }

    const boundingBoxKey = getFeatureBoundingBoxKey(feature);
    if (boundingBoxKey && !referenceByBoundingBox.has(boundingBoxKey)) {
      referenceByBoundingBox.set(boundingBoxKey, color);
    }

    const normalizedName = normalizeFeatureName(feature?.properties?.name);
    if (!normalizedName) {
      continue;
    }

    const counts = colorsByName.get(normalizedName) ?? new Map();
    counts.set(color, (counts.get(color) ?? 0) + 1);
    colorsByName.set(normalizedName, counts);
  }

  return features.map((feature) => {
    if (hasFeatureColor(feature?.properties?.color)) {
      return feature;
    }

    const normalizedName = normalizeFeatureName(feature?.properties?.name);
    const boundingBoxKey = getFeatureBoundingBoxKey(feature);
    const inferredColor =
      (boundingBoxKey && referenceByBoundingBox.get(boundingBoxKey)) ??
      getMostCommonColor(colorsByName.get(normalizedName)) ??
      inferColorFromName(normalizedName);

    if (!inferredColor) {
      return feature;
    }

    return {
      ...feature,
      properties: {
        ...feature.properties,
        color: inferredColor,
      },
    };
  });
}

export function enrichMissingFeatureDisplayProperties(
  features = [],
  referenceFeatures = [],
  options = {},
) {
  const floor =
    Number.isFinite(Number(options.floor)) ? Number(options.floor) : null;
  const scopedReferenceFeatures =
    floor === null
      ? referenceFeatures
      : referenceFeatures.filter(
          (feature) => getFeatureFloor(feature?.properties) === floor,
        );

  const referenceByBoundingBox = new Map();
  const colorsByName = new Map();
  const baseHeightsByName = new Map();

  for (const feature of scopedReferenceFeatures) {
    const properties = feature?.properties || {};
    const color = properties.color;
    const baseHeight = getExplicitBaseHeight(properties);
    const boundingBoxKey = getFeatureBoundingBoxKey(feature);

    if (boundingBoxKey) {
      const existingReference = referenceByBoundingBox.get(boundingBoxKey) ?? {};
      referenceByBoundingBox.set(boundingBoxKey, {
        color: existingReference.color ?? (hasFeatureColor(color) ? color : null),
        baseHeight: existingReference.baseHeight ?? baseHeight,
      });
    }

    const normalizedName = normalizeFeatureName(properties.name);
    if (!normalizedName) {
      continue;
    }

    if (hasFeatureColor(color)) {
      const counts = colorsByName.get(normalizedName) ?? new Map();
      counts.set(color, (counts.get(color) ?? 0) + 1);
      colorsByName.set(normalizedName, counts);
    }

    if (baseHeight !== null) {
      const counts = baseHeightsByName.get(normalizedName) ?? new Map();
      counts.set(baseHeight, (counts.get(baseHeight) ?? 0) + 1);
      baseHeightsByName.set(normalizedName, counts);
    }
  }

  return features.map((feature) => {
    const properties = feature?.properties || {};
    const normalizedName = normalizeFeatureName(properties.name);
    const boundingBoxKey = getFeatureBoundingBoxKey(feature);
    const referenceMetadata =
      (boundingBoxKey && referenceByBoundingBox.get(boundingBoxKey)) || null;

    let nextProperties = null;

    if (!hasFeatureColor(properties.color)) {
      const inferredColor =
        referenceMetadata?.color ??
        getMostCommonValue(colorsByName.get(normalizedName)) ??
        inferColorFromName(normalizedName);

      if (inferredColor) {
        nextProperties = {
          ...(nextProperties ?? properties),
          color: inferredColor,
        };
      }
    }

    if (getExplicitBaseHeight(properties) === null) {
      const inferredBaseHeight =
        referenceMetadata?.baseHeight ??
        getMostCommonValue(baseHeightsByName.get(normalizedName)) ??
        null;

      if (inferredBaseHeight !== null) {
        nextProperties = {
          ...(nextProperties ?? properties),
          base_heigh: inferredBaseHeight,
          base_height:
            nextProperties?.base_height ?? properties.base_height ?? inferredBaseHeight,
        };
      }
    }

    return nextProperties
      ? {
          ...feature,
          properties: nextProperties,
        }
      : feature;
  });
}

function getFeatureFloor(properties = {}) {
  const floor = properties.level ?? properties.floor ?? properties.nivel;
  return Number.isFinite(Number(floor)) ? Number(floor) : null;
}

function normalizeFeatureName(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getExplicitBaseHeight(properties = {}) {
  const raw =
    properties.base_height ??
    properties.base_heigh ??
    properties.baseHeight ??
    properties.baseheight;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferColorFromName(name) {
  if (!name) {
    return null;
  }

  if (name.includes("floor")) {
    return "lightgrey";
  }

  if (name.includes("stair")) {
    return "brown";
  }

  if (
    name.includes("elevator") ||
    name.includes("structure") ||
    name.includes("shaft") ||
    name.includes("mechanical")
  ) {
    return "grey";
  }

  return null;
}

function getMostCommonColor(colorCounts) {
  return getMostCommonValue(colorCounts);
}

function getMostCommonValue(valueCounts) {
  if (!valueCounts || valueCounts.size === 0) {
    return null;
  }

  let bestValue = null;
  let bestCount = -1;

  for (const [value, count] of valueCounts.entries()) {
    if (count > bestCount) {
      bestValue = value;
      bestCount = count;
    }
  }

  return bestValue;
}

function getFeatureBoundingBoxKey(feature, precision = 6) {
  const coordinates = [];
  collectCoordinates(feature?.geometry?.coordinates, coordinates);

  if (coordinates.length === 0) {
    return null;
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of coordinates) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLng, minLat, maxLng, maxLat]
    .map((value) => Number(value).toFixed(precision))
    .join("|");
}

function collectCoordinates(input, coordinates) {
  if (!Array.isArray(input) || input.length === 0) {
    return;
  }

  if (typeof input[0] === "number") {
    coordinates.push(input);
    return;
  }

  for (const child of input) {
    collectCoordinates(child, coordinates);
  }
}
