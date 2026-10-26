import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WebMercatorViewport } from "@deck.gl/core";
import { buildFilteredIndoorFeatureCollection, computeElevation } from "../components/IndoorBuilding";
import { createPerimeterWallMeshLayers } from "../layers/perimeterWallLayer";
import { clampMapZoom, fitBuildingCamera, getBuildingFitPoints, getWallFitPoints, projectFitBounds } from "./buildingCamera";

const read = name => JSON.parse(readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8"));
const source = read("rooms-all-WGS-v6.geojson");
const shell = getWallFitPoints(createPerimeterWallMeshLayers({ wallData: read("wall.geojson") }));
const pointsFor = (data, floors) => getBuildingFitPoints(
  buildFilteredIndoorFeatureCollection(data, floors, 4.5).features,
  feature => computeElevation(feature, 4.5, 1),
);

describe("building camera", () => {
  const allPoints = [...pointsFor(source, [0, 1, 2, 3, 4, 5, 6, 7]), ...shell];
  const f1Points = pointsFor(read("rooms-level-01-WGS.geojson"), [1]);
  for (const [name, points] of [["F1", f1Points], ["F-ALL including shell", allPoints]]) {
    for (const [width, height] of [[1000, 840], [364, 720], [740, 260], [1360, 840]]) {
      it(`fits ${name} in ${width}×${height} at the existing 3D orientation`, () => {
        const insets = { left: 12, right: 78, top: 12, bottom: 12 };
        const camera = fitBuildingCamera({ points, width, height, insets });
        expect(camera).not.toBeNull();
        expect(camera.pitch).toBe(45);
        expect(camera.bearing).toBe(0);
        const bounds = projectFitBounds(new WebMercatorViewport({ ...camera, width, height }), points);
        expect(bounds.left).toBeGreaterThanOrEqual(insets.left);
        expect(bounds.right).toBeLessThanOrEqual(width - insets.right);
        expect(bounds.top).toBeGreaterThanOrEqual(insets.top);
        expect(bounds.bottom).toBeLessThanOrEqual(height - insets.bottom);
        const occupancy = Math.max((bounds.right - bounds.left) / (width - insets.left - insets.right),
          (bounds.bottom - bounds.top) / (height - insets.top - insets.bottom));
        expect(occupancy).toBeGreaterThan(0.8);
        expect(occupancy).toBeLessThanOrEqual(0.86);
      });
    }
  }

  it("accounts for stacked height instead of fitting only a flat footprint", () => {
    const size = { width: 740, height: 420 };
    const stacked = fitBuildingCamera({ ...size, points: allPoints });
    const flat = fitBuildingCamera({ ...size, points: allPoints.map(([x, y]) => [x, y, 0]) });
    expect(stacked.zoom).toBeLessThan(flat.zoom);
    expect(Math.max(...shell.map(point => point[2]))).toBe(70);
  });

  it("preserves source coordinates and the existing F-ALL elevation convention", () => {
    const before = JSON.stringify(source);
    const f7 = pointsFor(source, [6, 7]);
    expect(f7.some(point => point[2] === 62)).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("supports a north-up 2D route panel without changing its orientation", () => {
    const camera = fitBuildingCamera({ points: f1Points, width: 600, height: 400,
      orientation: { pitch: 0, bearing: 0 } });
    expect(camera.pitch).toBe(0);
    expect(camera.bearing).toBe(0);
  });

  it("waits for usable dimensions and geometry", () => {
    expect(fitBuildingCamera({ points: f1Points, width: 0, height: 600 })).toBeNull();
    expect(fitBuildingCamera({ points: [], width: 1000, height: 600 })).toBeNull();
  });

  it("uses one bounded zoom range for buttons, slider and keyboard", () => {
    expect(clampMapZoom(-10)).toBe(14);
    expect(clampMapZoom(30)).toBe(22);
    expect(clampMapZoom(18.376)).toBe(18.376);
  });

  for (const [width, height] of [[1000, 840], [364, 716]]) {
    it(`centers an edge room while retaining the entire floor in ${width}x${height}`, () => {
      const floor = buildFilteredIndoorFeatureCollection(read("rooms-level-7-WGS.geojson"), [7], 4.5);
      const room = floor.features.find(feature => feature.properties.name === "Classroom 0754");
      const elevation = feature => computeElevation(feature, 4.5, 1);
      const points = getBuildingFitPoints([room], elevation);
      const contextPoints = getBuildingFitPoints(floor.features, elevation);
      const insets = { left: 20, right: 86, top: 24, bottom: width < 600 ? 210 : 24 };
      const orientation = { pitch: 45, bearing: 25 };
      const camera = fitBuildingCamera({ points, contextPoints, width, height, insets, orientation, maxZoom: 21 });
      expect(camera).not.toBeNull();
      const viewport = new WebMercatorViewport({ ...camera, width, height });
      const context = projectFitBounds(viewport, contextPoints);
      expect(context.left).toBeGreaterThanOrEqual(insets.left);
      expect(context.right).toBeLessThanOrEqual(width - insets.right);
      expect(context.top).toBeGreaterThanOrEqual(insets.top);
      expect(context.bottom).toBeLessThanOrEqual(height - insets.bottom);
      const selected = projectFitBounds(viewport, points);
      expect((selected.left + selected.right) / 2).toBeCloseTo((insets.left + width - insets.right) / 2, 0);
      expect((selected.top + selected.bottom) / 2).toBeCloseTo((insets.top + height - insets.bottom) / 2, 0);
      expect(camera.pitch).toBe(45);
      expect(camera.bearing).toBe(25);
    });
  }
});
