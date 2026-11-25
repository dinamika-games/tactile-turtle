// The goals of a level (DESIGN.md, section 4), checked after a run.

import type { Colour, World } from "./world.ts";

export type Goal =
  | { kind: "reach"; x: number; y: number }
  | { kind: "reach_colour"; colour: Colour }
  | { kind: "sorted" }
  | { kind: "home"; count: number }
  | { kind: "lamps" };

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
  }
}
