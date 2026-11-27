// Reading a plate: from the markers found in a frame to the tiles on it.
//
// The plate has an anchor marker at both ends of every row (data/plate.json),
// each with its own id. Every anchor in view gives four known points, so a
// frame which shows only a part of the plate is still placed exactly: the
// homography from the picture to the plate (in millimetres) is fitted to the
// corners of all the anchors in view. The tiles are then read in plate
// millimetres, so that frames showing different parts can be stitched
// (src/scan/hold.ts).

import plateData from "../../data/plate.json" with { type: "json" };
import { kindById, TILE_GEOMETRY } from "../lang/catalogue.ts";
import type { RowTile } from "../lang/tokens.ts";
import type { DetectedMarker } from "./detector.ts";
import { Quad, type Point } from "./geometry.ts";
import { apply, fitHomography, invert, type Homography } from "./homography.ts";

export type PlateSpec = (typeof plateData.plates)[number];
export const PLATES: readonly PlateSpec[] = plateData.plates;

export interface PlacedTile extends RowTile {
  /** The slot of the tile in its row (0 = the leftmost). */
  readonly column: number;
  /**
   * Whether the tile was found close to the middle of its slot (its vote
   * counts double when the frames are merged, src/scan/hold.ts).
   */
  readonly confident: boolean;
  /** The centre of the tile on the plate, in millimetres. */
  readonly x: number;
  readonly y: number;
}

export interface PlateReading {
  readonly plate: PlateSpec;
  /** The rows from top to bottom; each row from left to right. Empty rows are kept. */
  readonly rows: readonly (readonly PlacedTile[])[];
  /**
   * Was this point of the plate (mm) inside the picture of this frame, at
   * least ``marginShare`` of the width of the picture away from its edges?
   */
  readonly sees: (point: Point, marginShare: number) => boolean;
  /** The homography from the plate (mm) to the picture (pixels). */
  readonly toImage: Homography;
}

export interface Anchor {
  readonly id: number;
  readonly row: number;
  readonly side: "left" | "right";
  /** The top left corner of the anchor marker on the plate, in millimetres. */
  readonly x: number;
  readonly y: number;
}

export function anchorsOf(plate: PlateSpec): Anchor[] {
  const anchors: Anchor[] = [];
  for (let row = 0; row < plate.rows; row++) {
    const y = plate.rows_top + row * plate.row_pitch + (plate.row_pitch - plate.anchor_size) / 2;
    anchors.push({ id: plate.first_anchor + 2 * row, row, side: "left", x: plate.anchor_margin, y });
    anchors.push({
      id: plate.first_anchor + 2 * row + 1,
      row,
      side: "right",
      x: plate.width - plate.anchor_margin - plate.anchor_size,
      y,
    });
  }
  return anchors;
}

/** The anchor marker on the plate. */
export function anchorQuad(plate: PlateSpec, anchor: Anchor): Quad {
  return Quad.square(anchor.x, anchor.y, plate.anchor_size);
}

const ANCHORS = new Map<number, { plate: PlateSpec; anchor: Anchor }>();
for (const plate of PLATES) {
  for (const anchor of anchorsOf(plate)) ANCHORS.set(anchor.id, { plate, anchor });
}

export function isPlateMarker(id: number): boolean {
  return ANCHORS.has(id);
}

/** The position of the top left of the tile in row ``row``, column ``column``. */
export function slotTopLeft(plate: PlateSpec, row: number, column: number): Point {
  return {
    x: plate.rows_left + column * TILE_GEOMETRY.tile_width,
    y: plate.rows_top + row * plate.row_pitch + (plate.row_pitch - TILE_GEOMETRY.tile_height) / 2,
  };
}

// The centre of the marker relative to the centre of its tile.
const MARKER_OFFSET: Point = {
  x: TILE_GEOMETRY.marker_x + TILE_GEOMETRY.marker_size / 2 - TILE_GEOMETRY.tile_width / 2,
  y: TILE_GEOMETRY.marker_y + TILE_GEOMETRY.marker_size / 2 - TILE_GEOMETRY.tile_height / 2,
};

