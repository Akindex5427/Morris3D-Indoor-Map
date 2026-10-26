import { useEffect, useRef, useState } from 'react';
import { createInteriorLightActivation } from '../utils/interiorLightActivation';
import { interiorLightResources } from '../utils/interiorLightResources';

export function useInteriorLightActivation(nightMode, fullNight, enabled = true) {
  const [controller] = useState(() => createInteriorLightActivation());
  const state = useRef({ nightMode, fullNight });
  state.current = { nightMode, fullNight };
  // The owning Night request may retry a failure. Mounting/changing route panels
  // only subscribes to the same attempt; it must not create a retry storm.
  useEffect(() => {
    if (enabled && nightMode) interiorLightResources.prepare(true);
  }, [enabled, nightMode]);
  useEffect(() => {
    if (!enabled) return;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => controller.setEnvironment({ ...state.current, reducedMotion: Boolean(motion?.matches) });
    update(); motion?.addEventListener('change', update);
    return () => { motion?.removeEventListener('change', update); controller.dispose(); };
  }, [controller, enabled]);
  useEffect(() => {
    if (!enabled) return;
    controller.setEnvironment({ nightMode, fullNight,
      reducedMotion: Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) });
  }, [controller, nightMode, fullNight, enabled]);
  return controller;
}
