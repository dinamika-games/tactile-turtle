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
  /** The URL of the spanner sprite (else the vector spanner is drawn). */
  readonly spanner?: string;
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
    (options.spanner !== undefined
      ? `<image href="${options.spanner}" x="${cx - spannerSize / 2}" y="${cy - spannerSize / 2}" width="${spannerSize}" height="${spannerSize}"/>`
      : `<g transform="translate(${cx - spannerSize / 2} ${cy - spannerSize / 2}) scale(${spannerSize / 100})">` +
        `<path d="${spannerPath()}" fill="#e6e6e6"/></g>`) +
    `<text x="${cx}" y="${cy + r + 70}" font-family="Noto Sans, sans-serif" font-size="44" font-weight="700" ` +
    `fill="#fff" text-anchor="middle">${escapeXml(options.label)}</text>` +
    (options.hint
      ? `<text x="${cx}" y="${cy + r + 115}" font-family="Noto Sans, sans-serif" font-size="26" fill="#aaa" text-anchor="middle">${escapeXml(options.hint)}</text>`
      : "") +
    `</svg>`
  );
}

/**
 * The level with the scanning ring over it, as one picture: while the plate
 * is read, the children still see the level (dimmed), with the spanner, the
 * ring and the word in the middle, the ring scaled to fit the board.
 */
export function scanningOverlay(board: string, options: Omit<ScanningOptions, "width" | "height">): string {
  const [boardWidth, boardHeight] = (/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(board) ?? ["", "640", "400"]).slice(1).map(Number);
  const ring = scanningScreen({ ...options, width: 560, height: 400 }).replace(
    '<rect width="560" height="400" fill="#000"/>',
    '<rect width="560" height="400" rx="28" fill="#000" fill-opacity="0.78"/>',
  );
  const scale = Math.min(0.7, (0.92 * boardHeight) / 400, (0.92 * boardWidth) / 560);
  const x = (boardWidth - 560 * scale) / 2;
  const y = (boardHeight - 400 * scale) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${boardWidth} ${boardHeight}" width="${boardWidth}" height="${boardHeight}">` +
    board.replace("<svg ", '<svg x="0" y="0" ') +
    `<rect width="${boardWidth}" height="${boardHeight}" fill="#000" fill-opacity="0.35"/>` +
    ring.replace("<svg ", `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" `).replace(/ width="560" height="400"/, ` width="${(560 * scale).toFixed(1)}" height="${(400 * scale).toFixed(1)}"`) +
    `</svg>`
  );
}

/** A black screen (between scenes). */
export function blackScreen(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#000"/></svg>`;
}
