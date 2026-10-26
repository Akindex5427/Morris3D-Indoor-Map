import { CollisionFilterExtension } from '@deck.gl/extensions';
import { LayerExtension } from '@deck.gl/core';

// deck.gl 8.9's pixel-to-clip conversion uses the viewport focal distance, not
// this anchor's clip W. Correct the billboard offset before perspective divide
// so text, its background, and markers have true CSS-pixel dimensions even at
// the near/far edges of a pitched view or on upper floors. No camera/React work.
const screenPixelInjection = {
  'vs:DECKGL_FILTER_SIZE': `
    size.xy *= gl_Position.w / max(project_uFocalDistance, 0.0001);
  `,
};

export class RouteAnnotationPixelsExtension extends LayerExtension {
  static extensionName = 'RouteAnnotationPixelsExtension';
  getShaders() { return {inject:screenPixelInjection}; }
}

// deck.gl 8.9 samples collision visibility at the geographic anchor, ignoring
// getPixelOffset. A displaced label otherwise samples empty pixels and vanishes.
// Extend that same engine/group, translating only its visibility sample to the
// rendered text center; the authoritative geographic anchor stays unchanged.
export class RouteLabelCollisionExtension extends CollisionFilterExtension {
  initializeState(context, extension) {
    super.initializeState(context, extension);
    this.getAttributeManager()?.addInstanced({
      routeLabelPixelOffsets: {size: 2, accessor: 'getPixelOffset'},
    });
  }

  getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      inject: screenPixelInjection,
      modules: shaders.modules.map(module => ({
        ...module,
        vs: `attribute vec2 routeLabelPixelOffsets;\n${module.vs}`,
        inject: {
          ...module.inject,
          'vs:DECKGL_FILTER_GL_POSITION': module.inject['vs:DECKGL_FILTER_GL_POSITION'].replace(
            'vec2 collision_texCoords = collision_getCoords(collision_common_position);',
            `vec2 collision_texCoords = collision_getCoords(collision_common_position);
             collision_texCoords += project_pixel_size_to_clipspace(routeLabelPixelOffsets * vec2(1.0, -1.0)) / (2.0 * project_uFocalDistance);`
          ),
        },
      })),
    };
  }
}
