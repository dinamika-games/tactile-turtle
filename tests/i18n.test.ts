import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import levelsData from "../data/levels.json" with { type: "json" };

const DIR = new URL("../i18n/", import.meta.url);
const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({ name, data: JSON.parse(readFileSync(new URL(name, DIR), "utf-8")) }));
const english = files.find((file) => file.name === "en.json")!.data.texts as Record<string, string>;

describe("the languages", () => {
  it("are sixteen", () => {
    expect(files.map((file) => file.data.language.code).sort()).toEqual(
      ["ar", "bo", "de", "en", "es", "fr", "hbs", "hi", "it", "ja", "ko", "pt", "ru", "sq", "tr", "zh"],
    );
  });

  it.each(files)("$name has every text, with the same {placeholders}", ({ data }) => {
    for (const [key, text] of Object.entries(english)) {
      expect(data.texts[key], key).toBeTypeOf("string");
      const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(placeholders(data.texts[key]), key).toEqual(placeholders(text));
    }
  });

  it("have a sentence for every error of a run", () => {
    const source = readFileSync(new URL("../src/world/run.ts", import.meta.url), "utf-8");
    const codes = [...source.matchAll(/new RunError\("(\w+)"/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(5);
    for (const code of codes) expect(english[`error.${code}`], code).toBeTypeOf("string");
  });

  it("have the names of all 100 levels, the English ones as in data/levels.json", () => {
    for (const level of levelsData.levels) {
      expect(english[`level.${level.id}`]).toBe(level.name);
      for (const { name, data } of files) expect(data.texts[`level.${level.id}`], `${name}: level ${level.id}`).toBeTruthy();
    }
  });
});
