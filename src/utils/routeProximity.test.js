import { describe, it, expect } from 'vitest';
import { routePolygonProximity } from './routeProximity';
const ring=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]].map(p=>p.map(v=>v/111320));
const polygon=(...rings)=>({type:'Polygon',coordinates:rings});
const path=(...xy)=>xy.map(([x,y])=>({lng:x/111320,lat:y/111320}));
describe('filled polygon route proximity in local meters',()=>{
  it('returns zero for a route wholly inside a large room',()=>expect(routePolygonProximity(polygon(ring(0,0,100,100)),path([20,20],[25,20])).distanceMeters).toBe(0));
  it('treats a polygon hole as outside, not a room',()=>expect(routePolygonProximity(polygon(ring(0,0,100,100),ring(10,10,80,80)),path([40,40],[50,40])).distanceMeters).toBeCloseTo(30,5));
  it('finds the nearest multipart component',()=>expect(routePolygonProximity({type:'MultiPolygon',coordinates:[[ring(0,20,10,10)],[ring(0,2,10,10)]]},path([0,0],[10,0])).distanceMeters).toBeCloseTo(2,5));
  it('handles a concave notch without treating its bounding box as filled',()=>{
    const g=polygon([[0,0],[20,0],[20,20],[15,20],[15,5],[5,5],[5,20],[0,20],[0,0]].map(p=>p.map(v=>v/111320)));
    expect(routePolygonProximity(g,path([10,12],[10,15])).distanceMeters).toBeCloseTo(5,5);
  });
  it('rejects an invalid self-intersection',()=>expect(routePolygonProximity(polygon([[0,0],[1,1],[0,1],[1,0],[0,0]]),path([0,0],[10,0]))).toBeNull());
  it('reuses cached geometry results without aliasing a new route',()=>{
    const g=polygon(ring(0,2,10,10)),a=path([0,0],[10,0]),b=path([0,-10],[10,-10]);
    const first=routePolygonProximity(g,a);expect(routePolygonProximity(g,a)).toBe(first);
    expect(routePolygonProximity(g,b).distanceMeters).toBeCloseTo(12,5);
  });
});
