import { describe, expect, it } from "vitest";
import { getVisibleWallFloorSet } from "./buildingWallLayer";

describe("buildingWallLayer", () => {
  it("resolves a single selected floor to only that wall floor", () => {
    expect(Array.from(getVisibleWallFloorSet([1]))).toEqual([1]);
    expect(Array.from(getVisibleWallFloorSet([6]))).toEqual([6]);
  });

  it("resolves F-All floor ids to all matching wall floors", () => {
    expect(Array.from(getVisibleWallFloorSet([0, 1, 2, 3, 4, 5, 6, 7]))).toEqual([
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
    ]);
  });

  it("maps basement aliases to the F0 wall layer", () => {
    expect(Array.from(getVisibleWallFloorSet([-1]))).toEqual([0]);
    expect(Array.from(getVisibleWallFloorSet(["F0"]))).toEqual([0]);
  });

  it("keeps floor filter selections mapped to their matching wall layers", () => {
    expect(Array.from(getVisibleWallFloorSet(["F1"]))).toEqual([1]);
    expect(Array.from(getVisibleWallFloorSet([2, "F7"]))).toEqual([2, 7]);
  });
});
