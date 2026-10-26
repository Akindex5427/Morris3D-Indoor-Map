import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRoomLightSampler, getLightFloorPlacement, normalizeLightAnchors, positionLight, selectVisibleLights, nightEnvelopeLayers } from "./interiorLighting";
import { buildSurfaceLightField, shadeNightSurface } from "./surfaceLighting";
import { lightPalette, NIGHT_LIGHTING_DEFAULTS, srgbToLinear, linearToSrgb } from "./nightLightingConfig";
import { createInteriorLightLayers } from "../layers/interiorLightLayer";

const load = file => JSON.parse(readFileSync(new URL(`../../public/${file}`, import.meta.url), "utf8"));
const lightData = load("interior_lights.geojson");
const anchors = normalizeLightAnchors(lightData);
const source = { position: [0, 0, 4.3], radius: 10, intensity: 0.85, color: [255, 208, 138], contained: true };
const room = (x, floor = 1) => ({ type: "Feature", properties: { level: floor }, geometry: {
  type: "Polygon", coordinates: [[[x, -2], [x + 4, -2], [x + 4, 2], [x, 2], [x, -2]].map(p => p.map(n => n / 111320))],
} });

describe("night surface illumination", () => {
  it("decodes and encodes sRGB once, including near-black values", () => {
    for (const c of [0, 1, 10, 50, 138, 208, 255]) expect(linearToSrgb(srgbToLinear(c))).toBeCloseTo(c, 8);
  });
  it("keeps source hues and removes the former white core mix and additive blend", () => {
    const palette = lightPalette([255, 208, 138]);
    expect(palette.primary).toEqual([255, 208, 138]);
    expect(palette.highlight[2]).toBeLessThan(150);
    const red = lightPalette([255, 20, 20]);
    expect(red.halo[1]).toBe(red.halo[2]);
    expect(red.halo[0]).toBeGreaterThan(red.halo[1]);
    const layers = createInteriorLightLayers({ lights: anchors, floors: [0, 1, 2, 3, 4, 5, 6], floorSpacing: 4.5 });
    expect(layers.every(l => l.props.parameters.blendFunc[1] === 771)).toBe(true);
    expect(layers[2].props.radiusMaxPixels).toBeLessThan(2);
  });
  it("produces smooth gradients within a single surface, with vertical attenuation", () => {
    const base = [160, 160, 160];
    const near = shadeNightSurface(base, [source], [0, 0, 4.3]);
    const below = shadeNightSurface(base, [source], [0, 0, 0]);
    const far = shadeNightSurface(base, [source], [9, 0, 4.3]);
    const outside = shadeNightSurface(base, [source], [11, 0, 4.3]);
    expect(near[0]).toBeGreaterThan(below[0]);
    expect(below[0]).toBeGreaterThan(far[0]);
    expect(far[0]).toBeGreaterThan(outside[0]);
    expect(outside).toEqual(shadeNightSurface(base, [], [0, 0, 0]));
    const a = shadeNightSurface(base, [source], [9.99, 0, 4.3]);
    expect(a[0] - outside[0]).toBeLessThan(0.01);
  });
  it("compresses overlapping highlights without clipping all channels to white", () => {
    const result = shadeNightSurface([220, 220, 220], Array(32).fill(source), [0, 0, 4.3]);
    expect(result.every(c => c >= 0 && c < 255)).toBe(true);
    expect(result[0]).toBeGreaterThan(result[1]);
    expect(result[1] - result[2]).toBeGreaterThan(30);
    const blue = shadeNightSurface([20, 60, 220], [source], [0, 0, 4.3]);
    const red = shadeNightSurface([220, 60, 20], [source], [0, 0, 4.3]);
    expect(blue[2]).toBeGreaterThan(red[2]);
  });
  it("attenuates light crossing a room boundary and never shares sources across floors", () => {
    const record = { ...anchors[0], floor: 1, xy: [0, 0], radius: 10 };
    const features = [room(-2), room(2), room(-2, 2)];
    const sampler = createRoomLightSampler([record]);
    const data = { features };
    const field = buildSurfaceLightField(data, sampler, () => false);
    expect(field.pixels[3]).toBe(10);
    expect(field.pixels[field.width * 4 + 3]).toBe(-10);
    expect(field.rows.get(features[2]).count).toBe(0);
    expect(buildSurfaceLightField(data, sampler, () => false)).toBe(field);
    const lit = shadeNightSurface([120, 120, 120], [source], [0, 0, 4.3]);
    const spill = shadeNightSurface([120, 120, 120], [{ ...source, contained: false }], [0, 0, 4.3]);
    expect(spill[0]).toBeLessThan(lit[0] * 0.8);
  });
  it("uses explicit z_height while retaining legacy base/height fallback", () => {
    expect(positionLight(anchors[0], [0], 4.5)[2]).toBeCloseTo(4.3);
    const input = structuredClone(lightData.features[0]);
    input.properties.z_height = 2.1;
    expect(positionLight(normalizeLightAnchors({ features: [input] })[0], [0], 4.5)[2]).toBeCloseTo(2.1);
    delete input.properties.z_height;
    expect(positionLight(normalizeLightAnchors({ features: [input] })[0], [0], 4.5)[2]).toBeCloseTo(4.35);
  });
  it("covers F0-F7 and F-ALL without truncating real source lists or altering GIS data", () => {
    const sampler = createRoomLightSampler(anchors);
    const files = ["rooms-basement-WGS.geojson", "rooms-level-01-WGS.geojson", "rooms-level-02-WGS.geojson",
      "rooms-level-03-WGS.geojson", "rooms-level-04-WGS.geojson", "rooms-level-5-WGS.geojson",
      "rooms-level-6-WGS.geojson", "rooms-level-7-WGS.geojson", "rooms-all-WGS-v6.geojson"];
    files.forEach((file, floor) => {
      const data = load(file), before = JSON.stringify(data);
      const field = buildSurfaceLightField(data, sampler, () => false);
      expect(field.truncated, file).toBe(0);
      expect(JSON.stringify(data), file).toBe(before);
      expect(field.contributions, file)[floor === 7 ? "toBe" : "toBeGreaterThan"](0);
      const floors = floor === 8 ? [0, 1, 2, 3, 4, 5, 6, 7] : [floor];
      const { floorBase, floorBases } = getLightFloorPlacement(data, floors);
      for (const light of selectVisibleLights(anchors, floors)) {
        const expected = (floors.length > 1 ? light.floor * 4.5 : -floorBase) + (floorBases[light.floor] || 0) + 4.3;
        expect(positionLight(light, floors, 4.5, floorBase, 1, floorBases)[2]).toBeCloseTo(expected);
      }
    });
    expect(anchors).toHaveLength(138);
  });
  it("uses a more transparent stack envelope with continuous colors and stable IDs", () => {
    const original = [{ id: 'shell', props: { parameters: {}, getColor: [160,170,180,200] }, clone(props) { return { id: this.id, ...this.props, ...props }; } }];
    expect(nightEnvelopeLayers(original, false)[0].getColor({})).toEqual([160,170,180,200]);
    const middle = nightEnvelopeLayers(original, .5)[0];
    expect(middle.id).toBe("shell");
    expect(middle.getColor({})[0]).toBe((160 + NIGHT_LIGHTING_DEFAULTS.envelopeColor[0]) / 2);
    const single = nightEnvelopeLayers(original, true)[0].getColor({})[3];
    const stacked = nightEnvelopeLayers(original, true, NIGHT_LIGHTING_DEFAULTS, 8)[0].getColor({})[3];
    expect(stacked).toBeLessThan(single);
    expect(single).toBeLessThan(89);
  });
});
