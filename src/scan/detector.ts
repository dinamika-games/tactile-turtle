// Finding the markers in a camera frame, with js-aruco2 (pure JavaScript).
//
// The markers use our own dictionary of 100 codes (data/markers.json, made by
// dev/print/generate_markers.mjs), registered with js-aruco2 as a custom
// dictionary. The printing uses the same file, so the printed tiles and the
// detector can never disagree.

import { AR, CV } from "./aruco.ts";
import markersData from "../../data/markers.json" with { type: "json" };
import { Quad, type Point } from "./geometry.ts";

export type { Point };

export const DICTIONARY_NAME = "TT_4X4_100";

// Any two codes differ in at least 4 cells, also when rotated (checked by
// tests/markers.test.ts): a code read with one wrong cell is corrected, and
// one with two wrong cells is rejected rather than mistaken for another.
// js-aruco2 accepts a code whose distance is *less* than this.
export const MAX_HAMMING_DISTANCE = 2;

interface ArImage {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

interface ArDetector {
  grey: ArImage;
  thres: ArImage;
  homography: ArImage;
  binary: unknown[];
  contours: unknown[];
  candidates: RawCorner[][];
  dictionary: { markSize: number; find(bits: number[][]): { id: number; distance: number } | null };
  findCandidates(contours: unknown[], minSize: number, epsilon: number, minLength: number): RawCorner[][];
  clockwiseCorners(candidates: RawCorner[][]): RawCorner[][];
  notTooNear(candidates: RawCorner[][], minDistance: number): RawCorner[][];
  rotate(bits: number[][]): number[][];
  rotate2(corners: RawCorner[], rotation: number): RawCorner[];
}

const ar = AR as {
  DICTIONARIES: Record<string, unknown>;
  Detector: new (config: { dictionaryName: string; maxHammingDistance: number }) => ArDetector;
};

const cv = CV as {
  grayscale(image: ArImage, grey: ArImage): void;
  adaptiveThreshold(src: ArImage, dst: ArImage, kernelSize: number, threshold: number): void;
  findContours(image: ArImage, binary: unknown[]): unknown[];
  warp(src: ArImage, dst: ArImage, corners: RawCorner[], size: number): void;
  otsu(image: ArImage): number;
};
ar.DICTIONARIES[DICTIONARY_NAME] = {
  nBits: markersData.bits,
  tau: MAX_HAMMING_DISTANCE,
  codeList: markersData.codes.map((bits) => parseInt(bits, 2)),
};

interface RawCorner {
  x: number;
  y: number;
}

export interface DetectedMarker {
  readonly id: number;
  /** The corners in the picture, clockwise from the marker's top left (as printed). */
  readonly corners: Quad;
  /** How many bits had to be corrected (0 or 1). */
  readonly hammingDistance: number;
}

export interface Frame {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel, as in ImageData. */
  readonly data: ArrayLike<number>;
}

/**
 * The parameters of the detection. js-aruco2 finds the candidate squares
 * (adaptive threshold, contours, polygons); we read the cells ourselves,
 * because at 1.4-2 pixels per millimetre (a webcam at 50-70 cm) a cell is
 * only 4-6 pixels wide, and js-aruco2 rejects a marker as soon as one cell
 * of its black border is not black. Measured with tests/scan-e2e.test.ts.
 */
export const DETECTION = {
  /** The half size of the window of the adaptive threshold, in pixels. */
  thresholdKernel: 4,
  /** How much darker than its surroundings a pixel must be to count as black. */
  thresholdOffset: 5,
  /** The smallest contour, as a share of the width of the picture. */
  minContourShare: 0.01,
  /** The smallest edge of a candidate square, in pixels. */
  minEdge: 10,
  /** The size of the warped square: 6 cells of 10 pixels. */
  warpSize: 60,
  /** Each cell is read from its middle: this share of its width. */
  cellCore: 0.5,
  /** So many cells of the border may be wrong (out of 20). */
  borderTolerance: 2,
  /**
   * The corners of a candidate come from a pixel contour and may be a pixel
   * off. If a candidate cannot be read, it is tried again slightly shrunk,
   * grown and shifted; only an exact code is accepted then.
   */
  retryScales: [0.92, 0.96, 1.04, 1.08],
  retryShift: 0.6,
};

function readCells(image: ArImage, markSize: number, threshold: number): number[][] {
  const cell = image.width / markSize;
  const margin = (cell * (1 - DETECTION.cellCore)) / 2;
  const cells: number[][] = [];
  for (let row = 0; row < markSize; row++) {
    const bits: number[] = [];
    for (let column = 0; column < markSize; column++) {
      const x0 = Math.round(column * cell + margin);
      const x1 = Math.round((column + 1) * cell - margin);
      const y0 = Math.round(row * cell + margin);
      const y1 = Math.round((row + 1) * cell - margin);
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += image.data[y * image.width + x];
          count++;
        }
      }
      bits.push(sum / count > threshold ? 1 : 0);
    }
    cells.push(bits);
  }
  return cells;
}

