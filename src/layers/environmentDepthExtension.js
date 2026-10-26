import { LayerExtension } from '@deck.gl/core';
import { setParameters } from '@luma.gl/core';

// Depth writes are binary. The early depth handoff is composited between two
// complete scene images by EnvironmentDepthEffect; surfaces never reject pixels.
// Keep the existing timing, endpoint depth/blend states and picking behavior.
export const DEPTH_HANDOFF_END = 0.04;
export function environmentDepthBlend(surfaceNight) {
  const t = Math.max(0, Math.min(1, (Number(surfaceNight) || 0) / DEPTH_HANDOFF_END));
  return t * t * (3 - 2 * t);
}

export function environmentDepthState(progress, picking = false, mode) {
  const night = !picking && (mode === 1 || (mode !== 0 && environmentDepthBlend(progress) > 0));
  return {depthMask:!night,night};
}

export class EnvironmentDepthExtension extends LayerExtension {
  draw(options) {
    const state=environmentDepthState(this.props.environmentDepthProgress,
      options.moduleParameters?.pickingActive,options.moduleParameters?.environmentDepthMode);
    setParameters(this.context.gl, {
      depthMask: state.depthMask,
      ...(state.night && this.props.environmentNightBlendFunc
        ? { blendFunc: this.props.environmentNightBlendFunc } : {}),
    });
  }
}
EnvironmentDepthExtension.extensionName = 'EnvironmentDepthExtension';
EnvironmentDepthExtension.defaultProps = {
  environmentDepthProgress: { type: 'number', value: 0, min: 0, max: 1 },
  environmentNightBlendFunc: { type: 'array', value: null, optional: true, compare: true },
};
export const ENVIRONMENT_DEPTH_EXTENSIONS = Object.freeze([new EnvironmentDepthExtension()]);
