// Lay out a program in the text form on the rows of a plate.
//
// Rows mean nothing to the parser, so a program may run on from one row to
// the next, like the lines of a book. Only a number has to stay in one row
// (its digits must touch to be read as one number).

import { textToRows } from "./tokens.ts";

/**
 * Lay out the program: each line of the text starts a new row, and a line
 * which is too long wraps. With ``dense``, the line breaks of the text are
 * ignored and the rows are filled up. Returns null if it does not fit.
 */
export function layoutProgram(
  text: string,
  columns: number,
  rows: number,
  dense = false,
): number[][] | null {
  // Each "word" is a group of tiles that must stay together (a number).
  const lines: number[][][] = [];
  for (const line of text.split("\n")) {
    const words = line.trim().split(/\s+/).filter((word) => word !== "");
    if (words.length === 0) continue;
    lines.push(words.map((word) => textToRows(word)[0]));
  }
  const units = dense ? [lines.flat()] : lines;

  const result: number[][] = [];
  for (const line of units) {
    let row: number[] = [];
    for (const word of line) {
      if (word.length > columns) return null;
      if (row.length + word.length > columns) {
        result.push(row);
        row = [];
      }
      row.push(...word);
    }
    if (row.length > 0) result.push(row);
  }
  return result.length <= rows ? result : null;
}
