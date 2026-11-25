// End to end: a program is set on a plate, held up 50-70 cm in front of a
// virtual 720p webcam (turned, in perspective, blurred, noisy, with salt and
// pepper and JPEG), and must be read back exactly, tile by tile.
//
// Run `npm run docs:e2e` to also write the pictures to docs/e2e/ (used by the
// README).

import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import levelsData from "../data/levels.json" with { type: "json" };
import { parse } from "../src/lang/parser.ts";
import { tokenize, tokenizeText } from "../src/lang/tokens.ts";
import type { DetectedMarker, Frame } from "../src/scan/detector.ts";
import { apply } from "../src/scan/homography.ts";
import { isPlateMarker, type PlateReading } from "../src/scan/plate.ts";
import { holdUp, holdUpAlong, type HoldResult } from "./hold-up.ts";
import {
  drawLine,
  pixelsPerMm,
  toJpeg,
  WEBCAM_720P,
  WEBCAM_VGA,
  type CameraSettings,
  type Pose,
} from "./virtual-webcam.ts";

const SAVE_PICTURES = process.env.TT_SAVE_PICTURES === "1";
const PICTURES = new URL("../docs/e2e/", import.meta.url);

const A4_PROGRAM = `
a ← 12
WHILE FRONT ≠ ROCK
IF HERE = RED
a ← a + 1 END
FORWARD END
REPEAT a PAINT BLUE
FORWARD END`;

// The longest program of all levels (level 94, "Bar chart"), on the A3 plate.
const A3_PROGRAM = levelsData.levels.find((level) => level.id === 94)!.solution.join("\n");

interface Case {
  readonly name: string;
  readonly plate: string;
  readonly program: string;
  readonly pose: Pose;
  readonly seed: number;
  readonly camera: CameraSettings;
}

// At 50-60 cm the plate may be tilted clearly; at 70 cm a marker is only about
// 3 pixels per cell, so there the plate must be held fairly straight (the
// scanning screen asks the children to come closer when it is too small).
const CASES: Case[] = [
  { name: "a4-50cm", plate: "a4", program: A4_PROGRAM, seed: 1, pose: { distance: 500, roll: -8, yaw: 20, pitch: -12, offsetX: 40 }, camera: WEBCAM_720P },
  { name: "a4-60cm", plate: "a4", program: A4_PROGRAM, seed: 2, pose: { distance: 600, roll: 6, yaw: -25, pitch: 15, offsetY: 20 }, camera: WEBCAM_720P },
  { name: "a4-70cm", plate: "a4", program: A4_PROGRAM, seed: 3, pose: { distance: 700, roll: 8, yaw: 10, pitch: 10, offsetX: -60, offsetY: -30 }, camera: WEBCAM_720P },
  { name: "a3-50cm", plate: "a3", program: A3_PROGRAM, seed: 4, pose: { distance: 500, roll: -5, yaw: -15, pitch: 10 }, camera: WEBCAM_720P },
  { name: "a3-60cm", plate: "a3", program: A3_PROGRAM, seed: 5, pose: { distance: 600, roll: 8, yaw: 20, pitch: -15, offsetX: 30 }, camera: WEBCAM_720P },
  { name: "a3-70cm", plate: "a3", program: A3_PROGRAM, seed: 6, pose: { distance: 700, roll: -8, yaw: -10, pitch: 10, offsetY: 25 }, camera: WEBCAM_720P },
  // The same webcam in 640 x 480: closer (30 cm is like 60 cm in 720p), and only A4.
  { name: "vga-a4-30cm", plate: "a4", program: A4_PROGRAM, seed: 7, camera: WEBCAM_VGA, pose: { distance: 300, roll: 5, yaw: -8, pitch: 6 } },
];

function annotate(frame: Frame, markers: readonly DetectedMarker[], reading: PlateReading | null): Uint8ClampedArray {
  const data = new Uint8ClampedArray(frame.data);
  const canvas = { width: frame.width, height: frame.height, data };

  if (reading !== null) {
    // The row lines of the plate, as the game understood them.
    const plate = reading.plate;
    const right = plate.rows_left + plate.columns * 25;
    for (let row = 0; row <= plate.rows; row++) {
      const y = plate.rows_top + row * plate.row_pitch;
      const a = apply(reading.toImage, { x: plate.rows_left, y });
      const b = apply(reading.toImage, { x: right, y });
      drawLine(canvas, a.x, a.y, b.x, b.y, [0, 200, 255], 1);
    }
  }

  for (const marker of markers) {
    const colour: [number, number, number] = isPlateMarker(marker.id) ? [40, 90, 255] : [0, 230, 60];
    for (const [a, b] of marker.corners.edges) {
      drawLine(canvas, a.x, a.y, b.x, b.y, colour, 2);
    }
  }
  return data;
}

