// Render every SVG below a directory to a PNG with a transparent background
// (headless Chrome), and remove the SVG. Usage: node dev/sprites/render_pngs.mjs <dir>

import { spawn } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2]);
const svgs = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".svg")) svgs.push(path);
  }
};
walk(root);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(
  "google-chrome",
  ["--headless=new", "--no-sandbox", "--remote-debugging-port=9334", "--hide-scrollbars",
   `--user-data-dir=${join(tmpdir(), "tactile-turtle-render")}`, "about:blank"],
  { stdio: "ignore" },
);
try {
  let targets;
  for (let i = 0; i < 100 && !targets; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9334/json")).json(); } catch { await sleep(200); }
  }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const svg of svgs) {
    const text = readFileSync(svg, "utf8");
    const width = Number(/width="([\d.]+)"/.exec(text)[1]);
    const height = Number(/height="([\d.]+)"/.exec(text)[1]);
    await send("Emulation.setDeviceMetricsOverride", { width: Math.ceil(width), height: Math.ceil(height), deviceScaleFactor: 1, mobile: false });
    const html = `<html><body style="margin:0;background:transparent">${text}</body></html>`;
    await send("Page.navigate", { url: "data:text/html;base64," + Buffer.from(html).toString("base64") });
    await sleep(250);
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } });
    writeFileSync(svg.replace(/\.svg$/, ".png"), Buffer.from(shot.data, "base64"));
    rmSync(svg);
  }
  ws.close();
  console.log(`Rendered ${svgs.length} pictures.`);
} finally {
  chrome.kill();
}
