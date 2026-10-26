import { useCallback, useEffect, useRef, useState } from "react";
import { clampMapZoom, fitBuildingCamera } from "../utils/buildingCamera";

// A request is consumed once. Resizes only supply measurements; they never
// create another request or undo subsequent manual camera navigation.
export function useMapCameraNavigation({ containerRef, viewState, onViewStateChange,
  onUserCameraInteraction, fitRequest, onFitComplete, points, getWallPoints,
  ready, competingFocus, orientation }) {
  const [localRequest, setLocalRequest] = useState(null);
  const [size, setSize] = useState(null);
  const latest = useRef(null);
  const consumed = useRef(null);
  const request = localRequest || fitRequest;
  latest.current = { viewState, onViewStateChange, onUserCameraInteraction, onFitComplete, getWallPoints };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer;
    const measure = () => {
      clearTimeout(timer);
      setSize(null);
      timer = setTimeout(() => {
        const { width, height } = container.getBoundingClientRect();
        setSize(previous => previous?.width === width && previous?.height === height ? previous : { width, height });
      }, 120); // Let responsive/sidebar CSS transitions settle before first fit.
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [containerRef]);

  const complete = useCallback((pending) => {
    consumed.current = pending;
    setLocalRequest(null);
    latest.current.onFitComplete?.(pending);
  }, []);

  const manualInteraction = useCallback(() => {
    if (request) complete(request);
    latest.current.onUserCameraInteraction?.();
  }, [request, complete]);

  const zoomTo = useCallback((zoom) => {
    manualInteraction();
    latest.current.onViewStateChange({ ...latest.current.viewState, zoom: clampMapZoom(zoom), transitionDuration: 0 });
  }, [manualInteraction]);

  const fit = useCallback(() => {
    manualInteraction();
    setLocalRequest({ kind: "reset" });
  }, [manualInteraction]);

  useEffect(() => {
    if (!request || consumed.current === request) return;
    if (request.kind === "initial" && competingFocus) { complete(request); return; }
    if (!ready || !size || !points.length) return;
    const controls = containerRef.current.querySelector(".map-camera-controls");
    // The container excludes the header/sidebar. Compare the free rectangles
    // beside and below the controls, so a narrow phone can use its full width.
    const container = containerRef.current.getBoundingClientRect();
    const rail = controls?.getBoundingClientRect();
    const padding = { left: 12, right: 12, top: 12, bottom: 12 };
    const regions = rail ? [
      { ...padding, right: size.width - (rail.left - container.left) + 10 },
      { ...padding, top: rail.bottom - container.top + 10 },
    ] : [padding];
    const fitPoints = [...points, ...latest.current.getWallPoints()];
    const fitted = regions.map(insets => fitBuildingCamera({ points: fitPoints, ...size, insets, orientation }))
      .filter(Boolean).sort((a, b) => b.zoom - a.zoom)[0];
    if (!fitted) return;
    complete(request);
    latest.current.onViewStateChange({ ...latest.current.viewState, ...fitted });
  }, [request, ready, size, points, competingFocus, orientation, containerRef, complete]);

  return { zoomTo, fit, manualInteraction };
}
