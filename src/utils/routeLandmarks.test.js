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
});
