import { lightLocalHeight, smoothLightFalloff } from "./interiorLighting";
import { MAX_SURFACE_LIGHTS, NIGHT_LIGHTING_DEFAULTS, srgbToLinear, linearToSrgb } from "./nightLightingConfig";

const fieldCache = new WeakMap();
// Two RGBA float texels per source: local xyz/radius, source RGB/intensity.
// The sign of radius records whether a room boundary attenuates this source.
// The atlas is independent of camera, floor-stack offsets, reveal and tuning.
export function buildSurfaceLightField(data, sampler, isFloorSurface) {
  if (!sampler || !data) return null;
  if (!fieldCache.has(sampler)) fieldCache.set(sampler, new WeakMap());
  const cache = fieldCache.get(sampler);
  if (cache.has(data)) return cache.get(data);
  const features = data.features || [];
  const width = MAX_SURFACE_LIGHTS * 2;
  const height = Math.max(1, features.length);
  const pixels = new Float32Array(width * height * 4);
  const rows = new WeakMap();
  let truncated = 0, contributions = 0;
  features.forEach((feature, row) => {
    const candidates = sampler(feature).lights || [];
    const lights = candidates.length <= MAX_SURFACE_LIGHTS ? candidates : [...candidates].sort((a, b) =>
      Number(b.contained) - Number(a.contained) || a.centerDistance - b.centerDistance || b.light.intensity - a.light.intensity,
    ).slice(0, MAX_SURFACE_LIGHTS);
    truncated += candidates.length - lights.length;
    contributions += lights.length;
    rows.set(feature, { row, count: lights.length });
    lights.forEach(({ light, contained }, index) => {
      const offset = (row * width + index * 2) * 4;
      const transmission = contained || isFloorSurface(feature.properties) ? 1 : -1;
      pixels.set([...light.point, lightLocalHeight(light), light.radius * transmission,
        ...light.color.map(c => c / 255), light.intensity], offset);
    });
  });
  const field = { width, height, pixels, rows, origin: sampler.origin, truncated, contributions };
  cache.set(data, field);
  return field;
}

// CPU reference used by regression tests for the shader's lighting model.
export function shadeNightSurface(base, sources, point, tuning = NIGHT_LIGHTING_DEFAULTS, wall = false) {
  const energy = [0, 0, 0];
  for (const source of sources) {
    const distance = Math.hypot(...point.map((n, i) => n - source.position[i]));
    const weight = source.intensity * smoothLightFalloff(distance, source.radius) *
      (source.contained === false ? tuning.boundaryTransmission : 1);
    const minimum = Math.min(...source.color) / 255;
    source.color.forEach((c, i) => {
      energy[i] += srgbToLinear(Math.max(0, c - minimum * 255 * tuning.warmth * 0.18)) * weight;
    });
  }
  const radiance = base.map((c, i) => {
    const linear = srgbToLinear(c);
    return tuning.nightExposure * (linear * (wall ? tuning.wallAmbient : tuning.roomAmbient) +
      energy[i] * tuning.surfaceIlluminationStrength *
      (1 - tuning.surfaceColorRetention + tuning.surfaceColorRetention * linear));
  });
  const peak = Math.max(...radiance);
  return radiance.map(c => linearToSrgb(c / (1 + peak)));
}
