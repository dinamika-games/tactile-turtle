// The scanner page (milestone 1 of DESIGN.md): the camera, the five-second
// hold, and a run of the read program on a level.
//
// The level stays on the screen while the children set the tiles, so that
// they can study it. When they hold the plate up, the spanner and
// "Scanning" appear over it; when the plate is read, the turtle runs the
// program. Press D to see the camera and the numbers.

import { tokenize } from "./lang/tokens.ts";
import { playDemo } from "./demo.ts";
import { goalSentence, levelById, play } from "./play.ts";
import { renderRunAnimation } from "./render/animation.ts";
import { skinFrom } from "./render/skin.ts";
import { renderBoard } from "./render/board.ts";
import { scanningOverlay } from "./render/screens.ts";
import { parseMap } from "./world/world.ts";
import { PlateHold } from "./scan/hold.ts";
import { fromData } from "./scan/plate.ts";
import type { ScanReply } from "./scan/worker.ts";

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

const level = levelById(45);

/** The level as the children study it while they set the tiles. */
function levelBoard(): string {
  return renderBoard(parseMap(level.days[0].map), {
    caption: `Level ${level.id}: ${level.name}. ${goalSentence(level)}`,
    skin,
  });
}

type Mode = "scanning" | "running";
let mode: Mode = "scanning";

function show(svg: string): void {
  stage.innerHTML = svg;
  fitToScreen(stage);
}

/**
 * Size the pictures of the stage to the screen (tablets in landscape and
 * portrait, laptops): as large as possible, keeping their proportions. Two
 * pictures side by side (the demo's plate and screen) share the space; in
 * portrait they stand one above the other.
 */
export function fitToScreen(root: HTMLElement): void {
  const pictures = [...root.querySelectorAll<SVGSVGElement>(":scope > svg, :scope > .pair > svg")];
  const portrait = innerHeight > innerWidth;
  const share = pictures.length > 1 ? 0.5 : 1;
  const availableWidth = 96 * (portrait ? 1 : share) - (pictures.length > 1 && !portrait ? 2 : 0);
  const availableHeight = 90 * (portrait ? share : 1) - (pictures.length > 1 && portrait ? 2 : 0);
  for (const picture of pictures) {
    const box = picture.viewBox.baseVal;
    const aspect = box && box.width > 0 ? box.width / box.height : 1.6;
    picture.style.width = `min(${availableWidth}vw, ${(availableHeight * aspect).toFixed(2)}vh)`;
    picture.style.height = "auto";
  }
}

addEventListener("resize", () => fitToScreen(stage));

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
    show(levelBoard());
    return;
  }
  const small = reply.reading !== null && reply.reading.anchorPixels < SMALL_ANCHOR_PX;
  const partial = state.merged !== null && !state.merged.complete && state.merged.coverage > 0;
  show(
    scanningOverlay(levelBoard(), {
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
  const played = play(level, tokens);
  // The whole run as one smooth animation (src/render/animation.ts), played once.
  const stepMs = 600;
  show(renderRunAnimation(tokens, played.frames, { stepMs, loop: false, skin }));
  await new Promise((resolve) => setTimeout(resolve, (played.frames.length + 4) * stepMs));
  show(levelBoard());
  mode = "scanning";
}

async function start(): Promise<void> {
  try {
    await startCamera();
  } catch (error) {
    stage.textContent = `The camera did not start: ${String(error)}`;
    return;
  }
  show(levelBoard());
  scanLoop();
}

document.getElementById("start")!.addEventListener("click", () => void spritesReady.then(start));
// Decode every sprite before anything is shown: a sprite decoded only when it
// first appears leaves its frame empty for a moment (a flicker).
const spritesReady = Promise.all(
  Object.values(spriteUrls).map((url) => {
    const image = new Image();
    image.src = url;
    return image.decode().catch(() => undefined);
  }),
);

const params = new URLSearchParams(location.search);
// ?autostart: start without the button (a kiosk, or a test with a fake camera).
if (params.has("autostart")) void spritesReady.then(start);
// ?demo: imaginary plates, without a camera (src/demo.ts).
if (params.has("demo")) void spritesReady.then(() => playDemo(stage, document.getElementById("narration")!, skin, fitToScreen));

document.addEventListener("keydown", (event) => {
  if (event.key === "d" || event.key === "D") document.body.classList.toggle("debug");
});
