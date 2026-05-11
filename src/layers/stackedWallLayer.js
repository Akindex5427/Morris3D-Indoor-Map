import { useEffect, useMemo, useState } from "react";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { buildWallMeshes } from "../utils/wallGeometry";

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

    const controller = new AbortController();

    const loadStackedWalls = async () => {
      const wallEntries = await Promise.all(
        Object.entries(wallStackConfig).map(async ([floorKey, fileName]) => {
          const url = toWallStackUrl(fileName);
          try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) {
              throw new Error(`Failed to load ${url}`);
            }

            return [floorKey, await response.json()];
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

      if (!controller.signal.aborted) {
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

    return () => controller.abort();
  }, [enabled, wallStackConfig]);

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
        revealProgress: presentation.revealProgress,
        initialRevealActive: presentation.initialRevealActive,
      });

      return buildWallMeshes(wallData, {
        getRevealProgress: () => wallRevealProgress,
      }).map((wall, index) => (
        new SimpleMeshLayer({
          id: `building-stacked-wall-${floorKey}-${wall.id}-${index}`,
          data: [{ ...wall, floorKey }],
          mesh: wall.mesh,
          getPosition: (d) => d.origin,
          getColor: (d) => [
            d.color[0],
            d.color[1],
            d.color[2],
            Math.round((d.color[3] ?? 255) * d.revealProgress),
          ],
          getScale: [1, 1, 1],
          getOrientation: [0, 0, 0],
          getTranslation: [0, 0, 0],
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
    presentation,
    selectedFloor,
    selectedFloors,
    wallDataByFloor,
    wallStackConfig,
  ]);
}
