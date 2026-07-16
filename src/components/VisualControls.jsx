import React, { useState } from "react";
import { BASEMAP_STYLES } from "./Map3D";

const VisualControls = ({
  lightingEnabled,
  setLightingEnabled,
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
