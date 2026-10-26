import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { searchRooms } from "../utils/roomCatalog";

const SearchBar = ({ catalog, onClear, onRoomSelect, onRetry }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const rootRef = useRef(null);
  const suggestions = useMemo(() => searchRooms(catalog.entries, searchTerm), [catalog.entries, searchTerm]);
  useEffect(() => { setActive(0); }, [suggestions]);
  useEffect(() => {
    rootRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const select = entry => {
    setSearchTerm(entry.label);
    setOpen(false);
    onRoomSelect(entry.feature, entry.key);
  };
  const clear = () => { setSearchTerm(""); setOpen(false); onClear(); };
  const loading = catalog.loadedFloors.length < 8 && catalog.errors.length === 0;
  return (
    <div className="search-bar-container" ref={rootRef} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <div className="search-input-wrapper">
        <input type="text" role="combobox" aria-label="Search rooms on all floors"
          aria-autocomplete="list" aria-expanded={open && suggestions.length > 0}
          aria-controls={listId} aria-describedby={`${listId}-status`}
          aria-activedescendant={open && suggestions[active] ? `${listId}-${active}` : undefined}
          placeholder="Search all floors by room name or ID..." value={searchTerm}
          onChange={event => { setSearchTerm(event.target.value); setOpen(true); if (!event.target.value) onClear(); }}
          onFocus={() => setOpen(true)} className="search-input"
          onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setOpen(true);
              setActive(index => Math.max(0, Math.min(suggestions.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
            } else if (event.key === "Enter" && suggestions.length) {
              event.preventDefault(); select(suggestions[open ? active : 0] || suggestions[0]);
            } else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
          }} />
        {searchTerm && <button className="clear-btn" onClick={clear} aria-label="Clear search">&times;</button>}
      </div>
      <div className="room-search-status" id={`${listId}-status`} role="status">
        {catalog.errors.length > 0 ? <>Search incomplete: {catalog.errors.map(error => `F${error.floor}`).join(", ")} unavailable. <button onClick={onRetry}>Retry</button></>
          : loading ? `Loading rooms (${catalog.loadedFloors.length}/8 floors)…`
          : searchTerm.trim() ? `${suggestions.length} results across F0–F7` : "Search F0–F7"}
      </div>
      {open && suggestions.length > 0 && <div className="suggestions-list" role="listbox" id={listId} aria-label="Room search results">
        {suggestions.map((entry, index) => <div key={entry.key} id={`${listId}-${index}`}
          role="option" aria-selected={index === active} className="suggestion-item"
          onMouseDown={event => event.preventDefault()} onClick={() => select(entry)}>
          <div className="suggestion-name">{entry.label}</div>
          <div className="suggestion-meta">F{entry.floor}{entry.floor === 0 ? " · Basement" : ""}
            {entry.identifiers.length > 0 && ` · ${entry.identifiers[0].field} ${entry.identifiers[0].value}`}
          </div>
        </div>)}
      </div>}
    </div>
  );
};
export default SearchBar;
