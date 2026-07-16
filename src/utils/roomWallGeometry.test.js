import { describe, expect, it } from "vitest";
import { buildRoomWallShells } from "./roomWallGeometry";

const squareRoom = {
  type: "Feature",
  id: "room-a",
  properties: { level: 1, base_height: 0, height: 3 },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-89.22, 37.71],
        [-89.2198, 37.71],
        [-89.2198, 37.7102],
        [-89.22, 37.7102],
        [-89.22, 37.71],
      ],
    ],
  },
};

describe("roomWallGeometry", () => {
  it("creates an extrudable perimeter shell without changing source properties", () => {
    const walls = buildRoomWallShells({
      features: [squareRoom],
      thicknessMeters: 0.12,
    });

    expect(walls.features).toHaveLength(1);
    expect(walls.features[0].geometry.type).toBe("Polygon");
    expect(walls.features[0].properties.__roomWallHeight).toBe(3);
    expect(walls.features[0].geometry.coordinates[0][0]).toHaveLength(3);
    expect(squareRoom.geometry.coordinates[0][0]).toHaveLength(2);
  });

  it("skips rooms whose height does not rise above their base", () => {
    const walls = buildRoomWallShells({
      features: [
        {
          ...squareRoom,
          properties: { ...squareRoom.properties, base_height: 3, height: 3 },
        },
      ],
    });

    expect(walls.features).toHaveLength(0);
  });

  it("supports MultiPolygons and interior rings through Turf offsets", () => {
    const roomWithHole = {
      ...squareRoom,
      id: "room-with-hole",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            squareRoom.geometry.coordinates[0],
            [
              [-89.21995, 37.71005],
              [-89.21985, 37.71005],
              [-89.21985, 37.71015],
              [-89.21995, 37.71015],
              [-89.21995, 37.71005],
            ],
          ],
        ],
      },
    };

    const walls = buildRoomWallShells({ features: [roomWithHole] });

    expect(walls.features).toHaveLength(1);
    expect(["Polygon", "MultiPolygon"]).toContain(walls.features[0].geometry.type);
  });
});
