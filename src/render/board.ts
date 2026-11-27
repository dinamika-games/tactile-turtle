// Drawing the board as SVG (DESIGN.md, section 11): vectors now, generated
// sprites later. Each kind of thing is drawn by one function, so that a
// sprite can replace it without touching the rest.
//
// The look comes from SVG filters (small image shaders that every browser
// runs, also in an <img>): grain in the sand, shimmering caustics in the sea,
// soft shadows under the things, glowing lamps and a vignette.

import type { Colour, Thing, World } from "../world/world.ts";
import { THING_EXTENT, TURTLE_EXTENT, variant, type Skin } from "./skin.ts";

export const CELL = 64;

export const PALETTE: Record<Colour, string> = {
  RED: "#d7263d",
  GREEN: "#2e9e4f",
  BLUE: "#2f6fd6",
  YELLOW: "#f2c81f",
};

/** The filters and gradients; include once in every board SVG. */
export function boardDefs(): string {
  return `<defs>
<filter id="grain" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="noise"/>
  <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.33  0 0 0 0 0.18  0 0 0 0.22 0" result="specks"/>
  <feComposite in="specks" in2="SourceGraphic" operator="atop"/>
</filter>
<filter id="caustics" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.035 0.06" numOctaves="2" seed="9" result="noise">
    <animate attributeName="baseFrequency" dur="7s" values="0.035 0.06;0.042 0.052;0.035 0.06" repeatCount="indefinite"/>
  </feTurbulence>
  <feColorMatrix in="noise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 7 -3.4" result="light"/>
  <feComposite in="light" in2="SourceGraphic" operator="in" result="lightInSea"/>
  <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="lightInSea"/></feMerge>
</filter>
<filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
  <feDropShadow dx="3" dy="5" stdDeviation="3" flood-color="#3b2a12" flood-opacity="0.35"/>
</filter>
<filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
  <feGaussianBlur stdDeviation="7"/>
</filter>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#3fb4e8"/><stop offset="1" stop-color="#1f7fc4"/>
</linearGradient>
<linearGradient id="sand" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#f7e7bf"/><stop offset="1" stop-color="#ecd49f"/>
</linearGradient>
<radialGradient id="rock" cx="0.35" cy="0.3" r="0.8">
  <stop offset="0" stop-color="#b3aaa0"/><stop offset="0.6" stop-color="#857b70"/><stop offset="1" stop-color="#5c544b"/>
</radialGradient>
<radialGradient id="shell" cx="0.4" cy="0.35" r="0.75">
  <stop offset="0" stop-color="#a6d48a"/><stop offset="1" stop-color="#4f8a45"/>
</radialGradient>
<radialGradient id="lampGlow">
  <stop offset="0" stop-color="#fff3a0" stop-opacity="0.95"/><stop offset="1" stop-color="#ffd23f" stop-opacity="0"/>
</radialGradient>
<linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
</linearGradient>
<radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">
  <stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#1b1206" stop-opacity="0.35"/>
</radialGradient>
</defs>`;
}

// The colours carry a symbol too, for colour-blind players: ● ▲ ■ ★.
export function colourSymbol(colour: Colour, cx: number, cy: number, r: number, fill: string): string {
  switch (colour) {
    case "RED":
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
    case "GREEN":
      return `<path d="M${cx} ${cy - r} L${cx + r} ${cy + r * 0.8} L${cx - r} ${cy + r * 0.8} Z" fill="${fill}"/>`;
    case "BLUE":
      return `<rect x="${cx - r * 0.85}" y="${cy - r * 0.85}" width="${r * 1.7}" height="${r * 1.7}" fill="${fill}"/>`;
    case "YELLOW": {
      const points = Array.from({ length: 10 }, (_, i) => {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const radius = i % 2 === 0 ? r : r * 0.45;
        return `${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`;
      });
      return `<polygon points="${points.join(" ")}" fill="${fill}"/>`;
    }
  }
}

/** The fill of a floor (sand and sea have their own layers). */
export function floorFill(floor: World["cells"][number][number]["floor"]): string {
  if (floor === "SAND") return "url(#sand)";
  if (floor === "SEA") return "url(#sea)";
  return PALETTE[floor];
}

