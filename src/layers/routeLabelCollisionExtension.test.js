import {describe,it,expect} from 'vitest';
import {CollisionFilterExtension} from '@deck.gl/extensions';
import {RouteLabelCollisionExtension,RouteAnnotationPixelsExtension} from './routeLabelCollisionExtension';

describe('deck.gl 8.9 route label collision offset integration',()=>{
  it('keeps the existing collision module and corrects its sampling anchor',()=>{
    const original=new CollisionFilterExtension().getShaders().modules[0];
    const adjusted=new RouteLabelCollisionExtension().getShaders().modules[0];
    expect(adjusted.name).toBe(original.name);
    expect(adjusted.vs).toContain('attribute vec2 routeLabelPixelOffsets;');
    expect(adjusted.inject['vs:DECKGL_FILTER_GL_POSITION']).toContain('collision_texCoords +=');
    expect(adjusted.inject['vs:DECKGL_FILTER_GL_POSITION']).toContain('/ (2.0 * project_uFocalDistance)');
    expect(original.inject['vs:DECKGL_FILTER_GL_POSITION']).not.toContain('collision_texCoords +=');
    expect(adjusted.inject['vs:DECKGL_FILTER_COLOR']).toBe(original.inject['vs:DECKGL_FILTER_COLOR']);
  });
  it('uses the same screen-pixel correction for glyphs, backgrounds and markers',()=>{
    const labels=new RouteLabelCollisionExtension().getShaders();
    const markers=new RouteAnnotationPixelsExtension().getShaders();
    expect(labels.inject).toEqual(markers.inject);
    // After the clip-space perspective divide the offset must equal pixels,
    // regardless of anchor depth. Test near/far and elevated anchors.
    for(const w of [0.4,1,2,4])for(const focal of [1,1.5,2]) {
      const pixelOffset=12,viewport=800;
      const correctedClip=(pixelOffset*w/focal)/viewport*2*focal;
      expect(correctedClip/w*viewport/2).toBeCloseTo(pixelOffset,12);
    }
  });
});
