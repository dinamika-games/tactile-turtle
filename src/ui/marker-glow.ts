// The markers the scanner reads, drawn over the webcam (WebGL 2), so that the
// children see how the computer reads their tiles: brackets lock on to every
// marker found, the code it read pops out large and springs back onto it,
// lighting up cell by cell under a sweeping line, its white cells glowing. Tiles glow teal, the anchors of the
// plate blue. A marker follows the plate smoothly and fades when it is lost.
//
// Every marker is one quad (a little larger than the marker, for the glow),
// drawn with a homography so that it stays true under perspective; all the
// rest is in the fragment shader. Nothing is drawn while no marker is shown.

import markersData from "../../data/markers.json" with { type: "json" };
import type { Point } from "../scan/geometry.ts";
import { apply, fitHomography } from "../scan/homography.ts";
import { isPlateMarker } from "../scan/plate.ts";

export interface FoundMarker {
  readonly id: number;
  /** The corners in the picture, clockwise from the marker's top left (as printed). */
  readonly corners: readonly Point[];
}

/** A marker not seen for this long starts to fade (the scanner may miss it in a frame or two). */
const GRACE_MS = 600;
const FADE_MS = 350;
/** The quad reaches this far beyond the marker (in marker sizes), for the brackets and the ring. */
const MARGIN = 0.9;

const VERTEX = `#version 300 es
in vec2 a_pos;
in vec3 a_uvq;
uniform vec2 u_size;
out vec3 v_uvq;
void main() {
  v_uvq = a_uvq;
  vec2 clip = a_pos / u_size * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 v_uvq;
uniform float u_time;
uniform float u_age;
uniform float u_fade;
uniform float u_anchor;
uniform int u_code;
out vec4 o_colour;

// Paint a layer over what is there (premultiplied).
void over(inout vec4 dst, vec3 colour, float alpha) {
  alpha = clamp(alpha, 0.0, 1.0);
  dst = vec4(colour * alpha, alpha) + dst * (1.0 - alpha);
}

// Signed distance to the square of a marker (negative inside), in marker sizes.
float square(vec2 uv) {
  vec2 q = abs(uv - 0.5) - 0.5;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

// Overshoots a little and settles: a spring.
float springOut(float t) {
  t = clamp(t, 0.0, 1.0);
  float s = 2.2;
  return 1.0 + (s + 1.0) * pow(t - 1.0, 3.0) + s * pow(t - 1.0, 2.0);
}

void main() {
  vec2 uv = v_uvq.xy / v_uvq.z;
  vec3 tint = mix(vec3(0.1, 1.0, 0.75), vec3(0.35, 0.6, 1.0), u_anchor);
  vec3 hot = vec3(1.0, 0.98, 0.85);
  vec3 ink = vec3(0.02, 0.07, 0.12);
  vec4 c = vec4(0.0);
  float d = square(uv);

  // A soft glow around the marker, breathing a little.
  float breathe = 0.8 + 0.2 * sin(u_time * 4.0 + u_anchor * 2.0);
  if (d > 0.0) over(c, tint, 0.7 * exp(-d * 6.0) * breathe);

  // The ping: a ring that runs outward when the marker is first found.
  float ring = 0.05 + u_age * 1.3;
  float ringWidth = 0.05 + 1.5 * fwidth(d);
  over(c, hot, (1.0 - smoothstep(0.0, 0.5, u_age)) * (1.0 - smoothstep(0.0, ringWidth, abs(d - ring))));

  // The code as it was read: it pops out large, then springs back onto the
  // marker; its cells light up one after the other.
  float pop = mix(2.0, 1.0, springOut(u_age / 0.55));
  vec2 code = (uv - 0.5) / pop + 0.5;
  float inCode = square(code);
  if (inCode < 0.0) {
    ivec2 cell = ivec2(floor(code * 6.0));
    bool border = cell.x == 0 || cell.y == 0 || cell.x == 5 || cell.y == 5;
    int index = border ? 0 : (cell.y - 1) * 4 + (cell.x - 1);
    float revealAt = 0.06 + float(index) * 0.02;
    float shown = smoothstep(revealAt, revealAt + 0.06, u_age);
    float flash = step(revealAt, u_age) * exp(-(u_age - revealAt) * 10.0);
    // Stronger while it pops, then calmer, so that the picture shows through.
    float strength = mix(0.6, 0.95, 1.0 - smoothstep(0.5, 1.0, u_age));
    float lines = 0.85 + 0.15 * sin(code.y * 60.0 - u_time * 9.0);
    bool white = !border && ((u_code >> (15 - index)) & 1) == 1;
    if (white) {
      over(c, mix(tint, hot, 0.2 + 0.7 * flash) * lines, strength * shown);
    } else {
      over(c, ink, strength * 0.85 * shown);
    }
  }
  // The outline of the code.
  float outline = 1.0 - smoothstep(0.0, 0.03 + 1.2 * fwidth(inCode), abs(inCode));
  over(c, tint, outline * 0.9);

  // The sweep: a bright line running down over the code as it is read.
  float sweepY = (u_age - 0.04) / 0.4;
  if (inCode < 0.0 && sweepY < 1.15) {
    float band = exp(-abs(code.y - sweepY) * 30.0) * (1.0 - smoothstep(0.95, 1.15, sweepY));
    over(c, hot, 0.9 * band);
  }

  // The brackets at the corners, locking on from far out.
  float lock = 1.0 - pow(1.0 - smoothstep(0.0, 0.3, u_age), 3.0);
  float scale = mix(2.4, 1.16, lock);
  vec2 b = abs(uv - 0.5) / scale;
  float edge = abs(max(b.x, b.y) - 0.5);
  float width = 0.045 + 1.5 * fwidth(edge);
  float bracket = (1.0 - smoothstep(width * 0.5, width, edge)) * step(0.27, min(b.x, b.y));
  over(c, mix(tint, hot, 0.25 + 0.5 * (1.0 - lock)), bracket);

  o_colour = c * u_fade;
}`;

