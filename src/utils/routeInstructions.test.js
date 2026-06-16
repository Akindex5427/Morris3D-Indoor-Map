import { describe, expect, it } from "vitest";
import {
  classifyTurn,
  computeTurnAngle,
  generateMultiFloorRouteInstructions,
  generateRouteInstructions,
  generateVerticalInstruction,
  estimateSegmentDistance,
} from "./routeInstructions";

const routeResult = (coordinates, nodeIds = []) => ({
  coordinates,
  renderCoordinates: coordinates,
  distance: 0,
  waypointCount: coordinates.length,
  debug: {
    graphNodeIds: nodeIds,
  },
});

const routeFromXY = (points) =>
  routeResult(
    points.map(([x, y]) => ({
      lng: -89.22 + x / 100000,
      lat: 37.715 + y / 100000,
    })),
  );

describe("routeInstructions", () => {
  it("classifies dynamic turn angles from route geometry", () => {
    expect(classifyTurn(10)).toBe("straight");
    expect(classifyTurn(40)).toBe("slight-right");
    expect(classifyTurn(-90)).toBe("left");
    expect(classifyTurn(150)).toBe("sharp-right");
    expect(classifyTurn(178)).toBe("sharp-right");
  });

  it("generates straight and turn instructions from polyline geometry", () => {
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2202, lat: 37.715 },
        { lng: -89.2201, lat: 37.715 },
        { lng: -89.2201, lat: 37.7151 },
      ]),
      floorId: 1,
      startName: "Start",
      destinationName: "Destination",
    });

    expect(instructions[0]).toMatchObject({
      type: "start",
      floorId: "F1",
    });
    expect(instructions.some((instruction) => instruction.type === "turn")).toBe(true);
    expect(instructions.at(-1)).toMatchObject({
      type: "arrival",
      text: "You have arrived at Destination.",
    });
  });

  it("folds a single nearby landmark into the turn instruction for short segments", () => {
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2203, lat: 37.715 },
        { lng: -89.2201, lat: 37.715 },
        { lng: -89.2201, lat: 37.7151 },
      ]),
      floorId: 1,
      startName: "Start",
      destinationName: "Destination",
      options: {
        landmarks: [
          {
            id: "browsing-room",
            label: "Browsing Room",
            side: "left",
            coords: [-89.2202, 37.715],
          },
        ],
      },
    });

    const turnInstructions = instructions.filter(
      (instruction) => instruction.type === "turn",
    );
    expect(turnInstructions).toHaveLength(1);
    // Short segment (≤25 m) + isFinalTurn → "after X, toward Destination"
    expect(turnInstructions[0].text).toBe(
      "Turn left after Browsing Room on your left, toward Destination.",
    );
  });

  it("produces 'At X, turn' when a landmark is within 5 m of the turn point", () => {
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2205, lat: 37.715 },
        { lng: -89.2201, lat: 37.715 },
        { lng: -89.2201, lat: 37.7154 },
      ]),
      floorId: 2,
      startName: "Library Entrance",
      destinationName: "Reading Room",
      options: {
        landmarks: [
          {
            id: "corner-desk",
            label: "Corner Desk",
            side: "right",
            // Placed almost exactly at the turn point [-89.2201, 37.715]
            coords: [-89.22011, 37.71501],
          },
        ],
      },
    });

    const turnInstructions = instructions.filter((i) => i.type === "turn");
    expect(turnInstructions.length).toBeGreaterThan(0);
    expect(turnInstructions[0].text).toMatch(/^At Corner Desk,/);
  });

  it("emits a 'between X and Y' straight instruction when two landmarks flank the route", () => {
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2208, lat: 37.715 },
        { lng: -89.2201, lat: 37.715 },
        { lng: -89.2201, lat: 37.7153 },
      ]),
      floorId: 1,
      startName: "Start",
      destinationName: "End",
      options: {
        landmarks: [
          { id: "room-a", label: "Room A", side: "left",  coords: [-89.2206, 37.715] },
          { id: "room-b", label: "Room B", side: "right", coords: [-89.2203, 37.715] },
        ],
      },
    });

    const straightInstructions = instructions.filter((i) => i.type === "straight");
    const betweenStep = straightInstructions.find((i) =>
      i.text.includes("between") && i.text.includes("Room A") && i.text.includes("Room B"),
    );
    expect(betweenStep).toBeDefined();
  });

  it("derives landmark sides from route geometry when side metadata is absent", () => {
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2208, lat: 37.715 },
        { lng: -89.2201, lat: 37.715 },
      ]),
      floorId: 1,
      startName: "Start",
      destinationName: "End",
      options: {
        landmarks: [
          {
            id: "north-stack",
            label: "North Stack",
            coords: [-89.22045, 37.715],
            roomCoordinate: { lng: -89.22045, lat: 37.715025 },
          },
          {
            id: "south-stack",
            label: "South Stack",
            coords: [-89.22045, 37.715],
            roomCoordinate: { lng: -89.22045, lat: 37.714975 },
          },
        ],
      },
    });

    const between = instructions.find((instruction) =>
      instruction.text.includes("between North Stack on your left and South Stack on your right"),
    );
    expect(between).toBeDefined();
  });

  it("uses route order to say a turn happens after passing a nearby landmark", () => {
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.22035, lat: 37.715 },
        { lng: -89.2201, lat: 37.715 },
        { lng: -89.2201, lat: 37.7148 },
      ]),
      floorId: 1,
      startName: "Start",
      destinationName: "End",
      options: {
        landmarks: [
          {
            id: "study-area",
            label: "Study Area",
            coords: [-89.22018, 37.715],
            roomCoordinate: { lng: -89.22018, lat: 37.71502 },
          },
        ],
      },
    });

    const turn = instructions.find((instruction) => instruction.type === "turn");
    expect(turn?.text).toMatch(/Turn right after Study Area on your left/);
  });

  it("describes the arrival location with a nearby room when one exists", () => {
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2205, lat: 37.715 },
        { lng: -89.2201, lat: 37.715 },
      ]),
      floorId: 3,
      startName: "Lobby",
      destinationName: "Periodicals",
      options: {
        landmarks: [
          {
            id: "window-alcove",
            label: "Window Alcove",
            side: "right",
            // Very close to the destination point
            coords: [-89.22011, 37.71501],
          },
        ],
      },
    });

    const arrival = instructions.find((i) => i.type === "arrival");
    expect(arrival).toBeDefined();
    expect(arrival.text).toBe(
      "You have arrived at Periodicals, with Window Alcove on your left.",
    );
  });

  it("uses graph topology to describe intersection turn choice", () => {
    const nodes = new Map([
      ["prev", { id: "prev", point: { x: 0, y: -10 } }],
      ["current", { id: "current", point: { x: 0, y: 0 } }],
      ["firstRight", { id: "firstRight", point: { x: 8, y: 8 } }],
      ["secondRight", { id: "secondRight", point: { x: 10, y: 0 } }],
      ["left", { id: "left", point: { x: -10, y: 0 } }],
    ]);
    const graph = {
      nodes,
      adjacency: new Map([
        [
          "current",
          [
            { nodeId: "prev" },
            { nodeId: "firstRight" },
            { nodeId: "secondRight" },
            { nodeId: "left" },
          ],
        ],
      ]),
      projection: {
        unproject: (x, y) => ({
          lng: -89.22 + x / 100000,
          lat: 37.715 + y / 100000,
        }),
      },
    };
    const instructions = generateRouteInstructions({
      routeResult: routeResult(
        [
          { lng: -89.22, lat: 37.7149 },
          { lng: -89.22, lat: 37.715 },
          { lng: -89.2199, lat: 37.715 },
        ],
        ["prev", "current", "secondRight"],
      ),
      floorId: 1,
      graph,
      destinationName: "Destination",
    });

    expect(
      instructions.some((instruction) =>
        instruction.text.toLowerCase().includes("right"),
      ),
    ).toBe(true);
  });

  it("uses displayed render coordinates for turn detection", () => {
    const hiddenGraphRoute = [
      { lng: -89.2206, lat: 37.715 },
      { lng: -89.2203, lat: 37.715 },
      { lng: -89.2203, lat: 37.7153 },
      { lng: -89.2200, lat: 37.7153 },
    ];
    const instructions = generateRouteInstructions({
      routeResult: {
        coordinates: hiddenGraphRoute,
        renderCoordinates: [hiddenGraphRoute[0], hiddenGraphRoute.at(-1)],
        debug: { graphCoordinates: hiddenGraphRoute },
      },
      floorId: 1,
      startName: "Start",
      destinationName: "End",
    });

    expect(instructions.filter((instruction) => instruction.type === "turn")).toHaveLength(0);
  });

  it("generates a slight turn instruction for visible bends above the minor threshold", () => {
    const instructions = generateRouteInstructions({
      routeResult: routeFromXY([
        [0, 0],
        [10, 0],
        [20, 8.4],
      ]),
      floorId: 1,
      startName: "Start",
      destinationName: "End",
    });

    const turns = instructions.filter((instruction) => instruction.type === "turn");
    expect(turns).toHaveLength(1);
    expect(turns[0].turnDirection).toBe("slight-left");
  });

  it("generates vertical connector instructions for elevators and stairs", () => {
    expect(
      generateVerticalInstruction({
        connectorType: "elevator",
        fromFloor: "1",
        toFloor: "7",
        fromAccessPoint: { lng: -89.22, lat: 37.715 },
      }),
    ).toMatchObject({
      type: "vertical",
      connectorType: "elevator",
      text: "Take the elevator to Floor 7.",
    });

    expect(
      generateVerticalInstruction({
        connectorType: "accessible",
        connectorName: "Accessible Connector",
        fromFloor: "1",
        toFloor: "7",
        fromAccessPoint: { lng: -89.22, lat: 37.715 },
      }),
    ).toMatchObject({
      type: "vertical",
      connectorType: "elevator",
      text: "Take the elevator to Floor 7.",
    });

    const multiFloor = generateMultiFloorRouteInstructions({
      segments: [
        {
          type: "vertical-transition",
          connectorType: "stairs",
          fromFloor: "1",
          toFloor: "7",
          fromAccessPoint: { lng: -89.22, lat: 37.715 },
        },
      ],
      startName: "Start",
      destinationName: "Destination",
    });

    expect(multiFloor[0]).toMatchObject({
      connectorType: "stairs",
      text: "Take the stairs to Floor 7.",
    });
  });

  // ── Between-landmark (corridor pair) ──────────────────────────────────────

  it("generates 'between X and Y' when landmarks with explicit sides flank the route", () => {
    // Long straight corridor; two landmarks at similar t values, one on each side.
    // findLandmarksOnSegment should prefer the left+right pair over two same-side ones.
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2210, lat: 37.71500 },
        { lng: -89.2200, lat: 37.71500 },
      ]),
      floorId: 1,
      startName: "Entrance",
      destinationName: "Exit",
      options: {
        landmarks: [
          // Left and right at nearly the same position along the route
          { id: "north-room", label: "Maps Collection",   side: "left",  coords: [-89.2205, 37.71502] },
          { id: "south-room", label: "Serials Reading",   side: "right", coords: [-89.2205, 37.71498] },
        ],
      },
    });

    const straight = instructions.filter((i) => i.type === "straight");
    const between = straight.find((i) =>
      i.text.includes("between") &&
      i.text.includes("Maps Collection") &&
      i.text.includes("Serials Reading"),
    );
    expect(between).toBeDefined();
    expect(between.text).toMatch(/on your left/);
    expect(between.text).toMatch(/on your right/);
  });

  it("generates 'Pass X on your right' for a single right-side landmark", () => {
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2210, lat: 37.71500 },
        { lng: -89.2200, lat: 37.71500 },
      ]),
      floorId: 1,
      startName: "Entrance",
      destinationName: "Exit",
      options: {
        landmarks: [
          { id: "south-room", label: "Current Periodicals", side: "right", coords: [-89.2205, 37.71498] },
        ],
      },
    });

    const straight = instructions.filter((i) => i.type === "straight");
    const passStep = straight.find((i) =>
      i.text.includes("Current Periodicals") && i.text.includes("right"),
    );
    expect(passStep).toBeDefined();
    expect(passStep.text).toMatch(/Pass Current Periodicals on your right/);
  });

  it("generates 'Pass X on your left' for a single left-side landmark", () => {
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2210, lat: 37.71500 },
        { lng: -89.2200, lat: 37.71500 },
      ]),
      floorId: 1,
      startName: "Entrance",
      destinationName: "Exit",
      options: {
        landmarks: [
          { id: "north-room", label: "Reference Desk", side: "left", coords: [-89.2205, 37.71502] },
        ],
      },
    });

    const straight = instructions.filter((i) => i.type === "straight");
    const passStep = straight.find((i) =>
      i.text.includes("Reference Desk") && i.text.includes("left"),
    );
    expect(passStep).toBeDefined();
    expect(passStep.text).toMatch(/Pass Reference Desk on your left/);
  });

  it("prefers the closest visible opposite-side corridor pair", () => {
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2210, lat: 37.71500 },
        { lng: -89.2200, lat: 37.71500 },
      ]),
      floorId: 1,
      startName: "Entrance",
      destinationName: "Exit",
      options: {
        landmarks: [
          { id: "far-left", label: "Far Left", side: "left", coords: [-89.2205, 37.715039] },
          { id: "far-right", label: "Far Right", side: "right", coords: [-89.2205, 37.714961] },
          { id: "near-left", label: "Near Left", side: "left", coords: [-89.22054, 37.71501] },
          { id: "near-right", label: "Near Right", side: "right", coords: [-89.22046, 37.71499] },
        ],
      },
    });

    const between = instructions.find((instruction) =>
      instruction.text.includes("between"),
    );
    expect(between?.text).toMatch(/Near Left/);
    expect(between?.text).toMatch(/Near Right/);
    expect(between?.text).not.toMatch(/Far Left|Far Right/);
  });

  // ── Turn-count fidelity (Douglas–Peucker) ──────────────────────────────────

  it("generates exactly one turn instruction for a route with collinear graph-node noise", () => {
    // Straight approach with two sub-millimetre jitter points, then one real
    // 90° corner.  The DPS pass must strip the jitter so that exactly one
    // "turn" instruction is emitted.
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2210, lat: 37.71500 },  // start
        { lng: -89.2207, lat: 37.71500 },  // straight corridor node
        { lng: -89.2204, lat: 37.71500 },  // straight corridor node
        { lng: -89.2201, lat: 37.71500 },  // corner
        { lng: -89.2201, lat: 37.71540 },  // departure
      ]),
      floorId: 1,
      startName: "Entrance",
      destinationName: "Archive",
    });

    const turns = instructions.filter((i) => i.type === "turn");
    expect(turns).toHaveLength(1);
    expect(turns[0].turnDirection).toBe("left");
  });

  it("generates exactly two turn instructions for an L-then-L route with intermediate noise", () => {
    // Two real 90° corners separated by a straight segment with one noise
    // waypoint.  Must produce exactly two turn instructions.
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2212, lat: 37.71500 }, // start — heading east
        { lng: -89.2205, lat: 37.71500 }, // first corner (turn north)
        { lng: -89.2205, lat: 37.71505 }, // noise node on northward leg
        { lng: -89.2205, lat: 37.71520 }, // second corner (turn east)
        { lng: -89.2201, lat: 37.71520 }, // destination
      ]),
      floorId: 2,
      startName: "Lobby",
      destinationName: "Reading Room",
    });

    const turns = instructions.filter((i) => i.type === "turn");
    expect(turns).toHaveLength(2);
    expect(turns[0].turnDirection).toBe("left");   // first left turn
    expect(turns[1].turnDirection).toBe("right");  // second right turn
  });

  // ── Destination approach (final straight segment) ─────────────────────────

  it("generates 'Continue toward [dest]' on a long final approach (no landmarks)", () => {
    // Long straight route (> 15 m) with a prior turn, no landmarks.
    // The final-straight instruction should name the destination.
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2210, lat: 37.71500 }, // start
        { lng: -89.2205, lat: 37.71500 }, // turn right (south)
        { lng: -89.2205, lat: 37.71350 }, // long southward leg → destination
      ]),
      floorId: 1,
      startName: "Lobby",
      destinationName: "Special Collections",
    });

    const straight = instructions.filter((i) => i.type === "straight");
    const approach = straight.at(-1);
    expect(approach).toBeDefined();
    expect(approach.text).toMatch(/toward Special Collections/);
  });

  it("uses the selected end room name in the final approach and arrival", () => {
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2210, lat: 37.71500 },
        { lng: -89.2205, lat: 37.71500 },
        { lng: -89.2205, lat: 37.71350 },
      ]),
      floorId: 1,
      startName: "Lobby",
      destinationName: "  Special Collections  ",
    });

    const approach = instructions.find((i) => i.id === "F1-final-straight");
    const arrival = instructions.find((i) => i.type === "arrival");

    expect(approach?.text).toBe("Continue toward Special Collections.");
    expect(arrival?.text).toBe("You have arrived at Special Collections.");
  });

  it("generates 'Your destination is just ahead' on a short final approach", () => {
    // Two-point route; only start + destination — total < 15 m, no prior turn.
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2201, lat: 37.71500 },
        { lng: -89.2201, lat: 37.71508 }, // ~9 m north
      ]),
      floorId: 1,
      startName: "Hallway",
      destinationName: "Reading Room",
    });

    // No meaningful turn → no separate straight; arrival fires directly.
    // If a straight IS emitted it must use destination-first phrasing.
    const straights = instructions.filter((i) => i.type === "straight");
    if (straights.length > 0) {
      expect(straights.at(-1).text).toMatch(/Reading Room/);
    }
    const arrival = instructions.find((i) => i.type === "arrival");
    expect(arrival).toBeDefined();
    expect(arrival.text).toMatch(/Reading Room/);
  });

  it("generates 'Continue … toward [dest]' with a corridor pair on long final approach", () => {
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2210, lat: 37.71500 },
        { lng: -89.2201, lat: 37.71500 }, // long eastward leg (> 15 m)
      ]),
      floorId: 1,
      startName: "Entrance",
      destinationName: "Archive",
      options: {
        landmarks: [
          { id: "north-room", label: "Maps Collection",  side: "left",  coords: [-89.2206, 37.71502] },
          { id: "south-room", label: "Serials Reading",  side: "right", coords: [-89.2206, 37.71498] },
        ],
      },
    });

    const straight = instructions.filter((i) => i.type === "straight");
    const approach = straight.at(-1);
    expect(approach).toBeDefined();
    expect(approach.text).toMatch(/Maps Collection/);
    expect(approach.text).toMatch(/Serials Reading/);
    expect(approach.text).toMatch(/Archive/);
  });

  it("generates exactly three turn instructions for a Z-shaped route", () => {
    const instructions = generateRouteInstructions({
      routeResult: routeResult([
        { lng: -89.2212, lat: 37.71500 }, // start — east
        { lng: -89.2207, lat: 37.71500 }, // turn 1: right (south)
        { lng: -89.2207, lat: 37.71490 }, // turn 2: left (east)
        { lng: -89.2201, lat: 37.71490 }, // turn 3: right (south)
        { lng: -89.2201, lat: 37.71480 }, // destination
      ]),
      floorId: 3,
      startName: "Start",
      destinationName: "End",
    });

    const turns = instructions.filter((i) => i.type === "turn");
    expect(turns).toHaveLength(3);
  });

  // ── Multi-floor instruction generation ────────────────────────────────────

  it("uses real connector name in approach and exit instructions", () => {
    // Simulate a two-floor route: horizontal on floor 1 → stairs → horizontal on floor 3.
    const floor1Route = routeResult([
      { lng: -89.2210, lat: 37.71500 },
      { lng: -89.2201, lat: 37.71500 }, // long approach (> 15 m) to staircase
    ]);
    const floor3Route = routeResult([
      { lng: -89.2201, lat: 37.71500 },
      { lng: -89.2197, lat: 37.71500 }, // short leg after stairs to destination
    ]);

    const segments = [
      {
        type: "horizontal",
        floorId: "1",
        route: floor1Route,
        renderCoordinates: floor1Route.renderCoordinates,
        coordinates: floor1Route.coordinates,
        distance: 0,
        waypointCount: 2,
      },
      {
        type: "vertical-transition",
        connectorType: "stairs",
        connectorId: "stairs-1",
        connectorName: "Main Staircase",
        fromFloor: "1",
        toFloor: "3",
        fromAccessPoint: { lng: -89.2201, lat: 37.71500 },
        toAccessPoint: { lng: -89.2201, lat: 37.71500 },
        instruction: "",
      },
      {
        type: "horizontal",
        floorId: "3",
        route: floor3Route,
        renderCoordinates: floor3Route.renderCoordinates,
        coordinates: floor3Route.coordinates,
        distance: 0,
        waypointCount: 2,
      },
    ];

    const instructions = generateMultiFloorRouteInstructions({
      segments,
      startName: "Reading Room",
      destinationName: "Special Collections",
    });

    // Floor 1 start instruction
    const startStep = instructions.find((i) => i.type === "start");
    expect(startStep).toBeDefined();
    expect(startStep.text).toMatch(/Reading Room/);

    // Floor 1 approach → should name the staircase, not "vertical connector"
    const approachStep = instructions.find(
      (i) => i.type === "straight" && /staircase|stairs|elevator/i.test(i.text),
    );
    expect(approachStep).toBeDefined();

    // Vertical connector instruction
    const verticalStep = instructions.find((i) => i.type === "vertical");
    expect(verticalStep).toBeDefined();
    expect(verticalStep.text).toMatch(/staircase|stairs/i);
    expect(verticalStep.text).toMatch(/Floor 1.*Floor 3|Floor 3/);

    // Floor 3 exit instruction
    const exitStep = instructions.find((i) => /^Exit on Floor 3/i.test(i.text));
    expect(exitStep).toBeDefined();
    expect(exitStep.text).toMatch(/Special Collections/);

    // Arrival
    const arrival = instructions.find((i) => i.type === "arrival");
    expect(arrival).toBeDefined();
    expect(arrival.text).toMatch(/Special Collections/);
  });

  it("uses landmarks only from the active floor segment", () => {
    const floor1Route = routeResult([
      { lng: -89.2210, lat: 37.71500 },
      { lng: -89.2201, lat: 37.71500 },
    ]);
    const floor7Route = routeResult([
      { lng: -89.2201, lat: 37.71500 },
      { lng: -89.2192, lat: 37.71500 },
    ]);

    const instructions = generateMultiFloorRouteInstructions({
      segments: [
        {
          type: "horizontal",
          floorId: "1",
          route: floor1Route,
          renderCoordinates: floor1Route.renderCoordinates,
          coordinates: floor1Route.coordinates,
          distance: 0,
          waypointCount: 2,
        },
        {
          type: "vertical-transition",
          connectorType: "stairs",
          connectorName: "stair case",
          fromFloor: "1",
          toFloor: "7",
          fromAccessPoint: { lng: -89.2201, lat: 37.71500 },
          toAccessPoint: { lng: -89.2201, lat: 37.71500 },
        },
        {
          type: "horizontal",
          floorId: "7",
          route: floor7Route,
          renderCoordinates: floor7Route.renderCoordinates,
          coordinates: floor7Route.coordinates,
          distance: 0,
          waypointCount: 2,
        },
      ],
      startName: "Lobby",
      destinationName: "Archive",
      options: {
        landmarksByFloor: {
          F1: [
            {
              id: "floor-one-stack",
              label: "Floor One Stack",
              coords: [-89.2196, 37.71502],
            },
          ],
          F7: [
            {
              id: "floor-seven-desk",
              label: "Floor Seven Desk",
              coords: [-89.2196, 37.71502],
            },
          ],
        },
      },
    });

    const vertical = instructions.find((i) => i.type === "vertical");
    const floor7Exit = instructions.find((i) => /^Exit on Floor 7/.test(i.text));

    expect(vertical?.text).toBe("Take the staircase to Floor 7.");
    expect(floor7Exit).toBeDefined();
    expect(floor7Exit.text).toMatch(/Floor Seven Desk/);
    expect(floor7Exit.text).not.toMatch(/Floor One Stack/);
  });

  it("emits 'Proceed to the stairs' for a short final approach to the connector", () => {
    // Short floor-1 segment (<15 m) that ends at the staircase.
    const shortApproachRoute = routeResult([
      { lng: -89.2201, lat: 37.71500 },
      { lng: -89.2201, lat: 37.71508 }, // ~9 m
    ]);
    const floor3Route = routeResult([
      { lng: -89.2201, lat: 37.71508 },
      { lng: -89.2197, lat: 37.71508 },
    ]);

    const segments = [
      {
        type: "horizontal",
        floorId: "1",
        route: shortApproachRoute,
        renderCoordinates: shortApproachRoute.renderCoordinates,
        coordinates: shortApproachRoute.coordinates,
        distance: 0,
        waypointCount: 2,
      },
      {
        type: "vertical-transition",
        connectorType: "elevator",
        connectorId: "lift-1",
        connectorName: "Main Elevator",
        fromFloor: "1",
        toFloor: "3",
        fromAccessPoint: { lng: -89.2201, lat: 37.71508 },
        toAccessPoint: { lng: -89.2201, lat: 37.71508 },
        instruction: "",
      },
      {
        type: "horizontal",
        floorId: "3",
        route: floor3Route,
        renderCoordinates: floor3Route.renderCoordinates,
        coordinates: floor3Route.coordinates,
        distance: 0,
        waypointCount: 2,
      },
    ];

    const instructions = generateMultiFloorRouteInstructions({
      segments,
      startName: "Lobby",
      destinationName: "Archive",
    });

    // Short approach (<15 m) to elevator → "Proceed to the elevator."
    const approachStep = instructions.find(
      (i) => i.type === "straight" && /elevator/i.test(i.text),
    );
    // Either a straight "Proceed to the elevator." or folded into start (very short route)
    if (approachStep) {
      expect(approachStep.text).toMatch(/Proceed to the elevator\./i);
    }

    // Vertical step names the elevator
    const verticalStep = instructions.find((i) => i.type === "vertical");
    expect(verticalStep).toBeDefined();
    expect(verticalStep.connectorType).toBe("elevator");
    expect(verticalStep.text).toMatch(/elevator/i);

    // Exit on floor 3
    const exitStep = instructions.find((i) => /^Exit on Floor 3/i.test(i.text));
    expect(exitStep).toBeDefined();
  });
});