/**
 * Every tile goes to the slot whose middle is nearest to its centre: the row
 * lines and the ticks only help the children to set the tiles, and a tile set
 * between two slots still counts. A tile seen within this distance from the
 * middle of its slot is placed confidently: it then helps to place the tiles
 * beyond it (taken as sitting exactly in its slot), and its vote counts double
 * when the frames are merged.
 */
const CONFIDENT_MM = 8;

/** Anchors whose corners land farther than this from where they belong are dropped. */
const ANCHOR_TOLERANCE_MM = 4;

function fit(plate: PlateSpec, anchors: readonly { marker: DetectedMarker; anchor: Anchor }[]): Homography | null {
  return fitHomography(
    anchors.flatMap(({ marker }) => marker.corners.corners),
    anchors.flatMap(({ anchor }) => anchorQuad(plate, anchor).corners),
  );
}

/** Where the marker of a tile is when the tile sits exactly in its slot. */
function slotMarkerQuad(plate: PlateSpec, row: number, column: number): Quad {
  const topLeft = slotTopLeft(plate, row, column);
  return Quad.square(
    topLeft.x + TILE_GEOMETRY.marker_x,
    topLeft.y + TILE_GEOMETRY.marker_y,
    TILE_GEOMETRY.marker_size,
  );
}

/** Pairs of corresponding points: a quad in the picture and the same quad on the plate. */
function correspondences(image: Quad, plate: Quad): { image: Point; plate: Point }[] {
  const plateCorners = plate.corners;
  return image.corners.map((point, i) => ({ image: point, plate: plateCorners[i] }));
}

/** How many of the nearest known points a local fit uses. */
const LOCAL_POINTS = 16;

/**
 * Place the tiles on the plate, outward from the anchors. The lens distorts
 * the picture, so one homography for the whole picture is off by a centimetre
 * or more far from the anchors. Instead, each tile is placed with a homography
 * fitted to the known points nearest to it in the picture (the corners of the
 * anchors, and of the tiles placed so far, taken as sitting in their slots),
 * starting with the tiles nearest to the known points.
 */
function placeTiles(
  plate: PlateSpec,
  anchors: readonly { marker: DetectedMarker; anchor: Anchor }[],
  markers: readonly DetectedMarker[],
): PlacedTile[][] {
  const known = anchors.flatMap(({ marker, anchor }) => correspondences(marker.corners, anchorQuad(plate, anchor)));

  const pending = markers
    .filter((marker) => !ANCHORS.has(marker.id) && kindById(marker.id) !== undefined)
    .map((marker) => ({ marker, centre: marker.corners.centre() }));

  const rows: PlacedTile[][] = Array.from({ length: plate.rows }, () => []);
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  while (pending.length > 0) {
    // The pending tile nearest to a known point.
    let best = 0;
    let bestDistance = Infinity;
    pending.forEach(({ centre }, index) => {
      const d = Math.min(...known.map((point) => distance(point.image, centre)));
      if (d < bestDistance) {
        bestDistance = d;
        best = index;
      }
    });
    const { marker, centre } = pending.splice(best, 1)[0];

    const nearest = [...known]
      .sort((a, b) => distance(a.image, centre) - distance(b.image, centre))
      .slice(0, LOCAL_POINTS);
    const local = fitHomography(
      nearest.map((point) => point.image),
      nearest.map((point) => point.plate),
    );
    if (local === null) continue;

    const markerCentre = apply(local, centre);
    const x = markerCentre.x - MARKER_OFFSET.x;
    const y = markerCentre.y - MARKER_OFFSET.y;
    const row = Math.floor((y - plate.rows_top) / plate.row_pitch);
    const column = Math.floor((x - plate.rows_left) / TILE_GEOMETRY.tile_width);
    if (row < 0 || row >= plate.rows || column < 0 || column >= plate.columns) continue;
    const slotX = plate.rows_left + (column + 0.5) * TILE_GEOMETRY.tile_width;
    const slotY = plate.rows_top + (row + 0.5) * plate.row_pitch;
    const offset = Math.max(Math.abs(x - slotX), Math.abs(y - slotY));
    const confident = offset <= CONFIDENT_MM;
    const other = rows[row].findIndex((tile) => tile.column === column);
    if (other >= 0) {
      if (rows[row][other].confident || !confident) continue;
      rows[row].splice(other, 1);
    }

    rows[row].push({ id: marker.id, column, confident, x, y, touchesPrevious: false });
    if (confident) known.push(...correspondences(marker.corners, slotMarkerQuad(plate, row, column)));
  }
  return rows;
}

