// One reversible clock; appearance is a pure function of its scalar progress.
export const ENVIRONMENT_DURATION_MS = 8000;
export const clampProgress = value => Math.max(0, Math.min(1, Number(value) || 0));
export const mixValue = (a, b, t) => Array.isArray(a)
  ? a.map((v, i) => mixValue(v, b[i], t)) : a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
export const ENVIRONMENT_KEYFRAMES = [
  { at: 0, basemapWeights: [1,0,0,0], ambientColor: [255,255,255], ambient: 1, sunColor: [255,255,255], sun: 1,
    direction: [-1,-1,-2], exposure: 1, surfaceNight: 0, fixtures: 0, sky: [235,241,245] },
  { at: .36, basemapWeights: [0,1,0,0], ambientColor: [255,213,172], ambient: .95, sunColor: [255,156,72], sun: 1.25,
    direction: [-3,-1,-.35], exposure: 1.08, surfaceNight: .04, fixtures: 0, sky: [223,165,116] },
  { at: .7, basemapWeights: [0,0,1,0], ambientColor: [112,151,231], ambient: .62, sunColor: [151,173,255], sun: .28,
    direction: [-3,1,-.08], exposure: .85, surfaceNight: .55, fixtures: 0, sky: [43,66,110] },
  { at: 1, basemapWeights: [0,0,0,1], ambientColor: [140,162,202], ambient: .5, sunColor: [163,185,223], sun: .18,
    direction: [1,1,-1], exposure: .75, surfaceNight: 1, fixtures: 1, sky: [8,15,28] },
];
export function sampleEnvironment(progress, frames = ENVIRONMENT_KEYFRAMES) {
  const p = clampProgress(progress);
  const index = Math.max(1, frames.findIndex(frame => frame.at >= p));
  const a = frames[index - 1], b = frames[index];
  const t = smooth(clampProgress((p - a.at) / (b.at - a.at)));
  const result = { progress: p, fullNight: p === 1 };
  for (const key of Object.keys(a)) if (key !== 'at') result[key] = mixValue(a[key], b[key], t);
  const length = Math.hypot(...result.direction);
  result.direction = result.direction.map(value => value / length);
  return result;
}
export const DAY_ENVIRONMENT = sampleEnvironment(0);
export const NIGHT_ENVIRONMENT = sampleEnvironment(1);

export function createEnvironmentClock({ initial = 0, duration = ENVIRONMENT_DURATION_MS,
  now = () => performance.now(), request = callback => requestAnimationFrame(callback),
  cancel = id => cancelAnimationFrame(id), onChange }) {
  let progress = clampProgress(initial), target = progress, origin = progress, started = now();
  let frame = null, disposed = false;
  const read = time => clampProgress(origin + Math.sign(target - origin) *
    Math.min(Math.abs(target - origin), Math.max(0, time - started) / Math.max(1, duration)));
  const tick = time => {
    frame = null;
    if (disposed) return;
    progress = read(time);
    onChange(progress);
    if (!disposed && progress !== target) frame = request(tick);
  };
  return {
    setTarget(value, reducedMotion = false) {
      if (disposed) return;
      const time = now();
      progress = read(time);
      if (frame !== null) cancel(frame);
      frame = null;
      target = clampProgress(value);
      origin = reducedMotion ? target : progress;
      progress = origin;
      started = time;
      onChange(progress);
      if (!disposed && progress !== target) frame = request(tick);
    },
    getProgress: () => progress,
    dispose() { disposed = true; if (frame !== null) cancel(frame); frame = null; },
  };
}
