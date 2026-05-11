import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERIMETER_WALL_URL,
  createPerimeterWallMeshLayers,
} from "./perimeterWallLayer";

describe("perimeterWallLayer", () => {
  it("uses wall.geojson as the default standalone perimeter wall source", () => {
    expect(DEFAULT_PERIMETER_WALL_URL).toBe("/wall.geojson");
  });

  it("creates non-pickable mesh layers from LineString wall features", () => {
    const layers = createPerimeterWallMeshLayers({
      wallData: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "shell-a",
            properties: {
              base_height: 1,
              height: 6,
              color: "#ffffff00",
              name: "wall",
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
      },
    });

    expect(layers).toHaveLength(1);
    expect(layers[0].id).toBe("building-perimeter-shell-wall-shell-a-0");
    expect(layers[0].props.pickable).toBe(false);
    expect(layers[0].props.data[0].bottom).toBe(1);
    expect(layers[0].props.data[0].top).toBe(6);
    expect(layers[0].props.data[0].animatedTop).toBe(6);
  });

  it("applies cinematic reveal progress to wall.geojson meshes without changing final heights", () => {
    const layers = createPerimeterWallMeshLayers({
      wallData: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "shell-a",
            properties: {
              base_height: 2,
              height: 10,
              name: "wall",
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
      },
      presentation: {
        initialRevealActive: true,
        revealProgress: 0.25,
      },
    });

    const wall = layers[0].props.data[0];

    expect(wall.bottom).toBe(2);
    expect(wall.top).toBe(10);
    expect(wall.animatedTop).toBe(4);
    expect(wall.revealProgress).toBe(0.25);
  });
});
