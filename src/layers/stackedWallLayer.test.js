import { describe, expect, it } from "vitest";
import {
  WALL_STACK_CONFIG,
  getVisibleWallStackKeys,
  normalizeWallStackFloorKey,
} from "./stackedWallLayer";

describe("stackedWallLayer", () => {
  it("maps app floor identifiers to wall stack floor keys", () => {
    expect(normalizeWallStackFloorKey(-1)).toBe("F0");
    expect(normalizeWallStackFloorKey(0)).toBe("F0");
    expect(normalizeWallStackFloorKey(7)).toBe("F7");
    expect(normalizeWallStackFloorKey("F3")).toBe("F3");
    expect(normalizeWallStackFloorKey("all")).toBe("F-ALL");
    expect(normalizeWallStackFloorKey("F-ALL")).toBe("F-ALL");
    expect(normalizeWallStackFloorKey("bad-floor")).toBeNull();
  });

  it("does not render wall stack files in single-floor mode", () => {
    expect(
      getVisibleWallStackKeys({
        selectedFloor: 0,
        selectedFloors: [],
      }),
    ).toEqual([]);

    expect(
      getVisibleWallStackKeys({
        selectedFloor: 1,
        selectedFloors: [],
      }),
    ).toEqual([]);
  });

  it("shows every wall stack in F-ALL mode", () => {
    expect(
      getVisibleWallStackKeys({
        selectedFloor: "all",
        selectedFloors: [],
      }),
    ).toEqual(Object.keys(WALL_STACK_CONFIG));
  });

  it("does not render wall stack files for multi-select filter mode", () => {
    expect(
      getVisibleWallStackKeys({
        selectedFloor: "all",
        selectedFloors: [1, 2],
      }),
    ).toEqual([]);
  });
});
