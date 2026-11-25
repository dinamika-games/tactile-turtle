// A virtual webcam for the end-to-end tests: it renders a plate with tiles,
// held up by a child, as a 720p webcam would see it.
//
// The model, step by step:
//
// * the plate: the printed sticker on a steel sheet, with the corner markers
//   and the row lines; the tiles are placed by hand, so each is shifted and
//   turned a little; the labels are stand-ins (blocky "glyphs"), so that the
//   detector also has to ignore clutter; two hands hold the plate at its sides;
// * the pose: the plate 50-70 cm in front of the camera, turned around all
//   three axes (perspective);
// * the camera: a pinhole camera with a 65° horizontal field of view (typical
//   for laptop webcams), barrel distortion, 2 x 2 samples per pixel;
// * the light: uneven (a gradient across the plate), a soft glare spot,
//   vignetting and a warm tint;
// * the picture: defocus (Gaussian blur), a little motion blur, sensor noise,
//   salt-and-pepper noise, and finally JPEG compression (many webcams send
//   MJPEG).

import jpeg from "jpeg-js";

import markersData from "../data/markers.json" with { type: "json" };
import tilesData from "../data/tiles.json" with { type: "json" };
import { kindById } from "../src/lang/catalogue.ts";
import type { Frame } from "../src/scan/detector.ts";
import { anchorsOf, slotTopLeft, type Anchor, type PlateSpec } from "../src/scan/plate.ts";

