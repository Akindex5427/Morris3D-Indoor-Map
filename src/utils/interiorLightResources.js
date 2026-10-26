import { createRoomLightSampler, EMPTY_LIGHTS, normalizeLightAnchors } from './interiorLighting';

export const INTERIOR_LIGHT_LOAD_TIMEOUT_MS = 20000;
export async function fetchInteriorLightData() {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), INTERIOR_LIGHT_LOAD_TIMEOUT_MS);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}interior_lights.geojson`, { signal: abort.signal });
    if (!response.ok) throw new Error(`Interior lights: HTTP ${response.status}`);
    const data = await response.json();
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid interior-light GeoJSON');
    return data;
  } finally { clearTimeout(timeout); }
}

// Share pending requests, parsed immutable records and the spatial sampler across
// maps. Day/Night changes never evict successful data. Failure retries are explicit.
export function createInteriorLightResources(load = fetchInteriorLightData) {
  let snapshot = { status: 'idle', anchors: EMPTY_LIGHTS, sampler: null, error: null };
  let pending = null;
  const listeners = new Set();
  const publish = next => { snapshot = next; listeners.forEach(listener => listener()); };
  const prepare = (retry = false) => {
    if (pending) return pending;
    if (snapshot.status === 'ready' || (snapshot.status === 'error' && !retry)) return Promise.resolve(snapshot);
    // Install the shared promise before notifying subscribers.
    pending = Promise.resolve().then(load).then(data => {
      const anchors = normalizeLightAnchors(data);
      const next = { status: 'ready', anchors, sampler: createRoomLightSampler(anchors), error: null };
      pending = null; publish(next); return next;
    }).catch(reason => {
      const next = { ...snapshot, status: 'error', error: reason?.name === 'AbortError'
        ? 'Interior lights took too long to load.' : 'Interior lights could not load.' };
      pending = null; publish(next); return next;
    });
    publish({ ...snapshot, status: 'loading', error: null });
    return pending;
  };
  return { getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, prepare };
}
export const interiorLightResources = createInteriorLightResources();
