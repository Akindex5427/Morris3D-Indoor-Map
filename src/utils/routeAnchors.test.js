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
const level7Centerlines = readGeoJson("public/room_level_7_centerlines.geojson");
const level7Walkable = readGeoJson("public/room_level_7_walkable.geojson");
const level7Obstacles = readGeoJson(
  "public/room_level_7_obstacle_buffered.geojson",
);
const level7Rooms = readGeoJson("public/rooms-level-7-WGS.geojson").features;
const basementCenterlines = readGeoJson("public/basement_centerlines.geojson");
const basementWalkable = readGeoJson("public/room_basement_walkable.geojson");
const basementObstacles = readGeoJson(
  "public/room_basement_obstacle_buffered.geojson",
);
const basementRooms = readGeoJson("public/rooms-basement-WGS.geojson").features;

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
const level7Router = new IndoorRouter(
  level7Centerlines,
  level7Walkable,
  level7Obstacles,
  {
    maxSnapDistanceMeters: 50,
    nodeToleranceMeters: 0.05,
    validationSampleStepMeters: 0.5,
    simplifyCollinearPoints: false,
  },
);
const level7CenterlineOnlyRouter = new IndoorRouter(
  level7Centerlines,
  null,
  null,
  {
    maxSnapDistanceMeters: 50,
    nodeToleranceMeters: 0.05,
    validationSampleStepMeters: 0.5,
    simplifyCollinearPoints: false,
  },
);
const level7RoomAnchorIndex = buildRoomAnchorIndex(level7Centerlines);
const basementRouter = new IndoorRouter(
  basementCenterlines,
  basementWalkable,
  basementObstacles,
  {
    maxSnapDistanceMeters: 50,
    nodeToleranceMeters: 0.05,
    validationSampleStepMeters: 0.5,
    simplifyCollinearPoints: false,
  },
);
const basementRoomAnchorIndex = buildRoomAnchorIndex(basementCenterlines);

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

describe("room_basement routing anchors", () => {
  it("routes national union catalog from the connected basement centerline component", () => {
    const startTarget = resolveRoomRoutingTarget({
      room: getRoom(basementRooms, "national union catalog"),
      floorId: 0,
      router: basementRouter,
      roomAnchorIndex: basementRoomAnchorIndex,
      role: "start",
    });
    const endTarget = resolveRoomRoutingTarget({
      room: getRoom(basementRooms, "dewey books 001 to 330"),
      floorId: 0,
      router: basementRouter,
      roomAnchorIndex: basementRoomAnchorIndex,
      role: "destination",
    });

    expect(startTarget?.debug?.source).toBe("level0_centerline_anchor");
    expect(endTarget?.debug?.source).toBe("level0_centerline_anchor");

    const result = basementRouter.computeRoute(
      startTarget.coordinates,
      endTarget.coordinates,
    );

    expect(result.success).toBe(true);
    expect(result.renderCoordinates.length).toBeGreaterThan(1);
    expect(result.debug?.startSnap?.componentId).toBe(
      result.debug?.endSnap?.componentId,
    );
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

describe("room_level_7 centerline routing", () => {
  it("uses the classroom 0752-side anchor when classroom 0752 is selected", () => {
    const startTarget = resolveRoomRoutingTarget({
      room: getRoom(level7Rooms, "classroom 0752"),
      floorId: 7,
      router: level7CenterlineOnlyRouter,
      roomAnchorIndex: level7RoomAnchorIndex,
      role: "start",
    });
    const endTarget = resolveRoomRoutingTarget({
      room: getRoom(level7Rooms, "center for learning support services"),
      floorId: 7,
      router: level7CenterlineOnlyRouter,
      roomAnchorIndex: level7RoomAnchorIndex,
      role: "destination",
    });

    expect(startTarget?.debug?.source).toBe("level7_geometry_anchor");
    expectCoordinateClose(startTarget?.coordinates, {
      lng: -89.22063510999548,
      lat: 37.7153596647848,
    });

    const result = level7CenterlineOnlyRouter.computeRoute(
      startTarget.coordinates,
      endTarget.coordinates,
    );

    expect(result.success).toBe(true);
    expectCoordinateClose(
      result.renderCoordinates[0],
      startTarget.coordinates,
      0.0001,
    );
  });

  it("keeps Center for Learning Support Services routes attached to the full centerline", () => {
    const startTarget = resolveRoomRoutingTarget({
      room: getRoom(level7Rooms, "center for learning support services"),
      floorId: 7,
      router: level7CenterlineOnlyRouter,
      roomAnchorIndex: level7RoomAnchorIndex,
      role: "start",
    });
    const endTarget = resolveRoomRoutingTarget({
      room: getRoom(level7Rooms, "classroom 0754"),
      floorId: 7,
      router: level7CenterlineOnlyRouter,
      roomAnchorIndex: level7RoomAnchorIndex,
      role: "destination",
    });

    expect(startTarget?.debug?.source).toBe("level7_centerline_anchor");
    expect(endTarget?.debug?.source).toBe("level7_centerline_anchor");
    expectCoordinateClose(startTarget?.coordinates, {
      lng: -89.22073495235739,
      lat: 37.71506942198426,
    });

    const prunedRoute = level7Router.computeRoute(
      startTarget.coordinates,
      endTarget.coordinates,
    );
    const centerlineRoute = level7CenterlineOnlyRouter.computeRoute(
      startTarget.coordinates,
      endTarget.coordinates,
    );

    expect(prunedRoute.success).toBe(true);
    expect(centerlineRoute.success).toBe(true);
    expect(centerlineRoute.renderCoordinates.length).toBeGreaterThan(
      prunedRoute.renderCoordinates.length,
    );
    expectCoordinateClose(
      centerlineRoute.renderCoordinates[0],
      startTarget.coordinates,
      0.0001,
    );
    expectCoordinateClose(
      centerlineRoute.renderCoordinates[centerlineRoute.renderCoordinates.length - 1],
      endTarget.coordinates,
      0.0001,
    );
  });
});
