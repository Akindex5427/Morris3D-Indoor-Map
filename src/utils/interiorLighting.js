import { parseFeatureColor } from "./featureColors";
import { NIGHT_LIGHTING_DEFAULTS } from "./nightLightingConfig";
import { ENVIRONMENT_DEPTH_EXTENSIONS } from "../layers/environmentDepthExtension";

export const MAX_VISIBLE_LIGHTS = 256;
export const EMPTY_LIGHTS = Object.freeze([]);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function lightFloor(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/^F/i, ""));
  return Number.isFinite(n) ? (n === -1 ? 0 : n) : null;
}

export function smoothLightFalloff(distance, radius) {
  if (!(radius > 0) || distance >= radius) return 0;
  const t = clamp(distance / radius, 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

// Runtime records only: never mutate the source GeoJSON or room properties.
export function normalizeLightAnchors(data) {
  return (data?.features || []).flatMap((feature, index) => {
    const p = feature.properties || {};
    const xy = feature.geometry?.coordinates;
    const floor = lightFloor(p.floor_id);
    const enabled = p.enabled === true || p.enabled === 1 ||
      p.enabled === "1" || p.enabled === "true";
    if (!enabled || feature.geometry?.type !== "Point" || floor === null ||
        !Array.isArray(xy) || xy.length < 2 || !xy.slice(0, 2).every(Number.isFinite) ||
        Math.abs(xy[0]) > 180 || Math.abs(xy[1]) > 90 ||
        !(Number(p.radius_m) > 0) || !(Number(p.intensity) > 0)) return [];
    const base = Number(p.base_height);
    const top = Number(p.height);
    const bottom = Number.isFinite(base) ? base : 0;
    return [{
      id: String(p.light_id ?? feature.id ?? index), floor,
      xy: xy.slice(0, 2), radius: clamp(Number(p.radius_m), 0.1, 100),
      intensity: clamp(Number(p.intensity), 0, 4),
      color: parseFeatureColor(p.color || "#FFD08A"),
      type: p.light_type || "interior-light",
      z: p.z_height !== null && p.z_height !== undefined && p.z_height !== "" && Number.isFinite(Number(p.z_height))
        ? Number(p.z_height) : null,
      base: bottom, top: Number.isFinite(top) ? Math.max(bottom, top) : bottom,
    }];
  });
}

export function selectVisibleLights(anchors, floors, limit = MAX_VISIBLE_LIGHTS) {
  const visible = new Set(floors.map(lightFloor));
  const buckets = new Map();
  for (const anchor of anchors) {
    if (!visible.has(anchor.floor)) continue;
    if (!buckets.has(anchor.floor)) buckets.set(anchor.floor, []);
    buckets.get(anchor.floor).push(anchor);
  }
  // Round-robin preserves coverage across the stack when the sprite budget is reached.
  for (const bucket of buckets.values()) bucket.sort((a, b) => b.intensity - a.intensity);
  const result = [];
  for (let i = 0; result.length < limit; i++) {
    let added = false;
    for (const bucket of buckets.values()) {
      if (bucket[i] && result.length < limit) { result.push(bucket[i]); added = true; }
    }
    if (!added) break;
  }
  return result;
}

const polygonRings = (geometry) => geometry?.type === "Polygon"
  ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];

function insideRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// One spatial index and a weak geometry cache per loaded anchor collection.
// Queries are horizontal distances on the same floor: ceiling elevation does not
// incorrectly extinguish a light's influence on the room directly underneath it.
export function createRoomLightSampler(anchors) {
  const origin = anchors[0]?.xy || [0, 0];
  const scaleX = 111320 * Math.cos(origin[1] * Math.PI / 180);
  const project = (p) => [(p[0] - origin[0]) * scaleX, (p[1] - origin[1]) * 111320];
  const cellSize = 12;
  const grids = new Map();
  const cache = new WeakMap();
  for (const anchor of anchors) {
    if (!grids.has(anchor.floor)) grids.set(anchor.floor, new Map());
    const grid = grids.get(anchor.floor), point = project(anchor.xy);
    const record = { ...anchor, point };
    for (let x = Math.floor((point[0] - anchor.radius) / cellSize); x <= Math.floor((point[0] + anchor.radius) / cellSize); x++) {
      for (let y = Math.floor((point[1] - anchor.radius) / cellSize); y <= Math.floor((point[1] + anchor.radius) / cellSize); y++) {
        const key = `${x},${y}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(record);
      }
    }
  }
  const sample = (feature) => {
    const geometry = feature.geometry;
    const p = feature.properties || {};
    const floor = lightFloor(p.level ?? p.floor ?? p.nivel);
    if (!geometry) return { strength: 0, color: [255, 208, 138], lights: [] };
    const prior = cache.get(geometry)?.get(floor);
    if (prior) return prior;
    const polygons = polygonRings(geometry).map((rings) => rings.map((ring) => ring.map(project)));
    const points = polygons.flatMap((rings) => rings[0].slice(0, -1));
    let total = 0, rgb = [0, 0, 0];
    const lights = [];
    if (points.length && grids.has(floor)) {
      const minX = Math.min(...points.map((p) => p[0])), maxX = Math.max(...points.map((p) => p[0]));
      const minY = Math.min(...points.map((p) => p[1])), maxY = Math.max(...points.map((p) => p[1]));
      const center = [(minX + maxX) / 2, (minY + maxY) / 2];
      const nearby = new Set(), grid = grids.get(floor);
      for (let x = Math.floor(minX / cellSize); x <= Math.floor(maxX / cellSize); x++) {
        for (let y = Math.floor(minY / cellSize); y <= Math.floor(maxY / cellSize); y++) {
          for (const light of grid.get(`${x},${y}`) || []) nearby.add(light);
        }
      }
      for (const light of nearby) {
        let distance = Infinity, contained = false;
        for (const rings of polygons) {
          if (insideRing(light.point, rings[0]) && !rings.slice(1).some((ring) => insideRing(light.point, ring))) { distance = 0; contained = true; break; }
          for (const ring of rings) for (let i = 1; i < ring.length; i++) {
            distance = Math.min(distance, segmentDistance(light.point, ring[i - 1], ring[i]));
          }
        }
        const centerDistance = Math.hypot(center[0] - light.point[0], center[1] - light.point[1]);
        if (distance < light.radius) lights.push({ light, contained, distance, centerDistance });
        const weight = light.intensity * smoothLightFalloff(distance, light.radius) *
          (0.35 + 0.65 * smoothLightFalloff(centerDistance, light.radius));
        total += weight;
        rgb = rgb.map((c, i) => c + light.color[i] * weight);
      }
    }
    const result = { strength: 1 - Math.exp(-total), color: total ? rgb.map((c) => c / total) : [255, 208, 138], lights };
    if (!cache.has(geometry)) cache.set(geometry, new Map());
    cache.get(geometry).set(floor, result);
    return result;
  };
  sample.origin = origin;
  return sample;
}

// Unlit material makes this a baked emissive contribution independent of sunlight.
// Retain most of the source hue; limit warm tint so blue/green rooms stay recognizable.
export function nightRoomColor(base, illumination, wall = false) {
  const strength = illumination?.strength || 0;
  const tint = illumination?.color || [255, 208, 138];
  const exposure = (wall ? 0.20 : 0.30) + strength * (wall ? 0.70 : 0.85);
  return base.slice(0, 3).map((c, i) => Math.round(clamp(c * exposure + tint[i] * strength * 0.17, 0, 255)));
}

export function getLightFloorPlacement(data, floors) {
  const visible = new Set(floors.map(lightFloor));
  const histograms = new Map();
  let minimum = Infinity;
  for (const feature of data?.features || []) {
    if (!polygonRings(feature.geometry).length) continue;
    const p = feature.properties || {};
    const floor = lightFloor(p.level ?? p.floor ?? p.nivel ?? 0);
    if (!visible.has(floor)) continue;
    const explicit = parseFloat(p.base_height ?? p.base_heigh ?? p.baseHeight ?? p.baseheight);
    const z = parseFloat(p.z_values), height = parseFloat(p.height ?? p.altura);
    const base = Number.isFinite(explicit) ? explicit : Number.isFinite(z) && (!Number.isFinite(height) || z <= height) ? z : 0;
    minimum = Math.min(minimum, base);
    if (!histograms.has(floor)) histograms.set(floor, new Map());
    const histogram = histograms.get(floor);
    const key = Math.round(base * 1000) / 1000;
    histogram.set(key, (histogram.get(key) || 0) + 1);
  }
  // The dominant base is the floor datum. This handles absolute stacked exports
  // without allowing a few zero-height fixtures to shift an entire floor's lights.
  const floorBases = Object.fromEntries([...histograms].map(([floor, counts]) => [floor,
    [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0],
  ]));
  return { floorBases, floorBase: Number.isFinite(minimum) ? minimum : 0 };
}

export function positionLight(anchor, floors, floorSpacing, floorBase = 0, heightExaggeration = 1, floorBases = {}) {
  const stack = floors.length > 1 ? anchor.floor * floorSpacing : -floorBase;
  return [...anchor.xy, stack + (floorBases[anchor.floor] || 0) + lightLocalHeight(anchor, heightExaggeration)];
}

export function lightLocalHeight(anchor, heightExaggeration = 1) {
  return Number.isFinite(anchor.z) ? anchor.z : anchor.base + (anchor.top - anchor.base) * heightExaggeration * 0.5;
}

export function nightEnvelopeLayers(layers, nightProgress, tuning = NIGHT_LIGHTING_DEFAULTS, floorCount = 1) {
  const progress = Math.max(0, Math.min(1, Number(nightProgress)));
  const opacity = tuning.nightEnvelopeOpacity * (floorCount > 1 ? tuning.stackedEnvelopeScale : 1);
  return layers.map(layer => layer.clone({
    // Stable IDs/data/mesh/material path; only the small per-instance color buffer changes.
    getColor: (d, info) => {
      const day = typeof layer.props.getColor === 'function' ? layer.props.getColor(d, info) : layer.props.getColor;
      const night = [...tuning.envelopeColor, 255 * opacity * (d.revealProgress ?? 1)];
      return night.map((n,i) => (day?.[i] ?? 255) * (1-progress) + n*progress);
    },
    material: {
      ambient: (layer.props.material?.ambient ?? .35) * (1-progress) + .7*progress,
      diffuse: (layer.props.material?.diffuse ?? .6) * (1-progress) + .35*progress,
      shininess: (layer.props.material?.shininess ?? 32) * (1-progress) + 16*progress,
      specularColor: tuning.envelopeSpecularColor.map((n,i) => (layer.props.material?.specularColor?.[i] ?? 0)*(1-progress)+n*progress),
    },
    // Preserve authored day blending (including inherited Deck alpha factors).
    // The extension applies the existing night factors only to night coverage.
    parameters: { ...layer.props.parameters, depthMask: true },
    extensions: ENVIRONMENT_DEPTH_EXTENSIONS,
    environmentDepthProgress: progress,
    environmentNightBlendFunc: [770, 771, 1, 771],
    updateTriggers: { ...layer.props.updateTriggers, getColor: [layer.props.getColor, progress, tuning.envelopeColor, opacity] },
  }));
}
