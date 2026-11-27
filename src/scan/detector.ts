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
   * A border cell is wrong (white) if it is lighter than the threshold plus
   * this share of the way from the threshold to the white cells.
   */
  borderLightness: 0.5,
  /**
   * The corners of a candidate come from a pixel contour and may be a pixel
   * off. If a candidate cannot be read, it is tried again slightly shrunk,
   * grown and shifted; only an exact code is accepted then.
   */
  retryScales: [0.92, 0.96, 1.04, 1.08],
  retryShift: 0.6,
  /** The edges are looked for this far (pixels) to either side of the contour. */
  refineReach: 3,
  /** So many points are looked for along each edge. */
  refinePoints: 10,
  /** A refined corner may move at most this share of the edge (else the candidate is kept). */
  refineMaxShift: 0.15,
};

/** The grey value at a point between pixels (bilinear; pixel centres at whole numbers). */
function sample(image: ArImage, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(image.width - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(image.height - 2, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const i = y0 * image.width + x0;
  const d = image.data;
  return (
    (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) +
    (d[i + image.width] * (1 - fx) + d[i + image.width + 1] * fx) * fy
  );
}

interface Line {
  /** A point on the line. */
  readonly x: number;
  readonly y: number;
  /** Its direction (a unit vector). */
  readonly dx: number;
  readonly dy: number;
}

/** The line through the points that fits them best (least squares, perpendicular to it). */
function fitLine(points: readonly RawCorner[]): Line | null {
  if (points.length < 3) return null;
  const mx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const my = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  const angle = Math.atan2(2 * sxy, sxx - syy) / 2;
  return { x: mx, y: my, dx: Math.cos(angle), dy: Math.sin(angle) };
}

function intersect(a: Line, b: Line): RawCorner | null {
  const denominator = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(denominator) < 1e-6) return null;
  const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / denominator;
  return { x: a.x + t * a.dx, y: a.y + t * a.dy };
}

/**
 * The corners of a candidate are pixels of its contour, on the dark side of
 * the edge: the quad is up to a pixel and a half too small or off, which is
 * half a cell of a small marker. Here each edge is found between the pixels:
 * across it, at several points along it, where the grey value is halfway
 * between the black border inside and the white paper outside; a line is
 * fitted to these points (again without the worst, a speck of noise), and the
 * corners are where the lines cross.
 */
function refineQuad(grey: ArImage, quad: readonly RawCorner[]): RawCorner[] | null {
  const cx = quad.reduce((sum, corner) => sum + corner.x, 0) / 4;
  const cy = quad.reduce((sum, corner) => sum + corner.y, 0) / 4;
  const reach = DETECTION.refineReach;
  const lines: Line[] = [];
  for (let side = 0; side < 4; side++) {
    const a = quad[side];
    const b = quad[(side + 1) % 4];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1) return null;
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    // The normal, pointing outward (away from the centre).
    let nx = -uy;
    let ny = ux;
    if (nx * ((a.x + b.x) / 2 - cx) + ny * ((a.y + b.y) / 2 - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }

    const points: RawCorner[] = [];
    const count = DETECTION.refinePoints;
    for (let k = 0; k < count; k++) {
      // Away from the corners, where the neighbouring edge would be in the way.
      const t = 0.2 + (0.6 * k) / (count - 1);
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      const steps = 4 * 2 * reach;
      const profile: number[] = [];
      for (let s = 0; s <= steps; s++) {
        const offset = -reach + (2 * reach * s) / steps;
        profile.push(sample(grey, px + nx * offset, py + ny * offset));
      }
      const dark = Math.min(...profile);
      const light = Math.max(...profile);
      if (light - dark < 20) continue;
      const half = (dark + light) / 2;
      // The last crossing from dark to light, going outward.
      let found: number | null = null;
      for (let s = 0; s < steps; s++) {
        if (profile[s] < half && profile[s + 1] >= half) {
          const f = (half - profile[s]) / (profile[s + 1] - profile[s]);
          found = -reach + (2 * reach * (s + f)) / steps;
        }
      }
      if (found !== null) points.push({ x: px + nx * found, y: py + ny * found });
    }

    let line = fitLine(points);
    if (line === null) return null;
    const fitted = line;
    const distance = (p: RawCorner) => Math.abs((p.x - fitted.x) * fitted.dy - (p.y - fitted.y) * fitted.dx);
    const kept = [...points].sort((p, q) => distance(p) - distance(q)).slice(0, Math.ceil(points.length * 0.7));
    line = fitLine(kept);
    if (line === null) return null;
    lines.push(line);
  }

  const refined: RawCorner[] = [];
  for (let corner = 0; corner < 4; corner++) {
    // Corner i is where the edge before it (i - 1 to i) meets the edge after it (i to i + 1).
    const point = intersect(lines[(corner + 3) % 4], lines[corner]);
    if (point === null) return null;
    const edge = Math.hypot(quad[(corner + 1) % 4].x - quad[corner].x, quad[(corner + 1) % 4].y - quad[corner].y);
    const shift = Math.hypot(point.x - quad[corner].x, point.y - quad[corner].y);
    if (shift > DETECTION.refineMaxShift * edge + 0.5) return null;
    refined.push(point);
  }
  return refined;
}

/** The mean grey value of the middle of every cell. */
function readCells(image: ArImage, markSize: number): number[][] {
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
      bits.push(sum / count);
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

  private decode(contour: RawCorner[]): DetectedMarker | null {
    const refined = refineQuad(this.detector.grey, contour);
    if (refined !== null) {
      const marker = this.decodeQuad(refined, refined, MAX_HAMMING_DISTANCE);
      if (marker !== null) return marker;
    }
    // The refined quad may be wrong (a corner hidden, a shadow along an edge):
    // try the contour itself, and around it.
    const candidate = contour;
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
    const means = readCells(d.homography, markSize);
    const inner = means.slice(1, markSize - 1).map((row) => row.slice(1, markSize - 1));

    // A small marker out of focus bleeds into the white paper around it, so
    // its border is grey: a border cell counts as white only if it is closer
    // to the white cells of the marker than to the threshold.
    const whites = inner.flat().filter((mean) => mean > threshold);
    const white = whites.length > 0 ? whites.reduce((sum, mean) => sum + mean, 0) / whites.length : 255;
    const borderThreshold = threshold + DETECTION.borderLightness * (white - threshold);
    let whiteBorder = 0;
    for (let i = 0; i < markSize; i++) {
      for (let j = 0; j < markSize; j++) {
        const border = i === 0 || j === 0 || i === markSize - 1 || j === markSize - 1;
        if (border && means[i][j] > borderThreshold) whiteBorder++;
      }
    }
    if (whiteBorder > DETECTION.borderTolerance) return null;

    let bits: number[][] = inner.map((row) => row.map((mean) => (mean > threshold ? 1 : 0)));
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
