import { LayerExtension } from '@deck.gl/core';
import { setParameters, withParameters } from '@luma.gl/core';

// Depth writes are binary WebGL state, not a blendable material property.
// Intermediate frames use complementary, screen-stable pixel coverage so depth
// occlusion dissolves instead of jumping at the first nonzero progress value.
// Both passes reuse the same models/buffers and output the same interpolated color.
// Finish the occlusion handoff by golden hour (surfaceNight = .04), before
// low-alpha twilight surfaces make coverage differences conspicuous. This is a
// deterministic remapping of the existing timeline, with no separate clock.
export const DEPTH_HANDOFF_END = 0.04;
export function environmentDepthCoverage(surfaceNight) {
  const t = Math.max(0, Math.min(1, (Number(surfaceNight) || 0) / DEPTH_HANDOFF_END));
  return t * t * (3 - 2 * t);
}

export function environmentDepthPasses(progress, picking = false) {
  const mix = Math.max(0, Math.min(1, Number(progress) || 0));
  if (picking || mix === 0) return [{ depthMask: true, pass: 0, night: false }];
  if (mix === 1) return [{ depthMask: false, pass: 0, night: true }];
  return [
    { depthMask: true, pass: 1, night: false },
    { depthMask: false, pass: -1, night: true },
  ];
}

export class EnvironmentDepthExtension extends LayerExtension {
  getShaders() {
    return { inject: {
      'fs:#decl': `
        uniform float environmentDepthMix;
        uniform float environmentDepthPass;
      `,
      'fs:#main-start': `
        if (environmentDepthPass != 0.0) {
          // Shared sample for each physical pixel, independent of animation time.
          float coverage = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
          bool dayPixel = coverage >= environmentDepthMix;
          if (dayPixel != (environmentDepthPass > 0.0)) discard;
        }
      `,
    } };
  }

  draw(options) {
    const gl = this.context.gl;
    const progress = environmentDepthCoverage(this.props.environmentDepthProgress);
    const passes = environmentDepthPasses(progress, options.moduleParameters?.pickingActive);
    const parametersFor = pass => ({
      depthMask: pass.depthMask,
      ...(pass.night && this.props.environmentNightBlendFunc
        ? { blendFunc: this.props.environmentNightBlendFunc } : {}),
    });
    const uniformsFor = pass => ({ environmentDepthMix: progress, environmentDepthPass: pass.pass });
    if (passes.length === 2) {
      // Render day coverage; deck's ordinary draw renders complementary pixels.
      withParameters(gl, parametersFor(passes[0]), () =>
        this.draw({ ...options, uniforms: { ...options.uniforms, ...uniformsFor(passes[0]) } }));
    }
    const last = passes[passes.length - 1];
    // Layer._drawLayer's enclosing withParameters restores state afterwards.
    setParameters(gl, parametersFor(last));
    for (const model of this.getModels()) model.setUniforms(uniformsFor(last));
  }
}
EnvironmentDepthExtension.extensionName = 'EnvironmentDepthExtension';
EnvironmentDepthExtension.defaultProps = {
  environmentDepthProgress: { type: 'number', value: 0, min: 0, max: 1 },
  environmentNightBlendFunc: { type: 'array', value: null, optional: true, compare: true },
};
export const ENVIRONMENT_DEPTH_EXTENSIONS = Object.freeze([new EnvironmentDepthExtension()]);
