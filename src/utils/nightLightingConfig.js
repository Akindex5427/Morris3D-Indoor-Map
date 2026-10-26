// Artistic controls only. GeoJSON remains the source of hue, intensity, radius,
// elevation and enabled state. All values are scoped to Night Mode.
export const NIGHT_LIGHTING_DEFAULTS = Object.freeze({
  warmth: 0.65,
  glowStrength: 0.45,
  glowRadiusScale: 1.1,
  coreBrightness: 0.65,
  coreRadiusScale: 0.7,
  coreMinPixels: 0.35,
  coreMaxPixels: 1.4,
  highlightMix: 0.08,
  surfaceIlluminationStrength: 1.4,
  nightExposure: 1,
  roomAmbient: 0.075,
  wallAmbient: 0.045,
  surfaceColorRetention: 0.65,
  boundaryTransmission: 0.18,
  nightEnvelopeOpacity: 0.18,
  stackedEnvelopeScale: 0.8,
  stackedWallOpacityScale: 0.72,
  envelopeColor: Object.freeze([27, 32, 38]),
  envelopeSpecularColor: Object.freeze([55, 65, 75]),
  floorOpacity: 0.025,
  floorColor: Object.freeze([110, 116, 123]),
  floorEdgeStrength: 0.08,
});

export const MAX_SURFACE_LIGHTS = 32;

// Both styles use the same geometry, source atlas and shader. Architectural
// preserves the established defaults; GIS raises unlit-room legibility and
// reduces source tint/glow instead of changing the GIS colors or light data.
export const NIGHT_PRESETS = Object.freeze({
  architectural: NIGHT_LIGHTING_DEFAULTS,
  gis: Object.freeze({
    ...NIGHT_LIGHTING_DEFAULTS,
    warmth: 0.3,
    glowStrength: 0.12,
    glowRadiusScale: 0.85,
    coreBrightness: 0.4,
    surfaceIlluminationStrength: 0.5,
    roomAmbient: 0.55,
    wallAmbient: 0.35,
    surfaceColorRetention: 1,
    boundaryTransmission: 0.08,
    nightEnvelopeOpacity: 0.1,
    floorEdgeStrength: 0.2,
  }),
});

export const DEFAULT_NIGHT_PRESET = "architectural";
export const NIGHT_PRESET_TRANSITION_MS = 550;
export const NIGHT_PRESET_LABELS = Object.freeze({
  architectural: "Architectural Night",
  gis: "GIS Night",
});

export function interpolateNightTuning(from, to, progress) {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  const eased = progress * progress * (3 - 2 * progress);
  return Object.fromEntries(Object.entries(to).map(([key, value]) => {
    // Preserve shared arrays (palette colors) by identity: they do not change
    // across these styles and must not invalidate vertex-color attributes.
    if (from[key] === value) return [key, value];
    if (typeof value === "number") return [key, from[key] + (value - from[key]) * eased];
    return [key, value];
  }));
}

export function srgbToLinear(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(c) {
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
}

// Shift the falloff's lightness/saturation, never its hue. Non-golden anchors
// keep their own hue; the primary source color is never overwritten.
export function lightPalette(color, tuning = NIGHT_LIGHTING_DEFAULTS) {
  const rgb = color.map(c => c / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  const targetL = Math.max(0, lightness - 0.16 * tuning.warmth);
  const targetS = saturation + (1 - saturation) * tuning.warmth * saturation;
  const chroma = (1 - Math.abs(2 * targetL - 1)) * targetS;
  const halo = rgb.map(c => Math.round(255 * (max === min ? targetL :
    (c - min) / (max - min) * chroma + targetL - chroma / 2)));
  return {
    primary: color.slice(0, 3),
    highlight: color.map(c => Math.round(c + (255 - c) * tuning.highlightMix)),
    halo,
    outer: halo.map(c => Math.round(c * 0.74)),
  };
}
