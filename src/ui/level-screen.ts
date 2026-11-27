// A level: the board stays on the screen while the children set the tiles;
// the scanning ring appears over it when they hold the plate up; then the
// turtle runs the program. A run that fails stays on the screen (at its end)
// until the children hold up the next program, or press "Show the start" to
// see where the level begins. A win is recorded in the journey (time, points,
// stars) and opens the next levels.

import { ParseError } from "../lang/parser.ts";
import { tokenize, type Token } from "../lang/tokens.ts";
import { dayGoals, goalSentence, levelTargets, play, type Level, type RunWords } from "../play.ts";
import { renderRunAnimation } from "../render/animation.ts";
import { renderBoard } from "../render/board.ts";
import { scanningOverlay } from "../render/screens.ts";
import type { Skin } from "../render/skin.ts";
import type { RunError } from "../world/run.ts";
import { dayWorld } from "../world/world.ts";
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
  /** Go to the main menu. */
  readonly onHome: () => void;
  /** Leave the level (back to the levels of the world). */
  readonly onLeave: () => void;
  /** Going to the next level, if it is open (asked after the win, which may open it). */
  readonly next: () => (() => void) | null;
}

export function goalText(level: Level): string {
  return dayGoals(level, level.days[0])
    .map((goal) =>
      goal.kind === "reach_colour" ? t("goal.reach_colour", { colour: tileWord(goal.colour) }) : t(`goal.${goal.kind}`),
    )
    .join(" ");
}

export function levelBoard(level: Level, skin: Skin): string {
  return renderBoard(dayWorld(level.days[0]), {
    targets: levelTargets(level),
    caption: `${t("ui.level", { n: level.id })}: ${t(`level.${level.id}`)}\n${goalText(level) || goalSentence(level)}`,
    skin,
  });
}

const runWords = (): RunWords => ({
  caption: (token: Token) => tileWord(token.kind.key),
  wellDone: t("ui.well_done"),
  notQuite: t("ui.not_quite"),
  error: errorSentence,
});

/** A parse or run error in the chosen language: tiles by their words, types by their names. */
function errorSentence(error: ParseError | RunError): string {
  const params = error instanceof ParseError ? error.params : {};
  const words = Object.fromEntries(
    Object.entries(params).map(([name, value]) => [
      name,
      name === "tile" ? (/^\d+$/.test(value) ? value : tileWord(value)) : name === "variable" ? value : t(`type.${value}`),
    ]),
  );
  return t(`error.${error instanceof ParseError ? error.text : error.code}`, words);
}

/** How long the reward stays before the next level opens by itself. */
const AUTO_NEXT_SECONDS = 15;

