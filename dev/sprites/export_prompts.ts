// Prompts for generating the sprites with GenAI, each with reference
// pictures drawn by the game's own vector code (the shapes, poses and colours
// that the sprites must keep). Every prompt gets a flat directory with a
// prompt.md and at most 20 pictures (SVG here; dev/sprites/render_pngs.mjs
// turns them into PNGs).
//
// Usage: node dev/sprites/export_prompts.ts <output directory>

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import levelsData from "../../data/levels.json" with { type: "json" };
import {
  boardDefs,
  CARRIED_SCALE,
  CELL,
  colourSymbol,
  drawColourCell,
  drawLampGlow,
  drawThingShape,
  drawTurtleShape,
  PALETTE,
  renderBoard,
  SPRITE_FRAMES,
  turnPose,
  walkPose,
  type TurtlePose,
} from "../../src/render/board.ts";
import { blackScreen, scanningScreen } from "../../src/render/screens.ts";
import type { Colour, Thing } from "../../src/world/world.ts";
import { parseMap } from "../../src/world/world.ts";

const out = process.argv[2];
if (!out) throw new Error("Usage: node dev/sprites/export_prompts.ts <output directory>");

const MAX_IMAGES = 20;

const STYLE = `## The style (the same for every sprite of the game)

* A children's game (8-14 years) about a small **robot sea turtle** on a tropical island; friendly, warm, calm. Nobody is hurt, nothing is destroyed.
* **Seen from straight above** (top-down), like a board game; the board is a grid of 64 x 64 cells.
* Soft, painted look with clean shapes: readable from three metres on a classroom screen. Soft shading, light from the **top left**, a soft shadow to the bottom right.
* Warm palette: sand #f3e2b8, sea #3fb4e8 to #1f7fc4, turtle greens #4f8a45 to #a6d48a, rock greys.
* The game colours are exactly: red ${PALETTE.RED}, green ${PALETTE.GREEN}, blue ${PALETTE.BLUE}, yellow ${PALETTE.YELLOW}. Coloured things also carry their **symbol** (red ●, green ▲, blue ■, yellow ★), for colour-blind players: keep it.
* **No text, no letters, no numbers** in the pictures.
* PNG with a **transparent background**, square, 512 x 512, the thing centred and filling about 80 % of the cell (unless said otherwise).
* The reference pictures show the shapes, proportions, poses and colours to keep; make them look much nicer, but keep the silhouette and the orientation (the turtle faces **up** = north in every frame; the game rotates it).`;

interface Prompt {
  readonly directory: string;
  readonly title: string;
  readonly body: string;
  readonly images: { name: string; svg: string }[];
}

function sprite(content: string, viewBox = "-40 -40 80 80", size = 512): string {
  const [, , w, h] = viewBox.split(" ").map(Number);
  const height = Math.round((size * h) / w);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${height}">${boardDefs()}${content}</svg>`;
}

function turtle(pose?: TurtlePose, rotate = 0, extra = ""): string {
  return `<g transform="rotate(${rotate})"><g filter="url(#shadow)">${drawTurtleShape(pose)}</g></g>${extra}`;
}

const box = (colour: Colour): Thing => ({ id: 0, kind: "BOX", colour });
const pad = (i: number) => String(i + 1).padStart(2, "0");

const prompts: Prompt[] = [];

// The turtle: walking, turning, picking up and dropping.
prompts.push({
  directory: "01-turtle-walk",
  title: "The robot turtle walking (6 frames)",
  body: `A walk cycle of the robot sea turtle, in **6 frames** that loop (frame 6 leads back to frame 1). It crawls forward (up) one cell in about 0.4 s: the front flippers pull in turn, the back flippers push, the head bobs a little.

The turtle: a young green sea turtle with a rounded shell of hexagonal plates, four flippers, a friendly face with two dark eyes, and a small **robot antenna with a red light** on its shell (it is a robot turtle; keep it subtle and cute, not mechanical-scary).

Pictures: \`rest.png\` (standing still) and \`walk-01.png\` to \`walk-06.png\`. Make one sprite per frame, the same size and position in every frame (only the flippers and the head move), facing up.`,
  images: [
    { name: "rest", svg: sprite(turtle()) },
    ...Array.from({ length: SPRITE_FRAMES }, (_, i) => ({ name: `walk-${pad(i)}`, svg: sprite(turtle(walkPose(i))) })),
  ],
});

