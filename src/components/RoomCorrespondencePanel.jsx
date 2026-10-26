import React from "react";

export const formatOverlapPercent = value => value > 0 && value < 0.1 ? "<0.1%" : `${value.toFixed(1)}%`;
export const formatOverlapArea = value => value > 0 && value < 0.01 ? "<0.01" : value.toFixed(2);

export default function RoomCorrespondencePanel({ analysis, onClose, onRetry, onChooseReference, onSelect, onInspectAll, onReference }) {
  if (!analysis.request) return null;
  const { result, candidateKey } = analysis;
  const candidate = result?.groups?.flatMap(group => group.matches).find(match => match.key === candidateKey);
  const matchButton = (match, choose = false) => <button type="button" key={match.key}
    className={`correspondence-result${candidateKey === match.key ? " active" : ""}`}
    aria-pressed={choose ? undefined : candidateKey === match.key}
    onClick={() => choose ? onChooseReference(match.key) : onSelect(match.key)}>
    <strong>{match.label}</strong>
    <span>F{match.floor} · {formatOverlapPercent(match.referencePercent)} of reference · {formatOverlapArea(match.intersectionArea)} m²</span>
  </button>;
  return <section className="room-correspondence-panel" id="panel-correspondence" aria-label="Rooms Above & Below" aria-busy={result?.status === "loading"}>
    <div className="correspondence-heading"><h3>Rooms Above &amp; Below</h3>
      <button type="button" onClick={onClose} aria-label="Close room correspondence">×</button></div>
    <p>Footprint overlap only. This does not indicate doors, stairs, elevators, or physical connectivity.</p>
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
      <button className="correspondence-reference" onClick={onReference}>
        <span className="correspondence-swatch reference" aria-hidden="true" />Reference: {result.reference.label} · F{result.reference.floor}
      </button>
      {candidateKey && <div className="correspondence-inspect">
        <p><span className="correspondence-swatch candidate" aria-hidden="true" />Corresponding: {candidate?.label} · F{candidate?.floor}</p>
        <button type="button" onClick={onInspectAll}>Inspect pair in F-ALL</button>
        <p>Outlines use authoritative footprints. The combined model may differ. Camera position stays under your control; use Fit Building or rotate to inspect the stack.</p>
      </div>}
      <div className="correspondence-groups">
        {["above", "below"].map(direction => <section key={direction} aria-label={`Rooms ${direction}`}>
          <h4>{direction === "above" ? "Above" : "Below"}</h4>
          {!result.groups.some(group => group.direction === direction) && <p>No supported floors {direction} F{result.reference.floor}.</p>}
          {result.groups.filter(group => group.direction === direction).map(group => <details key={group.floor} open>
            <summary>F{group.floor} · {group.matches.length} overlapping {group.matches.length === 1 ? "feature" : "features"}</summary>
            {!group.available ? <p>Floor data unavailable. <button onClick={onRetry}>Retry missing floors</button></p>
              : <>{group.matches.map(match => matchButton(match))}
                {!group.matches.length && <p>{group.skipped || group.failures ? "No overlap found among usable footprints; analysis is incomplete." : "No qualifying footprint overlap."}</p>}</>}
            {(group.skipped > 0 || group.failures > 0) && <p>{group.skipped} invalid footprints skipped; {group.failures} intersection failures.</p>}
          </details>)}
        </section>)}
      </div>
      <p className="correspondence-note">Percentages use the reference footprint. Source features include floor surfaces and structural parts. Do not add percentages when footprints overlap.</p>
    </>}
    {(result?.issues?.length > 0 || result?.errors?.length > 0) && <details className="correspondence-data-notes">
      <summary>Data quality notes ({(result.issues?.length || 0) + (result.errors?.length || 0)})</summary>
      <ul>{[...(result.issues || []), ...(result.errors || [])].map((issue, i) => <li key={i}>F{issue.floor ?? "?"} {issue.label || "Feature"}: {issue.reason}</li>)}</ul>
    </details>}
  </section>;
}
