// Points and quadrilaterals, in the picture (pixels) or on the plate (mm).

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A quadrilateral given by its four corners, clockwise from the top left (in
 * its own orientation: for a marker, the top left of the marker as printed).
 */
export class Quad {
  readonly topLeft: Point;
  readonly topRight: Point;
  readonly bottomRight: Point;
  readonly bottomLeft: Point;

  constructor(topLeft: Point, topRight: Point, bottomRight: Point, bottomLeft: Point) {
    this.topLeft = topLeft;
    this.topRight = topRight;
    this.bottomRight = bottomRight;
    this.bottomLeft = bottomLeft;
  }

  /** An upright square with its top left corner at (x, y). */
  static square(x: number, y: number, size: number): Quad {
    return new Quad({ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size });
  }

  /** The corners in order, clockwise from the top left. */
  get corners(): readonly [Point, Point, Point, Point] {
    return [this.topLeft, this.topRight, this.bottomRight, this.bottomLeft];
  }

  /** The four edges, as pairs of corners, clockwise from the top. */
  get edges(): readonly [Point, Point][] {
    const c = this.corners;
    return c.map((corner, i) => [corner, c[(i + 1) % 4]] as [Point, Point]);
  }

  /** Apply a function to every corner. */
  map(transform: (point: Point) => Point): Quad {
    return new Quad(
      transform(this.topLeft),
      transform(this.topRight),
      transform(this.bottomRight),
      transform(this.bottomLeft),
    );
  }

  /** The centre under perspective: where the diagonals cross. */
  centre(): Point {
    const a = this.topLeft;
    const b = this.topRight;
    const c = this.bottomRight;
    const d = this.bottomLeft;
    const denominator = (a.x - c.x) * (b.y - d.y) - (a.y - c.y) * (b.x - d.x);
    if (Math.abs(denominator) < 1e-9) {
      return { x: (a.x + b.x + c.x + d.x) / 4, y: (a.y + b.y + c.y + d.y) / 4 };
    }
    const t = ((a.x - b.x) * (b.y - d.y) - (a.y - b.y) * (b.x - d.x)) / denominator;
    return { x: a.x + t * (c.x - a.x), y: a.y + t * (c.y - a.y) };
  }
}
