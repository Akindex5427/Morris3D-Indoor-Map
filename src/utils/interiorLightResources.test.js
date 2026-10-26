import { describe, it, expect, vi } from 'vitest';
import { createInteriorLightResources, fetchInteriorLightData, INTERIOR_LIGHT_LOAD_TIMEOUT_MS } from './interiorLightResources';

const data = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-89.22, 37.71] },
  properties: { floor_id: 'F1', enabled: 1, intensity: .85, radius_m: 10.7, color: '#FFD08A', z_height: 4.3 } }] };

describe('shared lighting resources', () => {
  it('aborts a stalled fetch after the configured timeout and clears its timer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url,{signal}) => new Promise((_resolve,reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')));
    })));
    try {
      const result = fetchInteriorLightData().catch(error => error);
      await vi.advanceTimersByTimeAsync(INTERIOR_LIGHT_LOAD_TIMEOUT_MS);
      expect((await result).name).toBe('AbortError'); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
  });
  it('coalesces delayed requests, caches the sampler and preserves source attributes', async () => {
    let resolve; const load = vi.fn(() => new Promise(done => { resolve = done; }));
    const cache = createInteriorLightResources(load), original = JSON.stringify(data);
    const a = cache.prepare(), b = cache.prepare(); expect(a).toBe(b);
    expect(cache.getSnapshot().status).toBe('loading'); await Promise.resolve(); resolve(data);
    const ready = await a; expect(ready.status).toBe('ready');
    expect(ready.anchors[0]).toMatchObject({ intensity: .85, radius: 10.7, color: [255,208,138], z: 4.3 });
    expect(await cache.prepare(true)).toBe(ready); expect(load).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(data)).toBe(original);
  });
  it('reports failure without retry storms and supports explicit retry', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(data);
    const cache = createInteriorLightResources(load);
    expect((await cache.prepare()).status).toBe('error');
    await cache.prepare(); expect(load).toHaveBeenCalledTimes(1);
    expect((await cache.prepare(true)).status).toBe('ready'); expect(load).toHaveBeenCalledTimes(2);
  });
  it('handles malformed data and timeout and detaches subscriptions', async () => {
    const load = vi.fn().mockResolvedValueOnce({ features: [null] }).mockRejectedValueOnce({ name: 'AbortError' });
    const cache = createInteriorLightResources(load), events = [];
    const remove = cache.subscribe(() => events.push(cache.getSnapshot().status));
    expect((await cache.prepare()).status).toBe('error'); expect(events).toEqual(['loading','error']);
    remove(); expect((await cache.prepare(true)).error).toMatch(/too long/); expect(events).toHaveLength(2);
  });
});
