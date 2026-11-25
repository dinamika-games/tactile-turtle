// The demo: the game with imaginary plates, without a camera or printed tiles
// (open the page with ?demo). For each scenario: the level (it stays on the
// screen while the children program), the plate they hold up next to the
// scanning screen, and the run. A grey line at the bottom says what is happening; the
// real game shows nothing there.

import plateData from "../data/plate.json" with { type: "json" };
import { layoutProgram } from "./lang/layout.ts";
import { tokenizeText } from "./lang/tokens.ts";
import { goalSentence, levelById, play } from "./play.ts";
import { renderRunAnimation } from "./render/animation.ts";
import { renderBoard } from "./render/board.ts";
import { renderPlate } from "./render/plate.ts";
import { blackScreen, scanningOverlay } from "./render/screens.ts";
import type { Skin } from "./render/skin.ts";
import { parseMap } from "./world/world.ts";

interface Scenario {
  readonly level: number;
  /** What the narration says about this plate. */
  readonly about: string;
  readonly program: string;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    level: 10,
    about: "The first loop: twelve steps with one FORWARD tile.",
    program: "REPEAT 12\nFORWARD\nEND",
  },
  {
    level: 45,
    about: "A first try: every box goes to the left.",
    program: "REPEAT 4\nPICK_UP LEFT DROP\nRIGHT FORWARD\nEND",
  },
  {
    level: 45,
    about: "With IF and ELSE, but one END is missing.",
    program: "REPEAT 4\nIF COLOUR = RED\nPICK_UP LEFT DROP RIGHT\nELSE PICK_UP RIGHT\nDROP LEFT\nFORWARD\nEND",
  },
  {
    level: 45,
    about: "Fixed: red boxes to the left, blue to the right.",
    program: "REPEAT 4\nIF COLOUR = RED\nPICK_UP LEFT DROP RIGHT\nELSE PICK_UP RIGHT\nDROP LEFT END\nFORWARD\nEND",
  },
  {
    level: 92,
    about: "Following a line with WHILE and the COLOUR sensor.",
    program: "WHILE HERE ≠ YELLOW\nIF COLOUR = BLUE OR\nCOLOUR = YELLOW\nFORWARD\nELSE LEFT\nIF COLOUR ≠ BLUE\nRIGHT RIGHT END\nEND\nEND",
  },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function playDemo(
  stage: HTMLElement,
  narration: HTMLElement,
  skin: Skin,
  fit: (root: HTMLElement) => void,
): Promise<void> {
  const plate = plateData.plates.find((candidate) => candidate.name === "a4")!;
  const show = (html: string, says: string) => {
    stage.innerHTML = html;
    fit(stage);
    narration.textContent = says;
  };

  for (;;) {
    for (const scenario of SCENARIOS) {
      try {
        await playScenario(stage, scenario, plate, show, skin);
      } catch (error) {
        // One broken scenario must not stop the demo.
        console.error(error);
        show(blackScreen(1280, 720), `This scenario did not work: ${String(error)}`);
        await sleep(3000);
      }
    }
  }
}

async function playScenario(
  stage: HTMLElement,
  scenario: Scenario,
  plate: (typeof plateData.plates)[number],
  show: (html: string, says: string) => void,
  skin: Skin,
): Promise<void> {
  {
    {
      const level = levelById(scenario.level);
      const rows = layoutProgram(scenario.program, plate.columns, plate.rows) ?? layoutProgram(scenario.program, plate.columns, plate.rows, true)!;

      // 1. The task: the level stays on the screen while the children
      //    study it and set the tiles on the plate.
      const board = renderBoard(parseMap(level.days[0].map), {
        caption: `Level ${level.id}: ${level.name}. ${goalSentence(level)}`,
        skin,
      });
      show(board, `Level ${level.id}. The children study the level and set the tiles on the plate. ${scenario.about}`);
      await sleep(5000);

      // 2. They hold the plate up: the ring fills over the level.
      const plateSvg = renderPlate(plate, rows, 520);
      const steps = 25;
      for (let i = 0; i <= steps; i++) {
        show(
          `<div class="pair">${plateSvg}` +
            scanningOverlay(board, { progress: i / steps, label: "Scanning", spanner: skin.href("spanner") }) +
            `</div>`,
          "They hold the plate up to the webcam (left: the plate; right: the screen).",
        );
        await sleep(100);
      }

      // 4. The run.
      const played = play(level, tokenizeText(scenario.program));
      const stepMs = 550;
      show(renderRunAnimation(tokenizeText(scenario.program), played.frames, { stepMs, loop: false, skin }), "The turtle runs the program.");
      await sleep(played.frames.length * stepMs);
      const narration = played.won ? "Well done! On to the next level." : `${played.ending.replace(/\.$/, "")}. The children change the plate and try again.`;
      stage.ownerDocument.getElementById("narration")!.textContent = narration;
      await sleep(4 * stepMs + 1500);
    }
  }
}
