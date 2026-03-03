import React, { useState, useEffect, useMemo } from "react";
import "./DirectionsPanel.css";
import {
  generateDirections,
  generateStepSpeech,
  calculateRouteStats,
  generateSpeechText,
} from "../utils/directionsGenerator";

const DirectionsPanel = ({ routePath, routeInfo, onClose, onStepClick }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speechRate, setSpeechRate] = useState(1.0);
  const [collapsed, setCollapsed] = useState(false);

  // Generate directions from route path
  const directions = useMemo(() => {
    if (!routePath) return [];
    return generateDirections(routePath);
  }, [routePath]);

  // Calculate route statistics
  const stats = useMemo(() => {
    if (!routePath) return null;
    return calculateRouteStats(routePath);
  }, [routePath]);

  // Format time for display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins === 0) return `${secs} sec`;
    return secs > 0 ? `${mins} min ${secs} sec` : `${mins} min`;
  };

  // Format distance for display
  const formatDistance = (meters) => {
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(2)} km`;
  };

  // Check if speech synthesis is supported
  const isSpeechSupported = "speechSynthesis" in window;

  // Speak a direction step
  const speak = (text, rate = speechRate) => {
    if (!isSpeechSupported || !voiceEnabled) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);

      // Auto-advance to next step if autoPlay is enabled
      if (autoPlay && currentStep < directions.length - 1) {
        setTimeout(() => {
          setCurrentStep((prev) => prev + 1);
        }, 1000); // 1 second delay between steps
      }
    };
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  // Stop speaking
  const stopSpeaking = () => {
    if (isSpeechSupported) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  // Speak current step
  const speakCurrentStep = () => {
    if (directions.length > 0 && currentStep < directions.length) {
      const step = directions[currentStep];
      const text = generateStepSpeech(step);
      speak(text);
    }
  };

  // Speak all directions
  const speakAllDirections = () => {
    const text = generateSpeechText(directions);
    speak(text, speechRate * 0.9); // Slightly slower for full route
  };

  // Handle step navigation
  const goToStep = (index) => {
    setCurrentStep(index);
    stopSpeaking();

    // Notify parent to highlight this step on map
    if (onStepClick && directions[index]) {
      onStepClick(directions[index]);
    }
  };

  const nextStep = () => {
    if (currentStep < directions.length - 1) {
      goToStep(currentStep + 1);
    }
  };

  const previousStep = () => {
    if (currentStep > 0) {
      goToStep(currentStep - 1);
    }
  };

  // Auto-speak when step changes and voice is enabled
  useEffect(() => {
    if (voiceEnabled && !isSpeaking && autoPlay) {
      speakCurrentStep();
    }
  }, [currentStep, voiceEnabled, autoPlay]);

  // Cleanup speech on unmount
  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  if (!routePath || directions.length === 0) {
    return null;
  }

  const currentDirection = directions[currentStep];

  return (
    <div className={`directions-panel ${collapsed ? "collapsed" : ""}`}>
      {/* Header */}
      <div className="directions-header">
        <div className="directions-title">
          <h3>📍 Directions</h3>
          <button
            className="toggle-btn"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? "▼" : "▲"}
          </button>
        </div>
        <button className="close-btn" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Route Summary */}
          {stats && (
            <div className="route-summary">
              <div className="summary-item">
                <span className="summary-icon">📏</span>
                <div>
                  <div className="summary-label">Distance</div>
                  <div className="summary-value">
                    {formatDistance(stats.totalDistance)}
                  </div>
                </div>
              </div>
              <div className="summary-item">
                <span className="summary-icon">⏱️</span>
                <div>
                  <div className="summary-label">Est. Time</div>
                  <div className="summary-value">
                    {formatTime(stats.estimatedTime)}
                  </div>
                </div>
              </div>
              <div className="summary-item">
                <span className="summary-icon">🏢</span>
                <div>
                  <div className="summary-label">Floors</div>
                  <div className="summary-value">{stats.floors.join(", ")}</div>
                </div>
              </div>
            </div>
          )}

          {/* Voice Controls */}
          {isSpeechSupported && (
            <div className="voice-controls">
              <label className="voice-toggle">
                <input
                  type="checkbox"
                  checked={voiceEnabled}
                  onChange={(e) => setVoiceEnabled(e.target.checked)}
                />
                <span>🔊 Voice Guidance</span>
              </label>

              {voiceEnabled && (
                <>
                  <label className="voice-toggle">
                    <input
                      type="checkbox"
                      checked={autoPlay}
                      onChange={(e) => setAutoPlay(e.target.checked)}
                    />
                    <span>▶️ Auto-play steps</span>
                  </label>

                  <div className="voice-actions">
                    <button
                      className="btn-voice"
                      onClick={speakCurrentStep}
                      disabled={isSpeaking}
                      title="Speak current step"
                    >
                      🔊 Step
                    </button>
                    <button
                      className="btn-voice"
                      onClick={speakAllDirections}
                      disabled={isSpeaking}
                      title="Speak all directions"
                    >
                      🔊 All
                    </button>
                    <button
                      className="btn-voice btn-stop"
                      onClick={stopSpeaking}
                      disabled={!isSpeaking}
                      title="Stop speaking"
                    >
                      ⏹️ Stop
                    </button>
                  </div>

                  <div className="speed-control">
                    <label>
                      Speed: {speechRate.toFixed(1)}x
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        value={speechRate}
                        onChange={(e) =>
                          setSpeechRate(parseFloat(e.target.value))
                        }
                      />
                    </label>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Current Step Display */}
          <div className="current-step-card">
            <div className="step-header">
              <span className="step-number">
                Step {currentStep + 1} of {directions.length}
              </span>
              <span className={`step-type ${currentDirection.type}`}>
                {currentDirection.icon || "➡️"}
              </span>
            </div>
            <div className="step-instruction">
              {currentDirection.instruction}
            </div>
            {currentDirection.distance > 1 && (
              <div className="step-distance">
                {formatDistance(currentDirection.distance)}
              </div>
            )}
            <div className="step-floor">
              Floor {currentDirection.floor}
              {currentDirection.targetFloor !== undefined && (
                <> → Floor {currentDirection.targetFloor}</>
              )}
            </div>
          </div>

          {/* Step Navigation */}
          <div className="step-navigation">
            <button
              className="nav-btn"
              onClick={previousStep}
              disabled={currentStep === 0}
            >
              ← Previous
            </button>
            <div className="step-indicator">
              {currentStep + 1} / {directions.length}
            </div>
            <button
              className="nav-btn"
              onClick={nextStep}
              disabled={currentStep === directions.length - 1}
            >
              Next →
            </button>
          </div>

          {/* Progress Bar */}
          <div className="progress-container">
            <div
              className="progress-bar"
              style={{
                width: `${((currentStep + 1) / directions.length) * 100}%`,
              }}
            />
          </div>

          {/* All Steps List */}
          <div className="directions-list">
            <div className="list-header">All Steps</div>
            {directions.map((direction, index) => (
              <div
                key={direction.id}
                className={`direction-item ${
                  index === currentStep ? "active" : ""
                } ${direction.type}`}
                onClick={() => goToStep(index)}
              >
                <div className="direction-icon">{direction.icon || "➡️"}</div>
                <div className="direction-content">
                  <div className="direction-instruction">
                    {direction.instruction}
                  </div>
                  <div className="direction-meta">
                    Floor {direction.floor}
                    {direction.distance > 1 && (
                      <> · {formatDistance(direction.distance)}</>
                    )}
                  </div>
                </div>
                <div className="direction-step-number">{index + 1}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default DirectionsPanel;