/** A sprite, centred at (cx, cy), with the thing (not the square) ``size`` wide. */
export function spriteImage(skin: Skin, name: string, size: number, cx = 0, cy = 0, extent = THING_EXTENT): string {
  const side = size / extent;
  return `<image href="${skin.href(name)}" x="${(cx - side / 2).toFixed(1)}" y="${(cy - side / 2).toFixed(1)}" width="${side.toFixed(1)}" height="${side.toFixed(1)}"/>`;
}

/** The ground: sand everywhere (with grain), then the sea (with caustics). */
export function drawGround(world: World, skin?: Skin): string {
  if (skin !== undefined) {
    // Sprites: a tile of sand or sea per cell, the variants chosen by position.
    const tiles: string[] = [];
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const sea = world.cells[y][x].floor === "SEA";
        const name = sea ? `sea-${variant(x * 31 + y * 17, 8)}` : `sand-${variant(x * 13 + y * 29, 4)}`;
        tiles.push(`<image href="${skin.href(name)}" x="${x * CELL}" y="${y * CELL}" width="${CELL + 0.5}" height="${CELL + 0.5}"/>`);
      }
    }
    return tiles.join("");
  }
  const width = world.width * CELL;
  const height = world.height * CELL;
  const sea: string[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (world.cells[y][x].floor === "SEA") {
        sea.push(`<rect x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}"/>`);
      }
    }
  }
  return (
    `<g filter="url(#grain)"><rect width="${width}" height="${height}" fill="url(#sand)"/></g>` +
    (sea.length > 0 ? `<g filter="url(#caustics)" fill="url(#sea)">${sea.join("")}</g>` : "")
  );
}

/** A coloured cell (coral painted on the sand), with its symbol. */
export function drawColourCell(colour: Colour, x: number, y: number, opacity = 1, skin?: Skin): string {
  const px = x * CELL;
  const py = y * CELL;
  if (skin !== undefined) {
    return `<g opacity="${opacity}"><image href="${skin.href(`cell-${colour.toLowerCase()}`)}" x="${px}" y="${py}" width="${CELL + 0.5}" height="${CELL + 0.5}"/></g>`;
  }
  return (
    `<g opacity="${opacity}"><rect x="${px + 3}" y="${py + 3}" width="${CELL - 6}" height="${CELL - 6}" rx="10" ` +
    `fill="${PALETTE[colour]}" fill-opacity="0.6"/>` +
    colourSymbol(colour, px + CELL - 13, py + 13, 6, PALETTE[colour]) +
    `</g>`
  );
}

export function drawGrid(world: World): string {
  const parts: string[] = [];
  const width = world.width * CELL;
  const height = world.height * CELL;
  for (let y = 0; y <= world.height; y++) {
    parts.push(`<line x1="0" y1="${y * CELL}" x2="${width}" y2="${y * CELL}"/>`);
  }
  for (let x = 0; x <= world.width; x++) {
    parts.push(`<line x1="${x * CELL}" y1="0" x2="${x * CELL}" y2="${height}"/>`);
  }
  return `<g stroke="#c9ad74" stroke-width="1" opacity="0.35">${parts.join("")}</g>`;
}

/** How large each kind of thing is drawn as a sprite (the thing itself, in pixels). */
const SPRITE_SIZES: Record<"ROCK" | "HATCHLING" | "BOX" | "LAMP" | "GATE", number> = { ROCK: 60, HATCHLING: 40, BOX: 46, LAMP: 44, GATE: 60 };

/** A thing as a sprite, centred at (0, 0). */
export function drawThingSprite(thing: Thing, skin: Skin): string {
  // The key, the fuel and the crab have no sprites yet: they are drawn.
  if (thing.kind === "KEY" || thing.kind === "FUEL" || thing.kind === "CRAB") return drawThingShape(thing);
  const size = SPRITE_SIZES[thing.kind];
  switch (thing.kind) {
    case "ROCK":
      return spriteImage(skin, `rock-${variant(thing.id, 6)}`, size);
    case "HATCHLING":
      return spriteImage(skin, `hatchling-${variant(thing.id, 8)}`, size);
    case "BOX":
      return spriteImage(skin, `box-${thing.colour.toLowerCase()}`, size);
    case "LAMP":
      return spriteImage(skin, thing.on ? "lamp-4" : "lamp-0", size);
    case "GATE":
      return spriteImage(skin, thing.open ? "gate-5" : "gate-0", size);
  }
}

