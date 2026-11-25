// Playing a program on a level: run it on the level's first day and turn the
// run into frames for the animation (shared by the camera page and the demo).

import levelsData from "../data/levels.json" with { type: "json" };
import { parse, ParseError } from "./lang/parser.ts";
import type { Token } from "./lang/tokens.ts";
import type { AnimationFrame } from "./render/animation.ts";
import { goalMet, type Goal } from "./world/goals.ts";
import { run, RunError } from "./world/run.ts";
import { cloneWorld, parseMap, type World } from "./world/world.ts";

export interface Level {
  readonly id: number;
  readonly name: string;
  readonly days: { map: string[] }[];
  readonly goals: Goal[];
}

export function levelById(id: number): Level {
  const level = levelsData.levels.find((candidate) => candidate.id === id) as unknown as Level | undefined;
  if (level === undefined || !("days" in level)) throw new Error(`Level ${id} has no map yet.`);
  return level;
}

/** The goal of a level in one sentence. */
export function goalSentence(level: Level): string {
  return level.goals
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
      }
    })
    .join(" ");
}

export interface Played {
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
}

export const ENGLISH_WORDS: RunWords = {
  caption: (token) => token.kind.symbol ?? token.kind.key.replace("_", " "),
  wellDone: "Well done!",
  notQuite: "Not quite: try again",
};

/** Run the tokens on the level; a parse or run error ends the run with its message. */
export function play(level: Level, tokens: readonly Token[], words: RunWords = ENGLISH_WORDS): Played {
  const world = parseMap(level.days[0].map);
  const frames: AnimationFrame[] = [{ world: cloneWorld(world), token: null, caption: level.name }];
  let ending: string;
  let won = false;
  try {
    const program = parse(tokens);
    for (const { token } of run(program, world)) {
      frames.push({ world: cloneWorld(world), token, caption: words.caption(token) });
    }
    won = level.goals.every((goal) => goalMet(goal, world));
    ending = won ? words.wellDone : words.notQuite;
  } catch (error) {
    ending = error instanceof ParseError || error instanceof RunError ? error.message : String(error);
  }
  frames.push({ world: cloneWorld(world), token: null, caption: ending });
  return { frames, ending, won, world };
}
