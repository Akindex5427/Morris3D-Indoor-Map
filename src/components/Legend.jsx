import React from "react";

const Legend = ({ selectedFloor, selectedFloors, translucency }) => {
  const floors =
    selectedFloors && selectedFloors.length > 0
      ? selectedFloors
      : [selectedFloor];
  const displayFloors =
    floors && floors.length > 0
      ? floors
          .map((floor) =>
            floor === "all"
              ? "All Floors"
              : floor === -1 || floor === 0
                ? "F0"
                : `F${floor}`,
          )
          .join(", ")
      : "All Floors";

  return (
    <div className="visual-legend">
      <div className="legend-header">
        <div className="legend-title">Map legend</div>
        <div className="legend-subtitle">Current display state</div>
      </div>
      <div className="legend-row">
        <span className="legend-label">Selected floors</span>
        <span className="legend-value">{displayFloors}</span>
      </div>
      <div className="legend-row">
        <span className="legend-label">Translucency</span>
        <span className="legend-value">{translucency}%</span>
      </div>
    </div>
  );
};

export default Legend;