/** A thing, centred at (0, 0); place it with a transform. */
export function drawThingShape(thing: Thing, skin?: Skin): string {
  if (skin !== undefined) return drawThingSprite(thing, skin);
  switch (thing.kind) {
    case "ROCK":
      return (
        `<path d="M-25 18 L-19 -10 L-4 -23 L16 -17 L26 2 L23 19 Z" fill="url(#rock)" stroke="#4d463e" stroke-width="2" stroke-linejoin="round"/>` +
        `<path d="M-12 -8 L-3 -15 L8 -12" stroke="#d6cfc6" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.7"/>`
      );
    case "HATCHLING":
      return (
        `<ellipse cx="-9" cy="-4" rx="4" ry="7" fill="#6b9a52" transform="rotate(-35 -9 -4)"/>` +
        `<ellipse cx="9" cy="-4" rx="4" ry="7" fill="#6b9a52" transform="rotate(35 9 -4)"/>` +
        `<ellipse cx="0" cy="3" rx="11" ry="13" fill="url(#shell)" stroke="#33552a" stroke-width="2"/>` +
        `<circle cx="0" cy="-13" r="6" fill="#9ccc7b" stroke="#33552a" stroke-width="2"/>` +
        `<circle cx="-2.2" cy="-14.5" r="1.5" fill="#1a1a1a"/><circle cx="2.2" cy="-14.5" r="1.5" fill="#1a1a1a"/>`
      );
    case "BOX":
      return (
        `<rect x="-20" y="-20" width="40" height="40" rx="5" fill="${PALETTE[thing.colour]}" stroke="#3b2a1a" stroke-width="3"/>` +
        `<rect x="-20" y="-20" width="40" height="40" rx="5" fill="url(#shine)"/>` +
        `<path d="M-14 -14 L14 14 M14 -14 L-14 14" stroke="#3b2a1a" stroke-width="2" opacity="0.3"/>` +
        colourSymbol(thing.colour, 0, 0, 8, "#fff")
      );
    case "LAMP":
      return (
        `<rect x="-5" y="4" width="10" height="20" rx="2" fill="#4d4d4d"/>` +
        `<circle cx="0" cy="-6" r="13" fill="${thing.on ? "#ffd23f" : "#d7d7d7"}" stroke="#4d4d4d" stroke-width="3"/>` +
        `<circle cx="-4" cy="-10" r="4" fill="#fff" opacity="0.6"/>`
      );
    case "GATE":
      return thing.open
        ? `<rect x="-28" y="-28" width="8" height="56" rx="2" fill="#6d4c2f"/><rect x="20" y="-28" width="8" height="56" rx="2" fill="#6d4c2f"/>`
        : `<rect x="-28" y="-28" width="56" height="56" rx="3" fill="#8b5e34" stroke="#4a3018" stroke-width="3"/>` +
            [-14, 0, 14].map((dx) => `<line x1="${dx}" y1="-28" x2="${dx}" y2="28" stroke="#4a3018" stroke-width="2"/>`).join("");
    case "KEY":
      return (
        `<g transform="rotate(-35)">` +
        `<circle cx="-11" cy="0" r="9" fill="none" stroke="#7a5a00" stroke-width="7"/>` +
        `<circle cx="-11" cy="0" r="9" fill="none" stroke="#ffcf3a" stroke-width="4"/>` +
        `<path d="M-2 0 H20 M13 0 V7 M19 0 V6" stroke="#7a5a00" stroke-width="7" stroke-linecap="round" fill="none"/>` +
        `<path d="M-2 0 H20 M13 0 V7 M19 0 V6" stroke="#ffcf3a" stroke-width="4" stroke-linecap="round" fill="none"/>` +
        `</g>`
      );
    case "FUEL":
      return (
        `<path d="M-14 -12 L4 -12 L14 -2 L14 20 L-14 20 Z" fill="#d8432f" stroke="#6e1c12" stroke-width="3" stroke-linejoin="round"/>` +
        `<rect x="-11" y="-19" width="10" height="8" rx="2" fill="#4d4d4d"/>` +
        `<path d="M-8 -4 L8 14 M8 -4 L-8 14" stroke="#6e1c12" stroke-width="2" opacity="0.5"/>` +
        `<path d="M-1 0 C-6 7 -5 12 -1 12 C3 12 4 7 -1 0 Z" fill="#ffd23f"/>`
      );
    case "CRAB":
      return (
        [-1, 1]
          .map(
            (side) =>
              [-6, 0, 6].map((dy) => `<path d="M${side * 10} ${dy} L${side * 22} ${dy + 4} L${side * 25} ${dy + 10}" stroke="#a8321f" stroke-width="3" fill="none" stroke-linecap="round"/>`).join("") +
              `<path d="M${side * 9} -9 L${side * 15} -18" stroke="#a8321f" stroke-width="4" stroke-linecap="round"/>` +
              `<path d="M${side * 13} -17 a7 7 0 1 0 ${side * 8} -6 l${side * -5} 4 Z" fill="#e8553d" stroke="#a8321f" stroke-width="2" stroke-linejoin="round"/>`,
          )
          .join("") +
        `<ellipse cx="0" cy="2" rx="14" ry="11" fill="#e8553d" stroke="#a8321f" stroke-width="2.5"/>` +
        `<line x1="-4" y1="-8" x2="-5" y2="-15" stroke="#a8321f" stroke-width="2"/><line x1="4" y1="-8" x2="5" y2="-15" stroke="#a8321f" stroke-width="2"/>` +
        `<circle cx="-5" cy="-16" r="3" fill="#fff" stroke="#1a1a1a" stroke-width="1"/><circle cx="5" cy="-16" r="3" fill="#fff" stroke="#1a1a1a" stroke-width="1"/>` +
        `<circle cx="-5" cy="-16" r="1.4" fill="#1a1a1a"/><circle cx="5" cy="-16" r="1.4" fill="#1a1a1a"/>`
      );
  }
}

