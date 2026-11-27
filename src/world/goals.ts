// The goals of a level (DESIGN.md, section 4), checked after a run.

import type { Colour, World } from "./world.ts";

const PAINT: Record<string, Colour> = { R: "RED", G: "GREEN", B: "BLUE", Y: "YELLOW" };

/** The colour each cell of a "painted" goal must have (null: any). */
export function paintTargets(pattern: readonly string[]): (Colour | null)[][] {
  return pattern.map((row) => [...row].map((c) => PAINT[c] ?? null));
}

export type Goal =
  | { kind: "reach"; x: number; y: number }
  | { kind: "reach_colour"; colour: Colour }
  | { kind: "sorted" }
  | { kind: "home"; count: number }
  | { kind: "lamps" }
  /** The cells painted as in the pattern (R, G, B, Y; any other character: whatever is there). */
  | { kind: "painted"; pattern: string[] };

export function goalMet(goal: Goal, world: World): boolean {
  const turtle = world.turtle;
  switch (goal.kind) {
    case "reach":
      return turtle.x === goal.x && turtle.y === goal.y;
    case "reach_colour":
      return world.cells[turtle.y][turtle.x].floor === goal.colour;
    case "sorted":
      // Every box stands on the floor of its own colour, and none is carried.
      return (
        turtle.carrying.length === 0 &&
        world.cells.every((row) => row.every((cell) => cell.thing?.kind !== "BOX" || cell.floor === cell.thing.colour))
      );
    case "home":
      return world.home >= goal.count;
    case "lamps":
      return world.cells.every((row) => row.every((cell) => cell.thing?.kind !== "LAMP" || cell.thing.on));
    case "painted":
      return paintTargets(goal.pattern).every((row, y) =>
        row.every((colour, x) => colour === null || world.cells[y]?.[x]?.floor === colour),
      );
  }
}
