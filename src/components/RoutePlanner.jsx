import React, { useEffect, useMemo, useState } from "react";
import "./RoutePlanner.css";

const RoutePlanner = ({
  rooms,
  onRouteCalculate,
  onClearRoute,
  onClose,
  selectedFloors = [],
  activeFloor = "all",
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
  const [routePreferences, setRoutePreferences] = useState("shortest");
  const [accessibility, setAccessibility] = useState("standard");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recentDestinations, setRecentDestinations] = useState([]);

  useEffect(() => {
    if (typeof activeFloor === "number") {
      setSelectedFloor(String(activeFloor));
      return;
    }

    if (activeFloor === "all") {
      setSelectedFloor("");
    }
  }, [activeFloor]);

  const getRoomName = (room) => {
    return (
      room.properties?.name ||
      room.properties?.id ||
      room.properties?.room_id ||
      "Unnamed Room"
    );
  };

  const getRoomFloor = (room) => {
    return (
      room.properties?.floor ||
      room.properties?.nivel ||
      room.properties?.level ||
      0
    );
  };

  const availableFloors = useMemo(() => {
    const floorSet = new Set(rooms.map((room) => getRoomFloor(room)));
    return Array.from(floorSet).sort((a, b) => a - b);
  }, [rooms]);

  const filterRooms = (searchText, filterFloor = null) => {
    if (!searchText || searchText.length < 1) return [];

    const lowerSearch = searchText.toLowerCase();
    return rooms
      .filter((room) => {
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

  const handleStartChange = (e) => {
    const value = e.target.value;
    setStartRoom(value);
    const floorFilter = selectedFloor ? parseInt(selectedFloor, 10) : null;
    setStartSuggestions(filterRooms(value, floorFilter));
    setShowStartSuggestions(true);
  };

  const handleEndChange = (e) => {
    const value = e.target.value;
    setEndRoom(value);
    const floorFilter = selectedFloor ? parseInt(selectedFloor, 10) : null;
    setEndSuggestions(filterRooms(value, floorFilter));
    setShowEndSuggestions(true);
  };

  const handleFloorChange = (e) => {
    setSelectedFloor(e.target.value);
    setStartRoom("");
    setEndRoom("");
    setStartSuggestions([]);
    setEndSuggestions([]);
  };

  const selectStartRoom = (room) => {
    setStartRoom(getRoomName(room));
    setShowStartSuggestions(false);
  };

  const selectEndRoom = (room) => {
    setEndRoom(getRoomName(room));
    setShowEndSuggestions(false);
  };

  const setCurrentLocationHandler = (room) => {
    setCurrentLocation(room);
    setStartRoom(getRoomName(room));
    setUseCurrentLocation(true);
    setShowStartSuggestions(false);
  };

  const handleCalculateRoute = () => {
    const startRoomObj = useCurrentLocation
      ? currentLocation
      : rooms.find(
          (room) => getRoomName(room).toLowerCase() === startRoom.toLowerCase(),
        );

    const endRoomObj = rooms.find(
      (room) => getRoomName(room).toLowerCase() === endRoom.toLowerCase(),
    );

    if (!startRoomObj || !endRoomObj) {
      alert("Please select valid start and end rooms");
      return;
    }

    if (selectedFloor) {
      const floorNum = parseInt(selectedFloor, 10);
      if (
        getRoomFloor(startRoomObj) !== floorNum ||
        getRoomFloor(endRoomObj) !== floorNum
      ) {
        alert(`Both rooms must be on Floor ${floorNum}`);
        return;
      }
    }

    setIsSearching(true);

    const destName = getRoomName(endRoomObj);
    setRecentDestinations((prev) =>
      [destName, ...prev.filter((destination) => destination !== destName)]
        .slice(0, 5),
    );

    setTimeout(() => {
      onRouteCalculate(
        startRoomObj,
        endRoomObj,
        selectedFloor ? parseInt(selectedFloor, 10) : null,
        {
          preferences: routePreferences,
          accessibility,
        },
      );
      setIsSearching(false);
    }, 0);
  };

  const handleClearRoute = () => {
    setStartRoom("");
    setEndRoom("");
    if (onClearRoute) {
      onClearRoute();
    }
  };

  return (
    <div className="route-planner-overlay">
      <div className="route-planner">
        <div className="route-header">
          <div className="route-header-copy">
            <h3>Route Planner</h3>
            <p className="route-subtitle">
              Choose a start and destination room without changing the current
              workflow.
            </p>
          </div>
          <button
            className="route-close-btn"
            onClick={onClose}
            aria-label="Close route planner"
          >
            x
          </button>
        </div>

        <div className="route-body">
          {availableFloors.length > 1 && (
            <div className="route-input-group">
              <label htmlFor="planner-floor-select">Select Floor (Optional)</label>
              <select
                id="planner-floor-select"
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
            <label htmlFor="planner-start-input">
              Start Room{" "}
              {useCurrentLocation && (
                <span className="current-location-indicator">
                  Current location
                </span>
              )}
            </label>
            <div className="route-input-wrapper">
              <input
                id="planner-start-input"
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
                        className="route-suggestion-body"
                        onClick={() => selectStartRoom(room)}
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
                        Current
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="route-input-group">
            <label htmlFor="planner-end-input">End Room</label>
            <div className="route-input-wrapper">
              <input
                id="planner-end-input"
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
                        className="route-suggestion-item route-suggestion-item-clickable"
                        onClick={() => selectEndRoom(room)}
                      >
                        <div className="route-suggestion-body">
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
                      </div>
                    ))
                  ) : recentDestinations.length > 0 && !endRoom ? (
                    <>
                      <div className="route-suggestions-header">
                        Recent Destinations
                      </div>
                      {recentDestinations.map((destination, idx) => (
                        <div
                          key={idx}
                          className="route-suggestion-item route-suggestion-item-clickable"
                          onClick={() => {
                            setEndRoom(destination);
                            setShowEndSuggestions(false);
                          }}
                        >
                          <div className="route-suggestion-body">
                            <div className="route-suggestion-name">
                              {destination}
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <div className="advanced-options">
            <button
              className="advanced-toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
              aria-expanded={showAdvanced}
            >
              <span>Advanced options</span>
              <span className="advanced-toggle-indicator">
                {showAdvanced ? "Hide" : "Show"}
              </span>
            </button>

            {showAdvanced && (
              <div className="advanced-panel">
                <div className="route-input-group">
                  <label htmlFor="route-preference-select">
                    Route Preference
                  </label>
                  <select
                    id="route-preference-select"
                    className="route-input"
                    value={routePreferences}
                    onChange={(e) => setRoutePreferences(e.target.value)}
                  >
                    <option value="shortest">Shortest Route</option>
                    <option value="stairs_first">Prefer Stairs</option>
                    <option value="elevator_first">Prefer Elevator</option>
                  </select>
                </div>

                <div className="route-input-group">
                  <label htmlFor="accessibility-select">Accessibility</label>
                  <select
                    id="accessibility-select"
                    className="route-input"
                    value={accessibility}
                    onChange={(e) => setAccessibility(e.target.value)}
                  >
                    <option value="standard">Standard</option>
                    <option value="wheelchair">Wheelchair Accessible</option>
                    <option value="stairs_avoid">Avoid Stairs</option>
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
              {isSearching ? "Searching..." : "Find Route"}
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