// region Random numbers

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function hash(...values: number[]): number {
  let h = 2166136261;
  for (const value of values) {
    h ^= value | 0;
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// endregion

// region The scene

type Rgb = [number, number, number];

export interface PlacedTileSpec {
  readonly id: number;
  /** The centre of the tile on the plate, in millimetres. */
  readonly cx: number;
  readonly cy: number;
  /** The rotation of the tile in radians. */
  readonly angle: number;
}

export interface Scene {
  readonly plate: PlateSpec;
  readonly tiles: readonly PlacedTileSpec[];
}

/** Place the rows of tile ids on the plate, each tile a little off, as by hand. */
export function placeByHand(plate: PlateSpec, rows: readonly (readonly number[])[], seed: number): Scene {
  const random = mulberry32(seed);
  const geometry = tilesData.geometry_mm;
  const tiles: PlacedTileSpec[] = [];
  rows.forEach((row, rowIndex) =>
    row.forEach((id, column) => {
      const topLeft = slotTopLeft(plate, rowIndex, column);
      tiles.push({
        id,
        cx: topLeft.x + geometry.tile_width / 2 + (random() - 0.5) * 2.4,
        cy: topLeft.y + geometry.tile_height / 2 + (random() - 0.5) * 2.4,
        angle: ((random() - 0.5) * 5 * Math.PI) / 180,
      });
    }),
  );
  return { plate, tiles };
}

const PAPER = 0.82;
const INK = 0.05;
const STEEL = 0.38;
const STEEL_RIM = 4; // mm of steel around the sticker

const PAPER_RGB: Rgb = [PAPER, PAPER, PAPER];
const INK_RGB: Rgb = [INK, INK, INK];
const STEEL_RGB: Rgb = [STEEL, STEEL, STEEL * 1.04];
const EDGE_RGB: Rgb = [0.45, 0.45, 0.45];
const LINE_RGB: Rgb = [0.55, 0.55, 0.55];
const SKIN_RGB: Rgb = [0.62, 0.42, 0.33];

function hexToRgb(hex: string): Rgb {
  const value = (offset: number) => (parseInt(hex.slice(offset, offset + 2), 16) / 255) ** 2.2;
  return [value(1), value(3), value(5)];
}

const GROUP_COLOURS = new Map(
  Object.entries(tilesData.groups).map(([group, data]) => [group, hexToRgb(data.colour)]),
);
const FILLS = new Map(
  tilesData.tiles.filter((tile) => "fill" in tile).map((tile) => [tile.id, hexToRgb((tile as { fill: string }).fill)]),
);
const LABEL_LENGTHS = new Map(
  tilesData.tiles.map((tile) => [tile.id, "symbol" in tile ? 1 : Math.min(9, Math.max(2, tile.key.length))]),
);

function markerCell(code: string, side: number, cellX: number, cellY: number): boolean {
  // true = black. Border cells are black; inner bits "1" are white.
  if (cellX <= 0 || cellY <= 0 || cellX >= side + 1 || cellY >= side + 1) return true;
  return code[(cellY - 1) * side + (cellX - 1)] !== "1";
}

function markerAt(id: number, size: number, lx: number, ly: number): number | null {
  if (lx < 0 || ly < 0 || lx >= size || ly >= size) return null;
  const side = markersData.side;
  const cell = size / (side + 2);
  const black = markerCell(markersData.codes[id], side, Math.floor(lx / cell), Math.floor(ly / cell));
  return black ? INK : PAPER;
}

function tileColour(tile: PlacedTileSpec, lx: number, ly: number): Rgb {
  const g = tilesData.geometry_mm;
  const w = g.tile_width;
  const h = g.tile_height;

  // The cut edge: a thin shadow.
  if (lx < 0.25 || ly < 0.25 || lx > w - 0.25 || ly > h - 0.25) return EDGE_RGB;

  const fill = FILLS.get(tile.id);
  if (fill !== undefined && ly >= g.label_top) {
    // A colour tile: the coloured strip reaches down to the edge.
    if (ly > h - g.band_height) return fill;
  } else if (ly > h - g.band_height) {
    return GROUP_COLOURS.get(kindById(tile.id)!.group)!;
  }

  const marker = markerAt(tile.id, g.marker_size, lx - g.marker_x, ly - g.marker_y);
  if (marker !== null) return marker === INK ? INK_RGB : PAPER_RGB;

  if (ly >= g.label_top && ly <= g.label_bottom) {
    const fill = FILLS.get(tile.id);
    const background: Rgb = fill ?? PAPER_RGB;
    const ink: Rgb = fill !== undefined ? PAPER_RGB : INK_RGB;
    // Stand-in glyphs: the label is centred and has as many glyphs as letters.
    const glyphs = LABEL_LENGTHS.get(tile.id)!;
    const glyphWidth = Math.min(3.4, 20 / glyphs);
    const start = (w - glyphs * glyphWidth) / 2;
    const index = Math.floor((lx - start) / glyphWidth);
    if (index >= 0 && index < glyphs) {
      const gx = (lx - start) / glyphWidth - index;
      const gy = (ly - g.label_top) / (g.label_bottom - g.label_top);
      if (gx > 0.12 && gx < 0.88 && gy > 0.12 && gy < 0.88) {
        const on = hash(tile.id, index, Math.floor(gx * 3), Math.floor(gy * 4)) < 0.5;
        if (on) return ink;
      }
    }
    return background;
  }
  return PAPER_RGB;
}

/** The colour (linear reflectance) of the plate at (u, v) mm, or null beside it. */
const ANCHORS = new Map<PlateSpec, Anchor[]>();

function anchorsCached(plate: PlateSpec): Anchor[] {
  let anchors = ANCHORS.get(plate);
  if (anchors === undefined) {
    anchors = anchorsOf(plate);
    ANCHORS.set(plate, anchors);
  }
  return anchors;
}

interface BucketTile extends PlacedTileSpec {
  readonly cos: number;
  readonly sin: number;
}

function plateColour(scene: Scene, buckets: Map<number, BucketTile[]>, u: number, v: number): Rgb | null {
  const plate = scene.plate;
  if (u < -STEEL_RIM || v < -STEEL_RIM || u > plate.width + STEEL_RIM || v > plate.height + STEEL_RIM) {
    return null;
  }

  // The hands hold the plate in the middle of its left and right edges.
  const handY = (v - plate.height / 2) / 30;
  const leftX = (u + 6) / 22;
  const rightX = (u - plate.width - 6) / 22;
  if (leftX * leftX + handY * handY < 1 || rightX * rightX + handY * handY < 1) return SKIN_RGB;

  if (u < 0 || v < 0 || u > plate.width || v > plate.height) return STEEL_RGB;

  // The tiles, found through a coarse grid of buckets.
  const key = Math.floor(u / 25) * 1000 + Math.floor(v / 25);
  const g = tilesData.geometry_mm;
  for (const tile of buckets.get(key) ?? []) {
    const cos = tile.cos;
    const sin = tile.sin;
    const du = u - tile.cx;
    const dv = v - tile.cy;
    const lx = du * cos - dv * sin + g.tile_width / 2;
    const ly = du * sin + dv * cos + g.tile_height / 2;
    if (lx >= 0 && ly >= 0 && lx <= g.tile_width && ly <= g.tile_height) {
      return tileColour(tile, lx, ly);
    }
  }

  // The anchors at the ends of the rows.
  const size = plate.anchor_size;
  for (const { id, x: x0, y: y0 } of anchorsCached(plate)) {
    const marker = markerAt(id, size, u - x0, v - y0);
    if (marker !== null) return marker === INK ? INK_RGB : PAPER_RGB;
  }

  // The row lines.
  const right = plate.rows_left + plate.columns * g.tile_width;
  if (u >= plate.rows_left - 2 && u <= right + 2) {
    for (let row = 0; row <= plate.rows; row++) {
      if (Math.abs(v - (plate.rows_top + row * plate.row_pitch)) < 0.2) return LINE_RGB;
    }
  }
  return PAPER_RGB;
}

function bucketTiles(scene: Scene): Map<number, BucketTile[]> {
  const buckets = new Map<number, BucketTile[]>();
  const reach = 19; // more than half the diagonal of a tile
  for (const spec of scene.tiles) {
    const tile: BucketTile = { ...spec, cos: Math.cos(-spec.angle), sin: Math.sin(-spec.angle) };
    for (let bx = Math.floor((tile.cx - reach) / 25); bx <= Math.floor((tile.cx + reach) / 25); bx++) {
      for (let by = Math.floor((tile.cy - reach) / 25); by <= Math.floor((tile.cy + reach) / 25); by++) {
        const key = bx * 1000 + by;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(tile);
      }
    }
  }
  return buckets;
}

/** A room behind the plate: a wall with shelves and posters (some dark and checkered). */
function makeBackground(width: number, height: number, seed: number): (px: number, py: number) => Rgb {
  const random = mulberry32(seed);
  const rects = Array.from({ length: 14 }, () => ({
    x0: random() * width,
    y0: random() * height,
    w: 40 + random() * 220,
    h: 30 + random() * 160,
    colour: [0.1 + 0.7 * random(), 0, 0] as Rgb,
    checkered: random() < 0.3,
  }));
  for (const rect of rects) {
    const shade = rect.colour[0];
    rect.colour = [shade, 0.1 + 0.85 * (shade - 0.1), 0.1 + 0.5 * random()];
  }
  return (px, py) => {
    let colour: Rgb = [0.35 + 0.1 * (py / height), 0.33 + 0.1 * (py / height), 0.3];
    for (const rect of rects) {
      if (px >= rect.x0 && px < rect.x0 + rect.w && py >= rect.y0 && py < rect.y0 + rect.h) {
        const dark = (Math.floor((px - rect.x0) / 12) + Math.floor((py - rect.y0) / 12)) % 2 === 0;
        colour = rect.checkered && dark ? [0.04, 0.04, 0.05] : rect.colour;
      }
    }
    return colour;
  };
}

// endregion

// region The camera

export interface Pose {
  /** The distance from the camera to the centre of the plate, in millimetres. */
  readonly distance: number;
  /** Rotations in degrees: roll (in the picture), yaw (left/right), pitch (up/down). */
  readonly roll: number;
  readonly yaw: number;
  readonly pitch: number;
  /** Where the centre of the plate is, off the optical axis, in millimetres. */
  readonly offsetX?: number;
  readonly offsetY?: number;
}

export interface CameraSettings {
  readonly width: number;
  readonly height: number;
  readonly horizontalFovDegrees: number;
  /** Barrel distortion (k1 < 0). */
  readonly k1: number;
  /** The blur of the optics when in focus: the sigma of a Gaussian, in pixels. */
  readonly blurSigma: number;
  /**
   * The fixed-focus lens: its focal length and f-number, where it is focused,
   * and the width of the sensor. Nearer or farther than the focus, the picture
   * gets blurrier (see ``defocusSigma``).
   */
  readonly lensFocalMm: number;
  readonly fNumber: number;
  readonly focusMm: number;
  readonly sensorWidthMm: number;
  /** The length of the motion blur, in pixels. */
  readonly motionBlur: number;
  /** The sigma of the sensor noise, in 8-bit steps. */
  readonly noiseSigma: number;
  /** The share of pixels which are stuck white or black. */
  readonly saltAndPepper: number;
  readonly jpegQuality: number;
}

export const WEBCAM_720P: CameraSettings = {
  width: 1280,
  height: 720,
  horizontalFovDegrees: 65,
  k1: -0.06,
  blurSigma: 0.8,
  // A typical laptop webcam (e.g. the Chicony "Integrated Camera" 04f2:b531,
  // which gives 1280 x 720 in MJPEG at 30 frames per second): we don't know
  // its exact lens, so these are typical values, not measured ones.
  lensFocalMm: 2.5,
  fNumber: 2.2,
  focusMm: 600,
  sensorWidthMm: 3.6,
  motionBlur: 1.5,
  noiseSigma: 4,
  saltAndPepper: 0.004,
  jpegQuality: 75,
};

type Matrix = [number, number, number, number, number, number, number, number, number];

function multiply(a: Matrix, b: Matrix): Matrix {
  const r = new Array(9).fill(0) as Matrix;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

function rotation(pose: Pose): Matrix {
  const rad = Math.PI / 180;
  const [r, y, p] = [pose.roll * rad, pose.yaw * rad, pose.pitch * rad];
  const rz: Matrix = [Math.cos(r), -Math.sin(r), 0, Math.sin(r), Math.cos(r), 0, 0, 0, 1];
  const ry: Matrix = [Math.cos(y), 0, Math.sin(y), 0, 1, 0, -Math.sin(y), 0, Math.cos(y)];
  const rx: Matrix = [1, 0, 0, 0, Math.cos(p), -Math.sin(p), 0, Math.sin(p), Math.cos(p)];
  return multiply(rz, multiply(ry, rx));
}

export function focalLength(camera: CameraSettings): number {
  return camera.width / 2 / Math.tan((camera.horizontalFovDegrees * Math.PI) / 360);
}

/** Project a point of the plate (mm) into the picture (pixels), with distortion. */
export function project(scene: Scene, pose: Pose, camera: CameraSettings, u: number, v: number) {
  const R = rotation(pose);
  const lx = u - scene.plate.width / 2;
  const ly = v - scene.plate.height / 2;
  const x = R[0] * lx + R[1] * ly + (pose.offsetX ?? 0);
  const y = R[3] * lx + R[4] * ly + (pose.offsetY ?? 0);
  const z = R[6] * lx + R[7] * ly + pose.distance;
  const xu = x / z;
  const yu = y / z;
  const r2 = xu * xu + yu * yu;
  const f = focalLength(camera);
  return {
    x: camera.width / 2 + f * xu * (1 + camera.k1 * r2),
    y: camera.height / 2 + f * yu * (1 + camera.k1 * r2),
  };
}

/**
 * The defocus at a distance, as the sigma of a Gaussian in pixels: the thin
 * lens gives a blur disk of diameter f² / N · |1/focus − 1/distance| on the
 * sensor; a disk of diameter b blurs about like a Gaussian with sigma b / 2.5.
 */
export function defocusSigma(distanceMm: number, camera: CameraSettings): number {
  const f = camera.lensFocalMm;
  const diskMm = ((f * f) / camera.fNumber) * Math.abs(1 / camera.focusMm - 1 / distanceMm);
  const pixelMm = camera.sensorWidthMm / camera.width;
  return diskMm / pixelMm / 2.5;
}

/** The resolution on the plate at its centre, in pixels per millimetre. */
export function pixelsPerMm(pose: Pose, camera: CameraSettings): number {
  return focalLength(camera) / pose.distance;
}

export function render(scene: Scene, pose: Pose, camera: CameraSettings, seed: number): Frame {
  const { width, height } = camera;
  const f = focalLength(camera);
  const R = rotation(pose);
  const T = [pose.offsetX ?? 0, pose.offsetY ?? 0, pose.distance];
  const n = [R[2], R[5], R[8]];
  const nT = n[0] * T[0] + n[1] * T[1] + n[2] * T[2];
  const buckets = bucketTiles(scene);
  const random = mulberry32(seed);

  // The light on the plate: a gradient, and a glare spot in the picture.
  const gradientU = (random() - 0.5) * 0.5;
  const gradientV = (random() - 0.5) * 0.5;
  const glareX = width * (0.25 + 0.5 * random());
  const glareY = height * (0.25 + 0.5 * random());
  const glareRadius = 60 + 60 * random();
  const tint: Rgb = [1.0, 0.95, 0.86];
  const background = makeBackground(width, height, Math.floor(random() * 1e9));

  const planes = [new Float32Array(width * height), new Float32Array(width * height), new Float32Array(width * height)];
  const samples = [0.25, 0.75];

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let wall: Rgb | null = null;
      for (const sy of samples) {
        for (const sx of samples) {
          // The ray through this point of the sensor, undistorted.
          const xd = (px + sx - width / 2) / f;
          const yd = (py + sy - height / 2) / f;
          const factor = 1 / (1 + camera.k1 * (xd * xd + yd * yd));
          const rx = xd * factor;
          const ry = yd * factor;
          const nr = n[0] * rx + n[1] * ry + n[2];
          let colour: Rgb | null = null;
          let light = 1;
          if (Math.abs(nr) > 1e-9) {
            const s = nT / nr;
            const d0 = s * rx - T[0];
            const d1 = s * ry - T[1];
            const d2 = s - T[2];
            const u = R[0] * d0 + R[3] * d1 + R[6] * d2 + scene.plate.width / 2;
            const v = R[1] * d0 + R[4] * d1 + R[7] * d2 + scene.plate.height / 2;
            colour = plateColour(scene, buckets, u, v);
            light = 1 + gradientU * (u / scene.plate.width - 0.5) * 2 + gradientV * (v / scene.plate.height - 0.5) * 2;
          }
          if (colour === null) {
            wall ??= background(px + 0.5, py + 0.5);
            colour = wall;
            light = 0.8;
          }
          r += colour[0] * light;
          g += colour[1] * light;
          b += colour[2] * light;
        }
      }
      const i = py * width + px;
      const cx = (px - width / 2) / (width / 2);
      const cy = (py - height / 2) / (width / 2);
      const vignette = 1 - 0.35 * (cx * cx + cy * cy);
      const glareDistance = ((px - glareX) ** 2 + (py - glareY) ** 2) / (glareRadius * glareRadius);
      const glare = 0.35 * Math.exp(-glareDistance);
      planes[0][i] = (r / 4) * vignette * tint[0] + glare;
      planes[1][i] = (g / 4) * vignette * tint[1] + glare;
      planes[2][i] = (b / 4) * vignette * tint[2] + glare;
    }
  }

  const sigma = Math.hypot(camera.blurSigma, defocusSigma(pose.distance, camera));
  for (const plane of planes) {
    gaussianBlur(plane, width, height, sigma);
  }
  const angle = random() * Math.PI;
  const motioned = planes.map((plane) => motionBlur(plane, width, height, camera.motionBlur, angle));

  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) {
      const linear = Math.max(0, motioned[c][i]);
      data[i * 4 + c] = 255 * Math.min(1, linear) ** (1 / 2.2) + gaussian(random) * camera.noiseSigma;
    }
    data[i * 4 + 3] = 255;
    if (random() < camera.saltAndPepper) {
      const value = random() < 0.5 ? 0 : 255;
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value;
    }
  }

  // MJPEG: compress and decompress.
  const encoded = jpeg.encode({ data, width, height }, camera.jpegQuality);
  const decoded = jpeg.decode(encoded.data, { useTArray: true, formatAsRGBA: true });
  return { width, height, data: decoded.data };
}

