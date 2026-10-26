import { ROOM_FLOORS } from "./roomCatalog";
import { correspondenceFloor, footprintSignature } from "./roomCorrespondenceIdentity";

// The combined export rounds XY to 9 decimal degrees (~0.11 mm north/south).
// Compare complete rings at that export precision, never modify source geometry.
// This tolerance applies only to cross-export identity, not spatial analysis.
const exportSignatures = new WeakMap();
export function routeFootprintSignature(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return null;
  if (exportSignatures.has(geometry)) return exportSignatures.get(geometry);
  const roundRing = ring => ring.map(p => [Number(p[0].toFixed(9)), Number(p[1].toFixed(9))]);
  let signature = null;
  try {
    const coordinates = geometry.type === 'Polygon' ? geometry.coordinates.map(roundRing)
      : geometry.coordinates.map(polygon => polygon.map(roundRing));
    signature = footprintSignature({type:geometry.type,coordinates});
  } catch { /* Malformed footprints cannot establish identity. */ }
  exportSignatures.set(geometry,signature);
  return signature;
}

// Catalog provenance is the identity, never a room's display name. Unannotated
// geometry gets a separate namespace: an export-local OBJECTID alone cannot
// prove which catalog it came from. Display exports must be linked explicitly.
export function routeFeatureKey(feature) {
  const p = feature?.properties || {};
  if (p.__roomSearchKey) return p.__roomSearchKey;
  if (Object.hasOwn(p, "__routeFeatureKey")) return p.__routeFeatureKey;
  if (p.__displayFeatureKey) return null; // Must be resolved against the catalog.
  const floor = correspondenceFloor(feature);
  if (!ROOM_FLOORS.includes(floor)) return null;
  const footprint = footprintSignature(feature?.geometry);
  return footprint ? `uncatalogued:F${floor}:${footprint}` : null;
}

// Match exports only by full XY footprint (at export precision) and floor. Neither export row order,
// display name nor an independently assigned export OBJECTID proves a match.
export function linkRouteFeatureIdentities(displayFeatures, authoritativeFeatures) {
  const byFootprint = new Map();
  const signatureKey = feature => {
    const footprint = routeFootprintSignature(feature?.geometry);
    return footprint ? `${correspondenceFloor(feature)}:${footprint}` : null;
  };
  for (const feature of authoritativeFeatures) {
    const signature = signatureKey(feature), key = routeFeatureKey(feature);
    if (!signature || !key) continue;
    if (!byFootprint.has(signature)) byFootprint.set(signature, new Set());
    byFootprint.get(signature).add(key);
  }
  return displayFeatures.map(feature => {
    if (feature.properties?.__roomSearchKey) return feature;
    const matches = byFootprint.get(signatureKey(feature));
    const key = matches?.size === 1 ? [...matches][0] : null;
    return { ...feature, properties: { ...feature.properties, __routeFeatureKey: key,
      __routeIdentityStatus: key ? 'matched' : matches?.size > 1 ? 'ambiguous' : 'unmatched' } };
  });
}
