import { expect, it } from "vitest";
import { summarizeRoomAnalysis } from "./roomAnalysisSummary";
const match = (key, name, percent) => ({key, name, label:name, referencePercent:percent, intersectionArea:percent});
const result = groups => ({status:"ready",reference:{key:"ref",label:"Selected",floor:4,area:37.6},groups});
const group = (matches, other={}) => ({floor:5,direction:"above",available:true,matches,...other});
it("summarizes actual specific names without hiding generic intersections or adding coverage", () => {
  const source=result([group([match("floor","Floor",100),match("specific","Collection",61.2),match("structure","Structure",80)])]);
  const before=JSON.stringify(source), summary=summarizeRoomAnalysis(source);
  expect(summary.findings.map(f=>f.key)).toEqual(["specific"]);
  expect(summary.text).toContain("about 61 percent");
  expect(summary.text).not.toContain("100 percent");
  expect(summary.text).toContain("must not be added");
  expect(summary.text).toContain("does not establish");
  expect(JSON.stringify(source)).toBe(before);
});
it("uses one finding per side, stable identities, and verified classification only", () => {
  const a=match("a","Same",45),b=match("b","Same",55);
  b.classification={analysisRole:"background"}; // Unverified metadata cannot demote a result.
  expect(summarizeRoomAnalysis(result([group([a,b])])).findings[0].key).toBe("b");
  b.classification.provenance="Authoritative classification table";
  expect(summarizeRoomAnalysis(result([group([a,b])])).findings[0].key).toBe("a");
});
it("distinguishes missing data, empty floors, and incomplete analysis", () => {
  const missing=summarizeRoomAnalysis(result([group([],{available:false})])).text;
  expect(missing).toContain("overlap cannot be determined");
  expect(missing).not.toContain("no overlapping");
  expect(summarizeRoomAnalysis(result([group([])])).text).toContain("no overlapping features");
  expect(summarizeRoomAnalysis(result([group([],{skipped:1})])).text).toContain("analysis is incomplete");
});
it("speaks small positive percentages without rounding to zero and handles unnamed features", () => {
  const row={...match("id","OBJECTID 42",0.01),name:""};
  const summary=summarizeRoomAnalysis(result([group([row])]));
  expect(summary.text).toContain("OBJECTID 42");
  expect(summary.text).toContain("less than 1 percent");
  expect(summarizeRoomAnalysis({status:"loading"})).toBeNull();
});