function checkReading(result: HoldResult, program: string, plateName: string): void {
  expect(result.reading, "the plate is found").not.toBeNull();
  expect(result.reading!.plate.name).toBe(plateName);
  expect(result.reading!.complete, "every slot of the plate was seen").toBe(true);
  expect(result.readRows).toEqual(result.expected);

  // The same tokens as the program, with the digits joined into numbers.
  const tokens = tokenize(result.reading!.rows.filter((row) => row.length > 0));
  const expected = tokenizeText(program);
  expect(tokens.map((token) => [token.kind.key, token.value])).toEqual(
    expected.map((token) => [token.kind.key, token.value]),
  );
  expect(() => parse(tokens)).not.toThrow();
}

const PLATE_ROWS: Record<string, number> = { a4: 7, a3: 10 };

const FRAMES = 5; // about half a second of the five-second hold

describe("reading a plate held up to a virtual webcam", () => {
  it.each(CASES)("$name", ({ name, plate: plateName, program, pose, seed, camera }) => {
    const result = holdUp(program, plateName, pose, camera, seed, FRAMES);
    expect(result.inView, "the plate is inside the picture").toBe(true);

    const tiles = result.expected.flat().length + 2 * PLATE_ROWS[plateName];
    console.log(
      `${name}: ${camera.width}x${camera.height}, ${pixelsPerMm(pose, camera).toFixed(2)} px/mm at the centre, ` +
        `markers per frame ${result.markersPerFrame.join(" ")} of ${tiles}, ` +
        `${result.detectionMs.toFixed(0)} ms per frame`,
    );

    if (SAVE_PICTURES) {
      mkdirSync(PICTURES, { recursive: true });
      writeFileSync(new URL(`${name}.jpg`, PICTURES), toJpeg(result.firstFrame));
      const annotated = annotate(result.firstFrame, result.firstMarkers, result.firstReading);
      writeFileSync(new URL(`${name}-read.jpg`, PICTURES), toJpeg({ ...result.firstFrame, data: annotated }));
    }

    checkReading(result, program, plateName);
  });
});

// The plate is held too close to be seen whole, and moved about: the parts
// are stitched by the anchors at the ends of the rows.
const STITCH_CASES = [
  { name: "stitch-a3-30cm", camera: WEBCAM_720P, distance: 300 },
  { name: "stitch-vga-a3-25cm", camera: WEBCAM_VGA, distance: 250 },
];

describe("stitching a plate that is moved in front of the webcam", () => {
  it.each(STITCH_CASES)("$name", ({ name, camera, distance }) => {
    const poses: Pose[] = [];
    for (const offsetY of [-70, 0, 70]) {
      for (const offsetX of [-110, 0, 110]) {
        poses.push({ distance, roll: 4, yaw: offsetX / 20, pitch: -offsetY / 20, offsetX, offsetY });
        poses.push({ distance, roll: -3, yaw: offsetX / 25, pitch: -offsetY / 25, offsetX, offsetY });
      }
    }
    const result = holdUpAlong(A3_PROGRAM, "a3", poses, camera, 11);
    expect(result.inView, "no single frame shows the whole plate").toBe(false);
    console.log(
      `${name}: ${camera.width}x${camera.height}, ${poses.length} frames, ` +
        `markers per frame ${result.markersPerFrame.join(" ")}, coverage ${result.reading?.coverage.toFixed(2)}`,
    );
    if (SAVE_PICTURES) {
      mkdirSync(PICTURES, { recursive: true });
      const annotated = annotate(result.firstFrame, result.firstMarkers, result.firstReading);
      writeFileSync(new URL(`${name}-read.jpg`, PICTURES), toJpeg({ ...result.firstFrame, data: annotated }));
    }
    checkReading(result, A3_PROGRAM, "a3");
  });
});
