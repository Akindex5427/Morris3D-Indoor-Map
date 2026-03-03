import React, { useState } from "react";

const HelpOverlay = ({ onClose }) => {
  const shortcuts = [
    { key: "0-7", description: "Switch to floor 0-7" },
    { key: "A", description: "View all floors" },
    { key: "↑ ↓", description: "Rotate camera up/down" },
    { key: "← →", description: "Rotate camera left/right" },
    { key: "+ -", description: "Zoom in/out" },
    { key: "R", description: "Reset view" },
    { key: "L", description: "Toggle lighting" },
    { key: "D", description: "Toggle dark mode" },
    { key: "F", description: "Open filter panel" },
    { key: "P", description: "Plan route" },
    { key: "Esc", description: "Close dialogs" },
    { key: "?", description: "Show/hide this help" },
  ];

  return (
    <div className="help-overlay-backdrop" onClick={onClose}>
      <div
        className="help-overlay-content"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="help-close-btn" onClick={onClose}>
          ×
        </button>
        <h2>⌨️ Keyboard Shortcuts</h2>
        <div className="shortcuts-grid">
          {shortcuts.map((shortcut, index) => (
            <div key={index} className="shortcut-item">
              <kbd className="shortcut-key">{shortcut.key}</kbd>
              <span className="shortcut-description">
                {shortcut.description}
              </span>
            </div>
          ))}
        </div>
        <div className="help-footer">
          <p>💡 Tip: Use your mouse to drag, rotate, and zoom the map</p>
        </div>
      </div>
    </div>
  );
};

export default HelpOverlay;
