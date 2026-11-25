// A skin: the sprites the board is drawn with (assets/sprites/, cut from the
// generated sprite sheets by dev/sprites/import_sprites.py). Without a skin,
// the board is drawn with the vector shapes of board.ts.

import manifest from "../../assets/sprites/manifest.json" with { type: "json" };

export interface Skin {
  /** The URL (or data URI) of a sprite, by its name in the manifest. */
  href(name: string): string;
}

/** The share of a turtle sprite's square taken by the length of the turtle. */
export const TURTLE_EXTENT: number = manifest.turtle_extent;

/** The share of a thing sprite's square taken by the thing (the crops add 6 % on each side). */
export const THING_EXTENT = 1 / 1.12;

export const SPRITE_NAMES: readonly string[] = manifest.sprites;

/** A skin from a map of sprite names to URLs; fails early for a missing sprite. */
export function skinFrom(urls: Record<string, string>): Skin {
  const missing = SPRITE_NAMES.filter((name) => !(name in urls));
  if (missing.length > 0) throw new Error(`Missing sprites: ${missing.join(", ")}`);
  return {
    href: (name) => {
      const url = urls[name];
      if (url === undefined) throw new Error(`No sprite named ${JSON.stringify(name)}`);
      return url;
    },
  };
}

/** A stable choice of a variant (e.g. which of the 6 rocks) from a number. */
export function variant(seed: number, count: number): number {
  // Math.imul and >>> 0 keep it an unsigned 32-bit integer (a plain ^ would
  // make it signed, and the variant negative).
  let h = Math.imul(seed | 0, 2654435761) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return (h % count) + 1;
}
