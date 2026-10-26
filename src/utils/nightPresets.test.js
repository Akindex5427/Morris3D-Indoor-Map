import { describe, expect, it } from "vitest";
import { NIGHT_PRESETS, NIGHT_LIGHTING_DEFAULTS, DEFAULT_NIGHT_PRESET, interpolateNightTuning } from "./nightLightingConfig";
import { shadeNightSurface } from "./surfaceLighting";
import { createInteriorLightLayers } from "../layers/interiorLightLayer";

describe("shared Night Mode presets", () => {
  it("defaults to the established architectural treatment and keeps GIS surfaces identifiable without nearby fixtures", () => {
    expect(NIGHT_PRESETS[DEFAULT_NIGHT_PRESET]).toBe(NIGHT_LIGHTING_DEFAULTS);
    const colors = [[20, 180, 40], [170, 30, 190], [190, 160, 30]];
    for (const base of colors) {
      const architectural = shadeNightSurface(base, [], [0, 0, 0], NIGHT_PRESETS.architectural);
      const gis = shadeNightSurface(base, [], [0, 0, 0], NIGHT_PRESETS.gis);
      const brightest = base.indexOf(Math.max(...base));
      expect(gis[brightest]).toBeGreaterThan(architectural[brightest] * 1.5);
      expect(gis.indexOf(Math.max(...gis))).toBe(brightest);
    }
  });

  it("keeps transitions bounded, preserves shared palette arrays, and can reverse from an intermediate state", () => {
    const { architectural: a, gis: b } = NIGHT_PRESETS;
    const frames = Array.from({ length: 56 }, (_, i) => interpolateNightTuning(a, b, i / 55));
    expect(frames[0]).toBe(a);
    expect(frames.at(-1)).toBe(b);
    for (const frame of frames) {
      expect(frame.floorColor).toBe(a.floorColor);
      for (const key of Object.keys(a).filter(k => typeof a[k] === "number")) {
        expect(frame[key]).toBeGreaterThanOrEqual(Math.min(a[key], b[key]));
        expect(frame[key]).toBeLessThanOrEqual(Math.max(a[key], b[key]));
      }
    }
    const middle = frames[25];
    expect(interpolateNightTuning(middle, a, 0)).toBe(middle);
    expect(interpolateNightTuning(middle, a, 1)).toBe(a);
  });

  it("uses identical source objects, elevation and layer IDs for both presets on every floor and F-ALL", () => {
    for (let floor = 0; floor <= 7; floor++) {
      const light = Object.freeze({ floor, xy: [-89.22, 37.715], color: [255, 208, 138], z: 4.3,
        base: 4.3, top: 4.4, intensity: 0.85, radius: 10 });
      const lights = Object.freeze([light]);
      for (const floors of [[floor], [0, 1, 2, 3, 4, 5, 6, 7]]) {
        const make = tuning => createInteriorLightLayers({ lights, floors, floorSpacing: 4.5, tuning });
        const a = make(NIGHT_PRESETS.architectural), b = make(NIGHT_PRESETS.gis);
        expect(b.map(l => l.id)).toEqual(a.map(l => l.id));
        expect(b[0].props.data).toBe(lights);
        expect(b[0].props.getPosition(light)).toEqual(a[0].props.getPosition(light));
        expect(b[0].props.getPosition(light)[2]).toBeCloseTo(4.3 + (floors.length > 1 ? floor * 4.5 : 0));
        expect(b[1].props.getFillColor(light)[3]).toBeLessThan(a[1].props.getFillColor(light)[3]);
      }
    }
  });
});
