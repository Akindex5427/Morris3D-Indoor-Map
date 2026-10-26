import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFloorCatalog, FLOOR_POLYGON_MAP } from './roomCatalog';
import { enrichMissingFeatureDisplayProperties } from './featureColors';
import { normalizeLightAnchors, selectVisibleLights, getLightFloorPlacement, positionLight } from './interiorLighting';
import { buildFilteredIndoorFeatureCollection } from '../components/IndoorBuilding';

const read = path => JSON.parse(readFileSync(new URL(`../../public${path}`, import.meta.url), 'utf8'));
const source = read('/interior_lights.geojson'), lights = normalizeLightAnchors(source);
const combined = read(FLOOR_POLYGON_MAP.all), floors = [0,1,2,3,4,5,6,7];

describe('authoritative fixture placement', () => {
  it('retains all 138 enabled anchors and exact source radius, intensity, RGB and local Z', () => {
    expect(lights).toHaveLength(138);
    lights.forEach(light => {
      const p = source.features.find(f => f.properties.light_id === light.id).properties;
      expect(light.intensity).toBe(p.intensity); expect(light.radius).toBe(p.radius_m);
      expect(light.z).toBe(p.z_height); expect(light.color).toEqual([255,208,138]);
    });
    expect(floors.map(floor => selectVisibleLights(lights,[floor]).length)).toEqual([19,20,23,16,23,19,18,0]);
  });
  it('keeps single-floor fixture Z equal to z_height on all supplied floors', () => {
    floors.forEach(floor => {
      const raw = buildFloorCatalog(read(FLOOR_POLYGON_MAP[floor]), floor).data;
      const data = { ...raw, features: enrichMissingFeatureDisplayProperties(raw.features, combined.features, {floor}) };
      const placement = getLightFloorPlacement(data,[floor]);
      selectVisibleLights(lights,[floor]).forEach(light => {
        expect(positionLight(light,[floor],4.5,placement.floorBase,1,placement.floorBases)[2]).toBe(light.z);
      });
    });
  });
  it('adds local Z once to the actual rendered F-ALL floor datum', () => {
    const placement = getLightFloorPlacement(combined,floors);
    const rendered = buildFilteredIndoorFeatureCollection(combined,floors,4.5);
    for (const light of lights) {
      const index = combined.features.findIndex(f => Number(f.properties.level ?? f.properties.floor) === light.floor &&
        Number(f.properties.base_height ?? f.properties.base_heigh) === placement.floorBases[light.floor]);
      expect(index).toBeGreaterThanOrEqual(0);
      const feature = combined.features[index];
      const renderedFeature = rendered.features.find(f => f.properties === feature.properties ||
        f.properties.OBJECTID === feature.properties.OBJECTID && f.properties.name === feature.properties.name &&
        Number(f.properties.level ?? f.properties.floor) === light.floor);
      expect(renderedFeature).toBeDefined();
      const ring = renderedFeature.geometry.type === 'Polygon' ? renderedFeature.geometry.coordinates[0] : renderedFeature.geometry.coordinates[0][0];
      expect(positionLight(light,floors,4.5,placement.floorBase,1,placement.floorBases)[2]).toBeCloseTo(ring[0][2]+light.z);
    }
  });
});
