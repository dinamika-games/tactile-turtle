// The screens before a level: the start, the language, the journeys, the
// worlds and the levels of a world (DESIGN.md, sections 6 and 8). Everything
// is large and touchable, for tablets. The journeys and the language are
// kept in the browser's local storage.

import levelsData from "../../data/levels.json" with { type: "json" };
import { levelById } from "../play.ts";
import { renderBoard } from "../render/board.ts";
import type { Skin } from "../render/skin.ts";
import { parseMap } from "../world/world.ts";
import type { CameraScanner } from "./camera.ts";
import { backArrow, LANGUAGES, language, setLanguage, t } from "./i18n.ts";
import {
  defaultName,
  isOpen,
  isPlayable,
  isWorldOpen,
  JourneyStore,
  nextPlayable,
  starsIn,
  totalPoints,
  type Journey,
} from "./journeys.ts";
import { openLevel } from "./level-screen.ts";
import { showOn } from "./stage.ts";

const SETTINGS = "tactile-turtle/settings";

interface Settings {
  readonly language?: string;
}

export interface AppContext {
  readonly stage: HTMLElement;
  readonly overlay: HTMLElement;
  readonly skin: Skin;
  readonly scanner: CameraScanner;
  readonly storage: Storage;
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stars(n: number, of: number): string {
  return `★ ${n}/${of}`;
}

/** A screen, as kept in the browser's history (so that Back goes to the previous one). */
type Screen =
  | { readonly name: "language" }
  | { readonly name: "start" }
  | { readonly name: "journeys" }
  | { readonly name: "worlds" }
  | { readonly name: "levels"; readonly world: number }
  | { readonly name: "level"; readonly level: number };

export class App {
  private readonly context: AppContext;
  private readonly journeys: JourneyStore;
  private journey: Journey | null = null;

  constructor(context: AppContext) {
    this.context = context;
    this.journeys = new JourneyStore(context.storage);
    const settings = this.settings();
    if (settings.language !== undefined) setLanguage(settings.language);
  }

  private settings(): Settings {
    try {
      return JSON.parse(this.context.storage.getItem(SETTINGS) ?? "{}") as Settings;
    } catch {
      return {};
    }
  }

  /** Show a menu screen over a picture of a level (the island in the background). */
  private menu(html: string): HTMLElement {
    const background = levelById(45);
    showOn(this.context.stage, renderBoard(parseMap(background.days[0].map), { skin: this.context.skin }));
    this.context.overlay.innerHTML = `<div class="menu">${html}</div>`;
    return this.context.overlay;
  }

