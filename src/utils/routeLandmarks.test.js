import { describe, expect, it } from "vitest";
import { findRouteLandmarks } from "./routeLandmarks";

const makeRoom = (name, floor, ring) => ({
  type: "Feature",
  geometry: {
    type: "Polygon",
    coordinates: [ring],
  },
  properties: {
    name,
    level: floor,
  },
});

describe("routeLandmarks", () => {
  it("finds nearby rooms and assigns side from route travel direction", () => {
    const routeResult = {
      renderCoordinates: [
        { lng: -89.2203, lat: 37.715 },
        { lng: -89.2201, lat: 37.715 },
      ],
    };
    const nearbyNorthRoom = makeRoom("Browsing Room", 1, [
      [-89.22022, 37.715015],
      [-89.22018, 37.715015],
      [-89.22018, 37.715035],
      [-89.22022, 37.715035],
      [-89.22022, 37.715015],
    ]);
    const farRoom = makeRoom("Far Room", 1, [
      [-89.22022, 37.71509],
      [-89.22018, 37.71509],
      [-89.22018, 37.71511],
      [-89.22022, 37.71511],
      [-89.22022, 37.71509],
    ]);

    const landmarks = findRouteLandmarks({
      routeResult,
      rooms: [nearbyNorthRoom, farRoom],
      floorId: 1,
      options: {
        distanceThresholdMeters: 4.5,
      },
    });

    expect(landmarks).toHaveLength(1);
    expect(landmarks[0]).toMatchObject({
      name: "Browsing Room",
      side: "left",
      segmentIndex: 0,
    });
  });

  it("excludes start and destination rooms from normal landmark detection", () => {
    const routeResult = {
      renderCoordinates: [
        { lng: -89.2203, lat: 37.715 },
        { lng: -89.2201, lat: 37.715 },
      ],
    };
    const startRoom = makeRoom("Start Room", 1, [
      [-89.22031, 37.715],
      [-89.22029, 37.715],
      [-89.22029, 37.71502],
      [-89.22031, 37.71502],
      [-89.22031, 37.715],
    ]);

    const landmarks = findRouteLandmarks({
      routeResult,
      rooms: [startRoom],
      floorId: 1,
      startRoom,
    });

    expect(landmarks).toEqual([]);
  });

  it("returns both sides of a corridor when rooms flank the route on left and right", () => {
    // Route heading east.  North room → left side.  South room → right side.
    // Both rooms are at the same along-route position, so the old spacing
    // filter would have blocked the second one.
    const routeResult = {
      renderCoordinates: [
        { lng: -89.2206, lat: 37.71500 },
        { lng: -89.2200, lat: 37.71500 },
      ],
    };
    // North room (should be left when walking east)
    const northRoom = makeRoom("Journals A–D", 1, [
      [-89.2204, 37.71502],
      [-89.2202, 37.71502],
      [-89.2202, 37.71508],
      [-89.2204, 37.71508],
      [-89.2204, 37.71502],
    ]);
    // South room (should be right when walking east)
    const southRoom = makeRoom("Journals E–H", 1, [
      [-89.2204, 37.71498],
      [-89.2202, 37.71498],
      [-89.2202, 37.71492],
      [-89.2204, 37.71492],
      [-89.2204, 37.71498],
    ]);

    const landmarks = findRouteLandmarks({
      routeResult,
      rooms: [northRoom, southRoom],
      floorId: 1,
      options: { distanceThresholdMeters: 4.5, centroidDistanceThresholdMeters: 12 },
    });

    expect(landmarks).toHaveLength(2);
    const sides = landmarks.map((l) => l.side).sort();
    expect(sides).toEqual(["left", "right"]);
    const names = landmarks.map((l) => l.name).sort();
    expect(names).toContain("Journals A–D");
    expect(names).toContain("Journals E–H");
  });

  it("returns only one landmark when a single room is near the route on one side", () => {
    const routeResult = {
      renderCoordinates: [
        { lng: -89.2206, lat: 37.71500 },
        { lng: -89.2200, lat: 37.71500 },
      ],
    };
    // Only a north (left-side) room
    const leftRoom = makeRoom("Reference Section", 1, [
      [-89.2204, 37.71502],
      [-89.2202, 37.71502],
      [-89.2202, 37.71507],
      [-89.2204, 37.71507],
      [-89.2204, 37.71502],
    ]);

    const landmarks = findRouteLandmarks({
      routeResult,
      rooms: [leftRoom],
      floorId: 1,
      options: { distanceThresholdMeters: 4.5 },
    });

    expect(landmarks).toHaveLength(1);
    expect(landmarks[0].name).toBe("Reference Section");
    expect(landmarks[0].side).toBe("left");
  });

  it("uses a polygon interior anchor for labels instead of the route access point", () => {
    const routeResult = {
      renderCoordinates: [
        { lng: -89.2206, lat: 37.71500 },
        { lng: -89.2200, lat: 37.71500 },
      ],
    };
    const room = makeRoom("Route Adjacent Room", 1, [
      [-89.2204, 37.71502],
      [-89.2202, 37.71502],
      [-89.2202, 37.71508],
      [-89.2204, 37.71508],
      [-89.2204, 37.71502],
    ]);

    const [landmark] = findRouteLandmarks({
      routeResult,
      rooms: [room],
      floorId: 1,
      options: { distanceThresholdMeters: 4.5, centroidDistanceThresholdMeters: 12 },
    });

    expect(landmark).toBeDefined();
    expect(landmark.coords[1]).toBeCloseTo(37.71500, 5);
    expect(landmark.labelCoords[1]).toBeGreaterThan(37.71502);
    expect(landmark.labelCoords).not.toEqual(landmark.coords);
  });

  it("excludes generic structure and stairs area features from landmarks", () => {
    const routeResult = {
      renderCoordinates: [
        { lng: -89.2203, lat: 37.715 },
        { lng: -89.2201, lat: 37.715 },
      ],
    };
    const rooms = [
      makeRoom("structure", 1, [
        [-89.22029, 37.71501],
        [-89.22027, 37.71501],
        [-89.22027, 37.71503],
        [-89.22029, 37.71503],
        [-89.22029, 37.71501],
      ]),
      makeRoom("stairs area", 1, [
        [-89.22024, 37.71501],
        [-89.22022, 37.71501],
        [-89.22022, 37.71503],
        [-89.22024, 37.71503],
        [-89.22024, 37.71501],
      ]),
      makeRoom("Music Scores", 1, [
        [-89.22019, 37.71501],
        [-89.22017, 37.71501],
        [-89.22017, 37.71503],
        [-89.22019, 37.71503],
        [-89.22019, 37.71501],
      ]),
    ];

    const landmarks = findRouteLandmarks({
      routeResult,
      rooms,
      floorId: 1,
      options: {
        maxLandmarksPerSegment: 3,
        minAlongRouteSpacingMeters: 0,
      },
    });

    expect(landmarks.map((landmark) => landmark.name)).toEqual(["Music Scores"]);
  });
});
