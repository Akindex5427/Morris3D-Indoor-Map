import { GeoJsonLayer, PathLayer } from "@deck.gl/layers";
import { buildFilteredIndoorFeatureCollection, computeElevation } from "../components/IndoorBuilding";

export const CORRESPONDENCE_COLORS = { reference: [79, 70, 229], candidate: [13, 148, 136] };

export function correspondenceOverlayData(features, authoritativeFeatures, floors, spacing = 4.5, heightExaggeration = 1) {
  if (!features?.length) return { features: [], paths: [] };
  const roles = new Map(features.map(feature => [feature.properties.__roomSearchKey, feature.properties.__correspondenceRole]));
  // Use the full authoritative floor context for the same single-floor datum as
  // the building renderer. Never derive a datum from just the selected pair.
  const transformed = buildFilteredIndoorFeatureCollection({ type: "FeatureCollection", features: authoritativeFeatures }, floors, spacing);
  const roofs = transformed.features.filter(feature => roles.has(feature.properties.__roomSearchKey)).map(feature => {
    const elevation = computeElevation(feature, spacing, heightExaggeration, floors.length > 1);
    const lift = coordinates => typeof coordinates[0] === "number"
      ? [coordinates[0], coordinates[1], (coordinates[2] || 0) + elevation + 0.08]
      : coordinates.map(lift);
    return { ...feature, properties: { ...feature.properties, __correspondenceRole: roles.get(feature.properties.__roomSearchKey) },
      geometry: { ...feature.geometry, coordinates: lift(feature.geometry.coordinates) } };
  });
  return { features: roofs, paths: roofs.flatMap(feature => {
    const rings = feature.geometry.type === "Polygon" ? feature.geometry.coordinates : feature.geometry.coordinates.flat();
    return rings.map(path => ({ path, key: feature.properties.__roomSearchKey, role: feature.properties.__correspondenceRole }));
  }) };
}

export function createCorrespondenceLayers(options) {
  const data = correspondenceOverlayData(options.features, options.authoritativeFeatures, options.floors, options.spacing, options.heightExaggeration);
  if (!data.features.length) return [];
  return [new GeoJsonLayer({ id: "room-correspondence-fill", data: { type: "FeatureCollection", features: data.features },
    pickable: false, stroked: false, filled: true, extruded: false, material: false,
    getFillColor: feature => [...CORRESPONDENCE_COLORS[feature.properties.__correspondenceRole], 55],
    parameters: { depthMask: false } }),
  new PathLayer({ id: "room-correspondence-outline", data: data.paths, pickable: false,
    getPath: row => row.path, getColor: row => [...CORRESPONDENCE_COLORS[row.role], 235],
    widthUnits: "pixels", getWidth: 2.5, parameters: { depthTest: false, depthMask: false } })];
}
