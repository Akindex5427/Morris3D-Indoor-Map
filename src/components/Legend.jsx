import React from "react";

const Legend = ({ selectedFloor, selectedFloors, translucency }) => {
  const floors =
    selectedFloors && selectedFloors.length > 0
      ? selectedFloors
      : [selectedFloor];
  const displayFloors = floors && floors.length > 0 ? floors.join(", ") : "All";

  return (
    <div className="visual-legend">
      <div className="legend-title">Map Legend</div>
      <div className="legend-row">
        <strong>Selected Floors:</strong>
        <span>{displayFloors}</span>
      </div>
      <div className="legend-row">
        <strong>Translucency:</strong>
        <span>{translucency}%</span>
      </div>
    </div>
  );
};

export default Legend;
