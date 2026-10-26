import { NIGHT_ENVIRONMENT } from "../utils/environment";
import { SolidPolygonLayer } from "@deck.gl/layers";
import { Texture2D } from "@luma.gl/core";
import { MAX_SURFACE_LIGHTS, NIGHT_LIGHTING_DEFAULTS } from "../utils/nightLightingConfig";

// Share the atlas between room bodies and their wall shells in one GL context.
// Layer replacement and unmount release it; CPU data stays weakly cached.
const EMPTY_FIELD = {width: 1, height: 1, pixels: new Float32Array(4), origin: [0,0]};
const texturesByContext = new WeakMap();
function acquireTexture(gl, field) {
  if (!texturesByContext.has(gl)) texturesByContext.set(gl, new Map());
  const textures = texturesByContext.get(gl);
  let entry = textures.get(field);
  if (!entry) {
    const floatSupported = Boolean(gl.texStorage2D || gl.getExtension("OES_texture_float"));
    const texture = new Texture2D(gl, {
      width: floatSupported ? field.width : 1, height: floatSupported ? field.height : 1,
      data: floatSupported ? field.pixels : new Uint8Array(4),
      // luma.gl 8 calls its internal texture format "format". An unsized RGBA
      // float texture is incomplete in WebGL2; dataFormat stays RGBA.
      format: gl.texStorage2D && floatSupported ? gl.RGBA32F : gl.RGBA,
      dataFormat: gl.RGBA, type: floatSupported ? gl.FLOAT : gl.UNSIGNED_BYTE,
      mipmaps: false,
      parameters: { [gl.TEXTURE_MIN_FILTER]: gl.NEAREST, [gl.TEXTURE_MAG_FILTER]: gl.NEAREST,
        [gl.TEXTURE_WRAP_S]: gl.CLAMP_TO_EDGE, [gl.TEXTURE_WRAP_T]: gl.CLAMP_TO_EDGE },
    });
    entry = { texture, references: 0, floatSupported };
    textures.set(field, entry);
  }
  entry.references++;
  return entry;
}
function releaseTexture(gl, field) {
  const textures = texturesByContext.get(gl), entry = textures?.get(field);
  if (entry && --entry.references === 0) { entry.texture.delete(); textures.delete(field); }
}

export class NightSurfaceLayer extends SolidPolygonLayer {
  initializeState() {
    super.initializeState();
    this.getAttributeManager().add({
      nightColor: { size: 4, accessor: "getNightColor", defaultValue: [255,255,255,255],
        shaderAttributes: { nightColor: { divisor: 0 }, instanceNightColor: { divisor: 1 } } },
      nightSurface: { size: 4, accessor: "getNightSurface", defaultValue: [0, 0, 0, 0],
        shaderAttributes: { nightSurface: { divisor: 0 }, instanceNightSurface: { divisor: 1 } } },
    });
  }

