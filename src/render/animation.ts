// An animated SVG of a whole run: the board on the left, the program on the
// right with the tile being run lit up. Everything moves smoothly: the
// turtle glides and turns, a thing picked up floats onto its back (and down
// again when dropped), paint fades in, lamps light up. The game shows runs
// this way, and the README too; the animation is SMIL, which every browser
// plays (also in an <img>).

import type { Token } from "../lang/tokens.ts";
import type { Colour, Thing, World } from "../world/world.ts";
import { frontOf } from "../world/world.ts";
import type { Skin } from "./skin.ts";
import {
  boardDefs,
  captionHeight,
  CARRIED_SCALE,
  CELL,
  drawCaption,
  drawColourCell,
  drawGrid,
  drawGround,
  drawLampGlow,
  drawTargets,
  drawThingShape,
  drawTurtleShape,
  drawTurtleSprite,
  escapeXml,
  SPRITE_FRAMES,
} from "./board.ts";

export interface AnimationFrame {
  readonly world: World;
  /** The token just run (null: before the start). */
  readonly token: Token | null;
  readonly caption: string;
}

export interface AnimationOptions {
  /** The time of one step, in milliseconds. */
  readonly stepMs?: number;
  /** Play again and again (the README), or once and stay (the game). */
  readonly loop?: boolean;
  /** How long the end is shown, in steps. */
  readonly endSteps?: number;
  /** Draw with sprites (the turtle walks and turns in frames) instead of vectors. */
  readonly skin?: Skin;
  /** The word on a tile in the picture of the program (default: English). */
  readonly word?: (token: Token) => string;
  /** The colours to paint (a "painted" goal), drawn as dashed frames. */
  readonly targets?: readonly (readonly (Colour | null)[])[];
}

/** The share of a step spent standing still before moving. */
const HOLD = 0.3;
const EASE = "0.42 0 0.58 1";

/** The timeline of a run: when each step starts moving and when it arrives. */
class Timeline {
  readonly duration: number;
  readonly starts: number[] = [];
  readonly ends: number[] = [];
  private readonly loop: boolean;

  constructor(steps: number, stepMs: number, endSteps: number, loop: boolean) {
    for (let i = 1; i <= steps; i++) {
      this.starts.push(((i - 1) * stepMs + HOLD * stepMs) / 1000);
      this.ends.push((i * stepMs) / 1000);
    }
    this.duration = ((steps + endSteps) * stepMs) / 1000;
    this.loop = loop;
  }

  private timing(): string {
    return this.loop ? `dur="${this.duration}s" repeatCount="indefinite"` : `dur="${this.duration}s" fill="freeze"`;
  }

  /** Smooth: hold each state, then ease to the next. ``states[i]`` is the state after step i. */
  smooth(attribute: string, states: readonly string[], type?: "translate" | "rotate" | "scale"): string {
    const times = [0];
    const values = [states[0]];
    for (let i = 0; i < this.starts.length; i++) {
      times.push(this.starts[i], this.ends[i]);
      values.push(states[i], states[i + 1]);
    }
    times.push(this.duration);
    values.push(states[states.length - 1]);
    if (values.every((value) => value === values[0])) return "";
    const keyTimes = times.map((time) => (time / this.duration).toFixed(5)).join(";");
    const splines = Array.from({ length: times.length - 1 }, () => EASE).join(";");
    const element = type === undefined ? "animate" : "animateTransform";
    const typeAttribute = type === undefined ? "" : ` type="${type}"`;
    return (
      `<${element} attributeName="${attribute}"${typeAttribute} values="${values.join(";")}" keyTimes="${keyTimes}" ` +
      `calcMode="spline" keySplines="${splines}" ${this.timing()}/>`
    );
  }

  /** The time when step i (from 1) starts moving, and when it arrives. */
  motion(i: number): { start: number; end: number } {
    return { start: this.starts[i - 1], end: this.ends[i - 1] };
  }

