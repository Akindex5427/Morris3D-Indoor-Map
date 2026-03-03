import React, { useState } from "react";

const SearchBar = ({ rooms, onSearch, onRoomSelect }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleInputChange = (e) => {
    const value = e.target.value.toLowerCase();
    setSearchTerm(value);

    if (value.length > 0) {
      const filtered = rooms.filter((room) => {
        const name = room.properties?.name || room.properties?.roomname || "";
        const type = room.properties?.tipo || room.properties?.type || "";
        const number = room.properties?.number || "";

        return (
          name.toLowerCase().includes(value) ||
          type.toLowerCase().includes(value) ||
          number.toLowerCase().includes(value)
        );
      });

      setSuggestions(filtered.slice(0, 8)); // Limit to 8 suggestions
      setShowSuggestions(true);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
      onSearch([]);
    }
  };

  const handleSuggestionClick = (room) => {
    const roomId = room.properties?.id || room.properties?.name || "";
    const roomName =
      room.properties?.name || room.properties?.roomname || roomId;
    setSearchTerm(roomName);
    setShowSuggestions(false);
    onRoomSelect(room.properties, roomId);
    onSearch([roomId]);
  };

  const handleSearch = (e) => {
    if (e.key === "Enter") {
      const matchedRoomIds = suggestions.map(
        (r) => r.properties?.id || r.properties?.name || ""
      );
      onSearch(matchedRoomIds);
      setShowSuggestions(false);
    }
  };

  const clearSearch = () => {
    setSearchTerm("");
    setSuggestions([]);
    setShowSuggestions(false);
    onSearch([]);
  };

  return (
    <div className="search-bar-container">
      <div className="search-input-wrapper">
        <input
          type="text"
          placeholder="Search rooms by name, type, or number..."
          value={searchTerm}
          onChange={handleInputChange}
          onKeyPress={handleSearch}
          className="search-input"
        />
        {searchTerm && (
          <button
            className="clear-btn"
            onClick={clearSearch}
            aria-label="Clear search"
          >
            &times;
          </button>
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="suggestions-list">
          {suggestions.map((room, idx) => {
            const roomName =
              room.properties?.name || room.properties?.roomname || "Unnamed";
            const roomType =
              room.properties?.tipo || room.properties?.type || "Room";
            const roomNumber = room.properties?.number || "";

            return (
              <div
                key={idx}
                className="suggestion-item"
                onClick={() => handleSuggestionClick(room)}
              >
                <div className="suggestion-name">{roomName}</div>
                <div className="suggestion-meta">
                  {roomType} {roomNumber}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SearchBar;