/** The glow of a lit lamp, centred at (0, 0). */
export function drawLampGlow(): string {
  return `<circle cx="0" cy="-6" r="34" fill="url(#lampGlow)" filter="url(#glow)"/>`;
}

/**
 * A pose of the turtle: how far each flipper is swung (degrees, added to its
 * rest angle), and how far the head is stretched out (pixels).
 */
export interface TurtlePose {
  readonly frontLeft: number;
  readonly frontRight: number;
  readonly backLeft: number;
  readonly backRight: number;
  readonly head: number;
}

export const REST_POSE: TurtlePose = { frontLeft: 0, frontRight: 0, backLeft: 0, backRight: 0, head: 0 };

export const SPRITE_FRAMES = 6;

/** The walk cycle: the front flippers pull in turn, the back ones push. */
export function walkPose(frame: number): TurtlePose {
  const phase = (2 * Math.PI * frame) / SPRITE_FRAMES;
  return {
    frontLeft: 28 * Math.sin(phase),
    frontRight: -28 * Math.sin(phase + Math.PI),
    backLeft: -14 * Math.sin(phase + Math.PI),
    backRight: 14 * Math.sin(phase),
    head: 2 * Math.cos(2 * phase),
  };
}

/** Turning on the spot: the flippers on the outside of the turn paddle. */
export function turnPose(frame: number, direction: "left" | "right"): TurtlePose {
  const phase = (2 * Math.PI * frame) / SPRITE_FRAMES;
  const paddle = 30 * Math.sin(phase);
  const calm = 8 * Math.sin(phase);
  return direction === "left"
    ? { frontLeft: calm, frontRight: -paddle, backLeft: -calm, backRight: paddle * 0.6, head: 0 }
    : { frontLeft: paddle, frontRight: -calm, backLeft: -paddle * 0.6, backRight: calm, head: 0 };
}

