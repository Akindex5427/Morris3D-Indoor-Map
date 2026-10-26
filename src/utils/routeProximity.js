import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp';

const routes = new WeakMap();
const reader = new GeoJSONReader();
// Same local meter convention as the existing landmark calculations. Cache by
// immutable route coordinates and polygon geometry; camera/preview never enter.
export function routePolygonProximity(geometry, points, routeKey = points) {
  if (!Array.isArray(points) || points.length < 2 ||
      points.some(p => !Number.isFinite(p?.lng) || !Number.isFinite(p?.lat))) return null;
  let route = routes.get(routeKey);
  if (!route) {
    const origin=points[0],scaleX=111320*Math.cos(origin.lat*Math.PI/180);
    const project=([x,y])=>[(x-origin.lng)*scaleX,(y-origin.lat)*111320];
    const coordinates=points.map(p=>project([p.lng,p.lat]));
    route={project,coordinates,line:reader.read({type:'LineString',coordinates}),polygons:new WeakMap()};
    routes.set(routeKey,route);
  }
  if (!geometry || !['Polygon','MultiPolygon'].includes(geometry.type)) return null;
  if (route.polygons.has(geometry)) return route.polygons.get(geometry);
  let result=null;
  try {
    const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    const coordinates=polygons.map(p=>p.map(r=>r.map(route.project)));
    const polygon=reader.read({type:'MultiPolygon',coordinates});
    if (!new IsValidOp(polygon).isValid() || polygon.isEmpty()) throw Error('Invalid polygon');
    const nearest=DistanceOp.nearestPoints(polygon,route.line);
    const [roomPoint,routePoint]=nearest;
    let best=Infinity,segmentIndex=0,t=0;
    for(let i=1;i<route.coordinates.length;i++){
      const [ax,ay]=route.coordinates[i-1],[bx,by]=route.coordinates[i],dx=bx-ax,dy=by-ay;
      const fraction=Math.max(0,Math.min(1,((routePoint.x-ax)*dx+(routePoint.y-ay)*dy)/(dx*dx+dy*dy||1)));
      const distance=Math.hypot(routePoint.x-ax-fraction*dx,routePoint.y-ay-fraction*dy);
      if(distance<best){best=distance;segmentIndex=i-1;t=fraction;}
    }
    result=Object.freeze({distanceMeters:Math.hypot(roomPoint.x-routePoint.x,roomPoint.y-routePoint.y),
      roomPoint:{x:roomPoint.x,y:roomPoint.y},routePoint:{x:routePoint.x,y:routePoint.y},segmentIndex,t});
  } catch { /* Invalid geometry cannot establish route proximity. */ }
  route.polygons.set(geometry,result);
  return result;
}