  /** When the page is loaded: the language first (the last choice is marked, one tap). */
  begin(): void {
    addEventListener("popstate", (event: PopStateEvent) => this.render((event.state as Screen | null) ?? { name: "language" }));
    // Esc goes one screen back, as the Back buttons (not past the first screen).
    addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.repeat) return;
      if ((history.state as Screen | null)?.name === "language") return;
      event.preventDefault();
      this.back();
    });
    history.replaceState({ name: "language" } satisfies Screen, "");
    this.render({ name: "language" });
  }

  /** Go to a screen: a new step in the history (Back returns). */
  private go(screen: Screen): void {
    history.pushState(screen, "");
    this.render(screen);
  }

  /** Go back to the previous screen (as the browser's Back button does). */
  private back(): void {
    history.back();
  }

  private render(screen: Screen): void {
    // Leaving a level: stop scanning, give the webcam's room back to the stage.
    if (screen.name !== "level") {
      this.context.scanner.stop();
      document.body.classList.remove("camera");
    }
    switch (screen.name) {
      case "language":
        return this.chooseLanguage();
      case "start":
        return this.start();
      case "journeys":
        return this.chooseJourney();
      case "worlds":
        return this.chooseWorld();
      case "levels":
        return this.chooseLevel(screen.world);
      case "level":
        return this.playLevel(screen.level);
    }
  }

  /** The button to the main menu (on the screens of a journey). */
  private homeButton(): string {
    return `<button class="small" data-action="home" title="Tactile Turtle">🏠</button>`;
  }

  private wireHome(root: HTMLElement): void {
    root.querySelector<HTMLButtonElement>("[data-action=home]")?.addEventListener("click", () => this.go({ name: "start" }));
  }

  start(): void {
    const root = this.menu(
      `<h1>Tactile Turtle</h1>` +
        `<button data-action="play">${t("ui.play")}</button>` +
        `<button class="secondary" data-action="language"><span>🌐 ${escape(LANGUAGES.find((l) => l.code === language())?.name ?? "")}</span></button>`,
    );
    root.querySelector<HTMLButtonElement>("[data-action=play]")!.onclick = () => this.go({ name: "journeys" });
    root.querySelector<HTMLButtonElement>("[data-action=language]")!.onclick = () => this.go({ name: "language" });
  }

  chooseLanguage(): void {
    const root = this.menu(
      `<h1>🌐</h1><div class="grid">` +
        LANGUAGES.map(
          (l) =>
            `<button class="${l.code === this.settings().language ? "current" : "secondary"}" data-code="${l.code}" lang="${l.code}">${escape(l.name)}</button>`,
        ).join("") +
        `</div>`,
    );
    root.querySelectorAll<HTMLButtonElement>("[data-code]").forEach((button) => {
      button.onclick = () => {
        setLanguage(button.dataset.code!);
        this.context.storage.setItem(SETTINGS, JSON.stringify({ ...this.settings(), language: button.dataset.code }));
        this.go({ name: "start" });
      };
    });
  }

  chooseJourney(): void {
    const all = this.journeys.list();
    // One row per journey: the journey (the last one first, to continue), and Delete beside it.
    const rows = all
      .map(
        (journey, i) =>
          `<div class="row"><button class="${i === 0 ? "" : "secondary"} journey" data-id="${journey.id}">` +
          `<span class="name">${i === 0 ? `${t("ui.continue")}: ` : ""}${escape(journey.name)}</span>` +
          `<span class="meta">${t("ui.points", { n: totalPoints(journey) })}</span></button>` +
          `<button class="small danger" data-delete="${journey.id}" title="${t("ui.delete")}">🗑 ${t("ui.delete")}</button></div>`,
      )
      .join("");
    const root = this.menu(
      `<h2>${t("ui.journeys")}</h2>` +
        `<div class="list">${rows}</div>` +
        `<div class="new"><input id="journey-name" value="${escape(defaultName())}" aria-label="${t("ui.journey_name")}">` +
        `<button data-action="new">+ ${t("ui.new_journey")}</button></div>` +
        `<button class="small" data-action="back">${backArrow()} ${t("ui.back")}</button>`,
    );
    root.querySelectorAll<HTMLButtonElement>("[data-id]").forEach((button) => {
      button.onclick = () => {
        this.journeys.choose(button.dataset.id!);
        this.journey = this.journeys.get(button.dataset.id!) ?? null;
        this.go({ name: "worlds" });
      };
    });
    root.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((button) => {
      button.onclick = () => this.confirmDelete(button.dataset.delete!);
    });
    root.querySelector<HTMLButtonElement>("[data-action=new]")!.onclick = () => {
      const name = (root.querySelector<HTMLInputElement>("#journey-name")!.value.trim() || defaultName()).slice(0, 40);
      this.journey = this.journeys.create(name);
      this.go({ name: "worlds" });
    };
    root.querySelector<HTMLButtonElement>("[data-action=back]")!.onclick = () => this.back();
  }

  /** Deleting asks first, so that a hand resting on the screen never deletes a journey. */
  private confirmDelete(id: string): void {
    const journey = this.journeys.get(id);
    if (journey === undefined) return;
    const root = this.menu(
      `<h2>${t("ui.delete_question", { name: escape(journey.name) })}</h2>` +
        `<button class="secondary" data-action="keep">${t("ui.keep")}</button>` +
        `<button class="danger" data-action="delete">${t("ui.delete")}</button>`,
    );
    root.querySelector<HTMLButtonElement>("[data-action=keep]")!.onclick = () => this.chooseJourney();
    root.querySelector<HTMLButtonElement>("[data-action=delete]")!.onclick = () => {
      this.journeys.delete(id);
      this.chooseJourney();
    };
  }

  chooseWorld(): void {
    const journey = this.refreshJourney();
    if (journey === null) return this.chooseJourney();
    const root = this.menu(
      `<h2>${escape(journey.name)} · ${t("ui.worlds")}</h2><div class="grid worlds">` +
        Array.from({ length: 10 }, (_, i) => i + 1)
          .map((world) => {
            const open = isWorldOpen(journey, world) || unlockAll();
            return (
              `<button class="${open ? "" : "locked"}" data-world="${world}" ${open ? "" : "disabled"}>` +
              `<span class="number">${t("ui.world", { n: world })}</span><span class="name">${t(`world.${world}`)}</span>` +
              `<span class="meta">${open ? stars(starsIn(journey, world), 30) : "🔒 " + t("ui.locked")}</span></button>`
            );
          })
          .join("") +
        `</div><div class="row"><button class="small" data-action="back">${backArrow()} ${t("ui.back")}</button>${this.homeButton()}</div>`,
    );
    root.querySelectorAll<HTMLButtonElement>("[data-world]").forEach((button) => {
      button.onclick = () => this.go({ name: "levels", world: Number(button.dataset.world) });
    });
    root.querySelector<HTMLButtonElement>("[data-action=back]")!.onclick = () => this.back();
    this.wireHome(root);
  }

  chooseLevel(world: number): void {
    const journey = this.refreshJourney();
    if (journey === null) return this.chooseJourney();
    const levels = levelsData.levels.filter((level) => level.world === world);
    const root = this.menu(
      `<h2>${t("ui.world", { n: world })}: ${t(`world.${world}`)} · ${t("ui.levels")}</h2><div class="grid levels">` +
        levels
          .map((level) => {
            const open = isOpen(journey, level.id) || unlockAll();
            const playable = isPlayable(level.id);
            const result = journey.results[String(level.id)];
            const meta = !open
              ? "🔒"
              : !playable
                ? t("ui.coming_soon")
                : result !== undefined
                  ? "★".repeat(result.stars) + "☆".repeat(3 - result.stars)
                  : "☆☆☆";
            const enabled = open && playable;
            return (
              `<button class="${enabled ? "" : "locked"}" data-level="${level.id}" ${enabled ? "" : "disabled"}>` +
              `<span class="number">${level.id}</span><span class="name">${escape(t(`level.${level.id}`))}</span><span class="meta">${meta}</span></button>`
            );
          })
          .join("") +
        `</div><div class="row"><button class="small" data-action="back">${backArrow()} ${t("ui.back")}</button>${this.homeButton()}</div>`,
    );
    root.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((button) => {
      button.onclick = () => this.go({ name: "level", level: Number(button.dataset.level) });
    });
    root.querySelector<HTMLButtonElement>("[data-action=back]")!.onclick = () => this.back();
    this.wireHome(root);
  }

  playLevel(levelId: number): void {
    const journey = this.refreshJourney();
    // The next level with a map (levels still in preparation are skipped).
    const nextLevel = (): number | null => {
      const now = this.refreshJourney();
      if (now === null) return null;
      if (unlockAll()) return Array.from({ length: 100 - levelId }, (_, i) => levelId + 1 + i).find(isPlayable) ?? null;
      return nextPlayable(now, levelId);
    };
    this.context.overlay.innerHTML = "";
    void openLevel(levelById(levelId), {
      stage: this.context.stage,
      overlay: this.context.overlay,
      skin: this.context.skin,
      scanner: this.context.scanner,
      onWin: (seconds) => (journey === null ? null : this.journeys.record(journey.id, levelId, seconds)),
      onHome: () => this.go({ name: "start" }),
      onLeave: () => this.back(),
      // The next level replaces this one in the history: Back still leads to the levels.
      next: () => {
        const next = nextLevel();
        return next === null
          ? null
          : () => {
              history.replaceState({ name: "level", level: next } satisfies Screen, "");
              this.render({ name: "level", level: next });
            };
      },
    });
  }

  private refreshJourney(): Journey | null {
    this.journey = this.journey === null ? (this.journeys.last() ?? null) : (this.journeys.get(this.journey.id) ?? null);
    return this.journey;
  }
}

/** ?unlock opens every level (for trying the game; only levels with maps can be played). */
function unlockAll(): boolean {
  return new URLSearchParams(location.search).has("unlock");
}
