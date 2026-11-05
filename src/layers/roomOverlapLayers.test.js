import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader";
import { createCorrespondenceIndex, analyzeCorrespondence, createMetricProjection, OVERLAP_AREA_EPSILON } from "../utils/roomCorrespondence";
import { correspondenceOverlayData, createCorrespondenceLayers, CORRESPONDENCE_COLORS } from "./roomCorrespondenceLayers";
import { buildFloorCatalog, FLOOR_POLYGON_MAP, ROOM_FLOORS } from "../utils/roomCatalog";
const projection=createMetricProjection([-89.22,37.71]);
const ring=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]].map(p=>projection.invert(p));
const feature=(key,floor,coordinates,base,height,role,type="Polygon")=>({type:"Feature",properties:{name:"Same name",floor,level:floor,base_height:base,height,__roomSearchKey:key,__correspondenceRole:role},geometry:{type,coordinates}});
const ref=feature("ref",4,[ring(0,0,10,10),ring(2,2,2,2)],10,13,"reference");
const candidate=feature("candidate",5,[ring(5,0,10,10)],15,18,"candidate");
const slab=feature("slab",4,[ring(-10,-10,40,40)],8,9,"other");
const sources=features=>Object.fromEntries([...new Set(features.map(f=>f.properties.floor))].map(floor=>[floor,{type:"FeatureCollection",features:features.filter(f=>f.properties.floor===floor)}]));
const analyze=(features,key="ref")=>{const index=createCorrespondenceIndex(sources(features));return {index,result:analyzeCorrespondence(index,key)};};
const area=(geometry,project)=>new GeoJSONReader().read({...geometry,coordinates:geometry.coordinates.map(poly=>poly.map(r=>r.map(p=>project(p.slice(0,2)))))}).getArea();

