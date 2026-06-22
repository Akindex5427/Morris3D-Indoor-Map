import React, { useEffect, useMemo, useState } from "react";
import "./DirectionsPanel.css";
import {
  generateStepSpeech,
  calculateRouteStats,
} from "../utils/directionsGenerator";

const DirectionsPanel = ({
  routePath,
  routeInfo,
  onClose,
  onStepClick,
  cameraMode,
  onRecenterRoute,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [speechRate, setSpeechRate] = useState(0.7);
  const [showStepList, setShowStepList] = useState(false);

  const directions = useMemo(() => {
    if (routeInfo?.directions?.length) return routeInfo.directions;
    return [];
  }, [routeInfo]);

  // ── Floor journey (multi-floor only) ─────────────────────────────────────
  // Builds: [{ kind:"floor", floor:1 }, { kind:"connector", connectorType:"stairs", dirIndex:2 }, { kind:"floor", floor:4 }, …]
  const floorJourney = useMemo(() => {
    const verticals = directions.reduce((acc, d, i) => {
      if (d.type === "vertical") acc.push({ d, i });
      return acc;
    }, []);
    if (!verticals.length) return null;

    const startFloor =
      Number(String(directions[0]?.floor ?? 0).replace(/^F/i, "")) || 0;
    const items = [{ kind: "floor", floor: startFloor }];

    for (const { d, i } of verticals) {
      items.push({
        kind: "connector",
        connectorType: d.connectorType || "stairs",
        dirIndex: i,
      });
      items.push({
        kind: "floor",
        floor: d.targetFloor ?? Number(String(d.toFloor ?? "0").replace(/^F/i, "")),
      });
    }

    return items;
  }, [directions]);

  // Which item in floorJourney the current step corresponds to.
  // Floors are at even indices (0, 2, 4 …), connectors at odd indices (1, 3, 5 …).
  const currentJourneyIndex = useMemo(() => {
    if (!floorJourney) return 0;
    let verticalsPassed = 0;
    for (let i = 0; i < currentStep; i++) {
      if (directions[i]?.type === "vertical") verticalsPassed++;
    }
    return directions[currentStep]?.type === "vertical"
      ? verticalsPassed * 2 + 1
      : verticalsPassed * 2;
  }, [floorJourney, directions, currentStep]);

  const stats = useMemo(() => {
    if (routeInfo?.routeType === "multi-floor") {
      const dist = routeInfo.totalDistance ?? Number(routeInfo.distance) ?? 0;
      return {
        totalDistance: dist,
        estimatedTime: dist / 1.4 + Math.max(0, (routeInfo.floors?.length ?? 1) - 1) * 30,
        floors: routeInfo.floors ?? [],
      };
    }
    if (!routePath) return null;
    return calculateRouteStats(routePath);
  }, [routePath, routeInfo]);

  const isSpeechSupported = "speechSynthesis" in window;

  const formatDistance = (meters) => {
    if (!Number.isFinite(meters) || meters <= 0) return null;
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  const formatTimeSummary = (seconds) => {
    const mins = Math.floor(seconds / 60);
    if (mins === 0) return `${Math.round(seconds)} sec`;
    return `~${mins} min`;
  };

  const getDirectionText = (d) => d?.text ?? d?.instruction ?? "";

  // Returns a displayable icon for any step, replacing the raw "^"/"E" glyphs
  // that the instruction generator uses for vertical transitions.
  const getStepIcon = (d) => {
    if (d.type === "vertical") {
      return d.connectorType === "elevator" ? "🛗" : "🪜";
    }
    return d.icon || ">";
  };

  // ── Speech helpers ─────────────────────────────────────────────────────────

  const stopSpeaking = () => {
    if (isSpeechSupported) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const speakText = (text, { force = false, rate = speechRate } = {}) => {
    if (!isSpeechSupported || (!voiceEnabled && !force)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = Math.max(0.5, Math.min(2, rate));
    u.pitch = 1.0;
    u.volume = 1.0;
    u.onstart = () => setIsSpeaking(true);
    u.onend = () => setIsSpeaking(false);
    u.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(u);
  };

  // ── Step navigation ────────────────────────────────────────────────────────

  const goToStep = (index) => {
    setCurrentStep(index);
    stopSpeaking();
    if (onStepClick && directions[index]) onStepClick(directions[index]);
    if (voiceEnabled && directions[index]) {
      window.setTimeout(() => speakText(generateStepSpeech(directions[index])), 120);
    }
  };

  const previousStep = () => { if (currentStep > 0) goToStep(currentStep - 1); };
  const nextStep     = () => { if (currentStep < directions.length - 1) goToStep(currentStep + 1); };

  // ── Voice action handlers ─────────────────────────────────────────────────

  const handleRepeat = () => {
    if (!isSpeechSupported) return;
    const text = generateStepSpeech(directions[currentStep]);
    if (!voiceEnabled) {
      setVoiceEnabled(true);
      window.setTimeout(() => speakText(text, { force: true }), 120);
    } else {
      speakText(text);
    }
  };

  const stopGuidance = () => {
    setVoiceEnabled(false);
    stopSpeaking();
  };

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  useEffect(() => () => stopSpeaking(), []);

  useEffect(() => {
    setCurrentStep(0);
    setVoiceEnabled(false);
    stopSpeaking();
  }, [routeInfo, routePath]);

  if (!routePath || directions.length === 0) return null;

  const step = directions[currentStep];
  const progressPct = ((currentStep + 1) / directions.length) * 100;
  const stepDistance = formatDistance(step.distanceMeters);

  return (
    <div className="directions-panel">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="directions-header">
        <div className="directions-title-block">
          <h3 className="directions-heading">Directions</h3>
          {routeInfo?.start && routeInfo?.end && (
            <p className="directions-subtitle">{routeInfo.start} to {routeInfo.end}</p>
          )}
        </div>
        <div className="directions-header-btns">
          {cameraMode === "manual" && onRecenterRoute && (
            <button
              className="directions-recenter-btn"
              onClick={onRecenterRoute}
              title="Recenter map on route"
            >
              Recenter
            </button>
          )}
          <button
            className="directions-close-btn"
            onClick={onClose}
            title="Close directions"
          >
            ×
          </button>
        </div>
      </div>

      {/* ── Compact summary bar ────────────────────────────────────────────── */}
      {stats && (
        <div className="dp-summary-bar">
          {formatDistance(stats.totalDistance) && (
            <span className="dp-summary-item">{formatDistance(stats.totalDistance)}</span>
          )}
          <span className="dp-summary-dot" aria-hidden="true">·</span>
          <span className="dp-summary-item">{formatTimeSummary(stats.estimatedTime)}</span>
          {stats.floors?.length > 0 && (
            <>
              <span className="dp-summary-dot" aria-hidden="true">·</span>
              <span className="dp-summary-item">
                Floor{stats.floors.length > 1 ? "s" : ""} {stats.floors.join(", ")}
              </span>
            </>
          )}
        </div>
      )}

      {/* ── Floor journey breadcrumb (multi-floor only) ────────────────────── */}
      {floorJourney && (
        <div className="dp-floor-journey" role="navigation" aria-label="Floor journey">
          {floorJourney.map((item, idx) => {
            const isDone = idx < currentJourneyIndex;
            const isActive = idx === currentJourneyIndex;
            const stateClass = isDone
              ? "dp-jc-done"
              : isActive
                ? "dp-jc-active"
                : "dp-jc-upcoming";

            return (
              <React.Fragment key={idx}>
                {idx > 0 && (
                  <span
                    className={`dp-journey-sep${isDone ? " dp-journey-sep-done" : ""}`}
                    aria-hidden="true"
                  />
                )}
                {item.kind === "floor" ? (
                  <span className={`dp-journey-chip dp-journey-floor ${stateClass}`}>
                    F{item.floor}
                    {isDone && (
                      <span className="dp-jc-check" aria-hidden="true">✓</span>
                    )}
                  </span>
                ) : (
                  <span
                    className={`dp-journey-chip dp-journey-connector ${stateClass}`}
                    title={item.connectorType === "elevator" ? "Elevator" : "Stairs"}
                    aria-label={item.connectorType === "elevator" ? "Elevator" : "Stairs"}
                  >
                    {item.connectorType === "elevator" ? "🛗" : "🪜"}
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* ── Progress bar ───────────────────────────────────────────────────── */}
      <div className="dp-progress-track" role="progressbar" aria-valuenow={currentStep + 1} aria-valuemin={1} aria-valuemax={directions.length}>
        <div className="dp-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      {/* ── Active instruction card ─────────────────────────────────────────── */}
      <div className={`dp-instruction-card dp-type-${step.type}`}>
        <div className="dp-instruction-meta">
          <span className="dp-step-counter">Step {currentStep + 1} of {directions.length}</span>
          <span className="dp-floor-tag">
            {step.type === "vertical" && step.targetFloor !== undefined
              ? `F${step.floor} → F${step.targetFloor}`
              : `Floor ${step.floor}`
            }
          </span>
        </div>

        <div className="dp-instruction-body">
          <span className="dp-step-icon" aria-hidden="true">
            {getStepIcon(step)}
          </span>
          <p className="dp-step-text">{getDirectionText(step)}</p>
        </div>

        {/* Connector transition badge — only on vertical steps */}
        {step.type === "vertical" && step.targetFloor !== undefined && (
          <div className="dp-connector-transition">
            <span className="dp-ct-label">
              {step.connectorType === "elevator" ? "Elevator" : "Stairs"}
            </span>
            <span className="dp-ct-floors">
              <span className="dp-ct-from">F{step.floor}</span>
              <span className="dp-ct-arrow">→</span>
              <span className="dp-ct-to">F{step.targetFloor}</span>
            </span>
          </div>
        )}

        {stepDistance && step.type !== "vertical" && (
          <div className="dp-step-distance">{stepDistance}</div>
        )}
      </div>

      {/* ── Navigation controls ────────────────────────────────────────────── */}
      <div className="dp-nav-controls">
        <button
          className="dp-nav-btn"
          onClick={previousStep}
          disabled={currentStep === 0}
          aria-label="Previous step"
        >
          ← Previous
        </button>
        <span className="dp-nav-counter" aria-live="polite">
          {currentStep + 1} / {directions.length}
        </span>
        <button
          className="dp-nav-btn dp-nav-next"
          onClick={nextStep}
          disabled={currentStep === directions.length - 1}
          aria-label="Next step"
        >
          Next →
        </button>
      </div>

      {/* ── Voice controls ─────────────────────────────────────────────────── */}
      {isSpeechSupported && (
        <div className="dp-voice-controls">
          <button
            className={`dp-repeat-btn${isSpeaking ? " dp-speaking" : ""}`}
            onClick={handleRepeat}
            disabled={isSpeaking}
            title={isSpeaking ? "Speaking…" : "Repeat this instruction aloud"}
          >
            <span className="dp-repeat-icon" aria-hidden="true">🔊</span>
            {isSpeaking ? "Speaking…" : "Repeat"}
          </button>

          <label className="dp-autospeak-label" title="Automatically speak each step as you navigate">
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(e) => {
                if (!e.target.checked) stopGuidance();
                else setVoiceEnabled(true);
              }}
            />
            <span>Auto-speak</span>
          </label>

          <button
            className="dp-stop-btn"
            onClick={stopGuidance}
            disabled={!voiceEnabled && !isSpeaking}
            title="Stop voice guidance"
          >
            Stop guidance
          </button>
        </div>
      )}

      {/* Speed slider — only when voice guidance is active */}
      {isSpeechSupported && voiceEnabled && (
        <div className="dp-speed-row">
          <label htmlFor="dp-speech-rate-range">
            Speed: <strong>{speechRate.toFixed(1)}×</strong>
          </label>
          <input
            id="dp-speech-rate-range"
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={speechRate}
            onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
          />
        </div>
      )}

      {/* ── All-steps disclosure ────────────────────────────────────────────── */}
      <button
        className="dp-steps-toggle"
        onClick={() => setShowStepList((v) => !v)}
        aria-expanded={showStepList}
      >
        <span className="dp-steps-toggle-chevron" aria-hidden="true">
          {showStepList ? "▲" : "▼"}
        </span>
        All steps ({directions.length})
      </button>

      {showStepList && (
        <div className="dp-steps-list">
          {directions.map((d, index) => (
            <div
              key={d.id}
              className={`dp-step-item${index === currentStep ? " dp-step-active" : ""} dp-type-${d.type}`}
              onClick={() => goToStep(index)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && goToStep(index)}
              aria-current={index === currentStep ? "step" : undefined}
            >
              <span className="dp-step-item-icon" aria-hidden="true">
                {getStepIcon(d)}
              </span>
              <div className="dp-step-item-body">
                <div className="dp-step-item-text">{getDirectionText(d)}</div>
                <div className="dp-step-item-meta">
                  {d.type === "vertical" && d.targetFloor !== undefined
                    ? `F${d.floor} → F${d.targetFloor}`
                    : `Floor ${d.floor}${formatDistance(d.distanceMeters) ? ` · ${formatDistance(d.distanceMeters)}` : ""}`
                  }
                </div>
              </div>
              <span className="dp-step-item-num">{index + 1}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DirectionsPanel;
