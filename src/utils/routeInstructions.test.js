import { describe, expect, it } from "vitest";
import {
  classifyTurn,
  computeTurnAngle,
  generateMultiFloorRouteInstructions,
  generateRouteInstructions,
  generateVerticalInstruction,
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

describe("routeInstructions", () => {
  it("classifies dynamic turn angles from route geometry", () => {
    expect(classifyTurn(10)).toBe("straight");
    expect(classifyTurn(40)).toBe("slight-right");
    expect(classifyTurn(-90)).toBe("left");
    expect(classifyTurn(150)).toBe("sharp-right");
    expect(classifyTurn(178)).toBe("u-turn");
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
      text: "Take the elevator from Floor 1 to Floor 7.",
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
      text: "Take the stairs from Floor 1 to Floor 7.",
    });
  });
});
