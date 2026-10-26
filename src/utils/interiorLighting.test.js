import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRoomLightSampler, getLightFloorPlacement, lightFloor, nightEnvelopeLayers, nightRoomColor, normalizeLightAnchors, positionLight, selectVisibleLights, smoothLightFalloff } from "./interiorLighting";
import { createInteriorLightLayers } from "../layers/interiorLightLayer";
import { NIGHT_LIGHTING_DEFAULTS } from "./nightLightingConfig";

const feature = (overrides = {}) => ({ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {
  light_id: "a", floor_id: "F2", enabled: 1, intensity: 1, radius_m: 10, color: "#FFD08A", base_height: 4.3, height: 4.4, ...overrides,
} });
const anchors = (...features) => normalizeLightAnchors({ features });
const room = (meters, floor = 2) => ({ properties: { level: floor }, geometry: { type: "Polygon", coordinates: [[
  [meters / 111320, -0.5 / 111320], [(meters + 1) / 111320, -0.5 / 111320],
  [(meters + 1) / 111320, 0.5 / 111320], [meters / 111320, 0.5 / 111320], [meters / 111320, -0.5 / 111320],
]] } });

describe("interior lighting", () => {
  it("has smooth, bounded falloff with an exact cutoff", () => {
    expect(smoothLightFalloff(0, 10)).toBe(1);
    expect(smoothLightFalloff(5, 10)).toBe(0.5);
    expect(smoothLightFalloff(10, 10)).toBe(0);
    expect(smoothLightFalloff(15, 10)).toBe(0);
    expect(smoothLightFalloff(0, 0)).toBe(0);
  });
  it("normalizes floors and excludes disabled or malformed anchors", () => {
    expect(lightFloor("F7")).toBe(7);
    expect(lightFloor(-1)).toBe(0);
    expect(lightFloor(null)).toBe(null);
    expect(anchors(feature(), feature({ enabled: 0 }), feature({ enabled: "false" }), feature({ radius_m: 0 }),
      feature({ intensity: -1 }), feature({ floor_id: "bad" }), { ...feature(), geometry: { type: "Point", coordinates: [] } })).toHaveLength(1);
  });
  it("localizes room influence, isolates floors, and reuses cached geometry results", () => {
    const sample = createRoomLightSampler(anchors(feature()));
    const near = room(1), medium = room(5), far = room(11);
    expect(sample(near).strength).toBeGreaterThan(sample(medium).strength);
    expect(sample(medium).strength).toBeGreaterThan(0);
    expect(sample(far).strength).toBe(0);
    expect(sample(room(1, 3)).strength).toBe(0);
    expect(sample(near)).toBe(sample({ ...near }));
  });
  it("does not treat a courtyard hole as a light inside the room", () => {
    const polygon = { properties: { level: 2 }, geometry: { type: "Polygon", coordinates: [
      [[-20,-20],[20,-20],[20,20],[-20,20],[-20,-20]],
      [[-12,-12],[12,-12],[12,12],[-12,12],[-12,-12]],
    ].map((ring) => ring.map((point) => point.map((n) => n / 111320))) } };
    expect(createRoomLightSampler(anchors(feature()))(polygon).strength).toBe(0);
  });
  it("keeps source hues while making nearby rooms brighter", () => {
    const base = [30, 90, 200];
    const dim = nightRoomColor(base, { strength: 0 });
    const lit = nightRoomColor(base, { strength: 0.8, color: [255, 208, 138] });
    expect(lit[2]).toBeGreaterThan(lit[1]);
    expect(lit[1]).toBeGreaterThan(lit[0]);
    expect(lit.every((c, i) => c > dim[i])).toBe(true);
    expect(base).toEqual([30, 90, 200]);
  });
  it("caps sprites while retaining every visible floor and filters F7 without inventing lights", () => {
    const records = Array.from({ length: 400 }, (_, i) => ({ floor: i % 8, intensity: 1 }));
    const visible = selectVisibleLights(records, [0,1,2,3,4,5,6,7]);
    expect(visible).toHaveLength(256);
    expect(new Set(visible.map((d) => d.floor)).size).toBe(8);
    expect(selectVisibleLights(records, [7]).every((d) => d.floor === 7)).toBe(true);
    expect(selectVisibleLights(anchors(feature()), [7])).toEqual([]);
  });
  it("places fixtures with the same single-floor and stacked height convention as rooms", () => {
    const light = anchors(feature())[0];
    expect(positionLight(light, [2], 4.5)[2]).toBeCloseTo(4.35);
    expect(positionLight(light, [1, 2], 4.5)[2]).toBeCloseTo(13.35);
    expect(positionLight(light, [2], 4.5, 2)[2]).toBeCloseTo(2.35);
  });
  it("uses three instanced layers, with no light layers in daytime or during the reveal", () => {
    const lights = anchors(feature());
    const layers = createInteriorLightLayers({ lights, floors: [2], floorSpacing: 4.5 });
    expect(layers).toHaveLength(3);
    expect(layers.every((layer) => !layer.props.pickable && layer.props.parameters.depthMask === false)).toBe(true);
    expect(createInteriorLightLayers({ lights: [], floors: [2] })).toEqual([]);
    expect(createInteriorLightLayers({ lights, floors: [2], reveal: 0.5 })).toEqual([]);
  });
  it("aligns local light heights with absolute bases in the stacked room export", () => {
    const data = JSON.parse(readFileSync(new URL("../../public/rooms-all-WGS-v6.geojson", import.meta.url), "utf8"));
    const floors = [0,1,2,3,4,5,6,7];
    const placement = getLightFloorPlacement(data, floors);
    expect(placement.floorBases[2]).toBe(9);
    expect(placement.floorBases[3]).toBe(13.5);
    const light = anchors(feature())[0];
    expect(positionLight(light, floors, 4.5, placement.floorBase, 1, placement.floorBases)[2]).toBeCloseTo(22.35);
  });
  it("preserves daytime envelope objects and changes only appearance at night", () => {
    const original = [{ props: { parameters: { cull: false, depthMask: true } }, clone(props) { return { ...this.props, ...props }; } }];
    expect(nightEnvelopeLayers(original, false)[0].getColor({})).toEqual([255,255,255,255]);
    const [night] = nightEnvelopeLayers(original, true);
    expect(night.getColor({ revealProgress: 1 })).toEqual([...NIGHT_LIGHTING_DEFAULTS.envelopeColor, 255 * NIGHT_LIGHTING_DEFAULTS.nightEnvelopeOpacity]);
    expect(night.parameters.depthMask).toBe(true); // baseline; extension sets the effective night draw state
    expect(night.environmentDepthProgress).toBe(1);
    expect(night.environmentNightBlendFunc).toEqual([770, 771, 1, 771]);
    expect(original[0].props.parameters.depthMask).toBe(true);
  });
  it("loads all supplied F0–F6 lights from the combined asset", () => {
    const data = JSON.parse(readFileSync(new URL("../../public/interior_lights.geojson", import.meta.url), "utf8"));
    const records = normalizeLightAnchors(data);
    expect(records).toHaveLength(138);
    expect(new Set(records.map((d) => d.id)).size).toBe(138);
    expect([...new Set(records.map((d) => d.floor))].sort()).toEqual([0,1,2,3,4,5,6]);
    for (let floor = 0; floor <= 6; floor++) expect(selectVisibleLights(records, [floor]).length).toBeGreaterThan(0);
  });
  it("produces varied illumination on each real floor and the complete stack", () => {
    const load = (file) => JSON.parse(readFileSync(new URL(`../../public/${file}`, import.meta.url), "utf8"));
    const sample = createRoomLightSampler(normalizeLightAnchors(load("interior_lights.geojson")));
    const sources = ["rooms-basement-WGS.geojson", "rooms-level-01-WGS.geojson", "rooms-level-02-WGS.geojson",
      "rooms-level-03-WGS.geojson", "rooms-level-04-WGS.geojson", "rooms-level-5-WGS.geojson", "rooms-level-6-WGS.geojson", "rooms-all-WGS-v6.geojson"];
    for (const source of sources) {
      const strengths = load(source).features.filter((f) => /Polygon/.test(f.geometry?.type)).map((f) => sample(f).strength);
      expect(Math.max(...strengths), source).toBeGreaterThan(0.4);
      expect(Math.max(...strengths) - Math.min(...strengths), source).toBeGreaterThan(0.3);
    }
  });
});
