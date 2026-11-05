import React, { useEffect, useMemo, useRef } from "react";
import RoomAnalysisNarration from "./RoomAnalysisNarration";
import { FOOTPRINT_LIMITATION, hasSpecificAnalysisName, summarizeRoomAnalysis } from "../utils/roomAnalysisSummary";

export const formatOverlapPercent = value => value > 0 && value < 0.1 ? "<0.1%" : `${value.toFixed(1)}%`;
export const formatOverlapArea = value => value > 0 && value < 0.01 ? "<0.01" : value.toFixed(2);

export default function RoomCorrespondencePanel({ analysis, onClose, onRetry, onChooseReference, onSelect, onInspectAll, onReference,
  onClearHighlight, onFocusOverlap, visibleFloors = null }) {
  const { result, candidateKey } = analysis;
  const panelRef = useRef(null);
  const summary = useMemo(() => summarizeRoomAnalysis(result), [result]);
  useEffect(() => {
    if (!analysis.request) return;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current, drawer = panel?.closest(".left-panel");
      if (!drawer) return;
      // Sticky drawer navigation is an obstruction, not part of the usable viewport.
      const padding = (parseFloat(getComputedStyle(drawer).paddingTop) || 0) + drawer.clientTop;
      const inset = padding + Math.max(0, ...[...drawer.querySelectorAll(".drawer-header, .drawer-tabs")].map(node => {
        const style = getComputedStyle(node);
        return style.display === "none" ? 0 : (parseFloat(style.top) || 0) + node.offsetHeight;
      })) + 12;
      drawer.scrollTo({ top: drawer.scrollTop + panel.getBoundingClientRect().top - drawer.getBoundingClientRect().top - inset, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [analysis.request, result?.status]);
  if (!analysis.request) return null;
  const candidate = result?.groups?.flatMap(group => group.matches).find(match => match.key === candidateKey);
  const direction = result?.groups?.find(group => group.matches.some(match => match.key === candidateKey))?.direction;
  const singleFloor = visibleFloors?.length === 1 ? visibleFloors[0] : null;
  const pairVisible = candidate && (!visibleFloors || visibleFloors.some(floor => [result.reference.floor, candidate.floor].includes(floor)));
  const projectedFloor = candidate && singleFloor !== null ? (singleFloor === result.reference.floor ? candidate.floor : result.reference.floor) : null;
  const matchButton = (match, choose = false) => <button type="button" key={match.key}
    className={`correspondence-result${candidateKey === match.key ? " active" : ""}${hasSpecificAnalysisName(match) ? " specific-name" : ""}`}
    data-feature-key={match.key}
    aria-pressed={choose ? undefined : candidateKey === match.key}
    onClick={() => choose ? onChooseReference(match.key) : onSelect(match.key)}>
    <strong>{match.label}</strong>
    <span className="correspondence-metrics"><span>F{match.floor} · {formatOverlapArea(match.intersectionArea)} m²</span>
      <span>{formatOverlapPercent(match.referencePercent)} overlap</span></span>
    <span className="correspondence-bar" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, match.referencePercent))}%` }} /></span>
    {!choose && candidateKey === match.key && <span className="overlap-selected-state">Selected · {pairVisible ? "highlighted on map" : "shown on paired floors"}</span>}
    <span className="sr-only">Percentage of the selected reference footprint, on a zero to one hundred percent scale.</span>
  </button>;
  return <section ref={panelRef} className="room-correspondence-panel" id="panel-correspondence" aria-label="Rooms Above & Below" aria-busy={result?.status === "loading"}>
    <div className="correspondence-heading"><h3>Rooms Above &amp; Below</h3>
      <button type="button" onClick={onClose} aria-label="Close room correspondence">×</button></div>
    <p className="correspondence-note">Immediate neighboring floors · horizontal footprint analysis</p>
    <div role="status" aria-live="polite">
      {result?.status === "loading" && <p>Preparing floor footprints and calculating overlap…</p>}
      {result?.status === "error" && <p>Analysis unavailable: {result.message} <button onClick={onRetry}>Retry analysis</button></p>}
    </div>
    {result?.status === "choose-reference" && <>
      <p>The F-ALL export differs from the authoritative floor data. Choose the footprint to analyze on F{result.reference.floor}; these are same-floor geometric matches, not inferred room identities.</p>
      {result.choices.map(match => matchButton(match, true))}
      {!result.choices.length && <p>No usable matching footprint. Open F{result.reference.floor} and select a room there.</p>}
    </>}
    {result?.status === "ready" && <>
      <button type="button" className="correspondence-reference" onClick={onReference}>
        <span><span className="correspondence-swatch reference" aria-hidden="true" />Reference · F{result.reference.floor}</span>
        <strong>{result.reference.label}</strong>
        <span>{formatOverlapArea(result.reference.area)} m² footprint</span>
      </button>
      {candidate && <div className="correspondence-inspect">
        <p><span className={`correspondence-swatch candidate ${direction}`} aria-hidden="true" />Corresponding: {candidate.label} · F{candidate.floor}</p>
        <div className="overlap-actions">
          <button type="button" onClick={onClearHighlight}>Clear Highlight</button>
          <button type="button" onClick={onFocusOverlap} disabled={!pairVisible}>Focus on Overlap</button>
        </div>
        <button type="button" onClick={onInspectAll}>Inspect pair in F-ALL</button>
        <p>{!pairVisible ? `Highlight is retained for F${result.reference.floor} and F${candidate.floor}. Open a paired floor or inspect F-ALL.`
          : singleFloor !== null ? `The F${projectedFloor} footprint is projected onto F${singleFloor} for comparison; it is not physically on this floor.`
          : "Outlines and shared footprint use actual elevations on the visible paired floors."}</p>
        <p className="overlap-key"><span>Gold: reference</span><span>{direction === "above" ? "Teal" : "Indigo"}: adjacent feature</span><span>Filled area + white edge: exact intersection</span></p>
        <p>Analytical overlays remain visible through the building. Authoritative outlines may differ from the combined model.</p>
      </div>}
      <div className="correspondence-groups">
        {result.groups.map(group => <section key={group.floor} className={`correspondence-direction ${group.direction}`} aria-label={`Rooms ${group.direction}`}>
          <h4>{group.direction === "above" ? "Immediately Above" : "Immediately Below"} <span>F{group.floor}</span></h4>
          {!group.available ? <p>Floor data unavailable. <button onClick={onRetry}>Retry missing floors</button></p>
            : <><p className="correspondence-count">{group.matches.length} overlapping {group.matches.length === 1 ? "feature" : "features"}</p>
              {group.matches.map(match => matchButton(match))}
              {!group.matches.length && <p>{group.skipped || group.failures ? "No overlap found among usable footprints; analysis is incomplete." : "No overlapping features found on the immediately adjacent floor."}</p>}</>}
          {(group.skipped > 0 || group.failures > 0) && <p>{group.skipped} invalid footprints skipped; {group.failures} intersection failures.</p>}
        </section>)}
      </div>
      <p className="correspondence-note">Bars use a fixed 0–100% scale of the reference footprint. Features may overlap each other; do not add percentages.</p>
      <RoomAnalysisNarration summary={summary} selectionKey={candidateKey} />
    </>}
    <p className="correspondence-note">{FOOTPRINT_LIMITATION}</p>
    {(result?.issues?.length > 0 || result?.errors?.length > 0) && <details className="correspondence-data-notes">
      <summary>Data quality notes ({(result.issues?.length || 0) + (result.errors?.length || 0)})</summary>
      <ul>{[...(result.issues || []), ...(result.errors || [])].map((issue, i) => <li key={i}>F{issue.floor ?? "?"} {issue.label || "Feature"}: {issue.reason}</li>)}</ul>
    </details>}
  </section>;
}
