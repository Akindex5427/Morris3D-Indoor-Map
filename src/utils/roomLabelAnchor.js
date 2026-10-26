import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader";
import IsValidOp from "jsts/org/locationtech/jts/operation/valid/IsValidOp";
import InteriorPointArea from "jsts/org/locationtech/jts/algorithm/InteriorPointArea";
import Centroid from "jsts/org/locationtech/jts/algorithm/Centroid";
import SimplePointInAreaLocator from "jsts/org/locationtech/jts/algorithm/locate/SimplePointInAreaLocator";
import Coordinate from "jsts/org/locationtech/jts/geom/Coordinate";
import Location from "jsts/org/locationtech/jts/geom/Location";
import { createLocalProjection } from "../../routing/geometry";

const cache = new WeakMap();
const reader = new GeoJSONReader();

// Shared by route landmark analysis and rendering. XY only; renderer owns Z.
// Fail closed and expose the reason instead of falling back outside the room.
export function getRoomLabelAnchorResult(feature) {
  const geometry = feature?.geometry;
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type))
    return { position: null, reason: 'missing polygon geometry' };
  if (cache.has(geometry)) return cache.get(geometry);
  let result;
  try {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const points = polygons.flat(2);
    if (!points.length || points.some(p => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) ||
      Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw Error('invalid XY coordinates');
    const projection = createLocalProjection(points[0][0], points[0][1]);
    const projected = polygons.map(polygon => polygon.map(ring => ring.map(([lng, lat]) => {
      const p = projection.project(lng, lat); return [p.x, p.y];
    })));
    const metric = reader.read({type:'MultiPolygon', coordinates:projected});
    if (!new IsValidOp(metric).isValid()) throw Error('invalid polygon topology');
    const parts = Array.from({length:metric.getNumGeometries()}, (_, i)=>metric.getGeometryN(i))
      .filter(part=>part.getArea()>0).sort((a,b)=>b.getArea()-a.getArea());
    let position = null;
    for (const part of parts) {
      for (const point of [Centroid.getCentroid(part), InteriorPointArea.getInteriorPoint(part)]) {
        if (!point || SimplePointInAreaLocator.locate(point, part) !== Location.INTERIOR) continue;
        const geographic = projection.unproject(point.x, point.y);
        const roundTrip = projection.project(geographic.lng, geographic.lat);
        if (SimplePointInAreaLocator.locate(new Coordinate(roundTrip.x, roundTrip.y), part) !== Location.INTERIOR) continue;
        position = Object.freeze([geographic.lng, geographic.lat]); break;
      }
      if (position) break;
    }
    result = { position, reason: position ? null : 'no strictly interior anchor' };
  } catch (error) { result = { position:null, reason:error.message }; }
  cache.set(geometry, result);
  return result;
}

export const getRoomLabelAnchor = feature => getRoomLabelAnchorResult(feature).position;
