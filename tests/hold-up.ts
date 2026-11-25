// Hold a program up to the virtual webcam: set it on the plate, render a few
// frames of a trembling hold, read each, and merge the readings as the game
// does (src/scan/hold.ts).

import { layoutProgram } from "../src/lang/layout.ts";
import { MarkerDetector, type DetectedMarker, type Frame } from "../src/scan/detector.ts";
import { mergeReadings, type MergedPlate } from "../src/scan/hold.ts";
import { PLATES, readPlate, type PlateReading } from "../src/scan/plate.ts";
import {
  mulberry32,
  placeByHand,
  plateInView,
  render,
  trembling,
  type CameraSettings,
  type Pose,
  type Scene,
} from "./virtual-webcam.ts";

export interface HoldResult {
  /** The rows as they were set on the plate. */
  readonly expected: number[][];
  readonly scene: Scene;
  /** The merged reading. */
  readonly reading: MergedPlate | null;
  /** The rows of the merged reading, without empty rows. */
  readonly readRows: number[][];
  /** How many tiles (plus corners) each frame found. */
  readonly markersPerFrame: number[];
  readonly inView: boolean;
  readonly firstFrame: Frame;
  readonly firstMarkers: DetectedMarker[];
  readonly firstReading: PlateReading | null;
  readonly detectionMs: number;
}

const detector = new MarkerDetector();

export function holdUp(
  program: string,
  plateName: string,
  pose: Pose,
  camera: CameraSettings,
  seed: number,
  frames: number,
): HoldResult {
  return holdUpAlong(program, plateName, Array.from({ length: frames }, () => pose), camera, seed);
}

/**
 * Hold the plate up and move it along the poses, one frame per pose (each
 * but the first trembling a little). The frames may show only parts of it.
 */
export function holdUpAlong(
  program: string,
  plateName: string,
  poses: readonly Pose[],
  camera: CameraSettings,
  seed: number,
): HoldResult {
  const plate = PLATES.find((candidate) => candidate.name === plateName)!;
  const expected =
    layoutProgram(program, plate.columns, plate.rows) ?? layoutProgram(program, plate.columns, plate.rows, true);
  if (expected === null) throw new Error(`The program does not fit on the plate ${plateName}.`);

  const scene = placeByHand(plate, expected, seed);
  const random = mulberry32(seed * 7919);
  const readings: (PlateReading | null)[] = [];
  const markersPerFrame: number[] = [];
  let first: { frame: Frame; markers: DetectedMarker[]; reading: PlateReading | null } | null = null;
  let detectionMs = 0;
  let inView = true;

  poses.forEach((pose, i) => {
    const framePose = i === 0 ? pose : trembling(pose, random);
    inView &&= plateInView(scene, framePose, camera);
    const frame = render(scene, framePose, camera, seed * 1000 + i);
    const started = performance.now();
    const markers = detector.detect(frame);
    const reading = readPlate(markers, frame);
    detectionMs += performance.now() - started;
    readings.push(reading);
    markersPerFrame.push(markers.length);
    if (first === null) first = { frame, markers, reading };
  });

  const reading = mergeReadings(readings);
  return {
    expected,
    scene,
    reading,
    readRows: reading === null ? [] : reading.rows.map((row) => row.map((tile) => tile.id)).filter((row) => row.length > 0),
    markersPerFrame,
    inView,
    firstFrame: first!.frame,
    firstMarkers: first!.markers,
    firstReading: first!.reading,
    detectionMs: detectionMs / poses.length,
  };
}
