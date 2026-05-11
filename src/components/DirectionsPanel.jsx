import React, { useEffect, useMemo, useState } from "react";
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

  const directions = useMemo(() => {
    if (routeInfo?.directions?.length) return routeInfo.directions;
    if (!routePath) return [];
    return generateDirections(routePath);
  }, [routePath, routeInfo]);

  const stats = useMemo(() => {
    if (routeInfo?.routeType === "multi-floor") {
      return {
        totalDistance: routeInfo.totalDistance ?? Number(routeInfo.distance) ?? 0,
        estimatedTime:
          (routeInfo.totalDistance ?? Number(routeInfo.distance) ?? 0) / 1.4 +
          Math.max(0, (routeInfo.floors?.length ?? 1) - 1) * 30,
        floors: routeInfo.floors ?? [],
        floorChanges: Math.max(0, (routeInfo.floors?.length ?? 1) - 1),
      };
    }
    if (!routePath) return null;
    return calculateRouteStats(routePath);
  }, [routePath, routeInfo]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins === 0) return `${secs} sec`;
    return secs > 0 ? `${mins} min ${secs} sec` : `${mins} min`;
  };

  const formatDistance = (meters) => {
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(2)} km`;
  };

  const isSpeechSupported = "speechSynthesis" in window;

  const speak = (text, rate = speechRate) => {
    if (!isSpeechSupported || !voiceEnabled) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);

      if (autoPlay && currentStep < directions.length - 1) {
        setTimeout(() => {
          setCurrentStep((prev) => prev + 1);
        }, 1000);
      }
    };
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    if (isSpeechSupported) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  const speakCurrentStep = () => {
    if (directions.length > 0 && currentStep < directions.length) {
      const step = directions[currentStep];
      const text = generateStepSpeech(step);
      speak(text);
    }
  };

  const speakAllDirections = () => {
    const text = generateSpeechText(directions);
    speak(text, speechRate * 0.9);
  };

  const goToStep = (index) => {
    setCurrentStep(index);
    stopSpeaking();

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

  useEffect(() => {
    if (voiceEnabled && !isSpeaking && autoPlay) {
      speakCurrentStep();
    }
  }, [currentStep, voiceEnabled, autoPlay]);

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
      <div className="directions-header">
        <div className="directions-title-block">
          <div className="directions-title">
            <h3>Directions</h3>
            <button
              className="directions-toggle-btn"
              onClick={() => setCollapsed(!collapsed)}
              title={collapsed ? "Expand directions" : "Collapse directions"}
            >
              {collapsed ? "+" : "-"}
            </button>
          </div>
          {routeInfo?.start && routeInfo?.end && (
            <p className="directions-subtitle">
              {routeInfo.start} to {routeInfo.end}
            </p>
          )}
        </div>
        <button
          className="directions-close-btn"
          onClick={onClose}
          title="Close directions"
        >
          x
        </button>
      </div>

      {!collapsed && (
        <>
          {stats && (
            <div className="route-summary">
              <div className="summary-item">
                <div className="summary-label">Distance</div>
                <div className="summary-value">
                  {formatDistance(stats.totalDistance)}
                </div>
              </div>
              <div className="summary-item">
                <div className="summary-label">Est. Time</div>
                <div className="summary-value">
                  {formatTime(stats.estimatedTime)}
                </div>
              </div>
              <div className="summary-item">
                <div className="summary-label">Floors</div>
                <div className="summary-value">{stats.floors.join(", ")}</div>
              </div>
            </div>
          )}

          {isSpeechSupported && (
            <div className="voice-controls">
              <label className="voice-toggle">
                <span>Voice guidance</span>
                <input
                  type="checkbox"
                  checked={voiceEnabled}
                  onChange={(e) => setVoiceEnabled(e.target.checked)}
                />
              </label>

              {voiceEnabled && (
                <>
                  <label className="voice-toggle">
                    <span>Auto-play steps</span>
                    <input
                      type="checkbox"
                      checked={autoPlay}
                      onChange={(e) => setAutoPlay(e.target.checked)}
                    />
                  </label>

                  <div className="voice-actions">
                    <button
                      className="btn-voice"
                      onClick={speakCurrentStep}
                      disabled={isSpeaking}
                      title="Speak current step"
                    >
                      Speak step
                    </button>
                    <button
                      className="btn-voice"
                      onClick={speakAllDirections}
                      disabled={isSpeaking}
                      title="Speak all directions"
                    >
                      Speak all
                    </button>
                    <button
                      className="btn-voice btn-stop"
                      onClick={stopSpeaking}
                      disabled={!isSpeaking}
                      title="Stop speaking"
                    >
                      Stop
                    </button>
                  </div>

                  <div className="speed-control">
                    <label htmlFor="speech-rate-range">
                      Speed: {speechRate.toFixed(1)}x
                    </label>
                    <input
                      id="speech-rate-range"
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={speechRate}
                      onChange={(e) =>
                        setSpeechRate(parseFloat(e.target.value))
                      }
                    />
                  </div>
                </>
              )}
            </div>
          )}

          <div className="current-step-card">
            <div className="step-header">
              <span className="step-number">
                Step {currentStep + 1} of {directions.length}
              </span>
              <span className={`step-type ${currentDirection.type}`}>
                {currentDirection.icon || ">"}
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
                <>{` -> Floor ${currentDirection.targetFloor}`}</>
              )}
            </div>
          </div>

          <div className="step-navigation">
            <button
              className="directions-nav-btn"
              onClick={previousStep}
              disabled={currentStep === 0}
            >
              Previous
            </button>
            <div className="step-indicator">
              {currentStep + 1} / {directions.length}
            </div>
            <button
              className="directions-nav-btn"
              onClick={nextStep}
              disabled={currentStep === directions.length - 1}
            >
              Next
            </button>
          </div>

          <div className="progress-container">
            <div
              className="progress-bar"
              style={{
                width: `${((currentStep + 1) / directions.length) * 100}%`,
              }}
            />
          </div>

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
                <div className="direction-icon">{direction.icon || ">"}</div>
                <div className="direction-content">
                  <div className="direction-instruction">
                    {direction.instruction}
                  </div>
                  <div className="direction-meta">
                    Floor {direction.floor}
                    {direction.distance > 1 && (
                      <> - {formatDistance(direction.distance)}</>
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
