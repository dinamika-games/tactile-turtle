// The camera and the scanner: frames go to the worker (src/scan/worker.ts),
// the readings are merged while the plate is held up (src/scan/hold.ts).

import { PlateHold, type HoldState } from "../scan/hold.ts";
import { fromData } from "../scan/plate.ts";
import type { ScanReply } from "../scan/worker.ts";

/** Anchors smaller than this (pixels) are hard to read: ask to come closer. */
export const SMALL_ANCHOR_PX = 26;
const SCAN_INTERVAL_MS = 100;

export interface ScanUpdate {
  readonly state: HoldState;
  /** The anchors are small in the picture: the children should come closer. */
  readonly small: boolean;
}

export class CameraScanner {
  private readonly video: HTMLVideoElement;
  private readonly stats: HTMLElement;
  private readonly worker = new Worker(new URL("../scan/worker.ts", import.meta.url), { type: "module" });
  private readonly hold = new PlateHold();
  private busy = false;
  private running = false;
  private started = false;
  private looping = false;
  /** Counts the stops: a start that is still waiting for the camera when stop() is called gives up. */
  private generation = 0;
  /** Called for every frame read while scanning. */
  onUpdate: (update: ScanUpdate) => void = () => {};

  constructor(video: HTMLVideoElement, stats: HTMLElement) {
    this.video = video;
    this.stats = stats;
    this.worker.onmessage = (event: MessageEvent<ScanReply>) => this.received(event.data);
  }

  /** Start the camera (once); it asks for 1280 x 720, without which browsers give 640 x 480. */
  async start(): Promise<void> {
    const generation = this.generation;
    if (!this.started) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
      if (generation !== this.generation) {
        // The level was left while the camera was starting: switch it off again.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.video.srcObject = stream;
      await this.video.play();
      if (generation !== this.generation) return;
      this.started = true;
      if (!this.looping) {
        this.looping = true;
        this.loop();
      }
    }
    this.hold.reset();
    this.running = true;
  }

  /** Stop scanning (the camera stays on: e.g. while the turtle runs the program). */
  pause(): void {
    this.running = false;
    this.hold.reset();
  }

  /** Switch the camera off (leaving a level): its light goes out. start() turns it on again. */
  stop(): void {
    this.generation++;
    this.onUpdate = () => {};
    this.pause();
    const stream = this.video.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
    this.started = false;
  }

  private received(reply: ScanReply): void {
    this.busy = false;
    this.stats.textContent =
      `${this.video.videoWidth}x${this.video.videoHeight} · ${reply.markers} markers · ${reply.milliseconds.toFixed(0)} ms` +
      (reply.reading ? ` · anchors ${reply.reading.anchorPixels.toFixed(0)} px` : "");
    if (!this.running) return;
    const state = this.hold.add(performance.now(), reply.reading === null ? null : fromData(reply.reading));
    const small = reply.reading !== null && reply.reading.anchorPixels < SMALL_ANCHOR_PX;
    if (state.accepted) this.hold.reset();
    this.onUpdate({ state, small });
  }

  private loop(): void {
    if (!this.busy && this.running && this.video.readyState >= 2) {
      this.busy = true;
      createImageBitmap(this.video).then(
        (bitmap) => this.worker.postMessage(bitmap, [bitmap]),
        () => {
          this.busy = false;
        },
      );
    }
    setTimeout(() => this.loop(), SCAN_INTERVAL_MS);
  }
}