for (const direction of ["left", "right"] as const) {
  prompts.push({
    directory: `0${direction === "left" ? 2 : 3}-turtle-turn-${direction}`,
    title: `The robot turtle turning ${direction} (6 frames)`,
    body: `The robot sea turtle turns **90° to the ${direction}** on the spot, in **6 frames** (0°, ${direction === "left" ? "−" : ""}18°, … ${direction === "left" ? "−" : ""}90°). The flippers on the outer side of the turn paddle, the inner ones hold still.

Draw every frame **already rotated** as in the pictures \`turn-${direction}-01.png\` to \`turn-${direction}-06.png\` (the first faces up, the last faces ${direction}). Same turtle as in 01-turtle-walk; same size and centre in every frame.`,
    images: Array.from({ length: SPRITE_FRAMES }, (_, i) => ({
      name: `turn-${direction}-${pad(i)}`,
      svg: sprite(turtle(turnPose(i, direction), (direction === "left" ? -18 : 18) * i)),
    })),
  });
}

{
  const frames: { name: string; svg: string }[] = [];
  for (let i = 0; i < SPRITE_FRAMES; i++) {
    const t = i / (SPRITE_FRAMES - 1);
    const y = -CELL * (1 - t) + 2 * t;
    const scale = 1 + (CARRIED_SCALE - 1) * t;
    const head: TurtlePose = { frontLeft: 0, frontRight: 0, backLeft: 0, backRight: 0, head: 6 * Math.sin(Math.PI * t) };
    const item = `<g transform="translate(0 ${y.toFixed(1)}) scale(${scale.toFixed(3)})" filter="url(#shadow)">${drawThingShape(box("RED"))}</g>`;
    frames.push({ name: `pick-up-${pad(i)}`, svg: sprite(turtle(head) + item, "-40 -104 80 144") });
  }
  const carrying = (["RED", "GREEN", "BLUE", "YELLOW"] as Colour[]).map((colour) => ({
    name: `carrying-box-${colour.toLowerCase()}`,
    svg: sprite(turtle() + `<g transform="translate(0 2) scale(${CARRIED_SCALE})">${drawThingShape(box(colour))}</g>`),
  }));
  carrying.push({
    name: "carrying-hatchling",
    svg: sprite(turtle() + `<g transform="translate(0 2) scale(${CARRIED_SCALE})">${drawThingShape({ id: 0, kind: "HATCHLING" })}</g>`),
  });
  prompts.push({
    directory: "04-turtle-pick-up-and-drop",
    title: "The robot turtle picking up and dropping (6 frames, and carrying)",
    body: `The robot sea turtle **picks up** the thing in the cell in front of it (one cell = 64 px above) and carries it on its back; **dropping** is the same frames backwards.

* \`pick-up-01.png\` … \`pick-up-06.png\`: the head stretches out and back, the box rises, floats onto the shell and shrinks to about 45 %. Canvas: the turtle's cell and the cell in front (512 x 922); keep the turtle where it is.
* \`carrying-*.png\`: the turtle standing, with a box of each colour or a hatchling riding on its shell (these may become separate overlay sprites: the turtle, and the small thing on its back).

Same turtle as in 01-turtle-walk.`,
    images: [...frames, ...carrying],
  });
}

prompts.push({
  directory: "05-hatchling",
  title: "A sea turtle hatchling",
  body: `A tiny, cute **sea turtle hatchling** (the turtle rescues them and brings them to the sea). Seen from above, facing up, in the middle of a 64 x 64 cell; much smaller and more baby-like than the robot turtle, without antenna. Make **4 variants** (slightly different shell patterns and poses), and, if you can, 4 frames of it crawling.`,
  images: [{ name: "hatchling", svg: sprite(`<g filter="url(#shadow)">${drawThingShape({ id: 0, kind: "HATCHLING" })}</g>`) }],
});

