import React, { useState } from "react";
import { BASEMAP_STYLES } from "./Map3D";
import { NIGHT_PRESET_LABELS } from "../utils/nightLightingConfig";

const VisualControls = ({
  roomColorMode = "original",
  setRoomColorMode,
  roomFunctionAvailable = false,
  lightingEnabled,
  setLightingEnabled,
  nightMode = false,
  setNightMode,
  nightPreset = "architectural",
  setNightPreset,
  nightTuning,
  setNightTuning,
  roomFillOpacity,
  setRoomFillOpacity,
  roomWallOpacity,
  setRoomWallOpacity,
  roomWallThicknessMeters,
  setRoomWallThicknessMeters,
  basemapStyle,
  setBasemapStyle,
  cinematicAnimationsEnabled = true,
  setCinematicAnimationsEnabled,
  onReplayInitialReveal,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const handleRoomFillOpacityChange = (event) => {
    setRoomFillOpacity(parseInt(event.target.value, 10));
  };
  const handleRoomWallOpacityChange = (event) => {
    setRoomWallOpacity(parseInt(event.target.value, 10));
  };
  const handleRoomWallThicknessChange = (event) => {
    setRoomWallThicknessMeters(parseFloat(event.target.value));
  };
  const handleAnimationToggle = (event) => {
    setCinematicAnimationsEnabled?.(event.target.checked);
  };

  return (
    <div className={`visual-controls ${collapsed ? "collapsed" : ""}`}>
      <div className="vc-header">
        <div className="vc-heading">
          <span className="vc-kicker">Display</span>
          {!collapsed && <strong>Visual settings</strong>}
        </div>
        <div className="vc-actions">
          <button
            className="vc-toggle"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={
              collapsed ? "Open display settings" : "Collapse display settings"
            }
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="vc-body">
          <div className="control-row">
            <label className="control-label" htmlFor="room-color-mode">Room colors</label>
            <select id="room-color-mode" className="control-select" value={roomColorMode}
              aria-describedby="room-color-description"
              onChange={event => setRoomColorMode(event.target.value)}>
              <option value="original">Original Colors</option>
              <option value="function" disabled={!roomFunctionAvailable}>
                Room Function{roomFunctionAvailable ? "" : " (unavailable)"}
              </option>
              <option value="uniform">Uniform Color</option>
            </select>
            <p id="room-color-description" className="room-color-description">
              {roomColorMode === "original" ? "Existing source colors and display defaults; function meanings are unverified."
                : roomColorMode === "uniform" ? "Neutral rooms with selection and route colors preserved."
                : "Verified functions; unmapped features remain neutral. The legend shows categories in this view."}
              {!roomFunctionAvailable && " Room Function is unavailable: no verified room-purpose classifications have been supplied."}
            </p>
          </div>
          <div className="control-row">
            <label className="control-toggle" htmlFor="night-mode-toggle">
              <span>Night mode</span>
              <input id="night-mode-toggle" type="checkbox" checked={nightMode}
                onChange={(event) => setNightMode(event.target.checked)} />
            </label>
          </div>
          {nightMode && setNightPreset && (
            <fieldset className="night-preset-selector">
              <legend>Visualization style</legend>
              <div className="night-preset-options">
                {Object.entries(NIGHT_PRESET_LABELS).map(([key, label]) => (
                  <label className="night-preset-option" key={key}>
                    <input type="radio" name="night-visualization-style" value={key}
                      checked={nightPreset === key} onChange={() => setNightPreset(key)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <p>{nightPreset === "gis" ? "Clear room colors and restrained lighting." : "Warm interiors and soft architectural glow."}</p>
            </fieldset>
          )}
          {nightMode && nightTuning && setNightTuning && (
            <details className="night-lighting-controls">
              <summary>Night lighting</summary>
              {[
                ["warmth", "Warmth", 1],
                ["glowStrength", "Glow strength", 1],
                ["surfaceIlluminationStrength", "Interior illumination", 2],
                ["nightEnvelopeOpacity", "Exterior transparency", 1],
              ].map(([key, label, max]) => {
                const inverse = key === "nightEnvelopeOpacity";
                const value = inverse ? 1 - nightTuning[key] : nightTuning[key];
                return <div className="control-row" key={key}>
                  <label className="control-label" htmlFor={`night-${key}`}>
                    <span className="control-label-row"><span>{label}</span>
                      <strong className="control-value">{Math.round(value * 100)}%</strong></span>
                  </label>
                  <input id={`night-${key}`} className="control-range" type="range"
                    min={0} max={max} step={0.01} value={value}
                    onChange={event => {
                      const next = Number(event.target.value);
                      setNightTuning(current => ({ ...current, [key]: inverse ? 1 - next : next }));
                    }} />
                </div>;
              })}
            </details>
          )}
          <div className="control-row">
            <label className="control-label" htmlFor="basemap-style-select">
              <span>Basemap style</span>
            </label>
            <select
              id="basemap-style-select"
              className="control-select"
              value={basemapStyle}
              onChange={(e) => setBasemapStyle(e.target.value)}
            >
              {Object.entries(BASEMAP_STYLES).map(([key, style]) => (
                <option key={key} value={key}>
                  {style.name} - {style.description}
                </option>
              ))}
            </select>
          </div>

          <div className="control-row">
            <label className="control-toggle" htmlFor="lighting-toggle">
              <span>Enable lighting</span>
              <input
                id="lighting-toggle"
                type="checkbox"
                checked={lightingEnabled}
                onChange={(e) => setLightingEnabled(e.target.checked)}
              />
            </label>
          </div>

          <details className="day-lighting-controls">
            <summary>Day lighting settings</summary>
            <div className="control-row">
              <label className="control-label" htmlFor="room-fill-opacity-range">
                <span className="control-label-row">
                  <span>Room fill opacity</span>
                  <strong className="control-value">{roomFillOpacity}%</strong>
                </span>
              </label>
              <input
                id="room-fill-opacity-range"
                className="control-range"
                type="range"
                min={0}
                max={100}
                value={roomFillOpacity}
                onInput={handleRoomFillOpacityChange}
                onChange={handleRoomFillOpacityChange}
              />
            </div>

            <div className="control-row">
              <label className="control-label" htmlFor="room-wall-opacity-range">
                <span className="control-label-row">
                  <span>Interior wall opacity</span>
                  <strong className="control-value">{roomWallOpacity}%</strong>
                </span>
              </label>
              <input
                id="room-wall-opacity-range"
                className="control-range"
                type="range"
                min={0}
                max={100}
                value={roomWallOpacity}
                onInput={handleRoomWallOpacityChange}
                onChange={handleRoomWallOpacityChange}
              />
            </div>

            <div className="control-row">
              <label className="control-label" htmlFor="room-wall-thickness-range">
                <span className="control-label-row">
                  <span>Interior wall thickness</span>
                  <strong className="control-value">
                    {roomWallThicknessMeters.toFixed(2)} m
                  </strong>
                </span>
              </label>
              <input
                id="room-wall-thickness-range"
                className="control-range"
                type="range"
                min={0.05}
                max={0.3}
                step={0.01}
                value={roomWallThicknessMeters}
                onInput={handleRoomWallThicknessChange}
                onChange={handleRoomWallThicknessChange}
              />
            </div>
          </details>

          <div className="control-row control-row-inline">
            <label className="control-checkbox-label" htmlFor="animation-toggle">
              <input
                id="animation-toggle"
                type="checkbox"
                checked={cinematicAnimationsEnabled}
                onChange={handleAnimationToggle}
              />
              <span>Cinematic animation</span>
            </label>
            <button
              type="button"
              className="control-action-button"
              onClick={onReplayInitialReveal}
              disabled={!cinematicAnimationsEnabled}
            >
              Replay
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default VisualControls;
