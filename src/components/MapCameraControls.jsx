import React from "react";
import { MIN_MAP_ZOOM, MAX_MAP_ZOOM, clampMapZoom } from "../utils/buildingCamera";

export default function MapCameraControls({ zoom, onZoom, onFit }) {
  const value = clampMapZoom(zoom);
  return (
    <div className="map-camera-controls" role="group" aria-label="Map navigation"
      onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <button type="button" className="map-zoom-button" aria-label="Zoom in" title="Zoom in (+)"
        disabled={value >= MAX_MAP_ZOOM} onClick={() => onZoom(value + 0.5)}>+</button>
      <input className="map-zoom-slider" type="range" aria-label="Map zoom" aria-orientation="vertical"
        aria-valuetext={`Zoom ${value.toFixed(1)}`} min={MIN_MAP_ZOOM} max={MAX_MAP_ZOOM} step="0.01"
        value={value} onChange={event => onZoom(Number(event.target.value))} />
      <button type="button" className="map-zoom-button" aria-label="Zoom out" title="Zoom out (−)"
        disabled={value <= MIN_MAP_ZOOM} onClick={() => onZoom(value - 0.5)}>−</button>
      <button type="button" className="map-fit-building-button" aria-label="Fit building / Reset view"
        title="Fit current floor or all floors (R)" onClick={onFit}>Fit<br />Building</button>
    </div>
  );
}
