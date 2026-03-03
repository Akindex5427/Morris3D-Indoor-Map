import React, { useState, useMemo } from "react";
import "./RoutePlanner.css";

const RoutePlanner = ({
  rooms,
  onRouteCalculate,
  onClose,
  selectedFloors = [],
}) => {
  const [startRoom, setStartRoom] = useState("");
  const [endRoom, setEndRoom] = useState("");
  const [selectedFloor, setSelectedFloor] = useState("");
  const [startSuggestions, setStartSuggestions] = useState([]);
  const [endSuggestions, setEndSuggestions] = useState([]);
  const [showStartSuggestions, setShowStartSuggestions] = useState(false);
  const [showEndSuggestions, setShowEndSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [useCurrentLocation, setUseCurrentLocation] = useState(false);
  const [routePreferences, setRoutePreferences] = useState("shortest"); // "shortest" or "stairs_first"
  const [accessibility, setAccessibility] = useState("standard"); // "standard", "wheelchair", "stairs_avoid"
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recentDestinations, setRecentDestinations] = useState([]);

  // Get room name/ID for display
  const getRoomName = (room) => {
    return (
      room.properties?.name ||
      room.properties?.id ||
      room.properties?.room_id ||
      "Unnamed Room"
    );
  };

  // Get room floor
  const getRoomFloor = (room) => {
    return (
      room.properties?.floor ||
      room.properties?.nivel ||
      room.properties?.level ||
      0
    );
  };

  // Get available floors from rooms
  const availableFloors = useMemo(() => {
    const floorSet = new Set(rooms.map((r) => getRoomFloor(r)));
    return Array.from(floorSet).sort((a, b) => a - b);
  }, [rooms]);

  // Filter rooms based on search input and optional floor
  const filterRooms = (searchText, filterFloor = null) => {
    if (!searchText || searchText.length < 1) return [];

    const lowerSearch = searchText.toLowerCase();
    return rooms
      .filter((room) => {
        // If a floor is selected, only show rooms on that floor
        if (filterFloor !== null && getRoomFloor(room) !== filterFloor) {
          return false;
        }
        const name = getRoomName(room).toLowerCase();
        const roomType = (
          room.properties?.type ||
          room.properties?.tipo ||
          ""
        ).toLowerCase();
        return name.includes(lowerSearch) || roomType.includes(lowerSearch);
      })
      .slice(0, 10);
  };

  // Handle start room input
  const handleStartChange = (e) => {
    const value = e.target.value;
    setStartRoom(value);
    const floorFilter = selectedFloor ? parseInt(selectedFloor) : null;
    setStartSuggestions(filterRooms(value, floorFilter));
    setShowStartSuggestions(true);
  };

  // Handle end room input
  const handleEndChange = (e) => {
    const value = e.target.value;
    setEndRoom(value);
    const floorFilter = selectedFloor ? parseInt(selectedFloor) : null;
    setEndSuggestions(filterRooms(value, floorFilter));
    setShowEndSuggestions(true);
  };

  // Handle floor selection
  const handleFloorChange = (e) => {
    setSelectedFloor(e.target.value);
    // Clear previous suggestions when floor changes
    setStartRoom("");
    setEndRoom("");
    setStartSuggestions([]);
    setEndSuggestions([]);
  };

  // Select start room
  const selectStartRoom = (room) => {
    setStartRoom(getRoomName(room));
    setShowStartSuggestions(false);
  };

  // Select end room
  const selectEndRoom = (room) => {
    setEndRoom(getRoomName(room));
    setShowEndSuggestions(false);
  };

  // Set current location
  const setCurrentLocationHandler = (room) => {
    setCurrentLocation(room);
    setStartRoom(getRoomName(room));
    setUseCurrentLocation(true);
    setShowStartSuggestions(false);
  };

  // Calculate route
  const handleCalculateRoute = () => {
    // Find room objects
    const startRoomObj = useCurrentLocation
      ? currentLocation
      : rooms.find(
          (r) => getRoomName(r).toLowerCase() === startRoom.toLowerCase(),
        );

    const endRoomObj = rooms.find(
      (r) => getRoomName(r).toLowerCase() === endRoom.toLowerCase(),
    );

    if (!startRoomObj || !endRoomObj) {
      alert("Please select valid start and end rooms");
      return;
    }

    // Check if rooms are on the same floor when a floor is selected
    if (selectedFloor) {
      const floorNum = parseInt(selectedFloor);
      if (
        getRoomFloor(startRoomObj) !== floorNum ||
        getRoomFloor(endRoomObj) !== floorNum
      ) {
        alert(`Both rooms must be on Floor ${floorNum}`);
        return;
      }
    }

    setIsSearching(true);

    // Add to recent destinations
    const destName = getRoomName(endRoomObj);
    setRecentDestinations((prev) =>
      [destName, ...prev.filter((d) => d !== destName)].slice(0, 5),
    );

    // Use setTimeout to prevent UI blocking during route calculation
    setTimeout(() => {
      onRouteCalculate(
        startRoomObj,
        endRoomObj,
        selectedFloor ? parseInt(selectedFloor) : null,
        {
          preferences: routePreferences,
          accessibility,
        },
      );
      setIsSearching(false);
    }, 0);
  };

  // Clear route
  const handleClearRoute = () => {
    setStartRoom("");
    setEndRoom("");
    onRouteCalculate(null, null);
  };

  return (
    <div className="route-planner-overlay">
      <div className="route-planner">
        <div className="route-header">
          <h3>🗺️ Route Planner</h3>
          <button
            className="close-btn"
            onClick={onClose}
            aria-label="Close route planner"
          >
            &times;
          </button>
        </div>

        <div className="route-body">
          {/* Floor selection when multiple floors available */}
          {availableFloors.length > 1 && (
            <div className="route-input-group">
              <label>Select Floor (Optional)</label>
              <select
                className="route-input"
                value={selectedFloor}
                onChange={handleFloorChange}
              >
                <option value="">All Floors</option>
                {availableFloors.map((floor) => (
                  <option key={floor} value={floor}>
                    Floor {floor}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="route-input-group">
            <label>
              Start Room{" "}
              {useCurrentLocation && (
                <span className="current-location-indicator">
                  📍 Current Location
                </span>
              )}
            </label>
            <div className="route-input-wrapper">
              <input
                type="text"
                className="route-input"
                placeholder="Search start room..."
                value={startRoom}
                onChange={handleStartChange}
                onFocus={() => setShowStartSuggestions(true)}
              />
              {showStartSuggestions && startSuggestions.length > 0 && (
                <div className="route-suggestions">
                  {startSuggestions.map((room, idx) => (
                    <div key={idx} className="route-suggestion-item">
                      <div
                        onClick={() => selectStartRoom(room)}
                        style={{ cursor: "pointer", flex: 1 }}
                      >
                        <div className="route-suggestion-name">
                          {getRoomName(room)}
                        </div>
                        <div className="route-suggestion-meta">
                          Floor {getRoomFloor(room)} |{" "}
                          {room.properties?.type ||
                            room.properties?.tipo ||
                            "Room"}
                        </div>
                      </div>
                      <button
                        className="set-current-btn"
                        onClick={() => setCurrentLocationHandler(room)}
                        title="Set as current location"
                      >
                        📍
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="route-input-group">
            <label>End Room</label>
            <div className="route-input-wrapper">
              <input
                type="text"
                className="route-input"
                placeholder="Search end room..."
                value={endRoom}
                onChange={handleEndChange}
                onFocus={() => setShowEndSuggestions(true)}
              />
              {showEndSuggestions && (
                <div className="route-suggestions">
                  {endSuggestions.length > 0 ? (
                    endSuggestions.map((room, idx) => (
                      <div
                        key={idx}
                        className="route-suggestion-item"
                        onClick={() => selectEndRoom(room)}
                      >
                        <div className="route-suggestion-name">
                          {getRoomName(room)}
                        </div>
                        <div className="route-suggestion-meta">
                          Floor {getRoomFloor(room)} |{" "}
                          {room.properties?.type ||
                            room.properties?.tipo ||
                            "Room"}
                        </div>
                      </div>
                    ))
                  ) : recentDestinations.length > 0 && !endRoom ? (
                    <>
                      <div className="route-suggestions-header">
                        📌 Recent Destinations
                      </div>
                      {recentDestinations.map((dest, idx) => (
                        <div
                          key={idx}
                          className="route-suggestion-item"
                          onClick={() => {
                            setEndRoom(dest);
                            setShowEndSuggestions(false);
                          }}
                        >
                          <div className="route-suggestion-name">{dest}</div>
                        </div>
                      ))}
                    </>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {/* Advanced Options */}
          <div className="advanced-options">
            <button
              className="advanced-toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
              aria-expanded={showAdvanced}
            >
              {showAdvanced ? "▼" : "▶"} Advanced Options
            </button>

            {showAdvanced && (
              <div className="advanced-panel">
                <div className="route-input-group">
                  <label>Route Preference</label>
                  <select
                    className="route-input"
                    value={routePreferences}
                    onChange={(e) => setRoutePreferences(e.target.value)}
                  >
                    <option value="shortest">⚡ Shortest Route</option>
                    <option value="stairs_first">🪜 Prefer Stairs</option>
                    <option value="elevator_first">🛗 Prefer Elevator</option>
                  </select>
                </div>

                <div className="route-input-group">
                  <label>Accessibility</label>
                  <select
                    className="route-input"
                    value={accessibility}
                    onChange={(e) => setAccessibility(e.target.value)}
                  >
                    <option value="standard">Standard</option>
                    <option value="wheelchair">♿ Wheelchair Accessible</option>
                    <option value="stairs_avoid">🚫 Avoid Stairs</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="route-actions">
            <button
              className="btn-primary"
              onClick={handleCalculateRoute}
              disabled={!startRoom || !endRoom || isSearching}
              aria-busy={isSearching}
            >
              {isSearching ? "🔍 Searching..." : "🚀 Find Route"}
            </button>
            <button
              className="btn-secondary"
              onClick={handleClearRoute}
              disabled={isSearching}
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoutePlanner;
