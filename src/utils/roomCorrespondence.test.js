import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createCorrespondenceIndex, analyzeCorrespondence, resolveAndAnalyze, createMetricProjection } from "./roomCorrespondence";
import { exactAuthoritativeMatches } from "./roomCorrespondenceIdentity";
import { buildFloorCatalog, FLOOR_POLYGON_MAP } from "./roomCatalog";
import { correspondenceOverlayData } from "../layers/roomCorrespondenceLayers";

const project = createMetricProjection([-89.217, 37.714]);
const ring = (x, y, w, h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]].map(p => project.invert(p));
const feature = (key, floor, rings, extra = {}) => ({ type: "Feature", properties: { __roomSearchKey: key, floor, level: floor, name: key, height: 3, base_height: 0, ...extra }, geometry: { type: "Polygon", coordinates: rings } });
const box = (key, floor, x, y, w, h, extra) => feature(key, floor, [ring(x,y,w,h)], extra);
const datasets = features => Object.fromEntries([...new Set(features.map(f=>f.properties.floor))].map(floor=>[floor,{ type: "FeatureCollection", features: features.filter(f=>f.properties.floor===floor) }]));
const matches = result => result.groups.flatMap(g=>g.matches);

describe("vertical room correspondence", () => {
  it("computes metric intersections and both percentages; sorts floors by proximity and area", () => {
    const index = createCorrespondenceIndex(datasets([box("reference",3,0,0,10,10), box("above",4,0,0,10,10), box("partial",4,5,0,10,10), box("far",7,0,0,5,5), box("below",2,0,0,2,10)]));
    const result = analyzeCorrespondence(index,"reference"), rows=matches(result);
    expect(result.reference.area).toBeCloseTo(100,4);
    expect(rows.find(r=>r.key==="above").intersectionArea).toBeCloseTo(100,4);
    expect(rows.find(r=>r.key==="partial")).toMatchObject({floor:4});
    expect(rows.find(r=>r.key==="partial").referencePercent).toBeCloseTo(50,4);
    expect(rows.find(r=>r.key==="partial").candidatePercent).toBeCloseTo(50,4);
    expect(result.groups.filter(g=>g.direction==="above").map(g=>g.floor)).toEqual([4,5,6,7]);
    expect(result.groups.find(g=>g.floor===4).matches.map(r=>r.key)).toEqual(["above","partial"]);
    expect(analyzeCorrespondence(index,"reference").cacheHit).toBe(true);
    const reverse=matches(analyzeCorrespondence(index,"partial")).find(r=>r.key==="reference");
    expect(reverse.intersectionArea).toBeCloseTo(50,4);
  });
  it("handles holes, multipart footprints, unequal sizes, and multiple candidates", () => {
    const ref=feature("hole",1,[ring(0,0,10,10),ring(2,2,2,2)]);
    const multi={...box("multi",2,0,0,2,2),geometry:{type:"MultiPolygon",coordinates:[[ring(0,0,2,2)],[ring(8,8,4,4)]]}};
    const index=createCorrespondenceIndex(datasets([ref,multi,box("inside-hole",2,2.25,2.25,1,1),box("small",2,5,5,1,1)]));
    const result=analyzeCorrespondence(index,"hole"),rows=matches(result);
    expect(result.reference.area).toBeCloseTo(96,4);
    expect(rows.map(r=>r.key)).toEqual(["multi","small"]);
    expect(rows[0].intersectionArea).toBeCloseTo(8,4);
    expect(rows[0].candidatePercent).toBeCloseTo(40,4);
    expect(rows[1].candidatePercent).toBeCloseTo(100,4);
  });
  it("excludes boundary-only contacts and correctly reports empty overlap and F0/F7 limits", () => {
    const index=createCorrespondenceIndex(datasets([box("ground",0,0,0,10,10),box("touch",7,10,0,10,10),box("away",7,100,100,1,1)]));
    expect(matches(analyzeCorrespondence(index,"ground"))).toEqual([]);
    expect(analyzeCorrespondence(index,"ground").groups.every(g=>g.direction==="above")).toBe(true);
    expect(analyzeCorrespondence(index,"touch").groups.every(g=>g.direction==="below")).toBe(true);
    expect(analyzeCorrespondence(index,"ground").candidatesTested).toBeLessThan(2);
  });
  it("rejects self crossings, bad holes, unclosed rings, and nonfinite coordinates without silently repairing", () => {
    const bow=feature("bow",2,[[[0,0],[10,10],[0,10],[10,0],[0,0]].map(p=>project.invert(p))]);
    const hole=feature("bad-hole",2,[ring(0,0,10,10),ring(20,20,1,1)]);
    const open=box("open",2,0,0,1,1);open.geometry.coordinates[0].pop();
    const nan=box("nan",2,0,0,1,1);nan.geometry.coordinates[0][1][0]=NaN;
    const index=createCorrespondenceIndex(datasets([box("valid",1,0,0,10,10),bow,hole,open,nan]));
    expect(index.issues.length).toBe(4);expect(index.rows.size).toBe(1);
    expect(()=>analyzeCorrespondence(index,"bow")).toThrow();
    expect(analyzeCorrespondence(index,"valid").groups.find(g=>g.floor===2).skipped).toBe(4);
  });
  it("reports missing floors and uses source identifiers when names are absent", () => {
    const index=createCorrespondenceIndex(datasets([box("a",0,0,0,10,10),box("b",1,0,0,5,5,{name:null,OBJECTID:42})]));
    expect(matches(analyzeCorrespondence(index,"a"))[0].label).toBe("OBJECTID 42");
    expect(analyzeCorrespondence(index,"a").groups.find(g=>g.floor===7).available).toBe(false);
  });
  it("resolves exact XY independently of Z/name and refuses ambiguous or changed F-ALL identities", () => {
    const a=box("a",1,0,0,10,10),b=box("b",1,20,0,10,10);
    const combined={...a,properties:{name:"different",floor:1},geometry:{...a.geometry,coordinates:a.geometry.coordinates.map(r=>r.map(p=>[...p,99]))}};
    expect(exactAuthoritativeMatches(combined,[a,b])).toEqual([a]);
    const index=createCorrespondenceIndex(datasets([a,b,box("upper",2,0,0,10,10)]));
    expect(resolveAndAnalyze(index,combined).reference.key).toBe("a");
    const changed={...box("changed",1,0,0,5,5),properties:{floor:1,name:"a"}};
    const choices=resolveAndAnalyze(index,changed);
    expect(choices.status).toBe("choose-reference");expect(choices.choices.map(r=>r.key)).toEqual(["a"]);
    const duplicate=createCorrespondenceIndex(datasets([a,{...a,properties:{...a.properties,__roomSearchKey:"duplicate"}}]));
    expect(resolveAndAnalyze(duplicate,combined).status).toBe("choose-reference");
  });
  it("keeps source geometry immutable, and invalidates analysis with a new dataset index", () => {
    const source=datasets([box("a",0,0,0,10,10),box("b",1,0,0,10,10)]),before=JSON.stringify(source);
    const index=createCorrespondenceIndex(source);analyzeCorrespondence(index,"a");
    expect(JSON.stringify(source)).toBe(before);
    const changed=createCorrespondenceIndex(datasets([source[0].features[0],box("b",1,100,0,10,10)]));
    expect(matches(analyzeCorrespondence(changed,"a"))).toEqual([]);
  });
  it("places paired overlays with existing stack datums and unchanged XY", () => {
    const a=box("a",3,0,0,10,10,{base_height:12,height:15,__correspondenceRole:"reference"});
    const b=box("b",4,0,0,10,10,{base_height:17,height:20,__correspondenceRole:"candidate"});
    const before=JSON.stringify([a,b]);
    const data=correspondenceOverlayData([a,b],[a,b],[0,1,2,3,4,5,6,7]);
    expect(data.paths.length).toBe(2);
    data.features.forEach((f,i)=>{
      expect(f.geometry.coordinates[0].map(p=>p.slice(0,2))).toEqual([a,b][i].geometry.coordinates[0]);
      expect(f.geometry.coordinates[0][0][2]).toBeCloseTo([28.58,38.08][i],6);
    });
    expect(JSON.stringify([a,b])).toBe(before);
    const single=correspondenceOverlayData([b],[b,box("slab",4,0,0,30,30,{base_height:15,height:17})],[4]);
    expect(single.features[0].geometry.coordinates[0][0][2]).toBeCloseTo(5.08,6);
  });
  it("audits the real eight floors and computes the SIU Press example from geometry", () => {
    const sources=Object.fromEntries(Array.from({length:8},(_,floor)=>[floor,buildFloorCatalog(JSON.parse(readFileSync(`public${FLOOR_POLYGON_MAP[floor]}`,"utf8")),floor).data]));
    const before=JSON.stringify(sources),index=createCorrespondenceIndex(sources);
    writeFileSync("docs/stage-6-correspondence/validation-audit.json", JSON.stringify({ valid: index.rows.size, issues: index.issues }, null, 2));
    const press=[...index.rows.values()].find(row=>row.floor===3&&/university press/i.test(row.label));
    expect(press).toBeTruthy();
    const result=analyzeCorrespondence(index,press.key);
    expect(result.groups.length).toBe(7);expect(matches(result).length).toBeGreaterThan(0);
    for(const row of matches(result)) {
      expect(row.intersectionArea).toBeGreaterThan(0);
      expect(row.referencePercent).toBeCloseTo(100*row.intersectionArea/result.reference.area,8);
      expect(row.referencePercent).toBeLessThanOrEqual(100);expect(row.candidatePercent).toBeLessThanOrEqual(100);
    }
    expect(JSON.stringify(sources)).toBe(before);
    const audit={origin:index.origin,extent:index.extent,preparationMs:index.preparationMs,
      floors:Array.from({length:8},(_,floor)=>({floor,total:sources[floor].features.length,valid:index.floors.get(floor)?.length||0,invalid:index.issues.filter(i=>i.floor===floor).length})),
      example:result,issues:index.issues};
    writeFileSync("docs/stage-6-correspondence/data-audit.json",JSON.stringify(audit,null,2));
  });
});
