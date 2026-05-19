import React, { useEffect, useMemo, useState } from "react";
import "./DirectionsPanel.css";
import {
  generateDirections,
  generateStepSpeech,
  calculateRouteStats,
} from "../utils/directionsGenerator";

const DirectionsPanel = ({ routePath, routeInfo, onClose, onStepClick }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [speechRate, setSpeechRate] = useState(0.5);
  const [awaitingStepConfirmation, setAwaitingStepConfirmation] =
    useState(false);
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

  const stopSpeaking = () => {
    if (isSpeechSupported) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  };

  const speak = (text, rate = speechRate) => {
    if (!isSpeechSupported || !voiceEnabled) return;

    window.speechSynthesis.cancel();
    setAwaitingStepConfirmation(false);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      setAwaitingStepConfirmation(true);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setAwaitingStepConfirmation(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  const speakCurrentStep = () => {
    if (directions.length > 0 && currentStep < directions.length) {
      const step = directions[currentStep];
      const text = generateStepSpeech(step);
      speak(text);
    }
  };

  const goToStep = (index) => {
    setCurrentStep(index);
    setAwaitingStepConfirmation(false);
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

  const confirmStepComplete = () => {
    if (currentStep >= directions.length - 1) {
      setAwaitingStepConfirmation(false);
      stopSpeaking();
      return;
    }

    const nextIndex = currentStep + 1;
    setCurrentStep(nextIndex);
    setAwaitingStepConfirmation(false);
    if (onStepClick && directions[nextIndex]) {
      onStepClick(directions[nextIndex]);
    }

    window.setTimeout(() => {
      const nextStepText = generateStepSpeech(directions[nextIndex]);
      speak(nextStepText);
    }, 120);
  };

  const stopVoiceGuidance = () => {
    setVoiceEnabled(false);
    setAwaitingStepConfirmation(false);
    stopSpeaking();
  };

  const previousStep = () => {
    if (currentStep > 0) {
      goToStep(currentStep - 1);
    }
  };

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    setCurrentStep(0);
    setVoiceEnabled(false);
    setAwaitingStepConfirmation(false);
    stopSpeaking();
  }, [routeInfo, routePath]);

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
                  onChange={(e) => {
                    setVoiceEnabled(e.target.checked);
                    setAwaitingStepConfirmation(false);
                    if (!e.target.checked) {
                      stopSpeaking();
                    }
                  }}
                />
              </label>

              {voiceEnabled && (
                <>
                  <div className="voice-guidance-card">
                    <span className="voice-guidance-label">
                      Have you completed this step?
                    </span>
                    <p>{currentDirection.instruction}</p>
                  </div>

                  <div className="voice-actions">
                    <button
                      className="btn-voice"
                      onClick={speakCurrentStep}
                      disabled={isSpeaking}
                      title="Speak current step"
                    >
                      {awaitingStepConfirmation ? "Repeat instruction" : "Speak step"}
                    </button>
                    <button
                      className="btn-voice"
                      onClick={confirmStepComplete}
                      disabled={
                        isSpeaking ||
                        !awaitingStepConfirmation ||
                        currentStep >= directions.length - 1
                      }
                      title="Continue to next instruction"
                    >
                      Yes, next instruction
                    </button>
                    <button
                      className="btn-voice btn-stop"
                      onClick={stopVoiceGuidance}
                      title="Stop guidance"
                    >
                      Stop guidance
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
