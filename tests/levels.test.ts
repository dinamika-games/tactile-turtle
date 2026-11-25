// Every level can be solved with the tiles of the standard kit, on its plate.
//
// "Solved" means: the reference solution of the level is a valid program, it
// needs no more tiles of any kind than the kit holds, and it fits on the plate
// of the level. For the levels whose maps exist already, the solution is also
// run on every day and must reach the goals (DESIGN.md, section 13); the maps
// of the other levels are being written.

import { describe, expect, it } from "vitest";

import levelsData from "../data/levels.json" with { type: "json" };
import plateData from "../data/plate.json" with { type: "json" };
import { kindByKey, standardKit, kindById } from "../src/lang/catalogue.ts";
import { layoutProgram } from "../src/lang/layout.ts";
import { parse } from "../src/lang/parser.ts";
import { textToRows, tokenizeText } from "../src/lang/tokens.ts";
import { goalMet, type Goal } from "../src/world/goals.ts";
import { run } from "../src/world/run.ts";
import { parseMap } from "../src/world/world.ts";

const levels = levelsData.levels;

describe("the levels", () => {
  it("are numbered 1 to 100", () => {
    expect(levels.map((level) => level.id)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  describe.each(levels)("level $id: $name", (level) => {
    const text = level.solution.join("\n");

    it("has a reference solution which parses", () => {
      expect(() => parse(tokenizeText(text))).not.toThrow();
    });

    it("needs no more tiles than the kit holds", () => {
      const kit = standardKit();
      const used = new Map<number, number>();
      for (const id of textToRows(text).flat()) used.set(id, (used.get(id) ?? 0) + 1);

      const missing = [...used]
        .filter(([id, count]) => count > (kit.get(id) ?? 0))
        .map(([id, count]) => `${kindById(id)!.key}: needs ${count}, the kit has ${kit.get(id)}`);
      expect(missing).toEqual([]);
    });

    it("fits on its plate", () => {
      const plate = plateData.plates.find((candidate) => candidate.name === level.plate);
      expect(plate).toBeDefined();
      expect(layoutProgram(text, plate!.columns, plate!.rows, true)).not.toBeNull();
    });
  });
});

describe("the kit", () => {
  // Numbers and the common symbols appear in many programs; a group should
  // never run out of them while trying a second idea next to the first one.
  it("has plenty of digits", () => {
    for (const digit of "0123456789") {
      expect(kindByKey(digit).kit, `digit ${digit}`).toBeGreaterThanOrEqual(4);
    }
  });

  it("has plenty of the common symbols", () => {
    for (const key of ["ASSIGN", "EQUAL", "NOT_EQUAL", "LESS", "GREATER", "PLUS", "END"]) {
      expect(kindByKey(key).kit, key).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the levels with maps", () => {
  const withMaps = levels.filter((level) => "days" in level) as unknown as {
    id: number;
    name: string;
    solution: string[];
    days: { map: string[] }[];
    goals: Goal[];
  }[];

  it("include the first levels", () => {
    expect(withMaps.length).toBeGreaterThan(0);
  });

  describe.each(withMaps)("level $id: $name", (level) => {
    it.each(level.days.map((day, index) => ({ day, index })))("is won on day $index", ({ day }) => {
      const program = parse(tokenizeText(level.solution.join("\n")));
      const world = parseMap(day.map);
      for (const _ of run(program, world)) {
        // Run to the end.
      }
      for (const goal of level.goals) expect(goalMet(goal, world), JSON.stringify(goal)).toBe(true);
    });
  });
});
