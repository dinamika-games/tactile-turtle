// Read the printable PDFs back with the game's detector (js-aruco2): every
// tile of the kit and every anchor of the plates must be found. Needs the
// PDFs (venv/bin/python dev/print/generate_stickers.py) and pdftoppm.
//
// Run with `npm run verify:print`.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import plateData from "../data/plate.json" with { type: "json" };
import { TILE_KINDS } from "../src/lang/catalogue.ts";
import { MarkerDetector } from "../src/scan/detector.ts";
import { anchorsOf } from "../src/scan/plate.ts";

const PRINT = new URL("../print/", import.meta.url).pathname;
const available =
  existsSync(PRINT) &&
  (() => {
    try {
      execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

/** Rasterize a PDF and return the marker ids found, over all pages. */
function readPdf(pdf: string, dpi: number): number[] {
  const dir = mkdtempSync(join(tmpdir(), "tt-print-"));
  try {
    execFileSync("pdftoppm", ["-r", String(dpi), "-png", pdf, join(dir, "page")]);
    const detector = new MarkerDetector();
    const ids: number[] = [];
    for (const file of readdirSync(dir).sort()) {
      const png = PNG.sync.read(readFileSync(join(dir, file)));
      ids.push(...detector.detect({ width: png.width, height: png.height, data: png.data }).map((m) => m.id));
    }
    return ids.sort((a, b) => a - b);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!available)("the printable PDFs", () => {
  const tilePdfs = available ? readdirSync(PRINT).filter((name) => name.startsWith("tactile-turtle-tiles-")) : [];

  it.each(tilePdfs)("%s holds the whole kit", (name) => {
    const expected = TILE_KINDS.flatMap((kind) => Array.from({ length: kind.kit }, () => kind.id)).sort((a, b) => a - b);
    // 60 dpi: about 2.4 pixels per millimetre, like a webcam at 50 cm.
    expect(readPdf(join(PRINT, name), 60)).toEqual(expected);
  });

  it.each(plateData.plates)("the plate $name has all its anchors", (plate) => {
    const expected = anchorsOf(plate).map((anchor) => anchor.id).sort((a, b) => a - b);
    expect(readPdf(join(PRINT, `tactile-turtle-plate-${plate.name}.pdf`), 40)).toEqual(expected);
  });
});
