import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  countFeaturesMissingBaseHeight,
  countFeaturesMissingColor,
  enrichMissingFeatureDisplayProperties,
  enrichMissingFeatureColors,
  parseFeatureColor,
} from "./featureColors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const readGeoJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));

const level6Rooms = readGeoJson("public/rooms-level-6-WGS.geojson");
const level2Rooms = readGeoJson("public/rooms-level-02-WGS.geojson");
const allRooms = readGeoJson("public/rooms-all-WGS-v6.geojson");

function getRoom(featureCollection, name) {
  const room = featureCollection.features.find(
    (feature) =>
      String(feature.properties?.name ?? "").trim().toLowerCase() ===
      name.toLowerCase(),
  );

  if (!room) {
    throw new Error(`Unable to find "${name}" in the requested dataset.`);
  }

  return room;
}

describe("featureColors", () => {
  it("restores missing level-6 room colors from the all-floor dataset", () => {
    expect(countFeaturesMissingColor(level6Rooms.features)).toBe(
      level6Rooms.features.length,
    );

    const enrichedFeatures = enrichMissingFeatureColors(
      level6Rooms.features,
      allRooms.features,
      { floor: 6 },
    );

    expect(countFeaturesMissingColor(enrichedFeatures)).toBe(0);

    const enrichedCollection = {
      ...level6Rooms,
      features: enrichedFeatures,
    };

    expect(getRoom(enrichedCollection, "math lab 0677").properties.color).toBe(
      "lightcoral",
    );
    expect(
      getRoom(
        enrichedCollection,
        "southern illinois african american heritage center 0640a",
      ).properties.color,
    ).toBe("gold");
    expect(getRoom(enrichedCollection, "stairs area upper").properties.color).toBe(
      "brown",
    );
    expect(getRoom(enrichedCollection, "elevator").properties.color).toBe(
      "grey",
    );
  });

  it("restores missing level-2 display colors from the all-floor dataset", () => {
    expect(countFeaturesMissingColor(level2Rooms.features)).toBe(
      level2Rooms.features.length,
    );
    expect(countFeaturesMissingBaseHeight(level2Rooms.features)).toBe(0);

    const enrichedFeatures = enrichMissingFeatureDisplayProperties(
      level2Rooms.features,
      allRooms.features,
      { floor: 2 },
    );

    expect(countFeaturesMissingColor(enrichedFeatures)).toBe(0);
    expect(countFeaturesMissingBaseHeight(enrichedFeatures)).toBe(0);

    const floorFeature = enrichedFeatures.find(
      (feature) => feature.properties?.OBJECTID === 1,
    );
    const structureFeature = enrichedFeatures.find(
      (feature) => feature.properties?.OBJECTID === 4,
    );
    const stairFeature = enrichedFeatures.find(
      (feature) => feature.properties?.OBJECTID === 14,
    );

    expect(floorFeature?.properties?.base_height).toBe(0);
    expect(floorFeature?.properties?.color).toBe("lightgrey");
    expect(structureFeature?.properties?.base_height).toBe(0);
    expect(structureFeature?.properties?.color).toBe("grey");
    expect(stairFeature?.properties?.base_height).toBe(4.2);
    expect(stairFeature?.properties?.color).toBe("brown");
  });

  it("parses the named and hex colors used by the room datasets", () => {
    expect(parseFeatureColor("lightcoral")).toEqual([240, 128, 128]);
    expect(parseFeatureColor("darkorange")).toEqual([255, 140, 0]);
    expect(parseFeatureColor("magneta")).toEqual([255, 0, 255]);
    expect(parseFeatureColor("#0a387f")).toEqual([10, 56, 127]);
  });
});
