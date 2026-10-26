import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader';
import SimplePointInAreaLocator from 'jsts/org/locationtech/jts/algorithm/locate/SimplePointInAreaLocator';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate';
import Location from 'jsts/org/locationtech/jts/geom/Location';
import { getRoomLabelAnchor, getRoomLabelAnchorResult } from './roomLabelAnchor';
import { FLOOR_POLYGON_MAP } from './roomCatalog';
const reader=new GeoJSONReader();
const polygon=rings=>({geometry:{type:'Polygon',coordinates:rings}});
const square=(x,y,size)=>[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]];
const verify=feature=>{
  const p=getRoomLabelAnchor(feature);
  expect(p).not.toBeNull();
  expect(SimplePointInAreaLocator.locate(new Coordinate(...p),reader.read(feature.geometry))).toBe(Location.INTERIOR);
  expect(getRoomLabelAnchor(feature)).toBe(p);
  return p;
};
describe('shared strictly interior room label anchor',()=>{
  it('handles concave and narrow irregular polygons',()=>{
    verify(polygon([[[0,0],[5,0],[5,1],[1,1],[1,5],[0,5],[0,0]]]));
    verify(polygon([[[0,0],[8,0],[8,0.00001],[0,0.00002],[0,0]]]));
  });
  it('avoids holes and chooses an interior point on a multipart room',()=>{
    verify(polygon([square(0,0,6),square(1,1,4)]));
    const p=verify({geometry:{type:'MultiPolygon',coordinates:[[square(0,0,1)],[square(4,4,3)]]}});
    expect(p[0]).toBeGreaterThan(4);
  });
  it('returns an explicit failure for malformed or invalid polygons, never a centroid fallback',()=>{
    for(const f of [polygon([[[0,0],[1,1],[0,1],[1,0],[0,0]]]),polygon([[[0,0],[1,0],[2,0],[0,0]]]),polygon([[[NaN,0]]])]){
      expect(getRoomLabelAnchorResult(f).position).toBeNull();
      expect(getRoomLabelAnchorResult(f).reason).toBeTruthy();
    }
  });
  for(const floor of [0,1,2,3,4,5,6,7,'all']) it(`anchors every valid source polygon on F${floor}`,()=>{
    const data=JSON.parse(fs.readFileSync(`public${FLOOR_POLYGON_MAP[floor]}`,'utf8'));
    data.features.forEach(verify);
  });
});
