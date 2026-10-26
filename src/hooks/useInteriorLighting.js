import { useEffect, useMemo, useSyncExternalStore } from "react";
import { selectVisibleLights } from "../utils/interiorLighting";
import { interiorLightResources } from "../utils/interiorLightResources";

export async function loadInteriorLights() {
  const snapshot = await interiorLightResources.prepare(true);
  if (snapshot.error) throw new Error(snapshot.error);
  return snapshot.anchors;
}
const retry = () => interiorLightResources.prepare(true);

export function useInteriorLighting(nightMode, floors, retrySignal = nightMode) {
  const snapshot = useSyncExternalStore(interiorLightResources.subscribe, interiorLightResources.getSnapshot);
  useEffect(() => {
    if (!nightMode) return;
    interiorLightResources.prepare();
  }, [nightMode, retrySignal]);
  const visibleLights = useMemo(() => selectVisibleLights(snapshot.anchors, floors), [snapshot.anchors, floors]);
  return { ...snapshot, visibleLights, retry };
}
