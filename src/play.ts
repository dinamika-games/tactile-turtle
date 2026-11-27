// Playing a program on a level: run it on every day of the level and turn a
// run into frames for the animation (shared by the camera page and the demo).
// The level is won when the goals are met on every day; the animation shows
// the first day on which they were not (or the first day, when all were).

import levelsData from "../data/levels.json" with { type: "json" };
import { parse, ParseError } from "./lang/parser.ts";
import type { Token } from "./lang/tokens.ts";
import type { AnimationFrame } from "./render/animation.ts";
import { goalMet, paintTargets, type Goal } from "./world/goals.ts";
import { run, RunError } from "./world/run.ts";
import { cloneWorld, dayWorld, type Colour, type Day, type World } from "./world/world.ts";

export interface Level {
  readonly id: number;
  readonly name: string;
  readonly days: Day[];
  readonly goals: Goal[];
}

/** The goals of a day: its own, or the level's. */
export function dayGoals(level: Level, day: Day): readonly Goal[] {
  return day.goals ?? level.goals;
}

/** The colours to paint on a day of the level (its "painted" goal), if any; the first day by default. */
export function levelTargets(level: Level, day: Day = level.days[0]): (Colour | null)[][] | undefined {
  const goal = dayGoals(level, day).find((candidate) => candidate.kind === "painted");
  return goal?.kind === "painted" ? paintTargets(goal.pattern) : undefined;
}

export function levelById(id: number): Level {
  const level = levelsData.levels.find((candidate) => candidate.id === id) as unknown as Level | undefined;
  if (level === undefined) throw new Error(`There is no level ${id}.`);
  return level;
}

/** The goal of a level in one sentence. */
export function goalSentence(level: Level): string {
  return dayGoals(level, level.days[0])
    .map((goal) => {
      switch (goal.kind) {
        case "reach":
          return "Walk to the sea.";
        case "reach_colour":
          return `Follow the line to the ${goal.colour.toLowerCase()} cell.`;
        case "sorted":
          return "Put every box on its colour.";
        case "home":
          return "Bring the hatchlings to the sea.";
        case "lamps":
          return "Switch on every lamp.";
        case "painted":
          return "Paint the cells in the dashed frames.";
      }
    })
    .join(" ");
}

export interface Played {
  /** The day shown (the first one not won, or the first one). */
  readonly day: Day;
  readonly frames: AnimationFrame[];
  /** The sentence at the end: well done, not quite, or what went wrong. */
  readonly ending: string;
  readonly won: boolean;
  readonly world: World;
}

/** The words of a run, in the language of the game (English by default). */
export interface RunWords {
  caption(token: Token): string;
  readonly wellDone: string;
  readonly notQuite: string;
  /** The sentence of a parse or run error. */
  error(error: ParseError | RunError): string;
}

export const ENGLISH_WORDS: RunWords = {
  caption: (token) => token.kind.symbol ?? token.kind.key.replace("_", " "),
  wellDone: "Well done!",
  notQuite: "Not quite: try again",
  error: (error) => error.message,
};

/** Run the tokens on the level, day by day; a parse or run error ends the run with its message. */
export function play(level: Level, tokens: readonly Token[], words: RunWords = ENGLISH_WORDS): Played {
  let first: Played | null = null;
  for (const day of level.days) {
    const played = playDay(level, day, tokens, words);
    if (!played.won) return played;
    first ??= played;
  }
  return first!;
}

function playDay(level: Level, day: Day, tokens: readonly Token[], words: RunWords): Played {
  const world = dayWorld(day);
  const frames: AnimationFrame[] = [{ world: cloneWorld(world), token: null, caption: level.name }];
  let ending: string;
  let won = false;
  try {
    const program = parse(tokens);
    for (const { token } of run(program, world)) {
      frames.push({ world: cloneWorld(world), token, caption: words.caption(token) });
    }
    won = dayGoals(level, day).every((goal) => goalMet(goal, world));
    ending = won ? words.wellDone : words.notQuite;
  } catch (error) {
    ending = error instanceof ParseError || error instanceof RunError ? words.error(error) : String(error);
  }
  frames.push({ world: cloneWorld(world), token: null, caption: ending });
  return { day, frames, ending, won, world };
}
