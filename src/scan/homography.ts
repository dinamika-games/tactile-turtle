// A homography (projective transformation) between two planes: here between
// the camera picture and the plate in millimetres.

import type { Point } from "./geometry.ts";

export type Homography = readonly number[]; // 3 x 3, row by row

export function apply(h: Homography, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

/** Translate and scale points so that they are centred, with mean distance √2. */
function normalizer(points: readonly Point[]): Homography {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const spread = points.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.y - cy), 0) / points.length || 1;
  const s = Math.SQRT2 / spread;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

function multiply(a: Homography, b: Homography): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

function invertSimilarity(n: Homography): Homography {
  const s = n[0];
  return [1 / s, 0, -n[2] / s, 0, 1 / s, -n[5] / s, 0, 0, 1];
}

/** Solve the linear system m x = v in place (Gaussian elimination with pivoting). */
function solve(m: number[][], v: number[]): number[] | null {
  const n = v.length;
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(m[row][column]) > Math.abs(m[pivot][column])) pivot = row;
    }
    if (Math.abs(m[pivot][column]) < 1e-12) return null;
    [m[column], m[pivot]] = [m[pivot], m[column]];
    [v[column], v[pivot]] = [v[pivot], v[column]];
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = m[row][column] / m[column][column];
      for (let k = column; k < n; k++) m[row][k] -= factor * m[column][k];
      v[row] -= factor * v[column];
    }
  }
  return v.map((value, i) => value / m[i][i]);
}

/**
 * The homography H with H(from[i]) ≈ to[i], by least squares over four or
 * more point pairs (exact for four). The points are normalized first, so that
 * millimetres and pixels do not spoil the precision.
 */
export function fitHomography(from: readonly Point[], to: readonly Point[]): Homography | null {
  if (from.length !== to.length || from.length < 4) return null;
  const nf = normalizer(from);
  const nt = normalizer(to);
  const a = from.map((p) => apply(nf, p));
  const b = to.map((p) => apply(nt, p));

  // Normal equations for h0..h7 (h8 = 1).
  const ata = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const atb = new Array(8).fill(0);
  for (let i = 0; i < a.length; i++) {
    const { x, y } = a[i];
    const { x: u, y: v } = b[i];
    for (const [row, rhs] of [
      [[x, y, 1, 0, 0, 0, -u * x, -u * y], u],
      [[0, 0, 0, x, y, 1, -v * x, -v * y], v],
    ] as [number[], number][]) {
      for (let j = 0; j < 8; j++) {
        atb[j] += row[j] * rhs;
        for (let k = 0; k < 8; k++) ata[j][k] += row[j] * row[k];
      }
    }
  }
  const h = solve(ata, atb);
  if (h === null) return null;
  const result = multiply(invertSimilarity(nt), multiply([...h, 1], nf));
  return result.map((value) => value / result[8]);
}

export function invert(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, i, j] = h;
  const det = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  if (Math.abs(det) < 1e-15) return null;
  return [
    (e * j - f * i) / det, (c * i - b * j) / det, (b * f - c * e) / det,
    (f * g - d * j) / det, (a * j - c * g) / det, (c * d - a * f) / det,
    (d * i - e * g) / det, (b * g - a * i) / det, (a * e - b * d) / det,
  ];
}
