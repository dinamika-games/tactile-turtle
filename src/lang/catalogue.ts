// The tile catalogue: every kind of tile, its marker id and its group.
// The data lives in data/tiles.json, shared with the printing (dev/print/).

import tilesData from "../../data/tiles.json" with { type: "json" };

export type Group =
  | "action"
  | "control"
  | "operator"
  | "number"
  | "variable"
  | "sensor"
  | "value";

export interface TileKind {
  readonly id: number;
  /** The language-neutral name, e.g. "FORWARD", "ASSIGN", "7", "a". */
  readonly key: string;
  readonly group: Group;
  /** How many tiles of this kind the standard kit holds. */
  readonly kit: number;
  /** The printed symbol of tiles that are not translated (digits, operators...). */
  readonly symbol?: string;
}

export const TILE_KINDS: readonly TileKind[] = tilesData.tiles.map((tile) => ({
  id: tile.id,
  key: tile.key,
  group: tile.group as Group,
  kit: tile.kit,
  symbol: "symbol" in tile ? (tile.symbol as string) : undefined,
}));

export const TILE_GEOMETRY = tilesData.geometry_mm;

const BY_ID = new Map(TILE_KINDS.map((kind) => [kind.id, kind]));
const BY_KEY = new Map(TILE_KINDS.map((kind) => [kind.key, kind]));

export function kindById(id: number): TileKind | undefined {
  return BY_ID.get(id);
}

export function kindByKey(key: string): TileKind {
  const kind = BY_KEY.get(key);
  if (kind === undefined) {
    throw new Error(`Unknown tile key: ${key}`);
  }
  return kind;
}

/** The standard kit as a map from tile id to the number of tiles. */
export function standardKit(): Map<number, number> {
  return new Map(TILE_KINDS.map((kind) => [kind.id, kind.kit]));
}
