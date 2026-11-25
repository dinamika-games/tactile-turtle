// The texts of the game in the chosen language (i18n/<code>.json), with
// English as the fallback.

import en from "../../i18n/en.json" with { type: "json" };
import { kindByKey } from "../lang/catalogue.ts";

interface LanguageFile {
  readonly language: { readonly code: string; readonly name: string };
  readonly texts: Record<string, string>;
}

// Every file in i18n/, sorted by the name of the language (in itself).
const FILES: readonly LanguageFile[] = Object.values(
  import.meta.glob<LanguageFile>("../../i18n/*.json", { eager: true, import: "default" }),
).sort((a, b) => a.language.name.localeCompare(b.language.name, "en"));

/** The languages, each named in itself, in alphabetical order. */
export const LANGUAGES: readonly { code: string; name: string }[] = FILES.map((file) => file.language);

let current: LanguageFile = en;

/** Languages written from right to left (the menus turn round; programs stay left to right). */
const RIGHT_TO_LEFT = new Set(["ar"]);

export function setLanguage(code: string): void {
  current = FILES.find((file) => file.language.code === code) ?? en;
  document.documentElement.lang = current.language.code;
  document.documentElement.dir = RIGHT_TO_LEFT.has(current.language.code) ? "rtl" : "ltr";
}

export function language(): string {
  return current.language.code;
}

/** A text by its key, with {name} replaced by ``params.name``. */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const text = current.texts[key] ?? (en.texts as Record<string, string>)[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

/** The word on a tile (its symbol for digits, operators and the like). */
export function tileWord(key: string): string {
  const kind = kindByKey(key);
  return kind.symbol ?? t(`tile.${key}`);
}

/** The arrow of Back: it points the other way in languages written from right to left. */
export function backArrow(): string {
  return RIGHT_TO_LEFT.has(current.language.code) ? "→" : "←";
}

/** The arrow of Next. */
export function nextArrow(): string {
  return RIGHT_TO_LEFT.has(current.language.code) ? "←" : "→";
}
