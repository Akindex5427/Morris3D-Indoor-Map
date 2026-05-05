import React from "react";

const RoomInfoPopup = ({ room, onClose, position }) => {
  if (!room) return null;

  const {
    name = "Unnamed Room",
    roomname = "N/A",
    tipo = "Room",
    type = "N/A",
    number = "N/A",
    altura = 3,
    height = 3,
    base_height,
    base_heigh,
    floor,
    nivel,
    level,
    area = "N/A",
    description = "No description",
  } = room;

  const currentFloor = floor ?? nivel ?? level ?? 0;
  const floorDisplay =
    currentFloor === -1 ? "Basement" : `Floor ${currentFloor}`;
  const roomHeight = Number.isFinite(Number(altura))
    ? Number(altura)
    : Number.isFinite(Number(height))
      ? Number(height)
      : 3;
  const baseHeight = Number.isFinite(Number(base_height))
    ? Number(base_height)
    : Number.isFinite(Number(base_heigh))
      ? Number(base_heigh)
      : 0;

  return (
    <div
      className="room-info-popup"
      style={{
        left: `${position?.x || 0}px`,
        top: `${position?.y || 0}px`,
      }}
    >
      <button
        className="room-popup-close-btn"
        onClick={onClose}
        aria-label="Close room details"
      >
        x
      </button>

      <div className="popup-content">
        <div className="popup-header">
          <span className="popup-eyebrow">{floorDisplay}</span>
          <h2 className="room-name">{name || roomname}</h2>
        </div>

        <div className="room-details">
          <div className="detail-row">
            <span className="label">Type</span>
            <span className="value">{tipo || type}</span>
          </div>

          {number && number !== "N/A" && (
            <div className="detail-row">
              <span className="label">Number</span>
              <span className="value">{number}</span>
            </div>
          )}

          <div className="detail-row">
            <span className="label">Floor</span>
            <span className="value">{floorDisplay}</span>
          </div>

          <div className="detail-row">
            <span className="label">Height</span>
            <span className="value">{roomHeight.toFixed(2)} m</span>
          </div>

          {baseHeight !== 0 && (
            <div className="detail-row">
              <span className="label">Base Height</span>
              <span className="value">{baseHeight.toFixed(2)} m</span>
            </div>
          )}

          {area && area !== "N/A" && (
            <div className="detail-row">
              <span className="label">Area</span>
              <span className="value">{area}</span>
            </div>
          )}

          {description && description !== "No description" && (
            <div className="detail-row full-width">
              <span className="label">Description</span>
              <span className="value">{description}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RoomInfoPopup;