/** The length of the turtle on the board, in pixels. */
export const TURTLE_LENGTH = 58;

/** The robot turtle as a sprite (e.g. "turtle", "turtle-walk-3"), facing north, centred at (0, 0). */
export function drawTurtleSprite(skin: Skin, name = "turtle"): string {
  return spriteImage(skin, name, TURTLE_LENGTH, 0, 0, TURTLE_EXTENT);
}

/** The robot turtle, seen from above, facing north, centred at (0, 0). */
export function drawTurtleShape(pose: TurtlePose = REST_POSE): string {
  const flipper = (x: number, y: number, angle: number) =>
    `<ellipse cx="${x}" cy="${y}" rx="7" ry="13" fill="#5f9e6e" stroke="#2f5a3a" stroke-width="2" transform="rotate(${angle.toFixed(1)} ${x} ${y})"/>`;
  const plates = [
    [0, -6],
    [-9, 2],
    [9, 2],
    [0, 11],
  ]
    .map(([dx, dy]) => `<polygon points="${hexagon(dx, dy, 6)}" fill="#b5dc93" fill-opacity="0.55" stroke="#2f5a3a" stroke-width="1.5"/>`)
    .join("");
  return (
    flipper(-17, -12, -35 + pose.frontLeft) +
    flipper(17, -12, 35 + pose.frontRight) +
    flipper(-15, 14, 30 + pose.backLeft) +
    flipper(15, 14, -30 + pose.backRight) +
    `<g transform="translate(0 ${(-pose.head).toFixed(1)})">` +
    `<ellipse cx="0" cy="-24" rx="8" ry="9" fill="#86c085" stroke="#2f5a3a" stroke-width="2"/>` +
    `<circle cx="-3.5" cy="-27" r="1.8" fill="#111"/><circle cx="3.5" cy="-27" r="1.8" fill="#111"/></g>` +
    `<ellipse cx="0" cy="2" rx="18" ry="21" fill="url(#shell)" stroke="#2f5a3a" stroke-width="2.5"/>` +
    plates +
    // The robot's antenna: it is a robot turtle.
    `<line x1="0" y1="-8" x2="0" y2="-1" stroke="#2f5a3a" stroke-width="2"/><circle cx="0" cy="-9" r="2.5" fill="#f25c54"/>`
  );
}

function hexagon(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i;
    return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
  }).join(" ");
}

export const CARRIED_SCALE = 0.45;

export interface BoardOptions {
  /** A caption below the board (e.g. the statement just run). */
  readonly caption?: string;
  /** Draw with sprites instead of the vector shapes. */
  readonly skin?: Skin;
  /** The colours to paint (a "painted" goal), drawn as dashed frames. */
  readonly targets?: readonly (readonly (Colour | null)[])[];
}

/** The cells to paint: a dashed frame in the colour, and a faint wash. */
export function drawTargets(targets: readonly (readonly (Colour | null)[])[] | undefined): string {
  if (targets === undefined) return "";
  const parts: string[] = [];
  targets.forEach((row, y) =>
    row.forEach((colour, x) => {
      if (colour === null) return;
      parts.push(
        `<rect x="${x * CELL + 6}" y="${y * CELL + 6}" width="${CELL - 12}" height="${CELL - 12}" rx="8" ` +
          `fill="${PALETTE[colour]}" fill-opacity="0.18" stroke="${PALETTE[colour]}" stroke-width="4" stroke-dasharray="10 7"/>`,
      );
    }),
  );
  return `<g pointer-events="none">${parts.join("")}</g>`;
}

/** The height of a caption of one line (a statement during a run). */
export const CAPTION_HEIGHT = 44;

const CAPTION_FONT = 20;
const CAPTION_LINE = 27;
const CAPTION_PAD = 12;

/**
 * Break a caption into lines that fit the width. A caption may have a title
 * and more text, separated by a line break (e.g. "Level 45: Red left, blue
 * right" and its goal): the title is bold, the rest starts on a new line.
 */