prompts.push({
  directory: "06-boxes",
  title: "Boxes in the four colours",
  body: `Wooden harbour crates to be sorted by colour: one in each colour of the game, painted in that colour, with its **white symbol** on the lid (red ●, green ▲, blue ■, yellow ★). Seen from above, filling about 65 % of the cell. They must be told apart at a glance, also by colour-blind children (the symbol does that).`,
  images: (["RED", "GREEN", "BLUE", "YELLOW"] as Colour[]).map((colour) => ({
    name: `box-${colour.toLowerCase()}`,
    svg: sprite(`<g filter="url(#shadow)">${drawThingShape(box(colour))}</g>`),
  })),
});

prompts.push({
  directory: "07-rocks",
  title: "Rocks (obstacles)",
  body: `Beach rocks that block a cell: grey-brown, rounded, a bit of moss or a shell on some. Make **6 variants** so that a wall of rocks does not look repetitive; each fills most of its 64 x 64 cell and tiles well next to the others (the border of every map is a row of rocks).`,
  images: [{ name: "rock", svg: sprite(`<g filter="url(#shadow)">${drawThingShape({ id: 0, kind: "ROCK" })}</g>`) }],
});

prompts.push({
  directory: "08-lamp",
  title: "A lamp, off and on",
  body: `A small harbour lamp on a post, seen from above (a bit from the side is fine): **off** (grey glass) and **on** (warm yellow glass with a soft glow around it; the glow may be a separate sprite). The turtle switches it with SWITCH, or lights it with fuel (USE). Also 3 frames of it lighting up.`,
  images: [
    { name: "lamp-off", svg: sprite(`<g filter="url(#shadow)">${drawThingShape({ id: 0, kind: "LAMP", on: false })}</g>`) },
    { name: "lamp-on", svg: sprite(`${drawLampGlow()}<g filter="url(#shadow)">${drawThingShape({ id: 0, kind: "LAMP", on: true })}</g>`) },
  ],
});

prompts.push({
  directory: "09-gate",
  title: "A gate, closed and open",
  body: `A wooden harbour gate filling one cell, seen from above: **closed** (planks across the whole cell; it blocks the way) and **open** (only the two posts at the sides; the turtle walks through). Also 4 frames of it opening (closing is the same backwards).`,
  images: [
    { name: "gate-closed", svg: sprite(`<g filter="url(#shadow)">${drawThingShape({ id: 0, kind: "GATE", open: false })}</g>`) },
    { name: "gate-open", svg: sprite(`<g filter="url(#shadow)">${drawThingShape({ id: 0, kind: "GATE", open: true })}</g>`) },
  ],
});

{
  const cell = (content: string) => sprite(content, `0 0 ${CELL} ${CELL}`);
  const images = [
    { name: "sand", svg: cell(`<g filter="url(#grain)"><rect width="${CELL}" height="${CELL}" fill="url(#sand)"/></g>`) },
    { name: "sea", svg: cell(`<g filter="url(#caustics)"><rect width="${CELL}" height="${CELL}" fill="url(#sea)"/></g>`) },
    ...(["RED", "GREEN", "BLUE", "YELLOW"] as Colour[]).map((colour) => ({
      name: `cell-${colour.toLowerCase()}`,
      svg: cell(`<rect width="${CELL}" height="${CELL}" fill="#f3e2b8"/>${drawColourCell(colour, 0, 0)}`),
    })),
  ];
  prompts.push({
    directory: "10-ground",
    title: "The ground: sand, sea and coloured cells",
    body: `Ground tiles of 64 x 64 that **tile seamlessly** (the edges must fit any neighbour): **sand** (fine, warm, a few tiny shells; 4 variants), **sea** (shallow tropical water with light caustics; 4 variants, ideally also 4 frames of gently moving water), and **coloured cells** in red, green, blue and yellow (coral or painted sand; the turtle paints them and follows them as lines; keep the small symbol ● ▲ ■ ★ in a corner). No grid lines (the game draws them).`,
    images,
  });
}

