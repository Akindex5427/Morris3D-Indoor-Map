import React, { useState } from "react";

const FilterPanel = ({ rooms, onFilter, onClose }) => {
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedFloors, setSelectedFloors] = useState([]);
  const [areaRange, setAreaRange] = useState([0, 1000]);

  const uniqueTypes = [
    ...new Set(
      rooms.map((room) => room.properties?.tipo || room.properties?.type || "Unknown"),
    ),
  ];
  const uniqueFloors = [
    ...new Set(
      rooms.map(
        (room) =>
          room.properties?.floor ??
          room.properties?.nivel ??
          room.properties?.level ??
          0,
      ),
    ),
  ].sort((a, b) => a - b);

  const handleTypeToggle = (type) => {
    const updated = selectedTypes.includes(type)
      ? selectedTypes.filter((value) => value !== type)
      : [...selectedTypes, type];
    setSelectedTypes(updated);
  };

  const handleFloorToggle = (floor) => {
    const updated = selectedFloors.includes(floor)
      ? selectedFloors.filter((value) => value !== floor)
      : [...selectedFloors, floor];
    setSelectedFloors(updated);
  };

  const handleApplyFilter = () => {
    const filtered = rooms.filter((room) => {
      const roomType =
        room.properties?.tipo || room.properties?.type || "Unknown";
      const normalizedRoomFloor =
        room.properties?.floor ??
        room.properties?.nivel ??
        room.properties?.level ??
        0;

      const typeMatch =
        selectedTypes.length === 0 || selectedTypes.includes(roomType);
      const floorMatch =
        selectedFloors.length === 0 ||
        selectedFloors.includes(normalizedRoomFloor);

      return typeMatch && floorMatch;
    });

    const filteredIds = filtered.map(
      (room) => room.properties?.id || room.properties?.name || "",
    );
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
            className="filter-close-btn"
            onClick={onClose}
            aria-label="Close filter panel"
          >
            x
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
