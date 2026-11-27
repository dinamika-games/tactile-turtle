// The world of a level: a grid of cells with things on them, and the robot
// turtle (DESIGN.md, section 4).
//
// A map is written as rows of characters:
//
//   .  sand            #  rock            ~  sea (hatchlings dropped here are home)
//   R G B Y  floor of that colour
//   h  a hatchling     r g b y  a box of that colour
//   L  a lamp (off)    D  a gate (closed)
//   k  a key (opens a gate with USE)    f  fuel (lights a lamp with USE)
//   c  a crab (in the way until it walks off, see DayOptions.crab)
//   > < ^ v  the turtle on sand, facing east, west, north, south

import type { Goal } from "./goals.ts";

export type Colour = "RED" | "GREEN" | "BLUE" | "YELLOW";
export type Direction = 0 | 1 | 2 | 3; // north, east, south, west

/** A thing on the board; its id stays the same while it is carried about (for the animation). */
export type Thing = { readonly id: number } & (
  | { kind: "ROCK" }
  | { kind: "HATCHLING" }
  | { kind: "BOX"; colour: Colour }
  | { kind: "LAMP"; on: boolean }
  | { kind: "GATE"; open: boolean }
  | { kind: "KEY" }
  | { kind: "FUEL" }
  | { kind: "CRAB" }
);

export interface Cell {
  floor: Colour | "SAND" | "SEA";
  thing: Thing | null;
}

export interface Turtle {
  x: number;
  y: number;
  direction: Direction;
  carrying: Thing[];
}

export interface World {
  readonly width: number;
  readonly height: number;
  readonly cells: Cell[][];
  turtle: Turtle;
  /** How many hatchlings reached the sea. */
  home: number;
  tick: number;
  readonly capacity: number;
  readonly globals: { TIDE: number; LIGHT: (tick: number) => Colour };
  /** What happens by itself as time goes on (DayOptions). */
  readonly clock: { readonly crab: number | null; readonly gates: number | null };
}

const COLOURS: Record<string, Colour> = { R: "RED", G: "GREEN", B: "BLUE", Y: "YELLOW" };
const BOXES: Record<string, Colour> = { r: "RED", g: "GREEN", b: "BLUE", y: "YELLOW" };
const TURTLES: Record<string, Direction> = { "^": 0, ">": 1, v: 2, "<": 3 };

export const STEP: readonly { dx: number; dy: number }[] = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

export interface WorldOptions {
  readonly capacity?: number;
  readonly tide?: number;
  readonly light?: (tick: number) => Colour;
  /** The crabs walk off at this tick. */
  readonly crab?: number;
  /** Every this many ticks, the gates open or close by themselves. */
  readonly gates?: number;
}

/**
 * A day of a level, as written in data/levels.json: the map, and what is
 * different on that day besides it.
 */
export interface Day {
  readonly map: readonly string[];
  /** The global TIDE (a number). */
  readonly tide?: number;
  /** The lighthouse beam, one letter per tick, repeated: "RRRRGGGG" is red for 4 ticks, then green for 4. */
  readonly light?: string;
  /** How many things the turtle can carry (1 if not given). */
  readonly capacity?: number;
  /** The tick at which the crabs walk off. */
  readonly crab?: number;
  /** Every this many ticks, the gates open or close by themselves. */
  readonly gates?: number;
  /** The goals of this day, when they differ from the level's (e.g. how much to paint after counting). */
  readonly goals?: readonly Goal[];
}

/** The world of a day. */
export function dayWorld(day: Day): World {
  const light = day.light;
  return parseMap(day.map, {
    capacity: day.capacity,
    tide: day.tide,
    light: light === undefined ? undefined : (tick) => COLOURS[light[tick % light.length]],
    crab: day.crab,
    gates: day.gates,
  });
}

export function parseMap(rows: readonly string[], options: WorldOptions = {}): World {
  const height = rows.length;
  const width = Math.max(...rows.map((row) => row.length));
  let turtle: Turtle | null = null;
  let nextId = 0;
  const cells: Cell[][] = rows.map((row, y) =>
    Array.from({ length: width }, (_, x) => {
      const c = row[x] ?? "#";
      const cell: Cell = { floor: "SAND", thing: null };
      if (c === "#") cell.thing = { id: nextId++, kind: "ROCK" };
      else if (c === "~") cell.floor = "SEA";
      else if (c in COLOURS) cell.floor = COLOURS[c];
      else if (c === "h") cell.thing = { id: nextId++, kind: "HATCHLING" };
      else if (c in BOXES) cell.thing = { id: nextId++, kind: "BOX", colour: BOXES[c] };
      else if (c === "L") cell.thing = { id: nextId++, kind: "LAMP", on: false };
      else if (c === "D") cell.thing = { id: nextId++, kind: "GATE", open: false };
      else if (c === "k") cell.thing = { id: nextId++, kind: "KEY" };
      else if (c === "f") cell.thing = { id: nextId++, kind: "FUEL" };
      else if (c === "c") cell.thing = { id: nextId++, kind: "CRAB" };
      else if (c in TURTLES) turtle = { x, y, direction: TURTLES[c], carrying: [] };
      else if (c !== ".") throw new Error(`Unknown map character ${JSON.stringify(c)} at ${x},${y}`);
      return cell;
    }),
  );
  if (turtle === null) throw new Error("The map has no turtle.");
  return {
    width,
    height,
    cells,
    turtle,
    home: 0,
    tick: 0,
    capacity: options.capacity ?? 1,
    globals: { TIDE: options.tide ?? 0, LIGHT: options.light ?? (() => "GREEN") },
    clock: { crab: options.crab ?? null, gates: options.gates ?? null },
  };
}

/** A deep copy, for snapshots (frames of the animation). */
export function cloneWorld(world: World): World {
  return {
    ...world,
    cells: world.cells.map((row) => row.map((cell) => ({ floor: cell.floor, thing: cell.thing && { ...cell.thing } }))),
    turtle: { ...world.turtle, carrying: world.turtle.carrying.map((thing) => ({ ...thing })) },
  };
}

export function cellAt(world: World, x: number, y: number): Cell | null {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return null;
  return world.cells[y][x];
}

export function frontOf(world: World): { x: number; y: number; cell: Cell | null } {
  const { dx, dy } = STEP[world.turtle.direction];
  const x = world.turtle.x + dx;
  const y = world.turtle.y + dy;
  return { x, y, cell: cellAt(world, x, y) };
}

/** Can the turtle pick the thing up? */
export function portable(thing: Thing | null): boolean {
  return thing !== null && (thing.kind === "HATCHLING" || thing.kind === "BOX" || thing.kind === "KEY" || thing.kind === "FUEL");
}

/** Time goes on by one tick: what happens by itself (the crabs walk off, the gates open or close). */
export function advanceClock(world: World): void {
  const { crab, gates } = world.clock;
  for (const row of world.cells) {
    for (const cell of row) {
      const thing = cell.thing;
      if (thing?.kind === "CRAB" && crab !== null && world.tick >= crab) cell.thing = null;
      if (thing?.kind === "GATE" && gates !== null && world.tick % gates === 0) thing.open = !thing.open;
    }
  }
}

/** Does the thing block the way? */
export function blocks(thing: Thing | null): boolean {
  if (thing === null) return false;
  return thing.kind !== "GATE" || !thing.open;
}
