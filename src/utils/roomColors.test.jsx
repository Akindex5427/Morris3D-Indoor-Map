import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getRoomFunction, resolveRoomColor, summarizeRoomFunctions, UNIFORM_ROOM_COLOR } from "./roomColors";
import { FLOOR_POLYGON_MAP, ROOM_FLOORS } from "./roomCatalog";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RoomColorLegend from "../components/RoomColorLegend";

// Synthetic test data only; these categories are NOT Morris Library classifications.
const config = { field: "verified_use", provenance: "Synthetic unit-test fixture",
  categories: [{ id: "a", label: "Test A", color: [10, 20, 30] }, { id: "b", label: "Test B", color: [80, 90, 100] }],
  values: { A: "a", B: "b" } };
const features = ["A", "A", "B", "unknown"].map(verified_use => ({ properties: { verified_use, color: "red" } }));

describe("room color semantics", () => {
  it("does not infer functions from names, stack, or colors", () => {
    expect(getRoomFunction({ name: "Classroom", stack: "A", color: "red" })).toBeNull();
    expect(getRoomFunction(features[0].properties, { ...config, provenance: "" })).toBeNull();
    expect(getRoomFunction({ verified_use: "a" }, config)).toBeNull();
    expect(getRoomFunction({ verified_use: "toString" }, config)).toBeNull();
  });
  it("uses only explicitly mapped, valid categories and leaves unknown values neutral", () => {
    expect(resolveRoomColor(features[0].properties, "function", config)).toEqual([10, 20, 30]);
    expect(resolveRoomColor(features[3].properties, "function", config)).toEqual(UNIFORM_ROOM_COLOR);
    expect(getRoomFunction(features[0].properties, { ...config, categories: [{ id: "a", label: "bad", color: [999, 0, 0] }] })).toBeNull();
  });
  it("retains original colors and does not mutate feature or configuration colors", () => {
    const props = Object.freeze({ color: "red", verified_use: "A" });
    const rgb = resolveRoomColor(props, "function", config); rgb[0] = 255;
    expect(config.categories[0].color).toEqual([10, 20, 30]);
    expect(resolveRoomColor(props, "uniform")).toEqual(UNIFORM_ROOM_COLOR);
    expect(resolveRoomColor(props, "original")).toEqual([255, 0, 0]);
    expect(props.color).toBe("red");
  });
  it("limits legend categories and counts to the current view and hides inactive legends", () => {
    const summary = summarizeRoomFunctions([features[0], features[3]], config);
    expect(summary).toMatchObject({ classified: 1, unclassified: 1, categories: [{ id: "a", count: 1 }] });
    const html = renderToStaticMarkup(<RoomColorLegend mode="function" summary={summary} />);
    expect(html).toContain("Test A"); expect(html).not.toContain("Test B"); expect(html).toContain("Unclassified");
    expect(renderToStaticMarkup(<RoomColorLegend mode="original" summary={summary} />)).toBe("");
    expect(renderToStaticMarkup(<RoomColorLegend mode="function" summary={summarizeRoomFunctions(features)} />)).toBe("");
  });
  for (const floor of [...ROOM_FLOORS, "all"]) {
    it(`audits real F${floor} without inventing classifications or modifying data`, () => {
      const data = JSON.parse(readFileSync(`public${FLOOR_POLYGON_MAP[floor]}`, "utf8"));
      const before = JSON.stringify(data);
      expect(summarizeRoomFunctions(data.features)).toMatchObject({ classified: 0, unclassified: data.features.length, categories: [] });
      for (const f of data.features) {
        expect(resolveRoomColor(f.properties, "uniform")).toEqual(UNIFORM_ROOM_COLOR);
        expect(resolveRoomColor(f.properties, "function")).toEqual(UNIFORM_ROOM_COLOR);
        resolveRoomColor(f.properties, "original");
      }
      expect(JSON.stringify(data)).toBe(before);
    });
  }
});
