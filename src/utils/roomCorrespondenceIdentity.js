import { roomName, roomIdentifiers } from "./roomCatalog";

export const correspondenceFloor = feature => Number(feature?.properties?.floor ?? feature?.properties?.level ?? feature?.properties?.nivel);
export const correspondenceLabel = feature => roomName(feature) || roomIdentifiers(feature).map(id => `${id.field} ${id.value}`)[0] || "Unnamed feature";

// Exact horizontal topology signature; ignore Z, ring direction/start, and part order.
// No rounding, name matching, bounding-box equivalence, or cross-export ID matching.
const signatures = new WeakMap();
export function footprintSignature(geometry) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return null;
  if (signatures.has(geometry)) return signatures.get(geometry);
  try {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    const ringKey = ring => ring.slice(1).map((point, i) =>
      [JSON.stringify(ring[i].slice(0, 2)), JSON.stringify(point.slice(0, 2))].sort().join(":")
    ).sort().join(";");
    const result = polygons.map(polygon => `${ringKey(polygon[0])}|${polygon.slice(1).map(ringKey).sort().join("|")}`).sort().join("/");
    signatures.set(geometry, result);
    return result;
  } catch { return null; }
}

export function exactAuthoritativeMatches(feature, features) {
  const signature = footprintSignature(feature?.geometry);
  if (!signature) return [];
  return features.filter(candidate => correspondenceFloor(candidate) === correspondenceFloor(feature) &&
    footprintSignature(candidate.geometry) === signature);
}
