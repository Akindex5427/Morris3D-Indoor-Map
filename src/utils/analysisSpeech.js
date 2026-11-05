// Only local voices are eligible: building descriptions are never sent to a
// remote speech service. A readable summary remains available on every platform.
let activePlayer = null;
export function createAnalysisSpeech({ synthesis, Utterance, onChange = () => {},
  schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let utterance = null, generation = 0, timer = null, disposed = false, state = "idle";
  const supported = Boolean(synthesis && Utterance && synthesis.speak && synthesis.cancel && synthesis.getVoices);
  const canPause = supported && typeof synthesis.pause === "function" && typeof synthesis.resume === "function";
  const publish = (status, message = "") => { state = status; if (!disposed) onChange({ status, message, canPause }); };
  const clearTimer = () => { if (timer !== null) unschedule(timer); timer = null; };
  const voices = () => supported ? synthesis.getVoices().filter(voice => voice.localService === true && /^en(?:-|$)/i.test(voice.lang)) : [];
  const refresh = () => {
    if (utterance || disposed) return;
    if (!supported) publish("unavailable", "Speech synthesis is unavailable in this browser. Read the analysis summary below.");
    else {
      try {
        if (!voices().length) publish("unavailable", "No local English voice is available yet. Enable a device voice or read the analysis summary below.");
        else if (state === "unavailable" || state === "idle") publish("idle");
      } catch { publish("error", "Available voices could not be read. The text summary is still available."); }
    }
  };
  const stop = (notify = true) => {
    generation++; clearTimer();
    if (utterance) { utterance.onstart = utterance.onend = utterance.onerror = utterance.onpause = utterance.onresume = null; }
    utterance = null;
    if (activePlayer === player) {
      activePlayer = null;
      try { synthesis.cancel(); } catch { /* Cancellation still invalidates callbacks. */ }
    }
    if (notify) { publish("idle"); refresh(); }
  };
  const fail = message => { stop(false); publish("error", message); };
  const play = text => {
    if (disposed || !text) return;
    stop(false);
    if (!supported) { refresh(); return; }
    let available;
    try { available = voices(); } catch { fail("Voices could not be loaded. Please read the summary or try again."); return; }
    if (!available.length) { refresh(); return; }
    activePlayer?.stop();
    const id = ++generation;
    try {
      utterance = new Utterance(text);
      utterance.voice = available.find(voice => voice.default) || available[0];
      utterance.lang = utterance.voice.lang; utterance.rate = 0.98; utterance.pitch = 1;
      const current = () => !disposed && id === generation;
      utterance.onstart = () => { if (current()) { clearTimer(); publish("speaking"); } };
      utterance.onpause = () => { if (current()) publish("paused"); };
      utterance.onresume = () => { if (current()) publish("speaking"); };
      utterance.onend = () => { if (current()) { clearTimer(); utterance = null; activePlayer = null; publish("ended"); } };
      utterance.onerror = event => { if (current()) fail(`Speech could not continue (${event.error || "playback error"}). Read the summary or try again.`); };
      activePlayer = player;
      publish("starting");
      timer = schedule(() => { if (current()) fail("Speech did not start. Read the summary or try another browser/device voice."); }, 8000);
      synthesis.speak(utterance);
    } catch { fail("Speech playback failed. The text summary is still available."); }
  };
  const pause = () => {
    if (!canPause || state !== "speaking") return;
    try { synthesis.pause(); if (synthesis.paused) publish("paused"); }
    catch { fail("This browser could not pause speech. Replay or read the summary."); }
  };
  const resume = () => {
    if (!canPause || state !== "paused") return;
    try { synthesis.resume(); if (!synthesis.paused) publish("speaking"); }
    catch { fail("This browser could not resume speech. Replay or read the summary."); }
  };
  const player = { play, pause, resume, stop, refresh,
    dispose() { stop(false); disposed = true; synthesis?.removeEventListener?.("voiceschanged", refresh); } };
  synthesis?.addEventListener?.("voiceschanged", refresh);
  refresh();
  return player;
}
