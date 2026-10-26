import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import RoomCorrespondencePanel, { formatOverlapArea, formatOverlapPercent } from "./RoomCorrespondencePanel";

const render = result => renderToStaticMarkup(<RoomCorrespondencePanel analysis={{ request: { feature: {} }, result }} />);
it("distinguishes empty overlap, missing floors, and incomplete geometry analysis", () => {
  const html = render({ status: "ready", reference: { label: "Test", floor: 0 }, groups: [
    { floor: 1, direction: "above", matches: [], available: true, skipped: 0, failures: 0 },
    { floor: 2, direction: "above", matches: [], available: false, skipped: 0, failures: 0 },
    { floor: 3, direction: "above", matches: [], available: true, skipped: 1, failures: 0 },
  ] });
  expect(html).toContain("No qualifying footprint overlap.");
  expect(html).toContain("Floor data unavailable.");
  expect(html).toContain("analysis is incomplete");
  expect(html).toContain("No supported floors below F0.");
  expect(html).toContain("does not indicate doors");
});
it("shows an explicit resolution step and errors rather than inventing room identities", () => {
  expect(render({ status: "choose-reference", reference: { floor: 3 }, choices: [] })).toContain("No usable matching footprint");
  expect(render({ status: "error", message: "Self-intersection" })).toContain("Self-intersection");
  expect(render({ status: "loading" })).toContain("aria-busy=\"true\"");
});
it("does not round a positive sliver to zero", () => {
  expect(formatOverlapArea(0.0001)).toBe("<0.01");
  expect(formatOverlapPercent(0.001)).toBe("<0.1%");
  expect(formatOverlapPercent(69.6496)).toBe("69.6%");
});
