import React, { useEffect, useRef, useState } from "react";
import { createAnalysisSpeech } from "../utils/analysisSpeech";

export default function RoomAnalysisNarration({ summary, selectionKey }) {
  const player = useRef(null);
  const [speech, setSpeech] = useState({ status: "idle", message: "", canPause: false });
  useEffect(() => {
    const instance = createAnalysisSpeech({ synthesis: window.speechSynthesis,
      Utterance: window.SpeechSynthesisUtterance, onChange: setSpeech });
    player.current = instance;
    return () => { instance.dispose(); player.current = null; };
  }, [summary, selectionKey]);
  const active = ["starting", "speaking", "paused"].includes(speech.status);
  const play = () => player.current?.play(summary.text);
  return <div className="analysis-narration">
    <div className="analysis-speech-controls" role="group" aria-label="Analysis narration">
      <button type="button" onClick={play} disabled={active || speech.status === "unavailable"}>Listen to Analysis</button>
      {active && speech.canPause && <button type="button" disabled={speech.status === "starting"}
        onClick={() => speech.status === "paused" ? player.current?.resume() : player.current?.pause()}>
        {speech.status === "paused" ? "Resume analysis" : "Pause analysis"}</button>}
      {active && <button type="button" onClick={() => player.current?.stop()}>Stop analysis</button>}
      {(active || speech.status === "ended") && <button type="button" onClick={play}>Replay analysis</button>}
    </div>
    <p role="status" aria-live="polite" className="analysis-speech-status">{speech.message || ({ starting: "Starting narration…", speaking: "Reading analysis.", paused: "Narration paused.", ended: "Narration finished." }[speech.status] || "Audio starts only when requested; uses a voice on this device.")}</p>
    <details className="analysis-summary"><summary>Read analysis summary</summary><p>{summary.text}</p></details>
  </div>;
}