interface Shown {
  readonly id: number;
  readonly code: number;
  readonly anchor: boolean;
  /** The corners drawn (they follow the corners found smoothly). */
  corners: Point[];
  target: Point[];
  readonly firstSeen: number;
  lastSeen: number;
}

const CODES = markersData.codes.map((bits) => parseInt(bits, 2));

export class MarkerGlow {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext | null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private shown: Shown[] = [];
  private frame = 0;
  private lastFrame = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: true });
    if (this.gl !== null) this.setUp(this.gl);
  }

  /** The markers found in a frame of the given size. */
  update(markers: readonly FoundMarker[], width: number, height: number): void {
    if (this.gl === null || this.program === null) return;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.shown = [];
    }
    const now = performance.now();
    const free = new Set(this.shown);
    for (const marker of markers) {
      const corners = [...marker.corners];
      const centre = mean(corners);
      const size = Math.hypot(corners[0].x - corners[2].x, corners[0].y - corners[2].y);
      // The same marker as before: the same id, near where it was (a plate may have the same tile twice).
      let match: Shown | null = null;
      let best = Math.max(size, 30);
      for (const candidate of free) {
        if (candidate.id !== marker.id) continue;
        const distance = Math.hypot(mean(candidate.target).x - centre.x, mean(candidate.target).y - centre.y);
        if (distance < best) {
          best = distance;
          match = candidate;
        }
      }
      if (match !== null && now - match.lastSeen < GRACE_MS + FADE_MS) {
        free.delete(match);
        match.target = corners;
        match.lastSeen = now;
      } else {
        if (match !== null) free.delete(match);
        this.shown.push({
          id: marker.id,
          code: CODES[marker.id] ?? 0,
          anchor: isPlateMarker(marker.id),
          corners,
          target: corners,
          firstSeen: now,
          lastSeen: now,
        });
      }
    }
    this.animate();
  }

  /** Let every marker fade out (scanning stopped). */
  clear(): void {
    const past = performance.now() - GRACE_MS;
    for (const shown of this.shown) shown.lastSeen = Math.min(shown.lastSeen, past);
    this.animate();
  }

  private animate(): void {
    if (this.frame !== 0) return;
    this.lastFrame = performance.now();
    this.frame = requestAnimationFrame((time) => this.draw(time));
  }

  private draw(time: number): void {
    this.frame = 0;
    const gl = this.gl!;
    const dt = Math.min(0.1, (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    this.shown = this.shown.filter((shown) => time - shown.lastSeen < GRACE_MS + FADE_MS);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.shown.length === 0) return;

    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.u_size, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.u_time, time / 1000);
    const follow = 1 - Math.exp(-dt * 18);
    for (const shown of this.shown) {
      shown.corners = shown.corners.map((corner, i) => ({
        x: corner.x + (shown.target[i].x - corner.x) * follow,
        y: corner.y + (shown.target[i].y - corner.y) * follow,
      }));
      const vertices = quadVertices(shown.corners);
      if (vertices === null) continue;
      const unseen = time - shown.lastSeen - GRACE_MS;
      gl.uniform1f(this.uniforms.u_age, (time - shown.firstSeen) / 1000);
      gl.uniform1f(this.uniforms.u_fade, unseen <= 0 ? 1 : Math.max(0, 1 - unseen / FADE_MS));
      gl.uniform1f(this.uniforms.u_anchor, shown.anchor ? 1 : 0);
      gl.uniform1i(this.uniforms.u_code, shown.code);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    }
    this.frame = requestAnimationFrame((next) => this.draw(next));
  }

  private setUp(gl: WebGL2RenderingContext): void {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn("The marker glow does not compile:", gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (vertex === null || fragment === null) return;
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("The marker glow does not link:", gl.getProgramInfoLog(program));
      return;
    }
    this.program = program;
    for (const name of ["u_size", "u_time", "u_age", "u_fade", "u_anchor", "u_code"]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }

    this.buffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const position = gl.getAttribLocation(program, "a_pos");
    const uvq = gl.getAttribLocation(program, "a_uvq");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(uvq);
    gl.vertexAttribPointer(uvq, 3, gl.FLOAT, false, 20, 8);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
}

