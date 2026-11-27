// Render the pictures of the README: frames of the turtle at work, and the
// screens around the plate. Usage: npm run docs (also renders the pictures of
// the end-to-end test, see tests/scan-e2e.test.ts).

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

import levelsData from "../../data/levels.json" with { type: "json" };
import { parse } from "../../src/lang/parser.ts";
import { tokenizeText } from "../../src/lang/tokens.ts";
import { renderRunAnimation, type AnimationFrame } from "../../src/render/animation.ts";
import { skinFrom } from "../../src/render/skin.ts";
import { renderBoard } from "../../src/render/board.ts";
import { scanningOverlay } from "../../src/render/screens.ts";
import { run } from "../../src/world/run.ts";
import { cloneWorld, parseMap } from "../../src/world/world.ts";

const DOCS = new URL("../../docs/", import.meta.url);

// The sprites, embedded (an SVG shown as an <img> cannot load other files):
// the small WebP copies of dev/sprites/import_sprites.py.
const SMALL = new URL("../../assets/sprites/small/", import.meta.url);
const skin = skinFrom(
  Object.fromEntries(
    readdirSync(SMALL)
      .filter((name) => name.endsWith(".webp"))
      .map((name) => [name.replace(/\.webp$/, ""), `data:image/webp;base64,${readFileSync(new URL(name, SMALL)).toString("base64")}`]),
  ),
);

function write(path: string, content: string): void {
  const url = new URL(path, DOCS);
  mkdirSync(new URL(".", url), { recursive: true });
  writeFileSync(url, content);
  console.log(`Wrote docs/${path}`);
}

// The screens: the level stays on the screen while the children program;
// while the plate is read, the ring is over the dimmed level.
const level45 = levelsData.levels.find((candidate) => candidate.id === 45) as unknown as { name: string; days: { map: string[] }[] };
const board = renderBoard(parseMap(level45.days[0].map), { caption: `Level 45: ${level45.name}\nPut every box on its colour.`, skin });
function overBoard(progress: number, hint?: string): string {
  return scanningOverlay(board, { progress, label: "Scanning", hint, spanner: skin.href("spanner") });
}

write("screens/programming.svg", board);
write("screens/scanning.svg", overBoard(0.62));
write("screens/scanning-closer.svg", overBoard(0.2, "Come a little closer"));

/** An animated run of a level's solution on its first day. */
function animation(levelId: number): string {
  const level = levelsData.levels.find((candidate) => candidate.id === levelId) as unknown as {
    solution: string[];
    days: { map: string[] }[];
  };
  const tokens = tokenizeText(level.solution.join("\n"));
  const world = parseMap(level.days[0].map);
  const result: AnimationFrame[] = [{ world: cloneWorld(world), token: null, caption: "start" }];
  for (const { token } of run(parse(tokens), world)) {
    result.push({ world: cloneWorld(world), token, caption: token.kind.symbol ?? token.kind.key.replace("_", " ") });
  }
  result.push({ ...result[result.length - 1], token: null, caption: "done!" });
  return renderRunAnimation(tokens, result, { skin });
}

write("demo/sorting.svg", animation(45));
write("demo/line.svg", animation(92));
