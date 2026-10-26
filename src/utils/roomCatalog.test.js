import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFloorCatalog, createRoomCatalogStore, FLOOR_POLYGON_MAP, ROOM_FLOORS,
  searchRooms, normalizeSearchText, isHighlightedRoom } from './roomCatalog';

const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const feature = properties => ({ type: 'Feature', properties, geometry: polygon });
const collection = features => ({ type: 'FeatureCollection', features });
const response = data => ({ ok: true, json: async () => data });
const real = ROOM_FLOORS.map(floor => buildFloorCatalog(JSON.parse(readFileSync(
  new URL(`../../public${FLOOR_POLYGON_MAP[floor]}`, import.meta.url), 'utf8')), floor));
const entries = real.flatMap(result => result.entries);

describe('authoritative room catalog', () => {
  it.each(ROOM_FLOORS)('indexes every identifiable valid feature on F%i', floor => {
    const expected = [148, 355, 243, 288, 199, 149, 138, 90];
    expect(real[floor].summary.total).toBe(expected[floor]);
    expect(real[floor].summary.searchable).toBe(expected[floor]);
    expect(real[floor].summary.excluded).toEqual([]);
    const named = real[floor].entries.find(entry => entry.name && /\d/.test(entry.name));
    expect(named).toBeDefined();
    expect(searchRooms(entries, named.name.slice(0, -1))).toContain(named);
    expect(named.feature.properties.floor).toBe(floor);
  });
  it('retains duplicate names as separate identifiable features across floors', () => {
    expect(new Set(entries.map(entry => entry.key)).size).toBe(1610);
    const results = searchRooms(entries, 'structure');
    expect(new Set(results.map(entry => entry.floor)).size).toBe(8);
    const selected = results[0];
    expect(results.filter(entry => isHighlightedRoom(entry.feature.properties, selected.key))).toEqual([selected]);
  });
  it('retains all nine unnamed features by their actual identifiers', () => {
    const unnamed = entries.filter(entry => !entry.name);
    expect(unnamed).toHaveLength(9);
    for (const entry of unnamed) {
      expect(entry.identifiers.length).toBeGreaterThan(0);
      expect(searchRooms(entries, entry.identifiers[0].value)).toContain(entry);
    }
  });
  it('normalizes case, whitespace, punctuation, accents and partial numbers', () => {
    const data = buildFloorCatalog(collection([feature({ name: '  Café—Room 0174-A ', OBJECTID: 0 })]), 1);
    for (const query of ['CAFE room', 'café-room', '0174a', '  Room   0174 ', '174', '0']) {
      expect(searchRooms(data.entries, query)).toHaveLength(1);
    }
    expect(normalizeSearchText(false)).toBe('');
    expect(searchRooms(data.entries, '!!!')).toEqual([]);
  });
  it('ranks exact matches before partial names and never truncates results to eight', () => {
    const results = searchRooms(entries, 'Classroom 0174');
    expect(results[0].name).toBe('Classroom 0174');
    expect(searchRooms(entries, 'class')).toHaveLength(entries.filter(entry => entry.terms.some(term => term.includes('class'))).length);
    expect(searchRooms(entries, 'structure').length).toBeGreaterThan(8);
  });
  it('reports missing attributes and invalid geometry without manufacturing names', () => {
    const data = collection([feature({}), feature({ name: true, id: {} }),
      { ...feature({ name: 'Broken', OBJECTID: 2 }), geometry: null },
      feature({ OBJECTID: 0 }), feature({ name: 'Named only' })]);
    const before = JSON.stringify(data);
    const result = buildFloorCatalog(data, 0);
    expect(result.summary.excludedCount).toBe(3);
    expect(result.summary.excluded[0].reasons).toContain('missing usable name and identifier');
    expect(result.summary.excluded[2].reasons).toContain('missing or invalid polygon geometry');
    expect(result.entries.map(entry => entry.label)).toEqual(['OBJECTID 0', 'Named only']);
    expect(JSON.stringify(data)).toBe(before);
  });
  it('disambiguates repeated identifiers without displaying invented IDs', () => {
    const result = buildFloorCatalog(collection([feature({ name: 'Same', OBJECTID: 4 }), feature({ name: 'Same', OBJECTID: 4 })]), 2);
    expect(new Set(result.entries.map(entry => entry.key)).size).toBe(2);
    expect(result.entries.map(entry => entry.identifiers[0].value)).toEqual(['4', '4']);
  });
});

describe('shared asynchronous room sources', () => {
  it('shares in-flight loads and completes all eight floors despite out-of-order responses', async () => {
    const resolves = {};
    const fetcher = vi.fn(url => new Promise(resolve => { resolves[url] = resolve; }));
    const store = createRoomCatalogStore(fetcher);
    const all = store.loadAll();
    const same = store.loadFloor(1);
    await Promise.resolve();
    for (const floor of [7, 3, 0, 6, 1, 5, 2, 4]) {
      resolves[FLOOR_POLYGON_MAP[floor]](response(collection([feature({ name: `Room ${floor}`, OBJECTID: floor })])));
    }
    await all; await same;
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(store.getSnapshot().loadedFloors).toEqual(ROOM_FLOORS);
    expect(store.getSnapshot().entries).toHaveLength(8);
    expect(store.getSnapshot().loadingFloors).toEqual([]);
  });
  it('exposes failed floors and retries only missing sources without combined-export substitution', async () => {
    let fail = true;
    const fetcher = vi.fn(async url => url === FLOOR_POLYGON_MAP[7] && fail ? { ok: false }
      : response(collection([feature({ name: 'Room', OBJECTID: 1 })])));
    const store = createRoomCatalogStore(fetcher);
    await store.loadAll();
    expect(store.getSnapshot().errors[0].floor).toBe(7);
    expect(store.getSnapshot().loadedFloors).toHaveLength(7);
    fail = false;
    await store.loadAll();
    expect(fetcher).toHaveBeenCalledTimes(9);
    expect(store.getSnapshot().entries).toHaveLength(8);
    expect(store.getSnapshot().errors).toEqual([]);
  });
  it('updates the index when a source reloads and rejects a stale publication', async () => {
    const resolves = [];
    const store = createRoomCatalogStore(() => new Promise(resolve => resolves.push(resolve)));
    const old = store.loadFloor(1);
    const fresh = store.loadFloor(1, { reload: true });
    await Promise.resolve();
    resolves[1](response(collection([feature({ name: 'New name', OBJECTID: 1 })])));
    await fresh;
    resolves[0](response(collection([feature({ name: 'Old name', OBJECTID: 1 })])));
    await old;
    expect(searchRooms(store.getSnapshot().entries, 'Old')).toEqual([]);
    expect(searchRooms(store.getSnapshot().entries, 'New')).toHaveLength(1);
    expect(store.getSnapshot().datasets[1].features[0].properties.name).toBe('New name');
  });
});