function gaussianBlur(plane: Float32Array, width: number, height: number, sigma: number): void {
  if (sigma <= 0) return;
  const radius = Math.ceil(3 * sigma);
  const kernel: number[] = [];
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const value = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel.push(value);
    sum += value;
  }
  const weights = kernel.map((value) => value / sum);
  const temp = new Float32Array(plane.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        acc += plane[y * width + xx] * weights[k + radius];
      }
      temp[y * width + x] = acc;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        acc += temp[yy * width + x] * weights[k + radius];
      }
      plane[y * width + x] = acc;
    }
  }
}

function motionBlur(plane: Float32Array, width: number, height: number, length: number, angle: number): Float32Array {
  if (length <= 0) return plane;
  const steps = Math.max(2, Math.ceil(length * 2));
  const out = new Float32Array(plane.length);
  const dx = Math.cos(angle) * length;
  const dy = Math.sin(angle) * length;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let s = 0; s < steps; s++) {
        const t = s / (steps - 1) - 0.5;
        const xx = Math.min(width - 1, Math.max(0, Math.round(x + dx * t)));
        const yy = Math.min(height - 1, Math.max(0, Math.round(y + dy * t)));
        acc += plane[yy * width + xx];
      }
      out[y * width + x] = acc / steps;
    }
  }
  return out;
}