prompts.push({
  directory: "11-screens",
  title: "The screens around the plate",
  body: `The screens while the children program and scan (1280 x 720, can be a vector illustration):

* **Programming**: black on purpose (all eyes on the plate). Maybe a very dark, barely visible turtle silhouette, nothing else.
* **Scanning**: a black screen with a **spanner** in the middle and a ring that fills; the word "Scanning" is set by the game (leave room below, no text in the picture). Make the spanner friendly and a bit playful (a turtle robot's tool), and a version of the ring.`,
  images: [
    { name: "programming", svg: blackScreen(640, 400) },
    { name: "scanning", svg: scanningScreen({ width: 640, height: 400, progress: 0.62, label: "Scanning" }) },
    { name: "scanning-closer", svg: scanningScreen({ width: 640, height: 400, progress: 0.2, label: "Scanning", hint: "Come a little closer" }) },
  ],
});

{
  const boards = [45, 92, 1, 10].map((id) => {
    const level = levelsData.levels.find((candidate) => candidate.id === id) as unknown as { name: string; days: { map: string[] }[] };
    return { name: `level-${String(id).padStart(3, "0")}`, svg: renderBoard(parseMap(level.days[0].map)) };
  });
  prompts.push({
    directory: "12-boards",
    title: "Whole boards (for the overall look)",
    body: `Whole levels as the game draws them now, to show how the sprites come together: a grid of 64 x 64 cells, rocks around, the robot turtle, boxes and coloured zones (level 45, sorting), a blue line to follow to the yellow cell (level 92), and the beach with the sea (levels 1 and 10). Paint **one mood picture per board** in the target style, so that all sprites can be matched to it (same light, palette and level of detail).`,
    images: boards,
  });
}

{
  const icon = (content: string) => sprite(content, "0 0 10 10", 256);
  const arrows: Record<string, string> = {
    forward: '<path d="M5 0.5 L9 5 H6.5 V9.5 H3.5 V5 H1 Z" fill="#2e9e4f"/>',
    left: '<path d="M8.5 9.5 V5.5 A2.5 2.5 0 0 0 6 3 H4 V0.5 L0.5 4.25 L4 8 V5.5 H6 V9.5 Z" fill="#2e9e4f"/>',
    right: '<path d="M1.5 9.5 V5.5 A2.5 2.5 0 0 1 4 3 H6 V0.5 L9.5 4.25 L6 8 V5.5 H4 V9.5 Z" fill="#2e9e4f"/>',
  };
  prompts.push({
    directory: "13-tile-icons",
    title: "Icons for the printed tiles",
    body: `Small, bold, **flat** icons printed on the magnetic tiles next to the word (about 4 mm high when printed, so very simple shapes, one colour, no fine detail; SVG would be ideal). Needed for: FORWARD, LEFT (turn left), RIGHT (turn right), PICK UP, DROP, SWITCH, USE, WAIT, PAINT, REPEAT, WHILE, IF; and the four colour symbols ● ▲ ■ ★. The pictures show the arrows and symbols used now. Black on transparent, plus one version in the group colour (actions green ${PALETTE.GREEN}, control orange #e8871e).`,
    images: [
      ...Object.entries(arrows).map(([name, path]) => ({ name: `icon-${name}`, svg: icon(path) })),
      ...(["RED", "GREEN", "BLUE", "YELLOW"] as Colour[]).map((colour) => ({
        name: `symbol-${colour.toLowerCase()}`,
        svg: icon(colourSymbol(colour, 5, 5, 4, PALETTE[colour])),
      })),
    ],
  });
}

rmSync(out, { recursive: true, force: true });
for (const prompt of prompts) {
  if (prompt.images.length > MAX_IMAGES) throw new Error(`${prompt.directory}: more than ${MAX_IMAGES} pictures`);
  const dir = join(out, prompt.directory);
  mkdirSync(dir, { recursive: true });
  const list = prompt.images.map((image) => `* \`${image.name}.png\``).join("\n");
  writeFileSync(
    join(dir, "prompt.md"),
    `# ${prompt.title}\n\n${prompt.body}\n\n${STYLE}\n\n## The reference pictures in this directory\n\n${list}\n`,
  );
  for (const image of prompt.images) writeFileSync(join(dir, `${image.name}.svg`), image.svg);
}
console.log(`Wrote ${prompts.length} prompts with ${prompts.reduce((n, p) => n + p.images.length, 0)} pictures to ${out}`);