function mean(points: readonly Point[]): Point {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

/**
 * The quad around the marker (MARGIN beyond it), as a fan of four vertices:
 * x, y in the picture, and u·q, v·q, q in marker sizes, so that the shader's
 * u, v stay true under perspective (q from where the diagonals cross).
 */
function quadVertices(corners: readonly Point[]): Float32Array | null {
  const unit = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const toPicture = fitHomography(unit, corners);
  if (toPicture === null) return null;
  const uvs = unit.map(({ x, y }) => ({ x: x === 0 ? -MARGIN : 1 + MARGIN, y: y === 0 ? -MARGIN : 1 + MARGIN }));
  const points = uvs.map((uv) => apply(toPicture, uv));

  // Where the diagonals cross; each corner's q is (d_i + d_opposite) / d_opposite.
  const [a, b, c, d] = points;
  const denominator = (c.x - a.x) * (d.y - b.y) - (c.y - a.y) * (d.x - b.x);
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x)) / denominator;
  const cross = { x: a.x + t * (c.x - a.x), y: a.y + t * (c.y - a.y) };
  const distances = points.map((p) => Math.hypot(p.x - cross.x, p.y - cross.y));

  const data = new Float32Array(20);
  points.forEach((p, i) => {
    const opposite = distances[(i + 2) % 4];
    if (opposite < 1e-6) return;
    const q = (distances[i] + opposite) / opposite;
    data.set([p.x, p.y, uvs[i].x * q, uvs[i].y * q, q], i * 5);
  });
  return data;
}
