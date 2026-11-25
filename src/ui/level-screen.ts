// A level: the board stays on the screen while the children set the tiles;
// the scanning ring appears over it when they hold the plate up; then the
// turtle runs the program. A win is recorded in the journey (time, points,
// stars) and opens the next levels.

import { tokenize, type Token } from "../lang/tokens.ts";
import { goalSentence, play, type Level, type RunWords } from "../play.ts";
import { renderRunAnimation } from "../render/animation.ts";
import { renderBoard } from "../render/board.ts";
import { scanningOverlay } from "../render/screens.ts";
import type { Skin } from "../render/skin.ts";
import { parseMap } from "../world/world.ts";
import type { CameraScanner } from "./camera.ts";
import { backArrow, nextArrow, t, tileWord } from "./i18n.ts";
import type { LevelResult } from "./journeys.ts";
import { showOn } from "./stage.ts";

export interface LevelContext {
  readonly stage: HTMLElement;
  readonly overlay: HTMLElement;
  readonly skin: Skin;
  readonly scanner: CameraScanner;
  /** Record a win (returns the result), or nothing outside a journey. */
  readonly onWin: (seconds: number) => LevelResult | null;
  /** Leave the level (back to the levels of the world). */
  readonly onLeave: () => void;
  /** Go to the next level, if it is open and has its map. */
  readonly onNext: (() => void) | null;
}

export function goalText(level: Level): string {
  return level.goals
    .map((goal) =>
      goal.kind === "reach_colour" ? t("goal.reach_colour", { colour: tileWord(goal.colour) }) : t(`goal.${goal.kind}`),
    )
    .join(" ");
}

export function levelBoard(level: Level, skin: Skin): string {
  return renderBoard(parseMap(level.days[0].map), {
    caption: `${t("ui.level", { n: level.id })}: ${t(`level.${level.id}`)}\n${goalText(level) || goalSentence(level)}`,
    skin,
  });
}

const runWords = (): RunWords => ({
  caption: (token: Token) => tileWord(token.kind.key),
  wellDone: t("ui.well_done"),
  notQuite: t("ui.not_quite"),
});

export async function openLevel(level: Level, context: LevelContext): Promise<void> {
  const { stage, overlay, skin, scanner } = context;
  const started = performance.now();
  let running = false;

  // The webcam is shown beside the level (index.html: body.camera).
  document.body.classList.add("camera");
  const leave = () => {
    document.body.classList.remove("camera");
    context.onLeave();
  };
  const board = levelBoard(level, skin);
  showOn(stage, board);
  overlay.innerHTML =
    `<div class="bar"><button class="small" data-action="back">${backArrow()} ${t("ui.back")}</button>` +
    `<span class="hint">${t("ui.hold_up")}</span></div>`;
  overlay.querySelector<HTMLButtonElement>("[data-action=back]")!.onclick = () => {
    scanner.pause();
    leave();
  };

  scanner.onUpdate = ({ state, small }) => {
    if (running) return;
    if (state.phase === "idle") {
      showOn(stage, board);
      return;
    }
    const partial = state.merged !== null && !state.merged.complete && state.merged.coverage > 0;
    showOn(
      stage,
      scanningOverlay(board, {
        progress: state.progress,
        label: t("ui.scanning"),
        spanner: skin.href("spanner"),
        hint: small ? t("ui.come_closer") : partial ? t("ui.show_all") : undefined,
      }),
    );
    if (state.accepted && state.merged !== null) {
      running = true;
      void run(state.merged.rows.filter((row) => row.length > 0)).finally(() => {
        running = false;
      });
    }
  };

  async function run(rows: Parameters<typeof tokenize>[0]): Promise<void> {
    scanner.pause();
    const tokens = tokenize(rows);
    const played = play(level, tokens, runWords());
    const stepMs = 600;
    showOn(stage, renderRunAnimation(tokens, played.frames, { stepMs, loop: false, skin, word: (token) => tileWord(token.kind.key) }));
    await new Promise((resolve) => setTimeout(resolve, (played.frames.length + 3) * stepMs));
    if (played.won) {
      const result = context.onWin((performance.now() - started) / 1000);
      showReward(result);
    } else {
      showOn(stage, board);
      await scanner.start();
    }
  }

  function showReward(result: LevelResult | null): void {
    const stars = result === null ? "" : "★".repeat(result.stars) + "☆".repeat(3 - result.stars);
    overlay.innerHTML =
      `<div class="reward"><div class="stars">${stars}</div>` +
      `<div class="title">${t("ui.well_done")}</div>` +
      (result === null ? "" : `<div class="points">${t("ui.points", { n: result.points })}</div>`) +
      `<div class="buttons">` +
      (context.onNext !== null ? `<button data-action="next">${t("ui.next_level")} ${nextArrow()}</button>` : "") +
      `<button class="secondary" data-action="again">${t("ui.try_again")}</button>` +
      `<button class="secondary" data-action="back">${t("ui.levels")}</button></div></div>`;
    overlay.querySelector<HTMLButtonElement>("[data-action=next]")?.addEventListener("click", () => {
      document.body.classList.remove("camera");
      context.onNext?.();
    });
    overlay.querySelector<HTMLButtonElement>("[data-action=again]")!.onclick = () => void openLevel(level, context);
    overlay.querySelector<HTMLButtonElement>("[data-action=back]")!.onclick = () => leave();
  }

  try {
    await scanner.start();
  } catch (error) {
    overlay.innerHTML =
      `<div class="bar"><button class="small" data-action="back">${backArrow()} ${t("ui.back")}</button>` +
      `<span class="hint">${t("ui.camera_failed", { error: String(error) })}</span></div>`;
    overlay.querySelector<HTMLButtonElement>("[data-action=back]")!.onclick = () => leave();
  }
}
