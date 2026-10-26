import { describe, expect, it, vi } from 'vitest';
import { createWallDataCache } from './wallDataCache';
import { buildWallMeshes, getCachedWallMeshes } from './wallGeometry';
import { createPerimeterWallMeshLayers } from '../layers/perimeterWallLayer';

describe('wall data and geometry reuse', () => {
  it('shares in-flight fetch and JSON parsing across map instances', async () => {
    const data = { type: 'FeatureCollection', features: [] };
    const json = vi.fn(async () => data);
    const fetcher = vi.fn(async () => ({ ok: true, json }));
    const load = createWallDataCache(fetcher);
    const first = load('/wall.geojson');
    expect(load('/wall.geojson')).toBe(first);
    expect(await first).toBe(data);
    expect(await load('/wall.geojson')).toBe(data);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledTimes(1);
  });
  it('retries failures rather than caching an unavailable source', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
    const load = createWallDataCache(fetcher);
    await expect(load('/wall')).rejects.toThrow('503');
    await expect(load('/wall')).resolves.toEqual({ features: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('bounds retained sources and refreshes recently used entries', async () => {
    const fetcher = vi.fn(async url => ({ ok: true, json: async () => ({ url }) }));
    const load = createWallDataCache(fetcher, 2);
    const a = await load('a'); await load('b'); expect(await load('a')).toBe(a);
    await load('c'); expect(await load('a')).toBe(a); await load('b');
    expect(fetcher.mock.calls.map(args => args[0])).toEqual(['a', 'b', 'c', 'b']);
  });
  const wall = { type: 'Feature', properties: { base_height: 2, height: 10 },
    geometry: { type: 'MultiLineString', coordinates: [
      [[-89.22, 37.715], [-89.2199, 37.715], [-89.2199, 37.7151]],
      [[-89.2198, 37.715], [-89.2198, 37.7151]],
    ] } };
  it('reuses typed arrays but invalidates when a source is replaced', () => {
    const first = getCachedWallMeshes(wall);
    expect(getCachedWallMeshes(wall)).toBe(first);
    const replacement = structuredClone(wall); replacement.properties.height = 15;
    expect(getCachedWallMeshes(replacement)[0].top).toBe(15);
    expect(getCachedWallMeshes(replacement)[0].mesh).not.toBe(first[0].mesh);
    expect(first[0].top).toBe(10);
  });
  it('GPU reveal matches original vertex positions without reallocating meshes', () => {
    const before = JSON.stringify(wall);
    for (const progress of [0, .1, .25, .5, .9, 1]) {
      const layer = createPerimeterWallMeshLayers({ wallData: wall, presentation: { revealProgress: progress } })[0];
      const original = buildWallMeshes(wall, { getRevealProgress: () => progress })[0].mesh.attributes.positions.value;
      const full = layer.props.mesh.attributes.positions.value;
      expect(layer.props.mesh).toBe(getCachedWallMeshes(wall)[0].mesh);
      for (let i = 0; i < full.length; i++) {
        const axis = i % 3;
        expect(full[i] * layer.props.getScale[axis] + layer.props.getTranslation[axis]).toBeCloseTo(original[i], 5);
      }
    }
    expect(JSON.stringify(wall)).toBe(before);
  });
});
