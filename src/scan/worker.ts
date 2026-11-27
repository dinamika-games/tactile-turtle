// The scanner in a Web Worker: finds the markers in a camera frame and reads
// the plate, so that the page stays smooth.

import { MarkerDetector } from "./detector.ts";
import { readPlate, toData, type ReadingData } from "./plate.ts";
import type { Point } from "./geometry.ts";

const detector = new MarkerDetector();
let canvas: OffscreenCanvas | null = null;

export interface ScanReply {
  readonly reading: ReadingData | null;
  readonly markers: number;
  /** Every marker found, with its corners (to show them over the webcam, src/ui/marker-glow.ts). */
  readonly found: readonly { readonly id: number; readonly corners: readonly Point[] }[];
  readonly width: number;
  readonly height: number;
  readonly milliseconds: number;
}

self.onmessage = (event: MessageEvent<ImageBitmap>) => {
  const bitmap = event.data;
  if (canvas === null || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  }
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);

  const started = performance.now();
  const markers = detector.detect(image);
  const reading = readPlate(markers, image);
  const reply: ScanReply = {
    reading: reading === null ? null : toData(reading, image, markers),
    markers: markers.length,
    found: markers.map((marker) => ({ id: marker.id, corners: marker.corners.corners.map(({ x, y }) => ({ x, y })) })),
    width: image.width,
    height: image.height,
    milliseconds: performance.now() - started,
  };
  self.postMessage(reply);
};
