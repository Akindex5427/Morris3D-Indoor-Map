import React from "react";
import { roomName } from "../utils/roomCatalog";

export default function RoomInfoPopup({ room, onClose, onCorrespondence, inline = false }) {
  if (!room) return null;
  const name = roomName({ properties: room }) || "Name unavailable";
  return (
    <section className={`room-info-popup ${inline ? 'room-info-popup-inline' : 'room-info-popup-floating'}`}
      aria-label="Room details">
      <div className="room-info-content"><h2 className="room-name" aria-live="polite">{name}</h2>
        {onCorrespondence && <button type="button" className="room-correspondence-action" onClick={onCorrespondence}>Rooms Above &amp; Below</button>}
      </div>
      <button className="room-popup-close-btn" onClick={onClose} aria-label="Close room details">&times;</button>
    </section>
  );
}