// endregion

// region Pictures for the README

export function toJpeg(frame: Frame, quality = 88): Uint8Array {
  return jpeg.encode({ data: frame.data as Uint8ClampedArray, width: frame.width, height: frame.height }, quality).data;
}

/** Draw a line into an RGBA frame (for annotating detections). */
export function drawLine(
  frame: { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: Rgb,
  thickness = 2,
): void {
  const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
  for (let s = 0; s <= steps; s++) {
    const x = x0 + ((x1 - x0) * s) / steps;
    const y = y0 + ((y1 - y0) * s) / steps;
    for (let oy = -thickness / 2; oy < thickness / 2; oy++) {
      for (let ox = -thickness / 2; ox < thickness / 2; ox++) {
        const px = Math.round(x + ox);
        const py = Math.round(y + oy);
        if (px < 0 || py < 0 || px >= frame.width || py >= frame.height) continue;
        const i = (py * frame.width + px) * 4;
        frame.data[i] = colour[0];
        frame.data[i + 1] = colour[1];
        frame.data[i + 2] = colour[2];
      }
    }
  }
}

// endregion

// region Holding a plate up

/** The same camera as WEBCAM_720P, in its 640 x 480 mode (what a browser gets by default). */
export const WEBCAM_VGA: CameraSettings = { ...WEBCAM_720P, width: 640, height: 480 };

/** The pose of one frame of a hold: the hands tremble a little. */
export function trembling(pose: Pose, random: () => number): Pose {
  const jitter = (amount: number) => (random() - 0.5) * 2 * amount;
  return {
    distance: pose.distance + jitter(5),
    roll: pose.roll + jitter(0.7),
    yaw: pose.yaw + jitter(1),
    pitch: pose.pitch + jitter(1),
    offsetX: (pose.offsetX ?? 0) + jitter(3),
    offsetY: (pose.offsetY ?? 0) + jitter(3),
  };
}

/** Is the whole plate inside the picture (with a margin of pixels)? */
export function plateInView(scene: Scene, pose: Pose, camera: CameraSettings, margin = 5): boolean {
  const { width, height } = scene.plate;
  return [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].every(([u, v]) => {
    const p = project(scene, pose, camera, u, v);
    return p.x > margin && p.y > margin && p.x < camera.width - margin && p.y < camera.height - margin;
  });
}

// endregion
