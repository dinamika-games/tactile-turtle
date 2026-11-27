// Journeys (DESIGN.md, section 8): a journey is one playthrough of a group,
// with its name and its results per level. They are kept in the browser's
// local storage. Which levels are open is not stored but derived from the
// results, so a save can never disagree with itself.

import levelsData from "../../data/levels.json" with { type: "json" };

export interface LevelResult {
  /** The best time, in seconds. */
  readonly seconds: number;
  readonly points: number;
  readonly stars: number;
}

export interface Journey {
  readonly id: string;
  readonly name: string;
  readonly created: string;
  readonly updated: string;
  /** By level id. */
  readonly results: Readonly<Record<string, LevelResult>>;
}

interface SaveFile {
  readonly format: 1;
  readonly journeys: Journey[];
  readonly last: string | null;
}

/** The part of the Storage API we use (so that tests can pass a map). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "tactile-turtle/journeys";

export class JourneyStore {
  private readonly storage: KeyValueStore;

  constructor(storage: KeyValueStore) {
    this.storage = storage;
  }

  private load(): SaveFile {
    try {
      const data = JSON.parse(this.storage.getItem(KEY) ?? "null") as SaveFile | null;
      if (data !== null && data.format === 1 && Array.isArray(data.journeys)) return data;
    } catch {
      // A broken save starts afresh (rather than breaking the game).
    }
    return { format: 1, journeys: [], last: null };
  }

  private save(data: SaveFile): void {
    this.storage.setItem(KEY, JSON.stringify(data));
  }

  /** The journeys, the last one played first. */
  list(): Journey[] {
    const data = this.load();
    return [...data.journeys].sort((a, b) =>
      a.id === data.last ? -1 : b.id === data.last ? 1 : b.updated.localeCompare(a.updated),
    );
  }

  get(id: string): Journey | undefined {
    return this.load().journeys.find((journey) => journey.id === id);
  }

  last(): Journey | undefined {
    const data = this.load();
    return data.journeys.find((journey) => journey.id === data.last);
  }

  create(name: string, now: Date = new Date()): Journey {
    const data = this.load();
    const stamp = now.toISOString();
    const journey: Journey = { id: `${stamp}-${Math.floor(Math.random() * 1e6)}`, name, created: stamp, updated: stamp, results: {} };
    this.save({ ...data, journeys: [...data.journeys, journey], last: journey.id });
    return journey;
  }

  choose(id: string): void {
    this.save({ ...this.load(), last: id });
  }

  delete(id: string): void {
    const data = this.load();
    this.save({ ...data, journeys: data.journeys.filter((journey) => journey.id !== id), last: data.last === id ? null : data.last });
  }

  /** Record a won level; the best result is kept. Returns the result of this run. */
  record(id: string, levelId: number, seconds: number, now: Date = new Date()): LevelResult {
    const data = this.load();
    const result = score(levelId, seconds);
    const journeys = data.journeys.map((journey) => {
      if (journey.id !== id) return journey;
      const previous = journey.results[String(levelId)];
      const best = previous === undefined || result.points > previous.points ? result : previous;
      return { ...journey, updated: now.toISOString(), results: { ...journey.results, [String(levelId)]: best } };
    });
    this.save({ ...data, journeys, last: id });
    return result;
  }
}

/** The default name of a new journey: the date and time. */
export function defaultName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function worldOf(levelId: number): number {
  return Math.floor((levelId - 1) / 10) + 1;
}

/** The par time of a level: 3 minutes in the first world, a minute more per world. */
export function parSeconds(levelId: number): number {
  return 180 + (worldOf(levelId) - 1) * 60;
}

/**
 * Points and stars (DESIGN.md, section 4): within the par time 300 points and
 * three stars; then down to 100 points at three times the par, in a straight
 * line; two stars up to twice the par.
 */
export function score(levelId: number, seconds: number): LevelResult {
  const par = parSeconds(levelId);
  const t = Math.max(0, Math.min(1, (seconds - par) / (2 * par)));
  const points = Math.round(300 - 200 * t);
  const stars = seconds <= par ? 3 : seconds <= 2 * par ? 2 : 1;
  return { seconds: Math.round(seconds), points, stars };
}

/**
 * Is the level open? Level 1 always; then every level up to two beyond the
 * highest won one. Levels without a map yet are skipped: the next two levels
 * with maps beyond the highest won one are open too.
 */
export function isOpen(journey: Journey, levelId: number): boolean {
  const won = Object.keys(journey.results).map(Number);
  const highest = won.length === 0 ? 0 : Math.max(...won);
  if (levelId === 1 || (highest > 0 && levelId <= highest + 2)) return true;
  return playableLevels()
    .filter((id) => id > highest)
    .slice(0, highest === 0 ? 1 : 2)
    .includes(levelId);
}

/** The first open level with a map after this one (the "Next level"), if any. */
export function nextPlayable(journey: Journey, levelId: number): number | null {
  return playableLevels().find((id) => id > levelId && isOpen(journey, id)) ?? null;
}

/** Is the world open? When one of its levels is. */
export function isWorldOpen(journey: Journey, world: number): boolean {
  return Array.from({ length: 10 }, (_, i) => (world - 1) * 10 + 1 + i).some((id) => isOpen(journey, id));
}

function playableLevels(): number[] {
  return levelsData.levels
    .filter((level) => "days" in level)
    .map((level) => level.id)
    .sort((a, b) => a - b);
}

/** Does the level have its map yet (can it be played)? */
export function isPlayable(levelId: number): boolean {
  const level = levelsData.levels.find((candidate) => candidate.id === levelId);
  return level !== undefined && "days" in level;
}

export function starsIn(journey: Journey, world: number): number {
  return Object.entries(journey.results)
    .filter(([id]) => worldOf(Number(id)) === world)
    .reduce((sum, [, result]) => sum + result.stars, 0);
}

export function totalPoints(journey: Journey): number {
  return Object.values(journey.results).reduce((sum, result) => sum + result.points, 0);
}