it("returns the same clipped geometry for statistics and rendering, cached with source identity",()=>{
 const {index,result}=analyze([ref,candidate]);const match=result.groups[0].matches[0];
 expect(match.referenceKey).toBe("ref");expect(match.key).toBe("candidate");
 expect(match.intersectionGeometry.type).toBe("MultiPolygon");
 expect(Math.abs(area(match.intersectionGeometry,index.projection)-match.intersectionArea)).toBeLessThan(OVERLAP_AREA_EPSILON);
 expect(match.referencePercent).toBeCloseTo(100*match.intersectionArea/result.reference.area,10);
 expect(analyzeCorrespondence(index,"ref").groups[0].matches[0].intersectionGeometry).toBe(match.intersectionGeometry);
 const changed=analyze([ref,{...candidate,geometry:{type:"Polygon",coordinates:[ring(100,100,10,10)]}}]);
 expect(changed.result.groups.flatMap(g=>g.matches)).toEqual([]);
});
it("preserves holes and disconnected intersections without a second clipping algorithm",()=>{
 const multi=feature("multi",5,[[ring(0,0,5,5)],[ring(8,8,4,4)]],15,18,"candidate","MultiPolygon");
 const {index,result}=analyze([ref,multi]);const match=result.groups[0].matches[0];
 expect(match.intersectionGeometry.coordinates.length).toBe(2);
 expect(match.intersectionGeometry.coordinates[0].length).toBe(2);
 expect(match.intersectionArea).toBeCloseTo(25,4); // 25 - 4 hole + 4 opposite corner
 expect(Math.abs(area(match.intersectionGeometry,index.projection)-match.intersectionArea)).toBeLessThan(OVERLAP_AREA_EPSILON);
});
it("projects a pair onto the reference roof in a single-floor view and preserves every XY",()=>{
 const all=[ref,candidate,slab],before=JSON.stringify(all),{result}=analyze(all);
 const match={...result.groups[0].matches[0],direction:"above"};
 const data=correspondenceOverlayData([ref,candidate],all,[4],4.5,1,match);
 expect(data.projection).toEqual({sourceFloor:5,displayFloor:4});
 expect(data.features.map(f=>f.properties.__projected)).toEqual([false,true]);
 expect(data.paths.map(p=>p.color)).toContainEqual(CORRESPONDENCE_COLORS.reference);
 expect(data.paths.map(p=>p.color)).toContainEqual(CORRESPONDENCE_COLORS.above);
 expect(data.intersections.length).toBe(1);
 const lifted=data.intersections[0].geometry.coordinates;
 expect(lifted.flat(2).every(p=>p[2]===5)).toBe(true); // base10 - floorDatum8 + thickness3
 expect(lifted.map(poly=>poly.map(r=>r.map(p=>p.slice(0,2))))).toEqual(match.intersectionGeometry.coordinates);
 expect(JSON.stringify(all)).toBe(before);
 const other=correspondenceOverlayData([ref,candidate],all,[5],4.5,1,match);
 expect(other.projection).toEqual({sourceFloor:4,displayFloor:5});
 expect(other.intersections[0].geometry.coordinates.flat(2).every(p=>p[2]===3)).toBe(true);
 expect(correspondenceOverlayData([ref,candidate],all,[2],4.5,1,match).intersections).toEqual([]);
});
it("uses actual stacked elevations exactly once and preserves geometry during redraw",()=>{
 const all=[ref,candidate],{result}=analyze(all),match={...result.groups[0].matches[0],direction:"above"};
 const data=correspondenceOverlayData(all,all,[0,1,2,3,4,5,6,7],4.5,2,match);
 expect(data.intersections.map(f=>f.geometry.coordinates[0][0][0][2])).toEqual([34,43.5]); // base + stack + thickness*2
 const layers=createCorrespondenceLayers({data});
 expect(layers.map(l=>l.id)).toContain("room-overlap-intersection-fill");
 expect(layers.every(l=>l.props.pickable===false&&l.props.parameters.depthTest===false&&l.props.parameters.depthMask===false)).toBe(true);
 const repeated=createCorrespondenceLayers({data});expect(repeated[0].props.data.features).toBe(layers[0].props.data.features);
 expect(data.projection).toBeNull();
});
it("clears only the active pair overlay and ignores stale reference/candidate combinations",()=>{
 const all=[ref,candidate],{result}=analyze(all),match={...result.groups[0].matches[0],direction:"above"};
 const cleared=correspondenceOverlayData([ref],all,[4],4.5,1,null);
 expect(cleared.paths.every(p=>p.role==="reference")).toBe(true);expect(cleared.intersections).toEqual([]);
 expect(correspondenceOverlayData(all,all,[4],4.5,1,{...match,referenceKey:"old-reference"}).intersections).toEqual([]);
 expect(createCorrespondenceLayers({data:correspondenceOverlayData([],all,[4])})).toEqual([]);
 const reverse=analyze(all,"candidate").result.groups.find(g=>g.floor===4).matches[0];
 const refs=[{...candidate,properties:{...candidate.properties,__correspondenceRole:"reference"}},{...ref,properties:{...ref.properties,__correspondenceRole:"candidate"}}];
 const below=correspondenceOverlayData(refs,all,[5],4.5,1,{...reverse,direction:"below"});
 expect(below.paths.find(p=>p.role==="candidate").color).toEqual(CORRESPONDENCE_COLORS.below);
});
it("matches displayed geometry area to the reported area across real adjacent-floor results",()=>{
 const datasets=Object.fromEntries(ROOM_FLOORS.map(floor=>[floor,buildFloorCatalog(JSON.parse(readFileSync(`public${FLOOR_POLYGON_MAP[floor]}`,"utf8")),floor).data]));
 const index=createCorrespondenceIndex(datasets);
 let checked=0;
 for(const [floor,query] of [[0,/dewey/i],[1,/0174/],[4,/0420D/],[7,/0754/]]){
  const reference=[...index.rows.values()].find(row=>row.floor===floor&&query.test(row.label));expect(reference).toBeTruthy();
  for(const match of analyzeCorrespondence(index,reference.key).groups.flatMap(group=>group.matches)){
   const displayedArea=area(match.intersectionGeometry,index.projection);
   expect(Math.abs(displayedArea-match.intersectionArea)).toBeLessThan(Math.max(OVERLAP_AREA_EPSILON,match.intersectionArea*1e-8));
   checked++;
  }
 }
 expect(checked).toBeGreaterThan(8);
});
