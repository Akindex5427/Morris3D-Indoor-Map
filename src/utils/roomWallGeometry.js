import buffer from "@turf/buffer";
import difference from "@turf/difference";
import { featureCollection } from "@turf/helpers";

const shellCache = new Map();

const isPolygonGeometry = (geometry) =>
  geometry?.type === "Polygon" || geometry?.type === "MultiPolygon";

const asNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getWallHeight = (properties = {}) =>
  asNumber(properties.height ?? properties.altura, 3) -
  asNumber(
    properties.base_height ??
      properties.base_heigh ??
      properties.baseHeight ??
      properties.baseheight,
    0,
  );

const stripZ = (coordinates) =>
  coordinates.map((coordinate) =>
    Array.isArray(coordinate[0])
      ? stripZ(coordinate)
      : [coordinate[0], coordinate[1]],
  );

const applyZ = (coordinates, z) =>
  coordinates.map((coordinate) =>
    Array.isArray(coordinate[0])
      ? applyZ(coordinate, z)
      : [coordinate[0], coordinate[1], z],
  );

const findGeometryZ = (coordinates) => {
  let z = 0;
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") {
      z = asNumber(value[2], z);
      return;
    }
    value.forEach(visit);
  };
  visit(coordinates);
  return z;
};

const warning = (message, context) => {
  if (import.meta.env.DEV) {
    console.warn(`[RoomWallGeometry] ${message}`, context);
  }
};

const getFeatureKey = (feature) => {
  const properties = feature.properties || {};
  const identifier =
    feature.id ??
    properties.OBJECTID ??
    properties.FID ??
    properties.id ??
    properties.room_id ??
    properties.name ??
    "room";
  // The coordinates are included to avoid incorrectly sharing geometry when
  // exported room names/ids are duplicated.
  return `${properties.level ?? properties.floor ?? 0}:${identifier}:${JSON.stringify(
    stripZ(feature.geometry.coordinates),
  )}`;
};

/**
 * Builds a narrow polygon band inside each source room. Turf performs the
 * offset and boolean difference so concave rooms, holes, and MultiPolygons
 * are handled by a maintained geometry engine instead of a custom offsetter.
 */
export const buildRoomWallShells = ({
  features = [],
  thicknessMeters = 0.12,
  shouldInclude = () => true,
} = {}) => {
  const thickness = asNumber(thicknessMeters);
  if (thickness <= 0) {
    warning("Skipping room walls because thickness is not positive.", {
      thicknessMeters,
    });
    return { type: "FeatureCollection", features: [] };
  }

  const wallFeatures = [];

  for (const feature of features) {
    if (!isPolygonGeometry(feature.geometry) || !shouldInclude(feature)) continue;

    const properties = feature.properties || {};
    const wallHeight = getWallHeight(properties);
    if (wallHeight <= 0) {
      warning("Skipping room with a negative or zero wall height.", {
        name: properties.name,
        wallHeight,
      });
      continue;
    }

    const key = getFeatureKey(feature);
    const cacheKey = `${thickness}:${key}`;
    let shellGeometry = shellCache.get(cacheKey);

    if (!shellGeometry) {
      const sourceFeature = {
        type: "Feature",
        properties: {},
        geometry: {
          type: feature.geometry.type,
          coordinates: stripZ(feature.geometry.coordinates),
        },
      };

      try {
        const inset = buffer(sourceFeature, -thickness, {
          units: "meters",
          steps: 2,
        });
        if (!inset?.geometry) {
          warning("Skipping room that is too small for the selected wall thickness.", {
            name: properties.name,
            thickness,
          });
          continue;
        }

        const shell = difference(featureCollection([sourceFeature, inset]));
        if (!shell?.geometry || !isPolygonGeometry(shell.geometry)) {
          warning("Offset operation did not produce a valid wall shell.", {
            name: properties.name,
            thickness,
          });
          continue;
        }

        shellGeometry = shell.geometry;
        shellCache.set(cacheKey, shellGeometry);
      } catch (error) {
        warning("Failed to generate a procedural wall shell.", {
          name: properties.name,
          thickness,
          error,
        });
        continue;
      }
    }

    const baseZ = findGeometryZ(feature.geometry.coordinates);
    wallFeatures.push({
      type: "Feature",
      id: `room-wall-${key}`,
      properties: {
        ...properties,
        __roomWallHeight: wallHeight,
      },
      geometry: {
        ...shellGeometry,
        coordinates: applyZ(shellGeometry.coordinates, baseZ),
      },
    });
  }

  return { type: "FeatureCollection", features: wallFeatures };
};

export const clearRoomWallGeometryCache = () => shellCache.clear();
