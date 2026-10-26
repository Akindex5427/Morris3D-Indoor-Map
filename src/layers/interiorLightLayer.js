import { ScatterplotLayer } from "@deck.gl/layers";
import { positionLight } from "../utils/interiorLighting";
import { lightPalette, NIGHT_LIGHTING_DEFAULTS } from "../utils/nightLightingConfig";

// A single instanced draw for every soft glow, with a smooth radial profile.
export class InteriorGlowLayer extends ScatterplotLayer {
  getShaders() {
    const shaders = super.getShaders();
    return { ...shaders, inject: { ...shaders.inject,
      "fs:DECKGL_FILTER_COLOR": "color.a *= pow(max(0.0, 1.0 - dot(geometry.uv, geometry.uv)), 3.0);",
    } };
  }
  draw({ uniforms }) {
    const gain = this.props.getFixtureGain?.() ?? 1;
    super.draw({ uniforms: { ...uniforms, opacity: (uniforms.opacity ?? this.props.opacity) * gain } });
  }
}
InteriorGlowLayer.layerName = "InteriorGlowLayer";
InteriorGlowLayer.defaultProps = { getFixtureGain: { type: 'function', value: null, optional: true } };

export function createInteriorLightLayers({ lights, floors, floorSpacing, floorBase = 0, floorBases = {}, heightExaggeration = 1, reveal = 1, tuning = NIGHT_LIGHTING_DEFAULTS, getFixtureGain = null }) {
  if (!lights.length || reveal < 1) return [];
  // Source-over compositing bounds overlapping halos instead of adding RGB
  // until every channel clips to white. This is local glow, not a bloom pass.
  const glowExposure = tuning.glowStrength / Math.sqrt(Math.max(1, floors.length));
  const palettes = new Map(lights.map(light => [light, lightPalette(light.color, tuning)]));
  const getPosition = (light) => positionLight(light, floors, floorSpacing, floorBase, heightExaggeration, floorBases);
  const common = {
    data: lights, pickable: false, stroked: false, radiusUnits: "meters", getFixtureGain,
    getPosition,
    parameters: { depthTest: true, depthMask: false, blend: true, blendFunc: [770, 771, 1, 771], blendEquation: 32774 },
    updateTriggers: { getPosition: [floors, floorSpacing, floorBase, floorBases, heightExaggeration] },
  };
  return [
    new InteriorGlowLayer({ ...common, id: "interior-light-pools",
      billboard: false, radiusMaxPixels: 100,
      getRadius: (d) => d.radius * tuning.glowRadiusScale,
      getFillColor: (d) => [...palettes.get(d).outer, Math.round(Math.min(60, 28 * d.intensity) * glowExposure)],
      updateTriggers: { ...common.updateTriggers, getRadius: [tuning.glowRadiusScale], getFillColor: [glowExposure, tuning.warmth] },
    }),
    new InteriorGlowLayer({ ...common, id: "interior-light-halos",
      billboard: true, radiusMaxPixels: 48,
      getRadius: (d) => Math.min(6, d.radius * 0.6) * tuning.glowRadiusScale,
      getFillColor: (d) => [...palettes.get(d).halo, Math.round(Math.min(100, 65 * d.intensity) * glowExposure)],
      updateTriggers: { ...common.updateTriggers, getRadius: [tuning.glowRadiusScale], getFillColor: [glowExposure, tuning.warmth] },
    }),
    new InteriorGlowLayer({ ...common, id: "interior-light-fixtures",
      billboard: true, radiusMinPixels: tuning.coreMinPixels, radiusMaxPixels: tuning.coreMaxPixels,
      getRadius: (d) => Math.max(0.07, Math.min(0.18, (d.top - d.base) * 0.8)) * tuning.coreRadiusScale,
      getFillColor: (d) => [...palettes.get(d).highlight, Math.round(255 * tuning.coreBrightness * Math.min(1, d.intensity))],
      updateTriggers: { ...common.updateTriggers, getRadius: [tuning.coreRadiusScale], getFillColor: [tuning.coreBrightness, tuning.highlightMix] },
    }),
  ];
}
