import { describe, expect, it } from "vitest";
import { generateSpeechText, generateStepSpeech } from "./directionsGenerator";

describe("directionsGenerator speech", () => {
  it("does not append separate per-step distance text to spoken instructions", () => {
    const direction = {
      type: "straight",
      instruction: "Continue straight for 20 meters.",
      distance: 20,
      floor: 1,
    };

    expect(generateStepSpeech(direction)).toBe("Continue straight for 20 meters.");
  });

  it("does not append extra floor-transition text to spoken instructions", () => {
    const direction = {
      type: "vertical",
      instruction: "Take the elevator from Floor 1 to Floor 7.",
      distance: 0,
      floor: 1,
      targetFloor: 7,
    };

    expect(generateStepSpeech(direction)).toBe(
      "Take the elevator from Floor 1 to Floor 7.",
    );
  });

  it("uses the displayed instruction text when generating full-route speech", () => {
    const directions = [
      {
        type: "start",
        text: "Start at Main Lobby.",
        instruction: "Start at Elevator.",
        distance: 0,
      },
      {
        type: "straight",
        instruction: "Continue straight for 20 meters.",
        distance: 20,
      },
    ];

    expect(generateSpeechText(directions)).toBe(
      "Start at Main Lobby. Continue straight for 20 meters.",
    );
  });

  it("prefers text field over instruction field", () => {
    const direction = {
      type: "straight",
      text: "Continue with Journals A–D on your left.",
      instruction: "old fallback text",
    };

    expect(generateStepSpeech(direction)).toBe(
      "Continue with Journals A to D on your left.",
    );
  });

  it("converts en-dash ranges in landmark names to spoken 'to'", () => {
    const direction = {
      text: "Continue between Journals A–D on your left and Journals E–H on your right toward Special Collections.",
    };

    const spoken = generateStepSpeech(direction);
    expect(spoken).toContain("Journals A to D");
    expect(spoken).toContain("Journals E to H");
    expect(spoken).not.toContain("–");
  });

  it("appends a period when the instruction text has no terminal punctuation", () => {
    const direction = { instruction: "Turn left at the Reference Section" };
    expect(generateStepSpeech(direction)).toBe(
      "Turn left at the Reference Section.",
    );
  });

  it("does not double-add a period when the text already ends with one", () => {
    const direction = { instruction: "You have arrived at Special Collections." };
    expect(generateStepSpeech(direction)).toBe(
      "You have arrived at Special Collections.",
    );
  });
});
