import { describe, expect, it } from "vitest";
import {
  DEFAULT_WALL_COLOR,
  buildWallMeshes,
  parseWallColor,
} from "./wallGeometry";

describe("wallGeometry", () => {
  it("builds double-sided vertical mesh faces from a LineString wall", () => {
    const meshes = buildWallMeshes({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "wall-a",
          properties: {
            name: "wall",
            base_height: 2,
            height: 5,
            color: "#ff000080",
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [-89.22, 37.715],
              [-89.2199, 37.715],
            ],
          },
        },
      ],
    });

    expect(meshes).toHaveLength(1);
    expect(meshes[0].bottom).toBe(2);
    expect(meshes[0].top).toBe(5);
    expect(meshes[0].color).toEqual([255, 0, 0, 128]);

    const positions = Array.from(meshes[0].mesh.attributes.positions.value);
    expect(positions).toHaveLength(36);
    expect(Math.min(...positions.filter((_, index) => index % 3 === 2))).toBe(2);
    expect(Math.max(...positions.filter((_, index) => index % 3 === 2))).toBe(5);
  });

  it("supports MultiLineString and closed outlines without adding routing geometry", () => {
    const meshes = buildWallMeshes({
      type: "Feature",
      properties: {
        base_height: 0,
        height: 10,
        color: "white",
      },
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [-89.22, 37.715],
            [-89.2199, 37.715],
            [-89.2199, 37.7151],
            [-89.22, 37.7151],
            [-89.22, 37.715],
          ],
        ],
      },
    });

    expect(meshes).toHaveLength(1);
    expect(meshes[0].mesh.attributes.positions.value).toHaveLength(144);
  });

  it("uses visible opacity for transparent GIS hex colors", () => {
    expect(parseWallColor("#ffffff00")).toEqual([
      255,
      255,
      255,
      DEFAULT_WALL_COLOR[3],
    ]);
  });

  it("preserves full stacked wall Z bounds from GeoJSON properties", () => {
    const stackedWallBottom = 0;
    const stackedWallTop = 75;

    const meshes = buildWallMeshes({
      type: "Feature",
      properties: {
        base_height: stackedWallBottom,
        height: stackedWallTop,
        color: "#ffffff00",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-89.22, 37.715],
          [-89.2199, 37.715],
        ],
      },
    });

    expect(meshes).toHaveLength(1);
    expect(meshes[0].bottom).toBe(stackedWallBottom);
    expect(meshes[0].top).toBe(stackedWallTop);

    const positions = Array.from(meshes[0].mesh.attributes.positions.value);
    const zValues = positions.filter((_, index) => index % 3 === 2);
    expect(Math.min(...zValues)).toBe(stackedWallBottom);
    expect(Math.max(...zValues)).toBe(stackedWallTop);
  });
});
