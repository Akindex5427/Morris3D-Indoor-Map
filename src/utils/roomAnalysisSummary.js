// Presentation only: geometry statistics and floor relationships come from the engine.
export const FOOTPRINT_LIMITATION = "Footprint overlap does not establish doors, stairs, elevators, physical connectivity, structural support, or shared building systems.";
const genericLabels = new Set(["floor", "structure", "floor surface", "unnamed feature"]);
export const hasSpecificAnalysisName = match => Boolean(match.name?.trim()) &&
  !genericLabels.has(match.name.trim().toLowerCase());

function narrationRank(match) {
  const verified = match.classification?.provenance?.trim();
  const role = verified ? match.classification.analysisRole : null;
  if (["background", "structural"].includes(role)) return 0;
  if (["space", "circulation"].includes(role)) return 2;
  // This is a name-specificity preference, never a room-function classification.
  return hasSpecificAnalysisName(match) ? 1 : 0;
}
const spokenPercent = value => value < 1 ? "less than 1 percent" : `about ${Math.round(value)} percent`;
const spokenArea = value => value < 0.1 ? "less than 0.1" : `approximately ${value.toFixed(1)}`;

export function summarizeRoomAnalysis(result) {
  if (result?.status !== "ready") return null;
  const { reference } = result;
  const sentences = [`You're viewing ${reference.label} on floor F${reference.floor}, with a footprint of ${spokenArea(reference.area)} square meters.`];
  const findings = [];
  for (const group of result.groups) {
    const location = `Immediately ${group.direction}, on F${group.floor}`;
    if (!group.available) {
      sentences.push(`${location}, the floor data is unavailable, so overlap cannot be determined.`);
      continue;
    }
    const ranked = [...group.matches].sort((a, b) => narrationRank(b) - narrationRank(a) ||
      b.intersectionArea - a.intersectionArea || a.key.localeCompare(b.key));
    const first = ranked[0];
    if (!first) sentences.push(`${location}, ${group.skipped || group.failures ? "no overlaps were found among usable footprints; the analysis is incomplete" : "no overlapping features were found"}.`);
    else {
      findings.push({ direction: group.direction, floor: group.floor, key: first.key });
      sentences.push(`${location}, the feature labeled ${first.label} overlaps ${spokenPercent(first.referencePercent)} of the selected footprint.`);
      // One main finding per side keeps narration concise; the cards retain every match.
      if (group.skipped || group.failures) sentences.push(`Some footprints on F${group.floor} could not be evaluated.`);
    }
  }
  sentences.push("Percentages describe this footprint; overlapping results must not be added.");
  sentences.push("Footprint overlap does not establish physical connectivity, structural support, or shared building systems.");
  return { referenceKey: reference.key, findings, sentences, text: sentences.join(" ") };
}
