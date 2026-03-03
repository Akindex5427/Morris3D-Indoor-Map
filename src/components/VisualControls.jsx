import React, { useState } from "react";
import { BASEMAP_STYLES } from "./Map3D";

const VisualControls = ({
  lightingEnabled,
  setLightingEnabled,
  translucency,
  setTranslucency,
  heightExaggeration,
  setHeightExaggeration,
  basemapStyle,
  setBasemapStyle,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`visual-controls floating ${collapsed ? "collapsed" : ""}`}>
      <div className="vc-header">
        <button
          className="vc-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={
            collapsed ? "Open visual controls" : "Close visual controls"
          }
        >
          {collapsed ? "Open" : "Visual"}
        </button>
        {!collapsed && (
          <button
            className="vc-close"
            onClick={() => setCollapsed(true)}
            aria-label="Hide visual controls"
          >
            &times;
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="vc-body">
          <div className="control-row">
            <label>
              Basemap Style:
              <select
                value={basemapStyle}
                onChange={(e) => setBasemapStyle(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.4rem",
                  marginTop: "0.3rem",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                  fontSize: "0.9rem",
                }}
              >
                {Object.entries(BASEMAP_STYLES).map(([key, style]) => (
                  <option key={key} value={key}>
                    {style.name} - {style.description}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="control-row">
            <label>
              <input
                type="checkbox"
                checked={lightingEnabled}
                onChange={(e) => setLightingEnabled(e.target.checked)}
              />
              Enable Lighting
            </label>
          </div>

          <div className="control-row">
            <label>
              Translucency: {translucency}%
              <input
                type="range"
                min={10}
                max={100}
                value={translucency}
                onChange={(e) => setTranslucency(parseInt(e.target.value, 10))}
              />
            </label>
          </div>
          <div className="control-row">
            <label>
              Height Exaggeration: {heightExaggeration}x
              <input
                type="range"
                min={0.5}
                max={6}
                step={0.1}
                value={heightExaggeration}
                onChange={(e) =>
                  setHeightExaggeration(parseFloat(e.target.value))
                }
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

export default VisualControls;
