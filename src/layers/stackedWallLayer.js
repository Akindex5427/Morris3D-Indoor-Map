import { useEffect, useMemo, useState } from "react";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { getCachedWallMeshes, revealWallMesh } from "../utils/wallGeometry";
import { loadWallData } from "../utils/wallDataCache";

export const stackedWallConfig = {
  F0: "wall_room_basement_stack.geojson",
  F1: "wall_room_1_stack.geojson",
  F2: "wall_room_2_stack.geojson",
  F3: "wall_room_3_stack.geojson",
  F4: "wall_room_4_stack.geojson",
  F5: "wall_room_5_stack.geojson",
  F6: "wall_room_6_stack.geojson",
  F7: "wall_room_7_stack.geojson",
};

export const WALL_STACK_CONFIG = stackedWallConfig;

const STACKED_WALL_MATERIAL = {
  ambient: 0.75,
  diffuse: 0.5,
  shininess: 4,
  specularColor: [80, 80, 80],
};

const clamp01 = (value) => Math.max(0, Math.min(1, value));

function getWallFloorIndex(floorKey, visibleFloorKeys) {
  const index = visibleFloorKeys.indexOf(floorKey);
  return index === -1 ? 0 : index;
}

function getStackedWallRevealProgress({
  floorKey,
  visibleFloorKeys,
  revealProgress = 1,
  initialRevealActive = false,
}) {
  const progress = clamp01(revealProgress);
  if (!initialRevealActive && progress >= 1) {
    return 1;
  }

  const floorIndex = getWallFloorIndex(floorKey, visibleFloorKeys);
  const floorCount = Math.max(1, visibleFloorKeys.length);
  const stagger = 0.65;
  const raw = progress * (floorCount + stagger) - floorIndex;
  const normalized = clamp01(raw / stagger);
  return normalized * normalized * (3 - 2 * normalized);
}

function toWallStackUrl(fileName) {
  return fileName.startsWith("/") ? fileName : `/${fileName}`;
}

export function normalizeWallStackFloorKey(floorId) {
  if (floorId === "all" || floorId === "F-ALL") {
    return "F-ALL";
  }

  if (typeof floorId === "string" && /^F\d+$/.test(floorId)) {
    return floorId;
  }

  const numericFloorId = Number(floorId);
  if (!Number.isFinite(numericFloorId)) {
    return null;
  }

  return `F${numericFloorId === -1 ? 0 : numericFloorId}`;
}

export function getVisibleWallStackKeys({
  activeFloor,
  selectedFloor,
  selectedFloors = [],
  wallStackConfig = stackedWallConfig,
} = {}) {
  if ((selectedFloors?.length ?? 0) > 0) {
    return [];
  }

  const floorKey = normalizeWallStackFloorKey(activeFloor ?? selectedFloor);
  if (floorKey === "F-ALL") {
    return Object.keys(wallStackConfig);
  }

  return [];
}

export function useStackedWallLayer({
  activeFloor,
  selectedFloor,
  selectedFloors = [],
  wallStackConfig = stackedWallConfig,
  enabled = true,
  presentation = {},
} = {}) {
  const [wallDataByFloor, setWallDataByFloor] = useState({});

  useEffect(() => {
    if (!enabled) {
      setWallDataByFloor({});
      return undefined;
    }

    let cancelled = false;

    const loadStackedWalls = async () => {
      const wallEntries = await Promise.all(
        Object.entries(wallStackConfig).map(async ([floorKey, fileName]) => {
          const url = toWallStackUrl(fileName);
          try {
            return [floorKey, await loadWallData(url)];
          } catch (error) {
            if (error.name !== "AbortError") {
              console.warn(
                `[StackedWallLayer] Stacked wall unavailable for ${floorKey}.`,
                error,
              );
            }

            return null;
          }
        }),
      );

      if (!cancelled) {
        const nextWallDataByFloor = {};
        for (const entry of wallEntries) {
          if (entry) {
            const [floorKey, data] = entry;
            nextWallDataByFloor[floorKey] = data;
          }
        }

        setWallDataByFloor(nextWallDataByFloor);
      }
    };

    loadStackedWalls();

    return () => { cancelled = true; };
  }, [enabled, wallStackConfig]);

  const { revealProgress, initialRevealActive } = presentation;
  return useMemo(() => {
    if (!enabled) {
      return [];
    }

    const visibleFloorKeys = getVisibleWallStackKeys({
      activeFloor,
      selectedFloor,
      selectedFloors,
      wallStackConfig,
    });

    return visibleFloorKeys.flatMap((floorKey) => {
      const wallData = wallDataByFloor[floorKey];
      if (!wallData) {
        return [];
      }

      const wallRevealProgress = getStackedWallRevealProgress({
        floorKey,
        visibleFloorKeys,
        revealProgress,
        initialRevealActive,
      });

      return getCachedWallMeshes(wallData).map((wall, index) => (
        new SimpleMeshLayer({
          id: `building-stacked-wall-${floorKey}-${wall.id}-${index}`,
          data: [{ ...revealWallMesh(wall, wallRevealProgress), floorKey }],
          mesh: wall.mesh,
          getPosition: (d) => d.origin,
          getColor: (d) => [
            d.color[0],
            d.color[1],
            d.color[2],
            Math.round((d.color[3] ?? 255) * d.revealProgress),
          ],
          getScale: [1, 1, wallRevealProgress],
          getOrientation: [0, 0, 0],
          getTranslation: [0, 0, wall.bottom * (1 - wallRevealProgress)],
          sizeScale: 1,
          pickable: false,
          wireframe: false,
          material: STACKED_WALL_MATERIAL,
          parameters: {
            cull: false,
            depthTest: true,
            depthMask: true,
          },
        })
      ));
    });
  }, [
    activeFloor,
    enabled,
    revealProgress,
    initialRevealActive,
    selectedFloor,
    selectedFloors,
    wallDataByFloor,
    wallStackConfig,
  ]);
}
