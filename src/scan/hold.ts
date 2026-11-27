// Holding the plate up: stitching and merging the readings of many frames
// (DESIGN.md, section 5).
//
// The children may move the plate while they hold it up, so that the camera
// sees one part of it after the other. Every frame is placed on the plate by
// its anchors (src/scan/plate.ts), so the readings are all in plate
// millimetres and are merged slot by slot:
//
// * a tile counts if it was seen in enough of the frames *which had its place
//   in view* (a frame that showed only the left half says nothing about the
//   right half);
// * its id is the one seen most often at that place;
// * the plate is complete when every slot has been in view in a few frames.
//
// A program is accepted when the plate is complete and nothing has changed
// for the hold time; while scanning, the screen shows a spanner and
// "Scanning" (DESIGN.md, section 6).

import { TILE_GEOMETRY } from "../lang/catalogue.ts";
import type { Point } from "./geometry.ts";
import { slotTopLeft, withTouching, type PlacedTile, type PlateReading, type PlateSpec } from "./plate.ts";

export interface MergeOptions {
  /** A tile counts if it was seen in at least this share of the frames that had it in view. */
  readonly minShare: number;
  /** A slot is covered when it was in view in at least this many frames. */
  readonly minViews: number;
}

export const DEFAULT_MERGE: MergeOptions = { minShare: 0.3, minViews: 2 };

export interface MergedPlate {
  readonly plate: PlateSpec;
  /** The rows from top to bottom (empty rows kept), each from left to right. */
  readonly rows: readonly (readonly PlacedTile[])[];
  /** For every slot (row, column): in how many frames it was in view. */
  readonly views: readonly (readonly number[])[];
  /** The share of slots that were in view in at least ``minViews`` frames. */
  readonly coverage: number;
  readonly complete: boolean;
}

// The points of a tile's marker that must be in the picture for it to be read.
const MARKER_HALF = TILE_GEOMETRY.marker_size / 2 + 1;
const MARKER_CENTRE_DY =
  TILE_GEOMETRY.marker_y + TILE_GEOMETRY.marker_size / 2 - TILE_GEOMETRY.tile_height / 2;

/**
 * A tile near the edge of the picture is often not found (and distorted), so
 * a frame is held against a tile it did not see only if the tile was well
 * inside the picture; for the coverage, being inside at all is enough.
 */
const VOTE_MARGIN = 0.05;
const COVERAGE_MARGIN = 0.01;

function markerInView(reading: PlateReading, tileCentre: Point, marginShare: number): boolean {
  const cx = tileCentre.x;
  const cy = tileCentre.y + MARKER_CENTRE_DY;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].every(([sx, sy]) => reading.sees({ x: cx + sx * MARKER_HALF, y: cy + sy * MARKER_HALF }, marginShare));
}