  /** Discrete, at explicit times (seconds, from 0): ``values[k]`` holds from ``times[k]``. */
  discreteAt(attribute: string, times: readonly number[], values: readonly string[], type?: "rotate"): string {
    const keyTimes: string[] = [];
    const kept: string[] = [];
    times.forEach((time, k) => {
      if (kept.length > 0 && kept[kept.length - 1] === values[k]) return;
      keyTimes.push((time / this.duration).toFixed(5));
      kept.push(values[k]);
    });
    if (kept.length === 1) return "";
    const element = type === undefined ? "animate" : "animateTransform";
    const typeAttribute = type === undefined ? "" : ` type="${type}"`;
    return (
      `<${element} attributeName="${attribute}"${typeAttribute} values="${kept.join(";")}" keyTimes="${keyTimes.join(";")}" ` +
      `calcMode="discrete" ${this.timing()}/>`
    );
  }

  /** Discrete: ``states[i]`` holds from the start of step i (state 0 before the first step). */
  discrete(attribute: string, states: readonly string[]): string {
    const times = [0, ...this.starts];
    const keyTimes: string[] = [];
    const values: string[] = [];
    states.forEach((state, i) => {
      if (values.length > 0 && values[values.length - 1] === state) return;
      keyTimes.push((times[i] / this.duration).toFixed(5));
      values.push(state);
    });
    if (values.length === 1) return "";
    return (
      `<animate attributeName="${attribute}" values="${values.join(";")}" keyTimes="${keyTimes.join(";")}" ` +
      `calcMode="discrete" ${this.timing()}/>`
    );
  }
}

interface Placement {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly opacity: number;
  readonly thing: Thing;
}

/** Where every thing is in a frame: on its cell, on the turtle's back, or gone. */
function placements(world: World): Map<number, Placement> {
  const result = new Map<number, Placement>();
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const thing = world.cells[y][x].thing;
      if (thing !== null) {
        result.set(thing.id, { x: x * CELL + CELL / 2, y: y * CELL + CELL / 2, scale: 1, opacity: 1, thing });
      }
    }
  }
  const t = world.turtle;
  t.carrying.forEach((thing, i) =>
    result.set(thing.id, {
      x: t.x * CELL + CELL / 2,
      y: t.y * CELL + CELL / 2 + 2 - i * 5,
      scale: CARRIED_SCALE,
      opacity: 1,
      thing,
    }),
  );
  return result;
}

const CHIP_HEIGHT = 34;
const ROW_GAP = 8;

const GROUP_STROKE: Record<string, string> = {
  action: "#2e9e4f",
  control: "#e8871e",
  operator: "#8a8f98",
  number: "#9e9e9e",
  variable: "#d8ae00",
  sensor: "#8e4fc2",
  value: "#2f6fd6",
};

function englishWord(token: Token): string {
  return token.kind.group === "number" ? String(token.value) : (token.kind.symbol ?? token.kind.key.replace("_", " "));
}

function sameToken(a: Token | null, b: Token): boolean {
  return a !== null && a.row === b.row && a.column === b.column;
}