  getShaders(type) {
    const shaders = super.getShaders(type);
    return { ...shaders, defines: { ...shaders.defines, NIGHT_SIDE_VERTEX: type === "side" ? 1 : 0 }, inject: { ...shaders.inject,
      "vs:#decl": `
        uniform float nightOpacity;
        uniform vec3 nightOrigin;
        uniform vec3 nightOrigin64Low;
        #if NIGHT_SIDE_VERTEX
        attribute vec4 instanceNightSurface;
        attribute vec4 instanceNightColor;
        #else
        attribute vec4 nightSurface;
        attribute vec4 nightColor;
        #endif
        varying vec4 vNightColor;
        varying vec3 vNightPosition;
        varying vec4 vNightSurface;
        varying vec2 vNightEdge;
      `,
      "vs:DECKGL_FILTER_GL_POSITION": `
        #if NIGHT_SIDE_VERTEX
        vNightSurface = instanceNightSurface;
        vNightColor = instanceNightColor / 255.0;
        #else
        vNightSurface = nightSurface;
        vNightColor = nightColor / 255.0;
        #endif
        vNightColor.a *= nightOpacity;
        vNightPosition = (geometry.position.xyz - project_position(nightOrigin, nightOrigin64Low)) / project_size(vec3(1.0));
        vNightPosition.z -= vNightSurface.y;
      `,
      // deck declares IS_SIDE_VERTEX after module injection; use our early define.
      // vertexPositions is only in scope in main, not in injected hook functions.
      "vs:#main-end": type === "side"
        ? "vNightEdge = vec2(vertexPositions.y, 1.0);" : "vNightEdge = vec2(1.0, 0.0);",
      "fs:#decl": `
        ${shaders.inject?.["fs:#decl"] || ""}
        uniform sampler2D nightAtlas;
        uniform vec2 nightAtlasSize;
        uniform bool nightFloatSupported;
        uniform float environmentMix;
        uniform float environmentExposure;
        uniform float fixtureGain;
        uniform float nightStrength;
        uniform float nightExposure;
        uniform float nightWarmth;
        uniform vec2 nightAmbient;
        uniform float nightRetention;
        uniform float nightTransmission;
        uniform float nightEdgeStrength;
        varying vec4 vNightColor;
        varying vec3 vNightPosition;
        varying vec4 vNightSurface;
        varying vec2 vNightEdge;
        vec3 nightLinear(vec3 c) {
          return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
        }
        vec3 nightSrgb(vec3 c) {
          return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
        }
      `,
      // Runs before deck.gl's picking filter (order 99), preserving room picking.
      "fs:DECKGL_FILTER_COLOR": { order: 0, injection: `
        vec4 nightResult = vNightColor;
        if (vNightSurface.w >= 0.0 && environmentMix > 0.0) {
          vec3 energy = vec3(0.0);
          if (nightFloatSupported && fixtureGain > 0.0) {
            for (int i = 0; i < ${MAX_SURFACE_LIGHTS}; i++) {
              if (float(i) >= vNightSurface.z) break;
              vec2 uv = vec2((float(i) * 2.0 + 0.5) / nightAtlasSize.x, (vNightSurface.x + 0.5) / nightAtlasSize.y);
              vec4 source = texture2D(nightAtlas, uv);
              vec4 emission = texture2D(nightAtlas, uv + vec2(1.0 / nightAtlasSize.x, 0.0));
              float radius = abs(source.w);
              float falloff = 1.0 - smoothstep(0.0, max(0.001, radius), distance(vNightPosition, source.xyz));
              falloff *= source.w < 0.0 ? nightTransmission : 1.0;
              float minimum = min(emission.r, min(emission.g, emission.b));
              vec3 hue = max(vec3(0.0), emission.rgb - minimum * nightWarmth * 0.18);
              energy += nightLinear(hue) * emission.a * falloff;
            }
          }
          vec3 base = nightLinear(vNightColor.rgb);
          float ambient = vNightSurface.w > 0.5 && vNightSurface.w < 1.5 ? nightAmbient.y : nightAmbient.x;
          vec3 radiance = base * ambient + energy * nightStrength * fixtureGain * (1.0 - nightRetention + nightRetention * base);
          float edge = vNightEdge.y * (smoothstep(0.96, 1.0, vNightEdge.x) + 1.0 - smoothstep(0.0, 0.04, vNightEdge.x));
          radiance += vec3(0.12, 0.14, 0.16) * edge * nightEdgeStrength;
          radiance *= nightExposure;
          // Compress by peak radiance, preserving chromatic ratios at overlaps.
          // Decode source sRGB once, accumulate in linear space, encode once.
          float peak = max(radiance.r, max(radiance.g, radiance.b));
          nightResult.rgb = nightSrgb(radiance / (1.0 + peak));
        }
        // Day and night share geometry, program, alpha blending and highlight priority.
        vec3 dayColor = color.rgb * (vNightSurface.w < 0.0 ? 1.0 : environmentExposure);
        color = vec4(mix(dayColor, nightResult.rgb, environmentMix), mix(color.a, nightResult.a, environmentMix));
      ` },
    } };
  }

  updateState(params) {
    super.updateState(params);
    if (this.state.atlasField !== (this.props.nightField || EMPTY_FIELD)) {
      if (this.state.atlasField) releaseTexture(this.context.gl, this.state.atlasField);
      const atlasField = this.props.nightField || EMPTY_FIELD;
      this.setState({ atlasField, atlasEntry: atlasField ? acquireTexture(this.context.gl, atlasField) : null });
    }
  }

  draw({ uniforms }) {
    const field = this.props.nightField || EMPTY_FIELD, entry = this.state.atlasEntry;
    if (!field || !entry) return;
    // Called only after the atlas is bound to an initialized model. Shared map
    // readiness gates activation; the callback is idempotent after first draw.
    this.props.onLightResourcesReady?.();
    const t = this.props.nightTuning;
    const environment = this.props.environment;
    const origin = [...field.origin, 0];
    super.draw({ uniforms: { ...uniforms,
      nightOpacity: uniforms.opacity ?? this.props.opacity,
      nightAtlas: entry.texture, nightAtlasSize: [field.width, field.height], nightFloatSupported: entry.floatSupported,
      nightOrigin: origin.map(Math.fround), nightOrigin64Low: origin.map(n => n - Math.fround(n)),
      environmentMix: environment.surfaceNight, environmentExposure: environment.exposure,
      fixtureGain: this.props.getFixtureGain?.() ?? environment.fixtures,
      nightStrength: t.surfaceIlluminationStrength, nightExposure: t.nightExposure, nightWarmth: t.warmth,
      nightAmbient: [t.roomAmbient, t.wallAmbient], nightRetention: t.surfaceColorRetention,
      nightTransmission: t.boundaryTransmission, nightEdgeStrength: t.floorEdgeStrength,
    } });
  }

  finalizeState() {
    if (this.state.atlasField) releaseTexture(this.context.gl, this.state.atlasField);
    super.finalizeState();
  }
}
NightSurfaceLayer.layerName = "NightSurfaceLayer";
NightSurfaceLayer.defaultProps = {
  getFixtureGain: { type: 'function', value: null, optional: true },
  onLightResourcesReady: { type: 'function', value: null, optional: true },
  nightField: null,
  environment: NIGHT_ENVIRONMENT,
  getNightColor: { type: "accessor", value: [255,255,255,255] },
  nightTuning: NIGHT_LIGHTING_DEFAULTS,
  getNightSurface: { type: "accessor", value: [0, 0, 0, 0] },
};
