import { useEffect, useMemo, useRef, useState } from 'react';
import { createEnvironmentClock, sampleEnvironment } from '../utils/environment';

// Owned by App, never by a floor/panel. Neither camera nor preset is an input.
export function useEnvironmentController(nightMode) {
  const [progress, setProgress] = useState(nightMode ? 1 : 0);
  const clock = useRef(null);
  const current = useRef(progress);
  const target = useRef(nightMode);
  target.current = nightMode;
  useEffect(() => {
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const controller = createEnvironmentClock({ initial: current.current,
      onChange: value => { current.current = value; setProgress(value); } });
    clock.current = controller;
    const update = () => controller.setTarget(target.current ? 1 : 0, motion?.matches);
    update();
    motion?.addEventListener('change', update);
    return () => { motion?.removeEventListener('change', update); controller.dispose(); clock.current = null; };
  }, []);
  useEffect(() => {
    clock.current?.setTarget(nightMode ? 1 : 0,
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }, [nightMode]);
  return useMemo(() => sampleEnvironment(progress), [progress]);
}
