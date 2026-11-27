import { describe, expect, it } from "vitest";

import { skinFrom, SPRITE_NAMES, variant } from "../src/render/skin.ts";

describe("the skin", () => {
  it("chooses variants from 1 to the count, for any seed", () => {
    for (let seed = -50; seed < 5000; seed += 7) {
      for (const count of [4, 6, 8]) {
        const v = variant(seed, count);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(count);
      }
    }
  });

  it("refuses unknown sprites", () => {
    const skin = skinFrom(Object.fromEntries(SPRITE_NAMES.map((name) => [name, `${name}.png`])));
    expect(skin.href("turtle")).toBe("turtle.png");
    expect(() => skin.href("sand-0")).toThrow();
  });
});
