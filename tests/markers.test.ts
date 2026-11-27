import { describe, expect, it } from "vitest";

import markersData from "../data/markers.json" with { type: "json" };
import { MAX_HAMMING_DISTANCE } from "../src/scan/detector.ts";

function rotate(code: string): string {
  let out = "";
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out += code[(3 - j) * 4 + i];
  return out;
}

function distance(a: string, b: string): number {
  return [...a].filter((bit, i) => bit !== b[i]).length;
}

describe("the marker codes", () => {
  const codes = markersData.codes;

  it("are 100 codes of 16 cells", () => {
    expect(codes).toHaveLength(100);
    for (const code of codes) expect(code).toMatch(/^[01]{16}$/);
  });

  it("differ in at least 4 cells from each other, in every rotation", () => {
    let minimum = Infinity;
    for (let i = 0; i < codes.length; i++) {
      let rotated = codes[i];
      for (let r = 0; r < 4; r++) {
        for (let j = 0; j < codes.length; j++) {
          if (j !== i) minimum = Math.min(minimum, distance(rotated, codes[j]));
        }
        rotated = rotate(rotated);
      }
    }
    expect(minimum).toBeGreaterThanOrEqual(4);
  });

  it("differ in at least 4 cells from their own rotations (the orientation is clear)", () => {
    for (const code of codes) {
      let rotated = rotate(code);
      for (let r = 1; r < 4; r++) {
        expect(distance(code, rotated)).toBeGreaterThanOrEqual(4);
        rotated = rotate(rotated);
      }
    }
  });

  it("are corrected for one wrong cell, and rejected for two", () => {
    // js-aruco2 accepts a code closer than MAX_HAMMING_DISTANCE: one cell off.
    expect(MAX_HAMMING_DISTANCE).toBe(2);
  });
});
