import { useEffect, useMemo, useState } from "react";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { buildWallMeshes } from "../utils/wallGeometry";

export const DEFAULT_PERIMETER_WALL_URL = "/wall.geojson";

const PERIMETER_WALL_MATERIAL = {
  ambient: 0.8,
  diffuse: 0.55,
  shininess: 3,
  specularColor: [70, 70, 70],
};

export function createPerimeterWallMeshLayers({
  wallData,
  idPrefix = "building-perimeter-shell-wall",
  presentation = {},
} = {}) {
  if (!wallData) {
    return [];
  }

  const revealProgress =
    typeof presentation.revealProgress === "number"
      ? Math.max(0, Math.min(1, presentation.revealProgress))
      : 1;
  const initialRevealActive = Boolean(presentation.initialRevealActive);

  const wallMeshes = buildWallMeshes(wallData, {
    getRevealProgress: () => revealProgress,
  });

  if (import.meta.env.DEV) {
    console.log("[PerimeterWallLayer] wall.geojson registered with cinematic reveal", {
      featureCount: wallData.features?.length ?? 0,
      meshCount: wallMeshes.length,
      initialRevealActive,
      revealProgress,
      firstAnimatedTop: wallMeshes[0]?.animatedTop ?? null,
      firstFinalTop: wallMeshes[0]?.top ?? null,
    });
  }

  return wallMeshes.map(
    (wall, index) =>
      new SimpleMeshLayer({
        id: `${idPrefix}-${wall.id}-${index}`,
        data: [wall],
        mesh: wall.mesh,
        getPosition: (d) => d.origin,
        getColor: (d) => d.color,
        getScale: [1, 1, 1],
        getOrientation: [0, 0, 0],
        getTranslation: [0, 0, 0],
        sizeScale: 1,
        pickable: false,
        wireframe: false,
        material: PERIMETER_WALL_MATERIAL,
        parameters: {
          cull: false,
          depthTest: true,
          depthMask: true,
        },
      }),
  );
}

export function usePerimeterWallLayer({
  url = DEFAULT_PERIMETER_WALL_URL,
  enabled = true,
  presentation = {},
} = {}) {
  const [wallData, setWallData] = useState(null);

  useEffect(() => {
    if (!enabled || !url) {
      setWallData(null);
      return undefined;
    }

    const controller = new AbortController();

    const loadPerimeterWall = async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to load ${url}`);
        }

        const data = await response.json();
        if (!controller.signal.aborted) {
          if (import.meta.env.DEV) {
            console.log("[PerimeterWallLayer] wall.geojson loaded", {
              url,
              featureCount: data.features?.length ?? 0,
            });
          }
          setWallData(data);
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          console.warn("[PerimeterWallLayer] Wall layer unavailable.", error);
        }

        if (!controller.signal.aborted) {
          setWallData(null);
        }
      }
    };

    loadPerimeterWall();

    return () => controller.abort();
  }, [enabled, url]);

  return useMemo(() => {
    if (!enabled) {
      return [];
    }

    const layers = createPerimeterWallMeshLayers({ wallData, presentation });

    if (import.meta.env.DEV && layers.length > 0) {
      const firstWall = layers[0].props.data?.[0];
      console.log("[PerimeterWallLayer] wall mesh created", {
        layerCount: layers.length,
        revealProgress: presentation.revealProgress ?? 1,
        currentAnimatedTop: firstWall?.animatedTop ?? null,
        finalWallTop: firstWall?.top ?? null,
      });
    }

    return layers;
  }, [enabled, presentation, wallData]);
}
