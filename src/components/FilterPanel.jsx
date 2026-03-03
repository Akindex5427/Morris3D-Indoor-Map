import React, { useState } from "react";

const FilterPanel = ({ rooms, onFilter, onClose }) => {
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedFloors, setSelectedFloors] = useState([]);
  const [areaRange, setAreaRange] = useState([0, 1000]);

  // Extract unique room types and floors from data
  const uniqueTypes = [
    ...new Set(
      rooms.map((r) => r.properties?.tipo || r.properties?.type || "Unknown")
    ),
  ];
  const uniqueFloors = [
    ...new Set(
      rooms.map((r) => r.properties?.floor || r.properties?.nivel || 0)
    ),
  ].sort((a, b) => a - b);

  const handleTypeToggle = (type) => {
    const updated = selectedTypes.includes(type)
      ? selectedTypes.filter((t) => t !== type)
      : [...selectedTypes, type];
    setSelectedTypes(updated);
  };

  const handleFloorToggle = (floor) => {
    const updated = selectedFloors.includes(floor)
      ? selectedFloors.filter((f) => f !== floor)
      : [...selectedFloors, floor];
    setSelectedFloors(updated);
  };

  const handleApplyFilter = () => {
    const filtered = rooms.filter((room) => {
      const roomType =
        room.properties?.tipo || room.properties?.type || "Unknown";
      const roomFloor = room.properties?.floor || room.properties?.nivel || 0;

      const typeMatch =
        selectedTypes.length === 0 || selectedTypes.includes(roomType);
      const floorMatch =
        selectedFloors.length === 0 || selectedFloors.includes(roomFloor);

      return typeMatch && floorMatch;
    });

    const filteredIds = filtered.map(
      (r) => r.properties?.id || r.properties?.name || ""
    );
    // Pass both filtered room ids and the list of selected floors
    onFilter({ roomIds: filteredIds, selectedFloors });
  };

  const handleClearFilters = () => {
    setSelectedTypes([]);
    setSelectedFloors([]);
    setAreaRange([0, 1000]);
    onFilter({ roomIds: [], selectedFloors: [] });
  };

  return (
    <div className="filter-panel-overlay">
      <div className="filter-panel">
        <div className="filter-header">
          <h3>Filter Rooms</h3>
          <button
            className="close-btn"
            onClick={onClose}
            aria-label="Close filter panel"
          >
            &times;
          </button>
        </div>

        <div className="filter-section">
          <h4>Room Types</h4>
          <div className="filter-options">
            {uniqueTypes.map((type) => (
              <label key={type} className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={selectedTypes.includes(type)}
                  onChange={() => handleTypeToggle(type)}
                />
                <span>{type}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="filter-section">
          <h4>Floors</h4>
          <div className="filter-options">
            {uniqueFloors.map((floor) => (
              <label key={floor} className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={selectedFloors.includes(floor)}
                  onChange={() => handleFloorToggle(floor)}
                />
                <span>{floor === -1 ? "Basement" : `Floor ${floor}`}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="filter-actions">
          <button className="btn-primary" onClick={handleApplyFilter}>
            Apply Filter
          </button>
          <button className="btn-secondary" onClick={handleClearFilters}>
            Clear All
          </button>
        </div>
      </div>
    </div>
  );
};

export default FilterPanel;
