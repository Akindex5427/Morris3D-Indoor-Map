import React from "react";

const HelpOverlay = ({ onClose }) => {
  const shortcuts = [
    { key: "0-7", description: "Switch to floor 0-7" },
    { key: "A", description: "View all floors" },
    { key: "Up / Down", description: "Tilt camera up or down" },
    { key: "Left / Right", description: "Rotate camera left or right" },
    { key: "+ / -", description: "Zoom in or out" },
    { key: "R", description: "Reset view" },
    { key: "L", description: "Toggle lighting" },
    { key: "D", description: "Toggle dark mode" },
    { key: "F", description: "Open filter panel" },
    { key: "P", description: "Plan route" },
    { key: "Esc", description: "Close dialogs" },
    { key: "?", description: "Show or hide this help" },
  ];

  return (
    <div className="help-overlay-backdrop" onClick={onClose}>
      <div
        className="help-overlay-content"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="help-close-btn" onClick={onClose}>
          x
        </button>
        <div className="panel-heading">
          <span className="panel-kicker">Shortcuts</span>
          <h2>Keyboard shortcuts</h2>
          <p className="panel-description">
            Use these keys to move through the building faster.
          </p>
        </div>
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
          <p>Tip: Use your mouse to drag, rotate, and zoom the map.</p>
        </div>
      </div>
    </div>
  );
};

export default HelpOverlay;
