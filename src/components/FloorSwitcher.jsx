import React from "react";

const FloorSwitcher = ({ currentFloor, onFloorChange, availableFloors }) => {
  return (
    <div className="floor-switcher">
      <h3>Floors</h3>
      <div className="floor-buttons">
        {availableFloors.map((floor) => (
          <button
            key={floor}
            className={`floor-btn ${currentFloor === floor ? "active" : ""}`}
            onClick={() => onFloorChange(floor)}
          >
            F{floor === -1 || floor === 0 ? "0" : floor}
          </button>
        ))}
        <button
          key="all"
          className={`floor-btn ${currentFloor === "all" ? "active" : ""}`}
          onClick={() => onFloorChange("all")}
        >
          F-All
        </button>
      </div>
    </div>
  );
};

export default FloorSwitcher;
