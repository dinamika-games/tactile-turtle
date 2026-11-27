// Every level can be solved with the tiles of the standard kit, on its plate.
//
// "Solved" means: the reference solution of the level is a valid program, it
// needs no more tiles of any kind than the kit holds, it fits on the plate of
// the level, and run on every day of the level it reaches the goals.

import { describe, expect, it } from "vitest";

import levelsData from "../data/levels.json" with { type: "json" };
import plateData from "../data/plate.json" with { type: "json" };
import { kindByKey, standardKit, kindById } from "../src/lang/catalogue.ts";
import { layoutProgram } from "../src/lang/layout.ts";
import { parse } from "../src/lang/parser.ts";
import { textToRows, tokenizeText } from "../src/lang/tokens.ts";
import { goalMet, type Goal } from "../src/world/goals.ts";
import { run } from "../src/world/run.ts";
import { dayWorld, type Day } from "../src/world/world.ts";

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

describe("the maps", () => {
  const withMaps = levels as unknown as {
    id: number;
    name: string;
    world: number;
    solution: string[];
    days?: Day[];
    goals?: Goal[];
  }[];

  it("exist for every level", () => {
    expect(withMaps.filter((level) => level.days === undefined || level.days.length === 0).map((level) => level.id)).toEqual([]);
    expect(withMaps.filter((level) => level.goals === undefined || level.goals.length === 0).map((level) => level.id)).toEqual([]);
  });

  // From world 4 on, one fixed path must not solve a level (DESIGN.md, "The days").
  it("have two to five days from world 4 on", () => {
    const wrong = withMaps.filter((level) => level.world >= 4 && !(level.days!.length >= 2 && level.days!.length <= 5));
    expect(wrong.map((level) => level.id)).toEqual([]);
  });

  describe.each(withMaps)("level $id: $name", (level) => {
    it("fits on the screen (at most 16 x 11 cells, framed by rocks)", () => {
      for (const day of level.days!) {
        const world = dayWorld(day);
        expect(world.width).toBeLessThanOrEqual(16);
        expect(world.height).toBeLessThanOrEqual(11);
        expect(day.map.every((row) => row.length === world.width), "every row as long").toBe(true);
        const edge = [day.map[0], day.map.at(-1)!, ...day.map.map((row) => row[0] + row.at(-1))].join("");
        expect(edge.replace(/#/g, ""), "the edge is rock").toBe("");
      }
    });

    it.each((level.days ?? []).map((day, index) => ({ day, index })))("is won on day $index", ({ day }) => {
      const program = parse(tokenizeText(level.solution.join("\n")));
      const world = dayWorld(day);
      for (const _ of run(program, world)) {
        // Run to the end.
      }
      for (const goal of day.goals ?? level.goals!) expect(goalMet(goal, world), JSON.stringify(goal)).toBe(true);
    });
  });
});