/** Merge the readings of several frames (nulls are frames without a plate). */
export function mergeReadings(
  readings: readonly (PlateReading | null)[],
  options: MergeOptions = DEFAULT_MERGE,
): MergedPlate | null {
  const found = readings.filter((reading): reading is PlateReading => reading !== null);
  if (found.length === 0) return null;

  // The plate seen most often.
  const counts = new Map<string, number>();
  for (const reading of found) counts.set(reading.plate.name, (counts.get(reading.plate.name) ?? 0) + 1);
  const plateName = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const same = found.filter((reading) => reading.plate.name === plateName);
  const plate = same[0].plate;

  const rows: PlacedTile[][] = [];
  for (let row = 0; row < plate.rows; row++) {
    const merged: PlacedTile[] = [];
    for (let column = 0; column < plate.columns; column++) {
      const sightings = same.flatMap((reading) => (reading.rows[row] ?? []).filter((tile) => tile.column === column));
      if (sightings.length === 0) continue;
      const centre = slotCentre(plate, row, column);
      const inView = same.filter((reading) => markerInView(reading, centre, VOTE_MARGIN)).length;
      const needed = Math.max(1, Math.ceil(options.minShare * Math.max(inView, sightings.length)));
      if (sightings.length < needed) continue;
      const votes = new Map<number, number>();
      for (const tile of sightings) votes.set(tile.id, (votes.get(tile.id) ?? 0) + (tile.confident ? 2 : 1));
      const id = [...votes].sort((a, b) => b[1] - a[1])[0][0];
      merged.push({
        id,
        column,
        confident: true,
        x: mean(sightings.map((t) => t.x)),
        y: mean(sightings.map((t) => t.y)),
        touchesPrevious: false,
      });
    }
    rows.push(withTouching(merged));
  }

  const views: number[][] = [];
  let covered = 0;
  for (let row = 0; row < plate.rows; row++) {
    const rowViews: number[] = [];
    for (let column = 0; column < plate.columns; column++) {
      const centre = slotCentre(plate, row, column);
      const count = same.filter((reading) => markerInView(reading, centre, COVERAGE_MARGIN)).length;
      rowViews.push(count);
      if (count >= options.minViews) covered++;
    }
    views.push(rowViews);
  }
  const coverage = covered / (plate.rows * plate.columns);
  return { plate, rows, views, coverage, complete: coverage === 1 };
}

function slotCentre(plate: PlateSpec, row: number, column: number): Point {
  const topLeft = slotTopLeft(plate, row, column);
  return { x: topLeft.x + TILE_GEOMETRY.tile_width / 2, y: topLeft.y + TILE_GEOMETRY.tile_height / 2 };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function signature(merged: MergedPlate | null): string {
  if (merged === null) return "";
  return merged.plate.name + ":" + merged.rows.map((row) => row.map((tile) => tile.id).join(",")).join("|");
}

export interface HoldState {
  /** "idle": no plate (the screen stays black); "scanning": a plate is being read. */
  readonly phase: "idle" | "scanning";
  readonly merged: MergedPlate | null;
  /** How far the scan is, from 0 to 1. */
  readonly progress: number;
  /** True once, when the program has been read. */
  readonly accepted: boolean;
}

export interface HoldOptions {
  /** Without a plate in view for this long, the scan starts over. */
  readonly lostMs: number;
  /** The plate must be complete and unchanged for this long. */
  readonly steadyMs: number;
  readonly merge: MergeOptions;
}

export const DEFAULT_HOLD: HoldOptions = { lostMs: 1500, steadyMs: 3000, merge: DEFAULT_MERGE };

/** Follows the frames while a plate is held up (and moved about). */
export class PlateHold {
  private session: { time: number; reading: PlateReading }[] = [];
  private lastSeen = -Infinity;
  private lastSignature = "";
  private steadySince = 0;
  private done = false;
  private readonly options: HoldOptions;

  constructor(options: HoldOptions = DEFAULT_HOLD) {
    this.options = options;
  }

  add(time: number, reading: PlateReading | null): HoldState {
    if (reading === null) {
      if (time - this.lastSeen > this.options.lostMs) this.reset();
      if (this.session.length === 0) return { phase: "idle", merged: null, progress: 0, accepted: false };
    } else {
      this.lastSeen = time;
      this.session.push({ time, reading });
    }

    const merged = mergeReadings(
      this.session.map((frame) => frame.reading),
      this.options.merge,
    );
    const current = signature(merged);
    if (current !== this.lastSignature) {
      this.lastSignature = current;
      this.steadySince = time;
    }
    const steady = Math.min(1, (time - this.steadySince) / this.options.steadyMs);
    const coverage = merged?.coverage ?? 0;
    const progress = merged?.complete ? 0.5 + 0.5 * steady : 0.5 * coverage;
    const accepted = merged !== null && merged.complete && steady >= 1 && !this.done;
    if (accepted) this.done = true;
    return { phase: "scanning", merged, progress, accepted };
  }

  reset(): void {
    this.session = [];
    this.lastSignature = "";
    this.done = false;
  }
}
