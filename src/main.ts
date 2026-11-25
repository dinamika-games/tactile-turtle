// The game: the start, the language, the journeys, the worlds and levels
// (src/ui/), and a level with the camera; or the demo (?demo).
//
// The level stays on the screen while the children set the tiles, so that
// they can study it. When they hold the plate up, the spanner and
// "Scanning" appear over it; when the plate is read, the turtle runs the
// program. Press D to see the camera and the numbers.

import { playDemo } from "./demo.ts";
import { levelById } from "./play.ts";
import { skinFrom } from "./render/skin.ts";
import { App } from "./ui/app.ts";
import { CameraScanner } from "./ui/camera.ts";
import { openLevel } from "./ui/level-screen.ts";
import { fitToScreen } from "./ui/stage.ts";

const stage = document.getElementById("stage")!;
const overlay = document.getElementById("overlay")!;
const video = document.getElementById("video") as HTMLVideoElement;
const stats = document.getElementById("stats")!;

// The sprites (assets/sprites/), as URLs of the built site.
const spriteUrls = import.meta.glob("../assets/sprites/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const skin = skinFrom(
  Object.fromEntries(Object.entries(spriteUrls).map(([path, url]) => [path.replace(/^.*\/(.*)\.png$/, "$1"), url])),
);

addEventListener("resize", () => fitToScreen(stage));

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
const scanner = new CameraScanner(video, stats);

void spritesReady.then(() => {
  if (params.has("demo")) {
    // ?demo: imaginary plates, without a camera (src/demo.ts).
    void playDemo(stage, document.getElementById("narration")!, skin, fitToScreen);
  } else if (params.has("autostart")) {
    // ?autostart: straight into a level with the camera, outside any journey
    // (a kiosk, or the test with a fake camera, dev/browser/chrome_e2e.mjs).
    const level = levelById(Number(params.get("level") ?? 45));
    void openLevel(level, { stage, overlay, skin, scanner, onWin: () => null, onLeave: () => location.reload(), onNext: null });
  } else {
    new App({ stage, overlay, skin, scanner, storage: localStorage }).begin();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "d" || event.key === "D") document.body.classList.toggle("debug");
});
