import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_NIGHT_PRESET, NIGHT_PRESETS, NIGHT_PRESET_TRANSITION_MS, interpolateNightTuning,
} from "../utils/nightLightingConfig";

// One bounded animation for all map views. Preset selection and manual tuning
// live above the map so Day Mode and floor changes do not reset the session.
export function useNightPreset(nightMode) {
  const [preset, setPreset] = useState(DEFAULT_NIGHT_PRESET);
  const [targetTuning, setTargetTuning] = useState(NIGHT_PRESETS[DEFAULT_NIGHT_PRESET]);
  const [nightTuning, setNightTuning] = useState(targetTuning);
  const current = useRef(nightTuning);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return undefined;
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion || current.current === targetTuning) {
      current.current = targetTuning;
      setNightTuning(targetTuning);
      return undefined;
    }
    const from = current.current;
    const started = performance.now();
    let frame;
    const animate = now => {
      const progress = Math.min(1, (now - started) / NIGHT_PRESET_TRANSITION_MS);
      current.current = interpolateNightTuning(from, targetTuning, progress);
      setNightTuning(current.current);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [targetTuning, reducedMotion]);

  const selectPreset = useCallback(key => {
    if (!Object.hasOwn(NIGHT_PRESETS, key)) return;
    setPreset(key);
    setTargetTuning(NIGHT_PRESETS[key]);
  }, []);

  return { preset, selectPreset, nightTuning, targetTuning, setTargetTuning };
}
