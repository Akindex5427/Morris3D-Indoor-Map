import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IndoorRouter } from "../../routing";
import {
  buildRoomAnchorIndex,
  getRoomCentroid,
  resolveRoomRoutingTarget,
} from "./routeAnchors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const readGeoJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));

const centerlines = readGeoJson("public/room_level_1_centerlines.geojson");
const walkable = readGeoJson("public/room_level_1_walkable.geojson");
const obstacles = readGeoJson("public/room_level_1_obstacle_buffered.geojson");
const rooms = readGeoJson("public/rooms-level-01-WGS.geojson").features;
const level3Centerlines = readGeoJson("public/room_level_3_centerlines.geojson");
const level3Walkable = readGeoJson("public/room_level_3_walkable.geojson");
const level3Obstacles = readGeoJson(
  "public/room_level_3_obstacle_buffered.geojson",
);
const level3Rooms = readGeoJson("public/rooms-level-03-WGS.geojson").features;
const level5Centerlines = readGeoJson("public/room_level_5_centerlines.geojson");
const level5Walkable = readGeoJson("public/room_level_5_walkable.geojson");
const level5Obstacles = readGeoJson(
  "public/room_level_5_obstacle_buffered.geojson",
);
const level5Rooms = readGeoJson("public/rooms-level-5-WGS.geojson").features;
const level6Centerlines = readGeoJson("public/room_level_6_centerlines.geojson");
const level6Rooms = readGeoJson("public/rooms-level-6-WGS.geojson").features;

const router = new IndoorRouter(centerlines, walkable, obstacles, {
  maxSnapDistanceMeters: 50,
  nodeToleranceMeters: 0.05,
  validationSampleStepMeters: 0.5,
  simplifyCollinearPoints: false,
});
const roomAnchorIndex = buildRoomAnchorIndex(centerlines);
const level3Router = new IndoorRouter(
  level3Centerlines,
  level3Walkable,
  level3Obstacles,
  {
    maxSnapDistanceMeters: 50,
    nodeToleranceMeters: 0.05,
    validationSampleStepMeters: 0.5,
    simplifyCollinearPoints: false,
  },
);
const level3RoomAnchorIndex = buildRoomAnchorIndex(level3Centerlines);
const level5Router = new IndoorRouter(
  level5Centerlines,
  level5Walkable,
  level5Obstacles,
  {
    maxSnapDistanceMeters: 50,
    nodeToleranceMeters: 0.05,
    validationSampleStepMeters: 0.5,
    simplifyCollinearPoints: false,
  },
);
const level5RoomAnchorIndex = buildRoomAnchorIndex(level5Centerlines);
const level6Router = new IndoorRouter(
  level6Centerlines,
  null,
  null,
  {
    maxSnapDistanceMeters: 50,
    nodeToleranceMeters: 0.05,
    validationSampleStepMeters: 0.5,
    simplifyCollinearPoints: false,
  },
);
const level6RoomAnchorIndex = buildRoomAnchorIndex(level6Centerlines);

const getRoom = (roomFeatures, name) => {
  const room = roomFeatures.find(
    (feature) =>
      String(feature.properties?.name ?? "").toLowerCase() ===
      name.toLowerCase(),
  );

  if (!room) {
    throw new Error(`Unable to find room "${name}" in the requested dataset.`);
  }

  return room;
};

const expectCoordinateClose = (
  actual,
  expected,
  epsilon = 0.00005,
) => {
  expect(actual).toBeTruthy();
  expect(Math.abs(actual.lng - expected.lng)).toBeLessThanOrEqual(epsilon);
  expect(Math.abs(actual.lat - expected.lat)).toBeLessThanOrEqual(epsilon);
};

