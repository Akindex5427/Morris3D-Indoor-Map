import { useEffect, useMemo, useState } from "react";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { buildWallMeshes } from "../utils/wallGeometry";

export const singleFloorWallConfig = {
  F0: "wall_room_basement.geojson",
  F1: "wall_room_level_1.geojson",
  F2: "wall_room_level_2.geojson",
  F3: "wall_room_level_3.geojson",
  F4: "wall_room_level_4.geojson",
  F5: "wall_room_level_5.geojson",
  F6: "wall_room_level_6.geojson",
  F7: "wall_room_level_7.geojson",
};

export const WALL_LAYER_CONFIG = Object.entries(singleFloorWallConfig).map(
  ([floorKey, fileName]) => ({
    floorId: Number(floorKey.slice(1)),
    url: fileName.startsWith("/") ? fileName : `/${fileName}`,
  }),
);

const WALL_LAYER_MATERIAL = {
  ambient: 0.75,
  diffuse: 0.5,
  shininess: 4,
  specularColor: [80, 80, 80],
};

function normalizeFloorId(value) {
  if (typeof value === "string" && /^F\d+$/.test(value)) {
    return Number(value.slice(1));
  }

  const floorId = Number(value);
  if (!Number.isFinite(floorId)) {
    return null;
  }

  // The UI labels the basement as F0, while some room datasets may encode it
  // as -1. The wall source for that level is keyed as floorId 0.
  return floorId === -1 ? 0 : floorId;
}

export function getVisibleWallFloorSet(visibleFloorIds = []) {
  return new Set(
    visibleFloorIds
      .map(normalizeFloorId)
      .filter((floorId) => floorId !== null),
  );
}

export function useBuildingWallLayers({
  visibleFloorIds = [],
  floorBaseOffsets = {},
  wallConfig = WALL_LAYER_CONFIG,
  enabled = true,
} = {}) {
  const [wallDataByFloor, setWallDataByFloor] = useState({});

  useEffect(() => {
    if (!enabled) {
      setWallDataByFloor({});
      return undefined;
    }

    const controller = new AbortController();

    const loadWallDataByFloor = async () => {
      const wallEntries = await Promise.all(
        wallConfig.map(async ({ floorId, url }) => {
          try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) {
              throw new Error(`Failed to load ${url}`);
            }

            return [floorId, await response.json()];
          } catch (error) {
            if (error.name !== "AbortError") {
              console.warn(
                `[BuildingWallLayer] Wall layer unavailable for floor ${floorId}.`,
                error,
              );
            }

            return null;
          }
        }),
      );

      if (!controller.signal.aborted) {
        const nextWallDataByFloor = {};
        for (const entry of wallEntries) {
          if (entry) {
            const [floorId, data] = entry;
            nextWallDataByFloor[floorId] = data;
          }
        }

        setWallDataByFloor(nextWallDataByFloor);
      }
    };

    loadWallDataByFloor();

    return () => controller.abort();
  }, [enabled, wallConfig]);

  return useMemo(() => {
    if (!enabled) {
      return [];
    }

    const visibleFloorSet = getVisibleWallFloorSet(visibleFloorIds);
    if (visibleFloorSet.size === 0) {
      return [];
    }

    return wallConfig.flatMap(({ floorId }) => {
      if (!visibleFloorSet.has(floorId) || !wallDataByFloor[floorId]) {
        return [];
      }

      return buildWallMeshes(wallDataByFloor[floorId]).map((wall, index) => {
        const wallData = {
          ...wall,
          floorId,
          zOffset: floorBaseOffsets[floorId] ?? 0,
        };

        return new SimpleMeshLayer({
          id: `building-perimeter-wall-floor-${floorId}-${wall.id}-${index}`,
          data: [wallData],
          mesh: wall.mesh,
          getPosition: (d) => d.origin,
          getColor: (d) => d.color,
          getScale: [1, 1, 1],
          getOrientation: [0, 0, 0],
          getTranslation: (d) => [0, 0, d.zOffset],
          sizeScale: 1,
          pickable: false,
          wireframe: false,
          material: WALL_LAYER_MATERIAL,
          parameters: {
            cull: false,
            depthTest: true,
            depthMask: true,
          },
        });
      });
    });
  }, [enabled, floorBaseOffsets, visibleFloorIds, wallConfig, wallDataByFloor]);
}
