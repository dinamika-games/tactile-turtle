// Every level's reference solution, set on its plate and held up to the
// virtual webcam (the Chicony "Integrated Camera" 04f2:b531 and its like:
// 1280 x 720 MJPEG, which the game asks for; and 640 x 480, which a browser
// gets when the page does not ask).
//
// Run with `npm run test:webcam` (it takes a few minutes).

import { expect, it } from "vitest";

import levelsData from "../../data/levels.json" with { type: "json" };
import { parse } from "../../src/lang/parser.ts";
import { tokenize, tokenizeText } from "../../src/lang/tokens.ts";
import { holdUp, holdUpAlong, type HoldResult } from "../hold-up.ts";
import { mulberry32, plateInView, placeByHand, WEBCAM_720P, WEBCAM_VGA, type Pose } from "../virtual-webcam.ts";
import { PLATES } from "../../src/scan/plate.ts";
import { layoutProgram } from "../../src/lang/layout.ts";

// Frames per hold (TT_FRAMES to change it): the game waits for three steady seconds, about
// 30 frames, so 5 is on the strict side.
const FRAMES = Number(process.env.TT_FRAMES ?? 5);

function check(result: HoldResult, program: string, plate: string): void {
  expect(result.reading, "the plate is found").not.toBeNull();
  expect(result.reading!.plate.name).toBe(plate);
  expect(result.reading!.complete, "every slot was seen").toBe(true);
  expect(result.readRows).toEqual(result.expected);
  const tokens = tokenize(result.reading!.rows.filter((row) => row.length > 0));
  expect(tokens.map((t) => [t.kind.key, t.value])).toEqual(tokenizeText(program).map((t) => [t.kind.key, t.value]));
  expect(() => parse(tokens)).not.toThrow();
}

/** A pose in the given range, tilted at random, with the whole plate in the picture. */
function randomPose(seed: number, distance: number, plateName: string, camera: typeof WEBCAM_720P, program: string): Pose {
  const random = mulberry32(seed);
  const plate = PLATES.find((p) => p.name === plateName)!;
  const scene = placeByHand(plate, layoutProgram(program, plate.columns, plate.rows, true)!, seed);
  // At 70 cm, the plate must be held fairly straight (see tests/scan-e2e.test.ts).
  const tilt = distance >= 700 ? 0.5 : 1;
  for (let attempt = 0; attempt < 50; attempt++) {
    const spread = (1 - attempt / 50) * tilt;
    const pose: Pose = {
      distance,
      roll: (random() - 0.5) * 20 * spread,
      yaw: (random() - 0.5) * 40 * spread,
      pitch: (random() - 0.5) * 30 * spread,
      offsetX: (random() - 0.5) * 80 * spread,
      offsetY: (random() - 0.5) * 50 * spread,
    };
    if (plateInView(scene, pose, camera, 20)) return pose;
  }
  return { distance, roll: 0, yaw: 0, pitch: 0 };
}

export function checkWorld(world: number): void {
  for (const level of levelsData.levels.filter((l) => l.world === world)) {
    const program = level.solution.join("\n");

    const distance = [500, 600, 700][level.id % 3];
    it(`level ${level.id} (${level.name}), 1280x720 at ${distance / 10} cm`, () => {
      const pose = randomPose(level.id, distance, level.plate, WEBCAM_720P, program);
      check(holdUp(program, level.plate, pose, WEBCAM_720P, level.id, FRAMES), program, level.plate);
    });

    if (level.plate === "a4") {
      it(`level ${level.id} (${level.name}), 640x480 at 30 cm`, () => {
        const pose = randomPose(level.id + 1000, 300, level.plate, WEBCAM_VGA, program);
        check(holdUp(program, level.plate, pose, WEBCAM_VGA, level.id + 1000, FRAMES), program, level.plate);
      });
    } else {
      it(`level ${level.id} (${level.name}), 640x480 at 25 cm, moved about`, () => {
        const poses: Pose[] = [];
        for (const offsetY of [-70, 0, 70]) {
          for (const offsetX of [-110, 0, 110]) {
            poses.push({ distance: 250, roll: 3, yaw: offsetX / 20, pitch: -offsetY / 20, offsetX, offsetY });
            poses.push({ distance: 250, roll: -2, yaw: offsetX / 25, pitch: -offsetY / 25, offsetX, offsetY });
          }
        }
        check(holdUpAlong(program, level.plate, poses, WEBCAM_VGA, level.id + 2000), program, level.plate);
      });
    }
  }
}