describe("room_level_1 routing anchors", () => {
  it("uses the encoded centerline anchor for University honors", () => {
    const room = getRoom(rooms, "University honors");
    const target = resolveRoomRoutingTarget({
      room,
      floorId: 1,
      router,
      roomAnchorIndex,
      role: "destination",
    });
    const centroid = getRoomCentroid(room);

    expect(target?.debug?.source).toBe("level1_centerline_anchor");
    expectCoordinateClose(target?.coordinates, {
      lng: -89.22052834598013,
      lat: 37.71504417328312,
    });
    expect(target?.coordinates?.lng).not.toBe(centroid?.lng);
    expect(target?.coordinates?.lat).not.toBe(centroid?.lat);
  });

  it("routes University honors to its centerline anchor without crossing obstacles", () => {
    const startTarget = resolveRoomRoutingTarget({
      room: getRoom(rooms, "information desk"),
      floorId: 1,
      router,
      roomAnchorIndex,
      role: "start",
    });
    const endTarget = resolveRoomRoutingTarget({
      room: getRoom(rooms, "University honors"),
      floorId: 1,
      router,
      roomAnchorIndex,
      role: "destination",
    });

    const result = router.computeRoute(
      startTarget.coordinates,
      endTarget.coordinates,
    );

    expect(result.success).toBe(true);
    expect(
      (result.debug?.renderedSegments ?? []).every(
        (segment) => segment.valid && !segment.intersectsObstacle,
      ),
    ).toBe(true);
    expectCoordinateClose(result.debug?.finalGraphEnd, endTarget.coordinates);
  });

  it("keeps Center for Teaching Excellence routes on the graph and stops at its anchor", () => {
    const startTarget = resolveRoomRoutingTarget({
      room: getRoom(rooms, "information desk"),
      floorId: 1,
      router,
      roomAnchorIndex,
      role: "start",
    });
    const endTarget = resolveRoomRoutingTarget({
      room: getRoom(rooms, "center for teaching excellence"),
      floorId: 1,
      router,
      roomAnchorIndex,
      role: "destination",
    });

    expect(startTarget?.coordinates).toBeTruthy();
    expect(endTarget?.debug?.source).toBe("level1_centerline_anchor");

    const result = router.computeRoute(
      startTarget.coordinates,
      endTarget.coordinates,
    );

    expect(result.success).toBe(true);
    expect(
      (result.debug?.renderedSegments ?? []).every(
        (segment) => segment.valid && !segment.intersectsObstacle,
      ),
    ).toBe(true);
    expectCoordinateClose(result.debug?.finalGraphEnd, endTarget.coordinates);
  });
});

describe("room_level_3 routing anchors", () => {
  it("uses the encoded centerline anchor for Lerner music studio", () => {
    const room = getRoom(level3Rooms, "lerner music studio");
    const target = resolveRoomRoutingTarget({
      room,
      floorId: 3,
      router: level3Router,
      roomAnchorIndex: level3RoomAnchorIndex,
      role: "destination",
    });
    const centroid = getRoomCentroid(room);

    expect(target?.debug?.source).toBe("level3_centerline_anchor");
    expectCoordinateClose(target?.coordinates, {
      lng: -89.22041143693973,
      lat: 37.71527946778371,
    }, 0.0001);
    expect(target?.coordinates?.lng).not.toBe(centroid?.lng);
    expect(target?.coordinates?.lat).not.toBe(centroid?.lat);
  });

  it("routes SIU Press to Lerner music studio on the level-3 centerline graph", () => {
    const startTarget = resolveRoomRoutingTarget({
      room: getRoom(level3Rooms, "siu press"),
      floorId: 3,
      router: level3Router,
      roomAnchorIndex: level3RoomAnchorIndex,
      role: "start",
    });
    const endTarget = resolveRoomRoutingTarget({
      room: getRoom(level3Rooms, "lerner music studio"),
      floorId: 3,
      router: level3Router,
      roomAnchorIndex: level3RoomAnchorIndex,
      role: "destination",
    });

    const result = level3Router.computeRoute(
      startTarget.coordinates,
      endTarget.coordinates,
    );

    expect(result.success).toBe(true);
    expect(
      (result.debug?.renderedSegments ?? []).every(
        (segment) => segment.valid && !segment.intersectsObstacle,
      ),
    ).toBe(true);
    expectCoordinateClose(result.debug?.finalGraphEnd, endTarget.coordinates);
  });
});

