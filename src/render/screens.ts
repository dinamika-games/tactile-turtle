// The screens around the plate (DESIGN.md, section 6): black while the
// children program, and a spanner with "Scanning" while the plate is read.

import { escapeXml } from "./board.ts";

/** The spanner (wrench), in a 100 x 100 box. */
export function spannerPath(): string {
  return (
    "M68 8 a22 22 0 0 0 -21 29 L10 74 a8 8 0 0 0 0 11 l5 5 a8 8 0 0 0 11 0 L63 53 " +
    "a22 22 0 0 0 29 -21 l-13 13 -12 -3 -3 -12 13 -13 a22 22 0 0 0 -9 -9 Z"
  );
}

export interface ScanningOptions {
  readonly width: number;
  readonly height: number;
  /** From 0 to 1. */
  readonly progress: number;
  readonly label: string;
  /** A hint, e.g. "Come closer" or "Show the right side too". */
  readonly hint?: string;
}

/** The scanning screen as SVG: black, a turning spanner, a ring, the word. */
export function scanningScreen(options: ScanningOptions): string {
  const { width, height, progress } = options;
  const cx = width / 2;
  const cy = height / 2 - 30;
  const r = Math.min(width, height) * 0.2;
  const circumference = 2 * Math.PI * r;
  const spannerSize = r * 1.1;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<rect width="${width}" height="${height}" fill="#000"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#222" stroke-width="10"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffb703" stroke-width="10" stroke-linecap="round" ` +
    `stroke-dasharray="${(circumference * progress).toFixed(1)} ${circumference.toFixed(1)}" ` +
    `transform="rotate(-90 ${cx} ${cy})"/>` +
    `<g transform="translate(${cx - spannerSize / 2} ${cy - spannerSize / 2}) scale(${spannerSize / 100})">` +
    `<path d="${spannerPath()}" fill="#e6e6e6"/></g>` +
    `<text x="${cx}" y="${cy + r + 70}" font-family="Noto Sans, sans-serif" font-size="44" font-weight="700" ` +
    `fill="#fff" text-anchor="middle">${escapeXml(options.label)}</text>` +
    (options.hint
      ? `<text x="${cx}" y="${cy + r + 115}" font-family="Noto Sans, sans-serif" font-size="26" fill="#aaa" text-anchor="middle">${escapeXml(options.hint)}</text>`
      : "") +
    `</svg>`
  );
}

/** The screen while the children program: black. */
export function blackScreen(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#000"/></svg>`;
}
