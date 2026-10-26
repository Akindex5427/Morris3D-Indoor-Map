import { describe, it, expect } from 'vitest';
import { buildFloorCatalog } from './roomCatalog';
import { routeFeatureKey, linkRouteFeatureIdentities } from './routeLabelIdentity';
import { findRouteLandmarks } from './routeLandmarks';

const feature = (id, x=0, name='Same name') => ({type:'Feature',properties:{OBJECTID:id,name,level:1},
  geometry:{type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]]]}});
const catalog = (features,floor=1)=>buildFloorCatalog({type:'FeatureCollection',features},floor).data.features;
describe('route label provenance',()=>{
  it('keeps identical names separate within and across floors, and survives renaming',()=>{
    const a=catalog([feature(1),feature(2,2)]),b=catalog([feature(1)],2);
    expect(new Set([...a,...b].map(routeFeatureKey)).size).toBe(3);
    expect(routeFeatureKey({...a[0],properties:{...a[0].properties,name:'Changed'}})).toBe(routeFeatureKey(a[0]));
  });
  it('maps reversed export order and independent IDs by exact floor/footprint',()=>{
    const a=catalog([feature(1),feature(2,2)]);
    const display=[feature(999,2),feature(998)].map((f,i)=>({...f,properties:{...f.properties,__displayFeatureKey:`combined:${i}`}}));
    const mapped=linkRouteFeatureIdentities(display,a);
    expect(mapped.map(routeFeatureKey)).toEqual([routeFeatureKey(a[1]),routeFeatureKey(a[0])]);
    expect(display[0].properties.__routeFeatureKey).toBeUndefined();
  });
  it('does not guess an ambiguous, shifted, or wrong-floor match',()=>{
    const a=catalog([feature(1),feature(2)]);
    const mapped=linkRouteFeatureIdentities([feature(44),feature(45,0.001),{...feature(46),properties:{level:2}}],a);
    expect(mapped.map(routeFeatureKey)).toEqual([null,null,null]);
    expect(mapped.map(f=>f.properties.__routeIdentityStatus)).toEqual(['ambiguous','unmatched','unmatched']);
  });
  it('retains catalog row disambiguation for duplicate source IDs',()=>{
    const a=catalog([feature(1),feature(1,2)]);
    expect(routeFeatureKey(a[0])).not.toBe(routeFeatureKey(a[1]));
  });
  it('allows the measured nine-decimal export rounding without changing either geometry',()=>{
    const original=feature(1,0.0000000003),a=catalog([original]);
    const rounded=feature(99,0);
    const snapshot=JSON.stringify([a,rounded]);
    expect(routeFeatureKey(linkRouteFeatureIdentities([rounded],a)[0])).toBe(routeFeatureKey(a[0]));
    expect(JSON.stringify([a,rounded])).toBe(snapshot);
  });
  it('does not deduplicate two nearby rooms or exclude an endpoint namesake by name',()=>{
    const small=(id,x)=>({type:'Feature',properties:{OBJECTID:id,name:'Reading Room',level:1},
      geometry:{type:'Polygon',coordinates:[[[x,0.00001],[x+0.00002,0.00001],[x+0.00002,0.00003],[x,0.00003],[x,0.00001]]]}});
    const rooms=catalog([small(1,0.00002),small(2,0.00012),small(3,0.00022)]);
    const options={debug:false,maxLandmarksPerSegment:4};
    const routePoints=[{lng:0,lat:0},{lng:0.0003,lat:0}];
    expect(findRouteLandmarks({rooms,routePoints,floorId:1,options}).map(l=>l.roomId)).toHaveLength(3);
    const result=findRouteLandmarks({rooms,routePoints,floorId:1,startRoom:rooms[0],options});
    expect(result.map(l=>l.roomId)).toEqual(rooms.slice(1).map(routeFeatureKey));
  });
});
