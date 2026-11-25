import { describe, expect, it } from "vitest";

import plateData from "../data/plate.json" with { type: "json" };
import { SCENARIOS } from "../src/demo.ts";
import { layoutProgram } from "../src/lang/layout.ts";
import { tokenizeText } from "../src/lang/tokens.ts";
import { levelById, play } from "../src/play.ts";

describe("the demo scenarios", () => {
  const plate = plateData.plates.find((candidate) => candidate.name === "a4")!;

  it.each(SCENARIOS)("$about", (scenario) => {
    expect(layoutProgram(scenario.program, plate.columns, plate.rows, true), "fits on the plate").not.toBeNull();
    const played = play(levelById(scenario.level), tokenizeText(scenario.program));
    expect(played.frames.length).toBeGreaterThan(1);
  });

  it("show a win, a mistake and an error", () => {
    const endings = SCENARIOS.map((scenario) => play(levelById(scenario.level), tokenizeText(scenario.program)));
    expect(endings.some((played) => played.won)).toBe(true);
    expect(endings.some((played) => played.ending === "Not quite: try again")).toBe(true);
    expect(endings.some((played) => played.ending.includes("needs an END"))).toBe(true);
  });
});
