import { describe, expect, it } from "vitest";

import { defaultName, isOpen, isWorldOpen, JourneyStore, levelExists, nextLevel, score, starsIn, type KeyValueStore } from "../src/ui/journeys.ts";

function memory(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value) };
}

describe("journeys", () => {
  it("are created, listed with the last first, chosen and deleted", () => {
    const store = new JourneyStore(memory());
    const a = store.create("Class 4a", new Date("2026-11-25T08:00:00Z"));
    const b = store.create("Class 4b", new Date("2026-11-25T09:00:00Z"));
    expect(store.list().map((j) => j.name)).toEqual(["Class 4b", "Class 4a"]);
    store.choose(a.id);
    expect(store.last()?.id).toBe(a.id);
    expect(store.list()[0].id).toBe(a.id);
    store.delete(a.id);
    expect(store.list().map((j) => j.id)).toEqual([b.id]);
    expect(store.last()).toBeUndefined();
  });

  it("keep the best result of a level, and survive a reload", () => {
    const storage = memory();
    const store = new JourneyStore(storage);
    const journey = store.create("Us");
    store.record(journey.id, 1, 500);
    store.record(journey.id, 1, 100);
    store.record(journey.id, 1, 900);
    const again = new JourneyStore(storage).get(journey.id)!;
    expect(again.results["1"]).toMatchObject({ seconds: 100, stars: 3, points: 300 });
  });

  it("start afresh from a broken save", () => {
    const storage = memory();
    storage.setItem("tactile-turtle/journeys", "{not json");
    expect(new JourneyStore(storage).list()).toEqual([]);
  });

  it("open level 1, then the level after the highest won one", () => {
    const store = new JourneyStore(memory());
    const journey = store.create("Us");
    expect(isOpen(journey, 1)).toBe(true);
    expect(isOpen(journey, 2)).toBe(false);
    store.record(journey.id, 1, 60);
    const after = store.get(journey.id)!;
    expect([2, 3, 4].map((id) => isOpen(after, id))).toEqual([true, false, false]);
    expect(isWorldOpen(after, 1)).toBe(true);
    expect(isWorldOpen(after, 2)).toBe(false);
    expect(starsIn(after, 1)).toBe(3);
  });

  it("lead to the next level once it is open, and to none after the last", () => {
    const store = new JourneyStore(memory());
    const journey = store.create("Us");
    expect(nextLevel(journey, 1)).toBeNull();
    store.record(journey.id, 1, 60);
    expect(nextLevel(store.get(journey.id)!, 1)).toBe(2);
    store.record(journey.id, 100, 60);
    expect(nextLevel(store.get(journey.id)!, 100)).toBeNull();
  });

  it("score by the par time: 3 stars within it, down to 100 points at three times it", () => {
    expect(score(1, 100)).toMatchObject({ points: 300, stars: 3 });
    expect(score(1, 360)).toMatchObject({ points: 200, stars: 2 });
    expect(score(1, 2000)).toMatchObject({ points: 100, stars: 1 });
  });

  it("know which levels exist", () => {
    expect(Array.from({ length: 100 }, (_, i) => i + 1).filter((id) => !levelExists(id))).toEqual([]);
    expect(levelExists(101)).toBe(false);
  });

  it("are named with the date and time by default", () => {
    expect(defaultName(new Date(2026, 10, 25, 9, 5))).toBe("2026-11-25 09:05");
  });
});
