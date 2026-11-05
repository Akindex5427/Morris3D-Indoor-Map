import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import RoomCorrespondencePanel, { formatOverlapArea, formatOverlapPercent } from "./RoomCorrespondencePanel";

const render = result => renderToStaticMarkup(<RoomCorrespondencePanel analysis={{ request: { feature: {} }, result }} />);
const reference={key:"ref",label:"Test",floor:0,area:100};
it("distinguishes empty overlap, missing floors, and incomplete analysis without absent-floor sections",()=>{
  const html=render({status:"ready",reference,groups:[{floor:1,direction:"above",matches:[],available:true}]});
  expect(html).toContain("No overlapping features found on the immediately adjacent floor.");
  expect(html).not.toContain("Immediately Below");
  expect(html).toContain("does not establish doors");
  const missing=render({status:"ready",reference,groups:[{floor:1,direction:"above",matches:[],available:false}]});
  expect(missing).toContain("Floor data unavailable");expect(missing).not.toContain("No overlapping features found");
  expect(render({status:"ready",reference,groups:[{floor:1,direction:"above",matches:[],available:true,skipped:1}]})).toContain("analysis is incomplete");
});
it("shows genuine percentages on fixed 100-percent bars, reference area, and the text summary",()=>{
  const html=render({status:"ready",reference,groups:[{floor:1,direction:"above",available:true,matches:[
    {key:"a",floor:1,label:"Collection",name:"Collection",referencePercent:61.2,intersectionArea:61.2},
    {key:"b",floor:1,label:"Same",name:"Same",referencePercent:20,intersectionArea:20}]}]});
  expect(html).toContain('width:61.2%');expect(html).toContain('width:20%');
  expect(html).toContain('61.2% overlap');expect(html).toContain('100.00 m² footprint');
  expect(html).toContain("zero to one hundred percent scale");
  expect(html).toContain("Read analysis summary");expect(html).toContain("Listen to Analysis");
});
it("shows explicit F-ALL resolution and errors instead of invented identities",()=>{
  expect(render({status:"choose-reference",reference:{floor:3},choices:[]})).toContain("No usable matching footprint");
  expect(render({status:"error",message:"Self-intersection"})).toContain("Self-intersection");
  expect(render({status:"loading"})).toContain('aria-busy="true"');
});
it("does not round a positive sliver to zero",()=>{
  expect(formatOverlapArea(.0001)).toBe("<0.01");expect(formatOverlapPercent(.001)).toBe("<0.1%");
  expect(formatOverlapPercent(69.6496)).toBe("69.6%");
});
it("keeps metrics and a selected state with explicit projection and clear/focus controls",()=>{
 const match={key:"candidate",floor:1,label:"Neighbor",name:"Neighbor",referencePercent:50,intersectionArea:50};
 const result={status:"ready",reference,groups:[{floor:1,direction:"above",available:true,matches:[match]}]};
 const html=renderToStaticMarkup(<RoomCorrespondencePanel analysis={{request:{feature:{}},result,candidateKey:match.key}} visibleFloors={[0]} />);
 expect(html).toContain('aria-pressed="true"');expect(html).toContain('width:50%');
 expect(html).toContain("highlighted on map");expect(html).toContain("F1 footprint is projected onto F0");
 expect(html).toContain("Clear Highlight");expect(html).toContain("Focus on Overlap");
 const elsewhere=renderToStaticMarkup(<RoomCorrespondencePanel analysis={{request:{feature:{}},result,candidateKey:match.key}} visibleFloors={[3]} />);
 expect(elsewhere).toContain("Highlight is retained for F0 and F1");expect(elsewhere).toContain('disabled=""');
});
