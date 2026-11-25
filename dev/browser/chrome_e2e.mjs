// The game end to end in a real browser: the built site in headless Chrome,
// with a fake camera that plays the virtual webcam (dev/browser/fake_camera.ts).
// The plate must be scanned and the program run. Screenshots go to
// build/browser/. Usage: npm run test:browser (needs google-chrome).

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fake = process.argv[2];
const out = "build/browser";
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const preview = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], { stdio: "ignore" });
const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--remote-debugging-port=9333",
    "--window-size=1280,760",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${fake}`,
    `--user-data-dir=${join(tmpdir(), "tactile-turtle-chrome")}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let ok = false;
try {
  let targets;
  for (let i = 0; i < 100 && targets === undefined; i++) {
    try {
      targets = await (await fetch("http://127.0.0.1:9333/json")).json();
    } catch {
      await sleep(200);
    }
  }
  const page = targets.find((target) => target.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message.result);
      pending.delete(message.id);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(message.params.exceptionDetails));
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  await sleep(1500); // the preview server
  await send("Page.navigate", { url: "http://localhost:4173/?autostart" });

  let scanned = false;
  let ran = false;
  for (let second = 1; second <= 30 && !(scanned && ran); second++) {
    await sleep(1000);
    const state = await send("Runtime.evaluate", {
      expression: "[...document.querySelectorAll('#stage text')].map((t) => t.textContent).join(' | ')",
    });
    const text = state.result.value ?? "";
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${out}/second-${String(second).padStart(2, "0")}.png`, Buffer.from(shot.data, "base64"));
    if (text.includes("Scanning")) scanned = true;
    if (text.includes("REPEAT")) ran = true; // the program panel of the run
    console.log(`${second}s: ${text.slice(0, 80) || "(black)"}`);
  }
  ws.close();
  if (errors.length > 0) console.error(errors.join("\n"));
  ok = scanned && ran && errors.length === 0;
  console.log(ok ? "OK: scanned and ran the program." : "FAILED: the plate was not scanned and run.");
} finally {
  chrome.kill();
  preview.kill();
}
process.exit(ok ? 0 : 1);
