import React from "react";
import { UNCLASSIFIED_ROOM_COLOR } from "../utils/roomColors";

export default function RoomColorLegend({ mode, summary }) {
  if (mode !== "function" || !summary?.classified) return null;
  const rows = [...summary.categories];
  if (summary.unclassified) rows.push({ id: "__unclassified", label: "Unclassified", color: UNCLASSIFIED_ROOM_COLOR, count: summary.unclassified });
  return <details className="room-color-legend" open>
    <summary>Room functions</summary>
    <ul aria-label="Room functions in this view">{rows.map(row => <li key={row.id}>
      <span className="room-color-swatch" style={{ backgroundColor: `rgb(${row.color.join(",")})` }} aria-hidden="true" />
      <span>{row.label}</span><span className="room-color-count">{row.count}</span>
    </li>)}</ul>
  </details>;
}
