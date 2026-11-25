// A picture of a plate with its tiles, as the children would hold it up: the
// steel plate, the sticker with the row lines and the anchors, and the tiles
// with their markers and (English) words. Used by the demo, which plays
// imaginary plates without a camera.

import en from "../../i18n/en.json" with { type: "json" };
import markersData from "../../data/markers.json" with { type: "json" };
import tilesData from "../../data/tiles.json" with { type: "json" };
import { kindById } from "../lang/catalogue.ts";
import { anchorsOf, slotTopLeft, type PlateSpec } from "../scan/plate.ts";
import { escapeXml } from "./board.ts";

const GROUP_COLOURS: Record<string, string> = Object.fromEntries(
  Object.entries(tilesData.groups).map(([group, data]) => [group, data.colour]),
);
const FILLS = new Map(tilesData.tiles.filter((tile) => "fill" in tile).map((tile) => [tile.id, (tile as { fill: string }).fill]));

/** A marker as SVG squares, its top left at (x, y), ``size`` wide (mm). */
function marker(id: number, x: number, y: number, size: number): string {
  const side = markersData.side;
  const cell = size / (side + 2);
  const code = markersData.codes[id];
  const white: string[] = [];
  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) {
      if (code[row * side + column] === "1") {
        white.push(`<rect x="${(x + (column + 1) * cell).toFixed(2)}" y="${(y + (row + 1) * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`);
      }
    }
  }
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#111"/><g fill="#fff">${white.join("")}</g>`;
}

function isDark(colour: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 150;
}

function label(id: number): string {
  const kind = kindById(id)!;
  if (kind.symbol !== undefined) return kind.symbol;
  return (en.texts as Record<string, string>)[`tile.${kind.key}`] ?? kind.key;
}

function tile(id: number, x: number, y: number): string {
  const g = tilesData.geometry_mm;
  const kind = kindById(id)!;
  const fill = FILLS.get(id);
  const words = label(id);
  const fontSize = Math.min(4, 21 / Math.max(1, words.length * 0.62));
  return (
    `<g transform="translate(${x} ${y})">` +
    `<rect width="${g.tile_width}" height="${g.tile_height}" rx="0.6" fill="#fff" stroke="#bbb" stroke-width="0.2"/>` +
    (fill !== undefined
      ? `<rect y="${g.label_top}" width="${g.tile_width}" height="${g.tile_height - g.label_top}" fill="${fill}"/>`
      : `<rect y="${g.tile_height - g.band_height}" width="${g.tile_width}" height="${g.band_height}" fill="${GROUP_COLOURS[kind.group]}"/>`) +
    marker(id, g.marker_x, g.marker_y, g.marker_size) +
    `<text x="${g.tile_width / 2}" y="${(g.label_top + g.label_bottom) / 2 + fontSize * 0.36}" font-family="Noto Sans, DejaVu Sans, sans-serif" ` +
    `font-weight="700" font-size="${fontSize.toFixed(2)}" text-anchor="middle" fill="${fill !== undefined && isDark(fill) ? "#fff" : "#111"}">${escapeXml(words)}</text>` +
    `</g>`
  );
}

/** The plate with the rows of tile ids on it, as SVG (``width`` pixels wide). */
export function renderPlate(plate: PlateSpec, rows: readonly (readonly number[])[], width = 640): string {
  const rim = 6;
  const w = plate.width + 2 * rim;
  const h = plate.height + 2 * rim;
  const parts: string[] = [
    `<rect width="${w}" height="${h}" rx="4" fill="#9aa1a8"/>`,
    `<g transform="translate(${rim} ${rim})">`,
    `<rect width="${plate.width}" height="${plate.height}" fill="#f7f7f2"/>`,
  ];
  const right = plate.rows_left + plate.columns * tilesData.geometry_mm.tile_width;
  for (let row = 0; row <= plate.rows; row++) {
    const y = plate.rows_top + row * plate.row_pitch;
    parts.push(`<line x1="${plate.rows_left}" y1="${y}" x2="${right}" y2="${y}" stroke="#c8c8c8" stroke-width="0.3"/>`);
  }
  for (const anchor of anchorsOf(plate)) parts.push(marker(anchor.id, anchor.x, anchor.y, plate.anchor_size));
  rows.forEach((row, r) =>
    row.forEach((id, c) => {
      const at = slotTopLeft(plate, r, c);
      parts.push(tile(id, at.x, at.y));
    }),
  );
  parts.push("</g>");
  const height = Math.round((width * h) / w);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${width}" height="${height}">${parts.join("")}</svg>`;
}