describe("room_level_5 centerline routing", () => {
  it("normalizes level-5 room name variants to explicit centerline anchors", () => {
    const target = resolveRoomRoutingTarget({
      room: getRoom(level5Rooms, "study group 0580b"),
      floorId: 5,
      router: level5Router,
      roomAnchorIndex: level5RoomAnchorIndex,
      role: "destination",
    });

    expect(target?.debug?.source).toBe("level5_centerline_anchor");
    expect(target?.debug?.snappedTarget).toBeTruthy();
  });

  it("falls back to the level-5 centerline graph when walkable validation rejects the floor", () => {
    const startTarget = resolveRoomRoutingTarget({
      room: getRoom(level5Rooms, "group study 0510a"),
      floorId: 5,
      router: level5Router,
      roomAnchorIndex: level5RoomAnchorIndex,
      role: "start",
    });
    const endTarget = resolveRoomRoutingTarget({
      room: getRoom(level5Rooms, "group study 0550a"),
      floorId: 5,
      router: level5Router,
      roomAnchorIndex: level5RoomAnchorIndex,
      role: "destination",
    });

    const result = level5Router.computeRoute(
      startTarget.coordinates,
      endTarget.coordinates,
    );
    const invalidSegments = (result.debug?.renderedSegments ?? []).filter(
      (segment) => !segment.valid || segment.intersectsObstacle,
    );

    expect(result.success).toBe(true);
    expect(result.coordinates.length).toBeGreaterThan(2);
    expect((result.debug?.graphNodeIds ?? []).length).toBeGreaterThan(1);
    expect(result.debug?.validationFallbackUsed).toBe(true);
    expect(invalidSegments).toEqual([]);
    expectCoordinateClose(result.debug?.finalGraphStart, startTarget.coordinates);
    expectCoordinateClose(result.debug?.finalGraphEnd, endTarget.coordinates);
  });
});

describe("room_level_6 centerline routing", () => {
  it("uses encoded centerline anchors for level-6 rooms", () => {
    const target = resolveRoomRoutingTarget({
      room: getRoom(level6Rooms, "math lab 0677"),
      floorId: 6,
      router: level6Router,
      roomAnchorIndex: level6RoomAnchorIndex,
      role: "destination",
    });

    expect(target?.debug?.source).toBe("level6_centerline_anchor");
    expect(target?.debug?.snappedTarget).toBeTruthy();
  });

  it("returns a graph polyline for level-6 routes that stays on the centerline network", () => {
    const startTarget = resolveRoomRoutingTarget({
      room: getRoom(level6Rooms, "elevator"),
      floorId: 6,
      router: level6Router,
      roomAnchorIndex: level6RoomAnchorIndex,
      role: "start",
    });
    const endTarget = resolveRoomRoutingTarget({
      room: getRoom(level6Rooms, "southern illinois african american heritage center 0640a"),
      floorId: 6,
      router: level6Router,
      roomAnchorIndex: level6RoomAnchorIndex,
      role: "destination",
    });

    const result = level6Router.computeRoute(
      startTarget.coordinates,
      endTarget.coordinates,
    );

    expect(result.success).toBe(true);
    expect(result.renderCoordinates.length).toBeGreaterThan(1);
    expect((result.debug?.graphNodeIds ?? []).length).toBeGreaterThan(1);
    expect(
      (result.debug?.renderedSegments ?? []).every(
        (segment) => segment.valid && !segment.intersectsObstacle,
      ),
    ).toBe(true);
    expectCoordinateClose(
      result.renderCoordinates[0],
      startTarget.coordinates,
      0.0001,
    );
    expectCoordinateClose(
      result.renderCoordinates[result.renderCoordinates.length - 1],
      endTarget.coordinates,
      0.0001,
    );
  });
});