/** Was the point of the plate inside the picture, away from its edges? */
export function makeSees(toImage: Homography, frame: FrameSize): PlateReading["sees"] {
  return (point, marginShare) => {
    const margin = marginShare * frame.width;
    const p = apply(toImage, point);
    return p.x > margin && p.y > margin && p.x < frame.width - margin && p.y < frame.height - margin;
  };
}

/** A reading as plain data (to send it from the worker). */
export interface ReadingData {
  readonly plate: string;
  readonly rows: readonly (readonly PlacedTile[])[];
  readonly toImage: Homography;
  readonly frame: FrameSize;
  /** The median size of the anchors in the picture, in pixels (to ask to come closer). */
  readonly anchorPixels: number;
}

export function toData(reading: PlateReading, frame: FrameSize, markers: readonly DetectedMarker[]): ReadingData {
  const sizes = markers
    .filter((marker) => ANCHORS.has(marker.id))
    .map((marker) => Math.hypot(marker.corners.topLeft.x - marker.corners.topRight.x, marker.corners.topLeft.y - marker.corners.topRight.y))
    .sort((a, b) => a - b);
  return {
    plate: reading.plate.name,
    rows: reading.rows,
    toImage: reading.toImage,
    frame: { width: frame.width, height: frame.height },
    anchorPixels: sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] : 0,
  };
}

export function fromData(data: ReadingData): PlateReading {
  return {
    plate: PLATES.find((plate) => plate.name === data.plate)!,
    rows: data.rows,
    toImage: data.toImage,
    sees: makeSees(data.toImage, data.frame),
  };
}

export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

export function readPlate(markers: readonly DetectedMarker[], frame: FrameSize): PlateReading | null {
  // Which plate: the one with the most anchors in view.
  const byPlate = new Map<PlateSpec, { marker: DetectedMarker; anchor: Anchor }[]>();
  for (const marker of markers) {
    const known = ANCHORS.get(marker.id);
    if (known === undefined) continue;
    if (!byPlate.has(known.plate)) byPlate.set(known.plate, []);
    byPlate.get(known.plate)!.push({ marker, anchor: known.anchor });
  }
  if (byPlate.size === 0) return null;
  const [plate, found] = [...byPlate].sort((a, b) => b[1].length - a[1].length)[0];

  // Fit, then drop anchors that do not agree with the others (a misread id).
  let anchors = found;
  let toPlate = fit(plate, anchors);
  if (toPlate === null) return null;
  if (anchors.length > 2) {
    const agreeing = anchors.filter(({ marker, anchor }) => {
      const expected = anchorQuad(plate, anchor).corners;
      return marker.corners.corners.every((corner, i) => {
        const p = apply(toPlate!, corner);
        return Math.hypot(p.x - expected[i].x, p.y - expected[i].y) < ANCHOR_TOLERANCE_MM;
      });
    });
    if (agreeing.length >= 1 && agreeing.length < anchors.length) {
      anchors = agreeing;
      toPlate = fit(plate, anchors);
      if (toPlate === null) return null;
    }
  }
  const toImage = invert(toPlate);
  if (toImage === null) return null;

  const rows = placeTiles(plate, anchors, markers);

  const sees = makeSees(toImage, frame);

  return {
    plate,
    rows: rows.map((row) => withTouching(row.sort((a, b) => a.column - b.column))),
    sees,
    toImage,
  };
}

/** Mark the tiles which touch their left neighbour (in the next slot; an empty slot is a space). */
export function withTouching(row: readonly PlacedTile[]): PlacedTile[] {
  return row.map((tile, index) => ({
    ...tile,
    touchesPrevious: index > 0 && tile.column === row[index - 1].column + 1,
  }));
}
