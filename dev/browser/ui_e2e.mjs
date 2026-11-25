// The game's screens in a real browser, as a class would use them: choose a
// language, start a journey, choose world 1 and level 1, hold the plate up
// (a fake camera with level 1's solution, dev/browser/fake_camera.ts), win,
// and find the journey again after a reload. Screenshots go to build/ui/.
//
// Usage: node dev/browser/ui_e2e.mjs <fake-camera.mjpeg> [url] (needs the dev
// server or the preview, and google-chrome).

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fake = process.argv[2];
const url = process.argv[3] ?? "http://localhost:5173/";
const out = "build/ui";
mkdirSync(out, { recursive: true });
const profile = join(tmpdir(), "tactile-turtle-ui");
rmSync(profile, { recursive: true, force: true }); // a fresh browser: no saved language, no journeys
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = spawn(
  "google-chrome",
  ["--headless=new", "--no-sandbox", "--remote-debugging-port=9338", "--use-fake-ui-for-media-stream",
   "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${fake}`, `--user-data-dir=${profile}`, "about:blank"],
  { stdio: "ignore" },
);

let failures = 0;
try {
  let targets;
  for (let i = 0; i < 100 && targets === undefined; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9338/json")).json(); } catch { await sleep(200); }
  }
  const ws = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result); pending.delete(message.id); }
    if (message.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true })).result.value;
  let shots = 0;
  const shot = async (name) => {
    const image = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${out}/${String(++shots).padStart(2, "0")}-${name}.png`, Buffer.from(image.data, "base64"));
  };
  const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
  const click = (selector) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true; })()`);
  const text = () => evaluate("document.getElementById('overlay').innerText");
  const waitFor = async (predicate, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await predicate()) return true; await sleep(300); } return false; };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url });

  check(await waitFor(async () => (await evaluate("document.querySelectorAll('[data-code]').length")) === 16), "the first start asks for the language (16 languages)");
  check((await evaluate("[...document.querySelectorAll('[data-code]')].map((b) => b.textContent).slice(0, 3).join(' | ')")) === "Bosanski / Hrvatski / Srpski | Deutsch | English", "the languages are in alphabetical order");
  await shot("language");
  await click('[data-code="de"]');
  check(await waitFor(async () => (await text()).includes("Spielen")), "the start screen is in German");
  await shot("start");
  await click('[data-action="play"]');
  check(await waitFor(async () => (await text()).includes("Eure Reisen")), "the journeys");
  await evaluate(`document.getElementById('journey-name').value = 'Klasse 4a'`);
  await shot("journeys");
  await click('[data-action="new"]');
  check(await waitFor(async () => (await text()).includes("Wählt eine Welt")), "the worlds");
  check((await evaluate("document.querySelectorAll('[data-world]:not([disabled])').length")) === 1, "only world 1 is open");
  await shot("worlds");
  await click('[data-world="1"]');
  check(await waitFor(async () => (await text()).includes("Wählt ein Level")), "the levels of world 1");
  check((await evaluate("[...document.querySelectorAll('[data-level]:not([disabled])')].map((b) => b.dataset.level).join()")) === "1", "only level 1 is open");
  await shot("levels");
  await click('[data-level="1"]');
  check(await waitFor(async () => (await evaluate("document.body.classList.contains('camera')")) === true, 10000), "the level shows the webcam beside it");
  await sleep(1500);
  await shot("level");
  const noOverlap = await evaluate(`(() => { const a = document.querySelector('#stage svg').getBoundingClientRect(); const b = document.getElementById('camera-view').getBoundingClientRect(); return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top; })()`);
  check(noOverlap, "the webcam does not overlap the level");
  check(await waitFor(async () => (await evaluate("[...document.querySelectorAll('#stage text')].some((t) => t.textContent === 'Scannen')")) === true, 20000), "scanning (in German)");
  await shot("scanning");
  check(await waitFor(async () => (await text()).includes("Gut gemacht"), 40000), "the run is won: the reward");
  await shot("reward");
  check((await evaluate("localStorage.getItem('tactile-turtle/journeys')")).includes("Klasse 4a"), "the journey is saved");

  await send("Page.navigate", { url });
  check(await waitFor(async () => (await evaluate("document.querySelector('[data-code].current')?.dataset.code")) === "de"), "after a reload: the language is asked again, with the last choice marked");
  await click('[data-code].current');
  check(await waitFor(async () => (await text()).includes("Spielen")), "after a reload: the start screen in German");
  check((await evaluate("document.querySelector('[data-action=language]').textContent")).includes("🌐 Deutsch"), "the language button shows 🌐 and the language");
  await click('[data-action="play"]');
  check(await waitFor(async () => (await text()).includes("Klasse 4a")), "after a reload: the journey is there");
  await click("[data-id]");
  await waitFor(async () => (await text()).includes("Wählt eine Welt"));
  await click('[data-world="1"]');
  await waitFor(async () => (await text()).includes("Wählt ein Level"));
  check((await evaluate("[...document.querySelectorAll('[data-level]:not([disabled])')].map((b) => b.dataset.level).join()")) === "1", "level 1 stays playable (2 and 3 are open but in preparation)");
  check((await text()).includes("In Vorbereitung"), "open levels without maps say they are in preparation");
  await shot("levels-after");

  // Back and the main menu.
  await click('[data-level="1"]');
  check(await waitFor(async () => (await evaluate("document.body.classList.contains('camera')")) === true, 10000), "level 1 again");
  await evaluate("history.back()");
  check(await waitFor(async () => (await text()).includes("Wählt ein Level")), "the browser's Back leaves the level for the levels");
  check((await evaluate("document.body.classList.contains('camera')")) === false, "leaving the level hides the webcam");
  await evaluate("history.back()");
  check(await waitFor(async () => (await text()).includes("Wählt eine Welt")), "Back again: the worlds");
  await click('[data-action="home"]');
  check(await waitFor(async () => (await text()).includes("Spielen")), "🏠 leads to the main menu");
  if (errors.length > 0) { console.log("ERRORS:\n" + errors.join("\n")); failures++; }
  ws.close();
} finally {
  chrome.kill();
}
console.log(failures === 0 ? "OK" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
