import { createEnvironmentClock } from './environment';

export const INTERIOR_LIGHT_RAMP_MS = 1200;

// One App-owned clock; subscribers request Deck redraws, not React renders.
// Resources register per map context, so a delayed atlas cannot start the ramp.
export function createInteriorLightActivation(options = {}) {
  const { duration = INTERIOR_LIGHT_RAMP_MS, ...timing } = options;
  const listeners = new Set(), resources = new Set();
  let clock = null, gain = 0, target = null, disposed = false;
  let nightMode = false, fullNight = false, reducedMotion = false, activated = false;
  const emit = () => listeners.forEach(listener => listener());
  const synchronize = () => {
    if (disposed || !clock) return;
    if (!nightMode || !fullNight) activated = false;
    else if (resources.size && [...resources].every(resource => resource.ready)) activated = true;
    // Once lit, a new floor/panel prepares independently; existing panels stay lit.
    const next = nightMode && fullNight && activated ? 1 : 0;
    if (next !== target || reducedMotion) {
      target = next;
      clock.setTarget(next, reducedMotion);
    }
  };
  return {
    getGain: () => gain,
    getStatus: () => ({ nightMode, fullNight, gain, target, resourceCount: resources.size,
      readyCount: [...resources].filter(resource => resource.ready).length }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    register(resource) {
      resources.add(resource); synchronize();
      return () => { resources.delete(resource); synchronize(); };
    },
    resourceChanged: synchronize,
    setEnvironment(state) {
      disposed = false;
      ({ nightMode, fullNight, reducedMotion = false } = state);
      if (!clock) clock = createEnvironmentClock({ ...timing, duration,
        onChange: progress => { gain = progress * progress * (3 - 2 * progress); emit(); } });
      synchronize();
    },
    dispose() {
      disposed = true; clock?.dispose(); clock = null; target = null;
      gain = 0; activated = false; listeners.clear(); resources.clear();
    },
  };
}