export function captionLines(text: string, width: number): { text: string; bold: boolean }[] {
  const perLine = Math.max(10, Math.floor((width - 2 * CAPTION_PAD) / (CAPTION_FONT * 0.56)));
  // "Title\nmore": the title in bold, the rest below it.
  const [title, ...rest] = text.split("\n");
  const parts = [{ text: title, bold: true }, ...(rest.length > 0 ? [{ text: rest.join(" "), bold: false }] : [])];
  const lines: { text: string; bold: boolean }[] = [];
  for (const part of parts) {
    let line = "";
    for (const word of part.text.split(" ")) {
      if (line !== "" && (line + " " + word).length > perLine) {
        lines.push({ text: line, bold: part.bold });
        line = word;
      } else {
        line = line === "" ? word : `${line} ${word}`;
      }
    }
    if (line !== "") lines.push({ text: line, bold: part.bold });
  }
  return lines;
}

export function captionHeight(text: string, width: number): number {
  return Math.max(CAPTION_HEIGHT, captionLines(text, width).length * CAPTION_LINE + 2 * CAPTION_PAD - 8);
}

/** A caption below the board; ``height`` keeps captions of one run the same size. */
export function drawCaption(text: string, width: number, top: number, opacity = 1, height?: number): string {
  const lines = captionLines(text, width);
  const box = height ?? captionHeight(text, width);
  const first = top + (box - lines.length * CAPTION_LINE) / 2 + CAPTION_FONT;
  return (
    `<g opacity="${opacity}"><rect x="0" y="${top}" width="${width}" height="${box}" fill="#1d2b36"/>` +
    lines
      .map(
        (line, i) =>
          `<text x="${width / 2}" y="${(first + i * CAPTION_LINE).toFixed(1)}" font-family="Noto Sans, DejaVu Sans, sans-serif" ` +
          `font-size="${CAPTION_FONT}" font-weight="${line.bold ? 700 : 400}" fill="#fff" text-anchor="middle">${escapeXml(line.text)}</text>`,
      )
      .join("") +
    `</g>`
  );
}

/** A still picture of the board. */
export function renderBoard(world: World, options: BoardOptions = {}): string {
  const skin = options.skin;
  const width = world.width * CELL;
  const captionSpace = options.caption ? captionHeight(options.caption, width) : 0;
  const height = world.height * CELL + captionSpace;
  const parts: string[] = [boardDefs(), drawGround(world, skin)];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const floor = world.cells[y][x].floor;
      if (floor !== "SAND" && floor !== "SEA") parts.push(drawColourCell(floor, x, y, 1, skin));
    }
  }
  parts.push(drawGrid(world));
  parts.push(drawTargets(options.targets));
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const thing = world.cells[y][x].thing;
      if (thing === null) continue;
      const at = `translate(${x * CELL + CELL / 2} ${y * CELL + CELL / 2})`;
      if (skin === undefined && thing.kind === "LAMP" && thing.on) parts.push(`<g transform="${at}">${drawLampGlow()}</g>`);
      const shadow = skin === undefined ? ' filter="url(#shadow)"' : "";
      parts.push(`<g transform="${at}"${shadow}>${drawThingShape(thing, skin)}</g>`);
    }
  }
  const t = world.turtle;
  const cx = t.x * CELL + CELL / 2;
  const cy = t.y * CELL + CELL / 2;
  const turtle = skin === undefined ? `<g filter="url(#shadow)">${drawTurtleShape()}</g>` : drawTurtleSprite(skin);
  parts.push(`<g transform="translate(${cx} ${cy}) rotate(${t.direction * 90})">${turtle}</g>`);
  t.carrying.forEach((thing, i) =>
    parts.push(`<g transform="translate(${cx} ${cy + 2 - i * 5}) scale(${CARRIED_SCALE})">${drawThingShape(thing, skin)}</g>`),
  );
  parts.push(`<rect width="${width}" height="${world.height * CELL}" fill="url(#vignette)" pointer-events="none"/>`);
  if (options.caption) parts.push(drawCaption(options.caption, width, world.height * CELL));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join("")}</svg>`;
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