export function renderRunAnimation(
  tokens: readonly Token[],
  frames: readonly AnimationFrame[],
  options: AnimationOptions = {},
): string {
  const stepMs = options.stepMs ?? 700;
  const chipLabel = (token: Token) => (token.kind.group === "number" ? String(token.value) : (options.word ?? englishWord)(token));
  const timeline = new Timeline(frames.length - 1, stepMs, options.endSteps ?? 3, options.loop ?? true);
  const first = frames[0].world;
  const boardWidth = first.width * CELL;
  const boardHeight = first.height * CELL;
  const skin = options.skin;
  const parts: string[] = [boardDefs(), drawGround(first, skin)];

  // The coloured cells; those that change (PAINT) fade from one colour to the next.
  for (let y = 0; y < first.height; y++) {
    for (let x = 0; x < first.width; x++) {
      const floors = frames.map((frame) => frame.world.cells[y][x].floor);
      const colours = [...new Set(floors)].filter((floor) => floor !== "SAND" && floor !== "SEA") as Colour[];
      for (const colour of colours) {
        const states = floors.map((floor) => (floor === colour ? "1" : "0"));
        const group = drawColourCell(colour, x, y, Number(states[0]), skin);
        parts.push(group.replace("</g>", `${timeline.smooth("opacity", states)}</g>`));
      }
    }
  }
  parts.push(drawGrid(first));
  parts.push(drawTargets(options.targets));

  // The things.
  const all = frames.map((frame) => placements(frame.world));
  const ids = [...new Set(all.flatMap((map) => [...map.keys()]))].sort((a, b) => a - b);
  const movable: string[] = [];
  for (const id of ids) {
    const sequence: Placement[] = [];
    all.forEach((map, i) => {
      const placement = map.get(id);
      if (placement !== undefined) {
        sequence.push(placement);
      } else {
        // Gone: a hatchling dropped into the sea swims off in front of the
        // turtle (a key or fuel is used up there); a crab walks off where it was.
        const previous = sequence[i - 1];
        const front = frontOf(frames[i].world);
        const inPlace = previous.thing.kind === "CRAB";
        sequence.push({
          ...previous,
          x: inPlace ? previous.x : front.x * CELL + CELL / 2,
          y: inPlace ? previous.y : front.y * CELL + CELL / 2,
          scale: 1,
          opacity: 0,
        });
      }
    });
    const thing = sequence[0].thing;
    const at = (p: Placement) => `${p.x} ${p.y}`;
    const translate = timeline.smooth("transform", sequence.map(at), "translate");
    const scale = timeline.smooth("transform", sequence.map((p) => String(p.scale)), "scale");
    const opacity = timeline.smooth("opacity", sequence.map((p) => String(p.opacity)));
    const open = `<g transform="translate(${at(sequence[0])})" opacity="${sequence[0].opacity}">${translate}${opacity}` +
      `<g transform="scale(${sequence[0].scale})">${scale}`;
    const close = `</g></g>`;

    // Sprites bring their own shadows; the vector shapes get one from a filter.
    const shadow = skin === undefined ? ' filter="url(#shadow)"' : "";
    if (thing.kind === "LAMP") {
      const on = sequence.map((p) => (p.thing.kind === "LAMP" && p.thing.on ? "1" : "0"));
      const glow = skin === undefined ? drawLampGlow() : "";
      parts.push(
        open +
          `<g${shadow}>${drawThingShape({ ...thing, on: false }, skin)}</g>` +
          `<g opacity="${on[0]}">${timeline.smooth("opacity", on)}${glow}${drawThingShape({ ...thing, on: true }, skin)}</g>` +
          close,
      );
    } else if (thing.kind === "GATE") {
      const states = sequence.map((p) => (p.thing.kind === "GATE" && p.thing.open ? "1" : "0"));
      const closed = states.map((state) => (state === "1" ? "0" : "1"));
      parts.push(
        open +
          `<g opacity="${states[0]}">${timeline.smooth("opacity", states)}${drawThingShape({ ...thing, open: true }, skin)}</g>` +
          `<g opacity="${closed[0]}"${shadow}>${timeline.smooth("opacity", closed)}${drawThingShape({ ...thing, open: false }, skin)}</g>` +
          close,
      );
    } else if (thing.kind === "ROCK") {
      parts.push(`<g transform="translate(${at(sequence[0])})"${shadow}>${drawThingShape(thing, skin)}</g>`);
    } else {
      // A hatchling or a box: picked up, it floats onto the turtle's back (the
      // real thing, in its own colour), and back down when dropped.
      movable.push(open + `<g${shadow}>${drawThingShape(thing, skin)}</g>` + close);
    }
  }

  // The turtle: it glides and turns (the turns unwrapped, so that it never spins round).
  let degrees = frames[0].world.turtle.direction * 90;
  const turns = frames.map((frame, i) => {
    if (i > 0) {
      const delta = (frame.world.turtle.direction - frames[i - 1].world.turtle.direction + 4) % 4;
      degrees += delta === 1 ? 90 : delta === 3 ? -90 : delta === 2 ? 180 : 0;
    }
    return String(degrees);
  });
  const positions = frames.map(
    (frame) => `${frame.world.turtle.x * CELL + CELL / 2} ${frame.world.turtle.y * CELL + CELL / 2}`,
  );
  if (skin === undefined) {
    parts.push(
      `<g transform="translate(${positions[0]})">${timeline.smooth("transform", positions, "translate")}` +
        `<g transform="rotate(${turns[0]})">${timeline.smooth("transform", turns, "rotate")}` +
        `<g filter="url(#shadow)">${drawTurtleShape()}</g></g></g>`,
    );
  } else {
    parts.push(
      `<g transform="translate(${positions[0]})">${timeline.smooth("transform", positions, "translate")}` +
        turtleSprites(frames, turns, timeline, skin) +
        `</g>`,
    );
  }
  // Things carried are drawn above the turtle.
  parts.push(...movable);
  parts.push(`<rect width="${boardWidth}" height="${boardHeight}" fill="url(#vignette)"/>`);

  // The captions, one after the other (all as tall as the tallest).
  const captionSpace = Math.max(...frames.map((frame) => captionHeight(frame.caption, boardWidth)));
  frames.forEach((frame, i) => {
    const states = frames.map((_, j) => (j === i ? "1" : "0"));
    parts.push(
      drawCaption(frame.caption, boardWidth, boardHeight, i === 0 ? 1 : 0, captionSpace).replace(
        "</g>",
        `${timeline.discrete("opacity", states)}</g>`,
      ),
    );
  });

  // The program, with the tile being run lit up.
  const gap = 24;
  const x0 = boardWidth + gap;
  const rowWidths = new Map<number, number>();
  let panelWidth = 0;
  for (const token of tokens) {
    const x = rowWidths.get(token.row) ?? 0;
    const width = 14 + chipLabel(token).length * 11.5;
    const y = token.row * (CHIP_HEIGHT + ROW_GAP) + 10;
    const lit = frames.map((frame) => (sameToken(frame.token, token) ? "#ffd23f" : "#ffffff"));
    parts.push(
      `<rect x="${x0 + x}" y="${y}" width="${width}" height="${CHIP_HEIGHT}" rx="6" fill="${lit[0]}" ` +
        `stroke="${GROUP_STROKE[token.kind.group]}" stroke-width="3">${timeline.discrete("fill", lit)}</rect>` +
        `<text x="${x0 + x + width / 2}" y="${y + 23}" font-family="Noto Sans, DejaVu Sans, sans-serif" font-size="17" ` +
        `font-weight="700" fill="#1d2b36" text-anchor="middle">${escapeXml(chipLabel(token))}</text>`,
    );
    rowWidths.set(token.row, x + width + 6);
    panelWidth = Math.max(panelWidth, x + width + 6);
  }
  const rows = tokens.length === 0 ? 0 : Math.max(...tokens.map((token) => token.row)) + 1;
  const width = x0 + panelWidth + 16;
  const height = Math.max(boardHeight + captionSpace, rows * (CHIP_HEIGHT + ROW_GAP) + 20);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<rect width="${width}" height="${height}" fill="#fffaf0"/>${parts.join("")}</svg>`
  );
}

/**
 * The turtle drawn with sprites. While it moves, the walk frames play; while
 * it turns, it turns smoothly and the same frames play (it paddles round).
 * All frames come from one sprite sheet, the same as the standing turtle: the
 * generated turn sheets were drawn a little differently (outline, shell,
 * centre), and switching between sheets made the turtle flicker at every turn.
 */
function turtleSprites(frames: readonly AnimationFrame[], turns: readonly string[], timeline: Timeline, skin: Skin): string {
  const events: { time: number; sprite: string }[] = [{ time: 0, sprite: "turtle" }];
  for (let i = 1; i < frames.length; i++) {
    const { start, end } = timeline.motion(i);
    const from = frames[i - 1].world.turtle;
    const to = frames[i].world.turtle;
    const moved = from.x !== to.x || from.y !== to.y;
    const turned = from.direction !== to.direction;
    if (moved || turned) {
      for (let k = 0; k < SPRITE_FRAMES; k++) {
        events.push({ time: start + ((end - start) * k) / SPRITE_FRAMES, sprite: `turtle-walk-${k + 1}` });
      }
      events.push({ time: end, sprite: "turtle" });
    }
  }

  const names = [...new Set(events.map((event) => event.sprite))];
  const images = names.map((name) => {
    const times = events.map((event) => event.time);
    const values = events.map((event) => (event.sprite === name ? "1" : "0"));
    const opacity = timeline.discreteAt("opacity", times, values);
    return `<g opacity="${values[0]}">${opacity}${drawTurtleSprite(skin, name)}</g>`;
  });
  return `<g transform="rotate(${turns[0]})">${timeline.smooth("transform", turns, "rotate")}${images.join("")}</g>`;
}
