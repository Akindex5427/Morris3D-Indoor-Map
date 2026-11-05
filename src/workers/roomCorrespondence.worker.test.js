import { afterEach, expect, it, vi } from "vitest";
vi.mock("../utils/roomCorrespondence", () => ({
  createCorrespondenceIndex: vi.fn(data => { if (data.invalid) throw new Error("Invalid replacement coordinates"); return {version:data.version}; }),
  resolveAndAnalyze: vi.fn(index => ({status:"ready",version:index.version})),
}));
afterEach(()=>vi.unstubAllGlobals());
it("does not use a stale index after invalid replacement data and can recover",async()=>{
  const scope={postMessage:vi.fn()};vi.stubGlobal("self",scope);
  await import("./roomCorrespondence.worker");
  const send=data=>{scope.onmessage({data});return scope.postMessage.mock.calls.at(-1)[0].result;};
  expect(send({id:1,datasets:{version:1},feature:{}}).version).toBe(1);
  expect(send({id:2,datasets:{invalid:true},feature:{}}).status).toBe("error");
  expect(send({id:3,feature:{}})).toMatchObject({status:"error",message:"Floor geometries are not ready"});
  expect(send({id:4,datasets:{version:2},feature:{}}).version).toBe(2);
});
