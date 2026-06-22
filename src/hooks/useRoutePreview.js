/**
 * useRoutePreview
 *
 * Animates a cursor along the computed indoor route polyline.
 * Uses haversine arc-length so the cursor moves at a constant real-world speed
 * regardless of coordinate density along the path.
 *
 * Works with both single-floor and multi-floor renderPath arrays —
 * each point carries a `floor` property that drives 3-D elevation in Map3D.
 *
 * Public API:
 *   isPlaying          – animation is running
 *   progressFraction   – 0..1
 *   progressMeters     – current distance travelled
 *   totalMeters        – full route arc length
 *   cursorPosition     – { coords: [lng, lat], floor } at current progress
 *   traveledPath       – sub-array up to the cursor (same shape as renderPath)
 *   remainingPath      – sub-array from the cursor to end
 *   startPreview()     – reset to 0 and play
 *   stopPreview()      – reset to 0 and pause
 *   togglePlayPause()  – flip playing state
 *   seekTo(fraction)   – jump to 0..1 position; pauses animation
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";

// Default preview speed — roughly 2× comfortable walking pace.
const DEFAULT_SPEED_MS = 3.0;

// ── Geometry helpers ──────────────────────────────────────────────────────────

function haversineMeters(lng1, lat1, lng2, lat2) {
  const R = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const dφ = ((lat2 - lat1) * Math.PI) / 180;
  const dλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Build cumulative haversine distances along the path.
 * Returns { cumulative: number[], total: number }.
 */
function buildPathMetrics(renderPath) {
  if (!Array.isArray(renderPath) || renderPath.length < 2) {
    return { cumulative: [0], total: 0 };
  }

  const cumulative = [0];
  let total = 0;

  for (let i = 1; i < renderPath.length; i++) {
    const [lng0, lat0] = renderPath[i - 1].coords;
    const [lng1, lat1] = renderPath[i].coords;
    total += haversineMeters(lng0, lat0, lng1, lat1);
    cumulative.push(total);
  }

  return { cumulative, total };
}

/**
 * Interpolate a { coords, floor } position at exactly `targetMeters` from start.
 */
function positionAtDistance(renderPath, cumulative, targetMeters) {
  if (!renderPath || renderPath.length < 2) return null;

  const clamped = Math.max(0, Math.min(targetMeters, cumulative[cumulative.length - 1]));

  for (let i = 1; i < cumulative.length; i++) {
    if (clamped <= cumulative[i]) {
      const segLen = cumulative[i] - cumulative[i - 1];
      const t = segLen > 0 ? (clamped - cumulative[i - 1]) / segLen : 0;
      const from = renderPath[i - 1];
      const to = renderPath[i];
      return {
        coords: [
          from.coords[0] + t * (to.coords[0] - from.coords[0]),
          from.coords[1] + t * (to.coords[1] - from.coords[1]),
        ],
        floor: from.floor,
      };
    }
  }

  const last = renderPath[renderPath.length - 1];
  return { coords: last.coords, floor: last.floor };
}

/**
 * Split the polyline at `targetMeters`.
 * Returns { traveled, remaining } — both use the same { coords, floor } shape.
 * An interpolated split point is inserted at the junction so the two halves
 * share their boundary exactly with no gap or overlap.
 */
function splitPath(renderPath, cumulative, targetMeters) {
  if (!renderPath || renderPath.length < 2) {
    return { traveled: [], remaining: renderPath || [] };
  }

  const total = cumulative[cumulative.length - 1];
  const clamped = Math.max(0, Math.min(targetMeters, total));

  if (clamped <= 0) return { traveled: [], remaining: renderPath };
  if (clamped >= total) return { traveled: renderPath, remaining: [] };

  // Find the segment that straddles `clamped`
  let idx = 1;
  while (idx < cumulative.length - 1 && cumulative[idx] < clamped) idx++;

  const segLen = cumulative[idx] - cumulative[idx - 1];
  const t = segLen > 0 ? (clamped - cumulative[idx - 1]) / segLen : 0;
  const from = renderPath[idx - 1];
  const to = renderPath[idx];

  const splitPoint = {
    coords: [
      from.coords[0] + t * (to.coords[0] - from.coords[0]),
      from.coords[1] + t * (to.coords[1] - from.coords[1]),
    ],
    floor: from.floor,
  };

  return {
    traveled: [...renderPath.slice(0, idx), splitPoint],
    remaining: [splitPoint, ...renderPath.slice(idx)],
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useRoutePreview({
  renderPath,
  speedMetersPerSecond = DEFAULT_SPEED_MS,
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progressMeters, setProgressMeters] = useState(0);

  const pathMetrics = useMemo(() => buildPathMetrics(renderPath), [renderPath]);

  // Always-current progress ref — read inside RAF closures to avoid stale capture
  const progressRef = useRef(0);
  progressRef.current = progressMeters;

  // Reset when the source route changes
  useEffect(() => {
    setIsPlaying(false);
    setProgressMeters(0);
  }, [renderPath]);

  // RAF animation loop.
  // capturedStart is read from progressRef.current once when the effect fires
  // (i.e. when isPlaying flips to true), so resume-after-pause picks up correctly.
  useEffect(() => {
    if (!isPlaying || pathMetrics.total <= 0) return;

    const capturedStart = progressRef.current;
    let startTs = null;
    let rafId;

    const frame = (ts) => {
      if (startTs === null) startTs = ts;
      const elapsed = (ts - startTs) / 1000;
      const next = capturedStart + speedMetersPerSecond * elapsed;

      if (next >= pathMetrics.total) {
        setProgressMeters(pathMetrics.total);
        setIsPlaying(false);
        return;
      }

      setProgressMeters(next);
      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, speedMetersPerSecond, pathMetrics.total]);

  // Derived path data — only recomputed when progress changes
  const cursorPosition = useMemo(
    () => positionAtDistance(renderPath, pathMetrics.cumulative, progressMeters),
    [renderPath, pathMetrics, progressMeters],
  );

  const { traveled: traveledPath, remaining: remainingPath } = useMemo(
    () => splitPath(renderPath, pathMetrics.cumulative, progressMeters),
    [renderPath, pathMetrics, progressMeters],
  );

  const progressFraction =
    pathMetrics.total > 0 ? progressMeters / pathMetrics.total : 0;

  // ── Public API ──────────────────────────────────────────────────────────────

  const startPreview = useCallback(() => {
    setProgressMeters(0);
    setIsPlaying(true);
  }, []);

  const stopPreview = useCallback(() => {
    setIsPlaying(false);
    setProgressMeters(0);
  }, []);

  const togglePlayPause = useCallback(() => {
    setIsPlaying((p) => !p);
  }, []);

  // Seeking always pauses so the RAF restarts cleanly from the new position.
  const seekTo = useCallback(
    (fraction) => {
      setIsPlaying(false);
      setProgressMeters(Math.max(0, Math.min(1, fraction)) * pathMetrics.total);
    },
    [pathMetrics.total],
  );

  return {
    isPlaying,
    progressFraction,
    progressMeters,
    totalMeters: pathMetrics.total,
    cursorPosition,
    traveledPath,
    remainingPath,
    startPreview,
    stopPreview,
    togglePlayPause,
    seekTo,
  };
}