export class MarkerDetector {
  private readonly detector = new ar.Detector({
    dictionaryName: DICTIONARY_NAME,
    maxHammingDistance: MAX_HAMMING_DISTANCE,
  });

  detect(frame: Frame): DetectedMarker[] {
    const d = this.detector;
    cv.grayscale(frame as ArImage, d.grey);
    cv.adaptiveThreshold(d.grey, d.thres, DETECTION.thresholdKernel, DETECTION.thresholdOffset);
    d.contours = cv.findContours(d.thres, d.binary);
    let candidates = d.findCandidates(d.contours, frame.width * DETECTION.minContourShare, 0.05, DETECTION.minEdge);
    candidates = d.clockwiseCorners(candidates);
    candidates = d.notTooNear(candidates, 10);
    d.candidates = candidates;

    const markers: DetectedMarker[] = [];
    for (const candidate of candidates) {
      const marker = this.decode(candidate);
      if (marker !== null) markers.push(marker);
    }
    return markers;
  }

  private decode(candidate: RawCorner[]): DetectedMarker | null {
    const first = this.decodeQuad(candidate, candidate, MAX_HAMMING_DISTANCE);
    if (first !== null) return first;

    const cx = candidate.reduce((sum, corner) => sum + corner.x, 0) / 4;
    const cy = candidate.reduce((sum, corner) => sum + corner.y, 0) / 4;
    const shift = DETECTION.retryShift;
    const variants: { scale: number; dx: number; dy: number }[] = [];
    for (const scale of [1, ...DETECTION.retryScales]) {
      for (const [dx, dy] of [[0, 0], [shift, 0], [-shift, 0], [0, shift], [0, -shift]]) {
        if (scale !== 1 || dx !== 0 || dy !== 0) variants.push({ scale, dx, dy });
      }
    }

    for (const { scale, dx, dy } of variants) {
      const quad = candidate.map((corner) => ({
        x: cx + (corner.x - cx) * scale + dx,
        y: cy + (corner.y - cy) * scale + dy,
      }));
      const marker = this.decodeQuad(quad, candidate, 1);
      if (marker !== null) return marker;
    }
    return null;
  }

  /** Read the quad; accept a code closer than ``maxDistance``. */
  private decodeQuad(quad: RawCorner[], candidate: RawCorner[], maxDistance: number): DetectedMarker | null {
    const d = this.detector;
    cv.warp(d.grey, d.homography, quad, DETECTION.warpSize);
    const threshold = cv.otsu(d.homography);
    const markSize = d.dictionary.markSize;
    const cells = readCells(d.homography, markSize, threshold);

    let whiteBorder = 0;
    for (let i = 0; i < markSize; i++) {
      for (let j = 0; j < markSize; j++) {
        const border = i === 0 || j === 0 || i === markSize - 1 || j === markSize - 1;
        if (border && cells[i][j] === 1) whiteBorder++;
      }
    }
    if (whiteBorder > DETECTION.borderTolerance) return null;

    let bits = cells.slice(1, markSize - 1).map((row) => row.slice(1, markSize - 1));
    let best: { id: number; distance: number } | null = null;
    let rotation = 0;
    for (let r = 0; r < 4; r++) {
      const found = d.dictionary.find(bits);
      if (found && (best === null || found.distance < best.distance)) {
        best = found;
        rotation = r;
        if (found.distance === 0) break;
      }
      bits = d.rotate(bits);
    }
    if (best === null || best.distance >= maxDistance) return null;

    const corners = d.rotate2(candidate, 4 - rotation);
    return {
      id: best.id,
      corners: new Quad(corners[0], corners[1], corners[2], corners[3]),
      hammingDistance: best.distance,
    };
  }
}
