import { useEffect, useMemo, useState } from "react";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { getCachedWallMeshes, revealWallMesh } from "../utils/wallGeometry";
import { loadWallData } from "../utils/wallDataCache";

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

  const wallMeshes = getCachedWallMeshes(wallData).map(wall => revealWallMesh(wall, revealProgress));

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
        getScale: [1, 1, revealProgress],
        getOrientation: [0, 0, 0],
        getTranslation: [0, 0, wall.bottom * (1 - revealProgress)],
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

    let cancelled = false;

    const loadPerimeterWall = async () => {
      try {
        const data = await loadWallData(url);
        if (!cancelled) {
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

        if (!cancelled) {
          setWallData(null);
        }
      }
    };

    loadPerimeterWall();

    return () => { cancelled = true; };
  }, [enabled, url]);

  const { revealProgress, initialRevealActive } = presentation;
  return useMemo(() => {
    if (!enabled) {
      return [];
    }

    const layers = createPerimeterWallMeshLayers({ wallData, presentation: { revealProgress, initialRevealActive } });

    if (import.meta.env.DEV && layers.length > 0) {
      const firstWall = layers[0].props.data?.[0];
      console.log("[PerimeterWallLayer] wall mesh created", {
        layerCount: layers.length,
        revealProgress: revealProgress ?? 1,
        currentAnimatedTop: firstWall?.animatedTop ?? null,
        finalWallTop: firstWall?.top ?? null,
      });
    }

    return layers;
  }, [enabled, revealProgress, initialRevealActive, wallData]);
}
