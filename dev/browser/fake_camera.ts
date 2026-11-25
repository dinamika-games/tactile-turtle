// A fake camera for Chrome: an MJPEG file of the virtual webcam, a while
// without the plate, then the plate with the solution of a level (default 45)
// held up at 52 cm. Usage: node dev/browser/fake_camera.ts <out.mjpeg> [level]
import { writeFileSync } from "node:fs";
import levels from "../../data/levels.json" with { type: "json" };
import { layoutProgram } from "../../src/lang/layout.ts";
import { PLATES } from "../../src/scan/plate.ts";
import { mulberry32, placeByHand, render, toJpeg, trembling, WEBCAM_720P } from "../../tests/virtual-webcam.ts";

const levelId = Number(process.argv[3] ?? 45);
const program = levels.levels.find((l) => l.id === levelId)!.solution.join("\n");
const plate = PLATES[0];
const scene = placeByHand(plate, layoutProgram(program, plate.columns, plate.rows)!, 5);
const random = mulberry32(42);
const chunks: Uint8Array[] = [];
for (let i = 0; i < 36; i++) {
  const held = i >= 6;
  const base = { distance: 520, roll: 4, yaw: -8, pitch: 6, offsetX: held ? 0 : 3000, offsetY: 0 };
  const frame = render(scene, trembling(base, random), WEBCAM_720P, 500 + i);
  chunks.push(toJpeg(frame, 85));
}
writeFileSync(process.argv[2], Buffer.concat(chunks));
console.log("frames", chunks.length);
