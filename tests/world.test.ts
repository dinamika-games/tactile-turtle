import { describe, expect, it } from "vitest";

import { parse } from "../src/lang/parser.ts";
import { tokenizeText } from "../src/lang/tokens.ts";
import { MAX_TICKS, run, RunError } from "../src/world/run.ts";
import { parseMap, type World } from "../src/world/world.ts";

function runText(text: string, world: World): World {
  for (const _ of run(parse(tokenizeText(text)), world)) {
    // Run to the end.
  }
  return world;
}

function errorOf(text: string, world: World): RunError {
  try {
    runText(text, world);
  } catch (error) {
    if (error instanceof RunError) return error;
    throw error;
  }
  throw new Error("No error");
}

describe("the interpreter", () => {
  it("moves and turns", () => {
    const world = runText("FORWARD RIGHT FORWARD", parseMap(["####", "#..#", "#^.#", "####"]));
    expect(world.turtle).toMatchObject({ x: 2, y: 1, direction: 1 });
  });

  it("bumps into rocks, pointing at the tile", () => {
    const error = errorOf("FORWARD FORWARD", parseMap(["###", "#.#", "#^#", "###"]));
    expect(error.code).toBe("bump");
    expect(error.token.column).toBe(1);
  });

  it("picks up and drops hatchlings into the sea", () => {
    const world = runText("PICK_UP RIGHT RIGHT DROP", parseMap(["###", "#h#", "#^#", "#~#", "###"]));
    expect(world.home).toBe(1);
  });

  it("switches lamps and uses items on gates", () => {
    const world = runText("SWITCH RIGHT PICK_UP RIGHT USE", parseMap(["#####", "#.L.#", "#.^b#", "#.D.#", "#####"]));
    expect(world.cells[1][2].thing).toMatchObject({ kind: "LAMP", on: true });
    expect(world.cells[3][2].thing).toMatchObject({ kind: "GATE", open: true });
  });

  it("reads the sensors", () => {
    const world = runText(
      "IF COLOUR = RED a ← 1 END IF FRONT = BOX b ← 2 END PICK_UP RIGHT RIGHT DROP RIGHT RIGHT REPEAT a + b FORWARD END",
      parseMap(["########", "#.>r...#", "########"]),
    );
    expect(world.turtle.x).toBe(5);
    expect(world.cells[1][1].thing).toMatchObject({ kind: "BOX", colour: "RED" });
  });

  it("counts with FOR, up and down", () => {
    const world = runText("FOR a ← 3 TO 1 REPEAT a FORWARD END RIGHT RIGHT END", parseMap(["#########", "#>......#", "#########"]));
    // 3 forward, turn, 2 back, turn, 1 forward: at x = 1 + 3 - 2 + 1.
    expect(world.turtle.x).toBe(3);
  });

  it("runs procedures, also recursively", () => {
    const world = runText(
      "DEFINE ★ IF FRONT = FREE FORWARD ★ FORWARD ELSE RIGHT RIGHT END END ★",
      parseMap(["#######", "#>....#", "#######"]),
    );
    expect(world.turtle).toMatchObject({ x: 1, direction: 3 });
  });

  it("runs recursion with a parameter (a spiral, walked inward)", () => {
    // ★ n: n steps, turn, then ★ n − 1; the parameter is the procedure's own.
    const world = runText(
      "a ← 9 DEFINE ★ a IF a > 0 REPEAT a FORWARD END RIGHT ★ a − 1 END END ★ 3 b ← a",
      parseMap(["#######", "#>....#", "#.....#", "#.....#", "#######"]),
    );
    // 3 east, 2 south, 1 west: from (1,1) to (3,3); a is 9 again after the call.
    expect(world.turtle).toMatchObject({ x: 3, y: 3 });
  });

  it("gets tired in an endless loop", () => {
    const error = errorOf("WHILE FRONT = ROCK WAIT END", parseMap(["###", "#^#", "###"]));
    expect(error.code).toBe("tired");
    expect(MAX_TICKS).toBe(1000);
  });
});
