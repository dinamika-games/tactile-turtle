// The scanner page (milestone 1 of DESIGN.md): the camera, the five-second
// hold, and a run of the read program on a level.
//
// The screen stays black while the children set the tiles. When they hold
// the plate up, it shows a spanner and "Scanning"; when the plate is read,
// the turtle runs the program. Press D to see the camera and the numbers.

import levelsData from "../data/levels.json" with { type: "json" };
import { parse, ParseError } from "./lang/parser.ts";
import { tokenize } from "./lang/tokens.ts";
import { renderRunAnimation, type AnimationFrame } from "./render/animation.ts";
import { skinFrom } from "./render/skin.ts";
import { blackScreen, scanningScreen } from "./render/screens.ts";
import { PlateHold } from "./scan/hold.ts";
import { fromData } from "./scan/plate.ts";
import type { ScanReply } from "./scan/worker.ts";
import { run, RunError } from "./world/run.ts";
import { goalMet, type Goal } from "./world/goals.ts";
import { cloneWorld, parseMap } from "./world/world.ts";

const stage = document.getElementById("stage")!;
const video = document.getElementById("video") as HTMLVideoElement;
const stats = document.getElementById("stats")!;

// The sprites (assets/sprites/), as URLs of the built site.
const spriteUrls = import.meta.glob("../assets/sprites/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const skin = skinFrom(
  Object.fromEntries(Object.entries(spriteUrls).map(([path, url]) => [path.replace(/^.*\/(.*)\.png$/, "$1"), url])),
);

/** Anchors smaller than this (pixels) are hard to read: ask to come closer. */
const SMALL_ANCHOR_PX = 26;
const SCAN_INTERVAL_MS = 100;

const level = levelsData.levels.find((candidate) => candidate.id === 45) as unknown as {
  name: string;
  days: { map: string[] }[];
  goals: Goal[];
};

type Mode = "scanning" | "running";
let mode: Mode = "scanning";

function show(svg: string): void {
  stage.innerHTML = svg;
}

async function startCamera(): Promise<void> {
  // Ask for 1280 x 720 explicitly: without it, browsers give 640 x 480.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

const worker = new Worker(new URL("./scan/worker.ts", import.meta.url), { type: "module" });
const hold = new PlateHold();
let busy = false;

worker.onmessage = (event: MessageEvent<ScanReply>) => {
  busy = false;
  const reply = event.data;
  stats.textContent =
    `${video.videoWidth}x${video.videoHeight} · ${reply.markers} markers · ` +
    `${reply.milliseconds.toFixed(0)} ms` +
    (reply.reading ? ` · anchors ${reply.reading.anchorPixels.toFixed(0)} px` : "");
  if (mode !== "scanning") return;

  const state = hold.add(performance.now(), reply.reading === null ? null : fromData(reply.reading));
  if (state.phase === "idle") {
    show(blackScreen(1280, 720));
    return;
  }
  const small = reply.reading !== null && reply.reading.anchorPixels < SMALL_ANCHOR_PX;
  const partial = state.merged !== null && !state.merged.complete && state.merged.coverage > 0;
  show(
    scanningScreen({
      width: 1280,
      height: 720,
      progress: state.progress,
      label: "Scanning",
      spanner: skin.href("spanner"),
      hint: small ? "Come a little closer" : partial ? "Show all of the plate" : undefined,
    }),
  );
  if (state.accepted && state.merged !== null) {
    hold.reset();
    void runProgram(state.merged.rows.filter((row) => row.length > 0));
  }
};

function scanLoop(): void {
  if (!busy && mode === "scanning" && video.readyState >= 2) {
    busy = true;
    createImageBitmap(video).then(
      (bitmap) => worker.postMessage(bitmap, [bitmap]),
      () => {
        busy = false;
      },
    );
  }
  setTimeout(scanLoop, SCAN_INTERVAL_MS);
}

async function runProgram(rows: Parameters<typeof tokenize>[0]): Promise<void> {
  mode = "running";
  const tokens = tokenize(rows);
  const world = parseMap(level.days[0].map);
  const frames: AnimationFrame[] = [{ world: cloneWorld(world), token: null, caption: level.name }];
  let ending: string;
  try {
    const program = parse(tokens);
    for (const { token } of run(program, world)) {
      frames.push({ world: cloneWorld(world), token, caption: token.kind.symbol ?? token.kind.key.replace("_", " ") });
    }
    ending = level.goals.every((goal) => goalMet(goal, world)) ? "Well done!" : "Not quite: try again";
  } catch (error) {
    ending = error instanceof ParseError || error instanceof RunError ? error.message : String(error);
  }
  frames.push({ world: cloneWorld(world), token: null, caption: ending });

  // The whole run as one smooth animation (src/render/animation.ts), played once.
  const stepMs = 600;
  show(renderRunAnimation(tokens, frames, { stepMs, loop: false, skin }));
  await new Promise((resolve) => setTimeout(resolve, (frames.length + 4) * stepMs));
  show(blackScreen(1280, 720));
  mode = "scanning";
}

async function start(): Promise<void> {
  try {
    await startCamera();
  } catch (error) {
    stage.textContent = `The camera did not start: ${String(error)}`;
    return;
  }
  show(blackScreen(1280, 720));
  scanLoop();
}

document.getElementById("start")!.addEventListener("click", () => void start());
// ?autostart: start without the button (a kiosk, or a test with a fake camera).
if (new URLSearchParams(location.search).has("autostart")) void start();

document.addEventListener("keydown", (event) => {
  if (event.key === "d" || event.key === "D") document.body.classList.toggle("debug");
});
