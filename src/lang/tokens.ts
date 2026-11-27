// Tokens: what the parser reads. A token is one tile, except that digit tiles
// lying next to each other in a row are joined into one number token.
//
// Tokens come from the plate (see src/scan/plate.ts) or from the text form,
// which developers and tests use:
//
//   a ← 12
//   WHILE FRONT ≠ ROCK
//     IF HERE = RED a ← a + 1 END
//     FORWARD
//   END
//
// In the text form, words are separated by white space; line breaks and
// indentation mean nothing (as on the plate, where the rows are just read
// one after the other). A run of digits is one number. ASCII spellings are
// accepted: <- for ←, != for ≠, == for =, * for ×, - for −, STAR / DOT for ★ / ●.

import { kindById, kindByKey, type TileKind } from "./catalogue.ts";

export interface Token {
  /** The kind of the (first) tile; for numbers, the kind of the first digit. */
  readonly kind: TileKind;
  /** The value of a number token. */
  readonly value?: number;
  /** The ids of the tiles of this token, in reading order. */
  readonly tileIds: readonly number[];
  /** The position of the first tile: the row and the index in the row. */
  readonly row: number;
  readonly column: number;
}

const ALIASES: Record<string, string> = {
  "←": "ASSIGN",
  "<-": "ASSIGN",
  "★": "STAR",
  "●": "DOT",
  "+": "PLUS",
  "−": "MINUS",
  "-": "MINUS",
  "×": "TIMES",
  "*": "TIMES",
  "=": "EQUAL",
  "==": "EQUAL",
  "≠": "NOT_EQUAL",
  "!=": "NOT_EQUAL",
  "<": "LESS",
  ">": "GREATER",
  "PICK": "PICK_UP",
  "PUT_DOWN": "DROP",
  "PRESS": "SWITCH",
  "COLOR": "COLOUR",
};

export class TextError extends Error {}

/** Translate the text form into rows of tile ids (one row per line). */
export function textToRows(text: string): number[][] {
  const rows: number[][] = [];
  for (const line of text.split("\n")) {
    const row: number[] = [];
    for (const word of line.trim().split(/\s+/)) {
      if (word === "") continue;
      if (/^[0-9]+$/.test(word)) {
        for (const digit of word) row.push(kindByKey(digit).id);
        continue;
      }
      const key = ALIASES[word] ?? word;
      try {
        row.push(kindByKey(key).id);
      } catch {
        throw new TextError(`Unknown word in the program: ${word}`);
      }
    }
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

/**
 * A tile as read from a row: its id, and whether it touches the tile before
 * it (needed to join digits; in the text form, digits of one word touch).
 */
export interface RowTile {
  readonly id: number;
  readonly touchesPrevious: boolean;
}

/** Make tokens from rows of tiles; adjacent digits in a row form a number. */
export function tokenize(rows: readonly (readonly RowTile[])[]): Token[] {
  const tokens: Token[] = [];
  rows.forEach((row, rowIndex) => {
    let index = 0;
    while (index < row.length) {
      const kind = kindById(row[index].id);
      if (kind === undefined) {
        index++;
        continue;
      }
      if (kind.group === "number") {
        const ids = [row[index].id];
        let end = index + 1;
        while (
          end < row.length &&
          row[end].touchesPrevious &&
          kindById(row[end].id)?.group === "number"
        ) {
          ids.push(row[end].id);
          end++;
        }
        const value = Number(ids.map((id) => kindById(id)!.key).join(""));
        tokens.push({ kind, value, tileIds: ids, row: rowIndex, column: index });
        index = end;
        continue;
      }
      tokens.push({ kind, tileIds: [row[index].id], row: rowIndex, column: index });
      index++;
    }
  });
  return tokens;
}

/** Tokenize the text form: digits within a word touch, words do not. */
export function tokenizeText(text: string): Token[] {
  const rows: RowTile[][] = [];
  for (const line of text.split("\n")) {
    const row: RowTile[] = [];
    for (const word of line.trim().split(/\s+/)) {
      if (word === "") continue;
      textToRows(word)[0].forEach((id, index) =>
        row.push({ id, touchesPrevious: index > 0 }),
      );
    }
    if (row.length > 0) rows.push(row);
  }
  return tokenize(rows);
}