/** The spanner in a ring that empties over the seconds before the next level. */
function countdownRing(spanner: string, seconds: number): string {
  const r = 42;
  const circumference = (2 * Math.PI * r).toFixed(1);
  return (
    `<svg class="countdown-ring" viewBox="0 0 100 100" aria-hidden="true">` +
    `<circle cx="50" cy="50" r="${r}" fill="none" stroke="rgba(16, 32, 42, 0.2)" stroke-width="9"/>` +
    `<circle cx="50" cy="50" r="${r}" fill="none" stroke="#10202a" stroke-width="9" stroke-linecap="round" ` +
    `stroke-dasharray="${circumference}" stroke-dashoffset="0" transform="rotate(-90 50 50)">` +
    `<animate attributeName="stroke-dashoffset" from="0" to="${circumference}" dur="${seconds}s" fill="freeze"/></circle>` +
    `<image href="${spanner}" x="24" y="24" width="52" height="52"/></svg>`
  );
}

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
  // What stays on the stage between scans: the board, or the last run that
  // failed (at its end), until the children show the next program.
  let resting = board;
  const showResting = (picture: string) => {
    showOn(stage, picture);
    // A failed run is shown again at its end, not played from the start.
    if (resting !== board) stage.querySelector<SVGSVGElement>(":scope > svg")?.setCurrentTime(1e6);
  };
  showOn(stage, board);
  overlay.innerHTML =
    `<div class="bar"><button class="small" data-action="back">${backArrow()} ${t("ui.back")}</button>` +
    `<button class="small" data-action="reset" hidden>↺ ${t("ui.reset")}</button>` +
    `<span class="hint">${t("ui.hold_up")}</span></div>`;
  overlay.querySelector<HTMLButtonElement>("[data-action=back]")!.onclick = () => {
    scanner.pause();
    leave();
  };
  // After a failed run: back to the board as the level begins.
  const resetButton = overlay.querySelector<HTMLButtonElement>("[data-action=reset]")!;
  resetButton.onclick = () => {
    resetButton.hidden = true;
    resting = board;
    if (!running) showResting(board);
  };

  scanner.onUpdate = ({ state, small }) => {
    if (running) return;
    if (state.phase === "idle") {
      showResting(resting);
      return;
    }
    const partial = state.merged !== null && !state.merged.complete && state.merged.coverage > 0;
    showResting(
      scanningOverlay(resting, {
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
    resetButton.hidden = true;
    const tokens = tokenize(rows);
    const played = play(level, tokens, runWords());
    const stepMs = 600;
    const animation = renderRunAnimation(tokens, played.frames, { stepMs, loop: false, skin, word: (token) => tileWord(token.kind.key), targets: levelTargets(level, played.day) });
    showOn(stage, animation);
    await new Promise((resolve) => setTimeout(resolve, (played.frames.length + 3) * stepMs));
    if (played.won) {
      const result = context.onWin((performance.now() - started) / 1000);
      showReward(result);
    } else {
      // The failed run stays on the screen until the next program is shown.
      resting = animation;
      resetButton.hidden = false;
      await scanner.start();
    }
  }

  function showReward(result: LevelResult | null): void {
    const onNext = context.next();
    const stars = result === null ? "" : "★".repeat(result.stars) + "☆".repeat(3 - result.stars);
    overlay.innerHTML =
      `<div class="reward"><div class="stars">${stars}</div>` +
      `<div class="title">${t("ui.well_done")}</div>` +
      (result === null ? "" : `<div class="points">${t("ui.points", { n: result.points })}</div>`) +
      `<div class="buttons">` +
      (onNext !== null
        ? `<button data-action="next">${countdownRing(skin.href("spanner"), AUTO_NEXT_SECONDS)}` +
          `<span>${t("ui.next_level")} ${nextArrow()}</span><span class="countdown">${AUTO_NEXT_SECONDS}</span></button>`
        : "") +
      `<button class="secondary" data-action="again">${t("ui.try_again")}</button>` +
      `<button class="secondary" data-action="back">${t("ui.levels")}</button>` +
      `<button class="secondary" data-action="home" title="Tactile Turtle">🏠</button></div></div>`;
    const nextButton = overlay.querySelector<HTMLButtonElement>("[data-action=next]");

    // Without a click, the next level opens by itself after a while.
    let timer: ReturnType<typeof setInterval> | undefined;
    const stopCountdown = () => clearInterval(timer);
    const goNext = () => {
      stopCountdown();
      document.body.classList.remove("camera");
      onNext?.();
    };
    if (nextButton !== null) {
      const countdown = nextButton.querySelector<HTMLElement>(".countdown")!;
      let left = AUTO_NEXT_SECONDS;
      timer = setInterval(() => {
        // The reward is gone (Back in the browser, another screen): no more counting.
        if (!nextButton.isConnected) return stopCountdown();
        left -= 1;
        if (left <= 0) return goNext();
        countdown.textContent = String(left);
      }, 1000);
      nextButton.onclick = goNext;
    }
    overlay.querySelector<HTMLButtonElement>("[data-action=again]")!.onclick = () => {
      stopCountdown();
      void openLevel(level, context);
    };
    overlay.querySelector<HTMLButtonElement>("[data-action=back]")!.onclick = () => {
      stopCountdown();
      leave();
    };
    overlay.querySelector<HTMLButtonElement>("[data-action=home]")!.onclick = () => {
      stopCountdown();
      document.body.classList.remove("camera");
      context.onHome();
    };
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
