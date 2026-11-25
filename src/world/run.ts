// The interpreter: runs a program on a world one tick at a time, as a
// generator, so that the board can animate every step (DESIGN.md, section 3).

import type { Cond, Expr, Program, Statement } from "../lang/parser.ts";
import type { Token } from "../lang/tokens.ts";
import { blocks, frontOf, type World } from "./world.ts";

export type Value = number | string;

/** Why a run stopped early; the token is the tile to point at. */
export class RunError extends Error {
  readonly code: string;
  readonly token: Token;

  constructor(code: string, message: string, token: Token) {
    super(message);
    this.code = code;
    this.token = token;
  }
}

export interface Step {
  /** The statement just done. */
  readonly token: Token;
  readonly world: World;
}

export const MAX_TICKS = 1000;
const MAX_DEPTH = 50;

class Interpreter {
  private readonly variables = new Map<string, number>([
    ["a", 0],
    ["b", 0],
    ["c", 0],
  ]);
  private depth = 0;
  private readonly world: World;
  private readonly program: Program;

  constructor(program: Program, world: World) {
    this.program = program;
    this.world = world;
  }

  *run(): Generator<Step> {
    yield* this.block(this.program.statements);
  }

  private *block(statements: readonly Statement[]): Generator<Step> {
    for (const statement of statements) yield* this.statement(statement);
  }

  private tick(token: Token): void {
    this.world.tick++;
    if (this.world.tick > MAX_TICKS) {
      throw new RunError("tired", "Your turtle is tired: is there a loop that never ends?", token);
    }
  }

  private *statement(statement: Statement): Generator<Step> {
    const world = this.world;
    const turtle = world.turtle;
    switch (statement.kind) {
      case "define":
        return;
      case "action": {
        const front = frontOf(world);
        const token = statement.token;
        switch (statement.action) {
          case "FORWARD":
            if (front.cell === null || blocks(front.cell.thing)) {
              throw new RunError("bump", "Bump! Something is in the way.", token);
            }
            turtle.x = front.x;
            turtle.y = front.y;
            break;
          case "LEFT":
            turtle.direction = ((turtle.direction + 3) % 4) as 0 | 1 | 2 | 3;
            break;
          case "RIGHT":
            turtle.direction = ((turtle.direction + 1) % 4) as 0 | 1 | 2 | 3;
            break;
          case "PICK_UP": {
            const thing = front.cell?.thing ?? null;
            if (thing === null || (thing.kind !== "HATCHLING" && thing.kind !== "BOX")) {
              throw new RunError("nothing_to_pick", "There is nothing to pick up in front.", token);
            }
            if (turtle.carrying.length >= world.capacity) {
              throw new RunError("full", "The turtle carries as much as it can.", token);
            }
            turtle.carrying.push(thing);
            front.cell!.thing = null;
            break;
          }
          case "DROP": {
            const thing = turtle.carrying.pop();
            if (thing === undefined) throw new RunError("empty", "The turtle carries nothing.", token);
            if (front.cell === null || front.cell.thing !== null) {
              turtle.carrying.push(thing);
              throw new RunError("no_room", "There is no room in front.", token);
            }
            if (front.cell.floor === "SEA" && thing.kind === "HATCHLING") world.home++;
            else front.cell.thing = thing;
            break;
          }
          case "SWITCH": {
            const thing = front.cell?.thing ?? null;
            if (thing?.kind === "LAMP") thing.on = !thing.on;
            else if (thing?.kind === "GATE") thing.open = !thing.open;
            else throw new RunError("nothing_to_switch", "There is nothing to switch in front.", token);
            break;
          }
          case "USE": {
            const thing = front.cell?.thing ?? null;
            const item = turtle.carrying.pop();
            if (item === undefined) throw new RunError("empty", "The turtle carries nothing to use.", token);
            if (thing?.kind === "LAMP") thing.on = true;
            else if (thing?.kind === "GATE") thing.open = true;
            else {
              turtle.carrying.push(item);
              throw new RunError("nothing_to_use", "There is nothing in front to use it on.", token);
            }
            break;
          }
          case "WAIT":
            break;
        }
        this.tick(token);
        yield { token, world };
        return;
      }
      case "paint": {
        world.cells[turtle.y][turtle.x].floor = this.expr(statement.colour) as "RED";
        this.tick(statement.token);
        yield { token: statement.token, world };
        return;
      }
      case "assign":
        this.variables.set(statement.variable, this.number(statement.expr));
        return;
      case "repeat": {
        const count = this.number(statement.count);
        for (let i = 0; i < count; i++) yield* this.block(statement.body);
        return;
      }
      case "while":
        while (this.cond(statement.cond)) {
          this.tick(statement.token);
          yield* this.block(statement.body);
        }
        return;
      case "if":
        if (this.cond(statement.cond)) yield* this.block(statement.then);
        else if (statement.otherwise !== null) yield* this.block(statement.otherwise);
        return;
      case "for": {
        const from = this.number(statement.from);
        const to = this.number(statement.to);
        const step = from <= to ? 1 : -1;
        for (let value = from; step > 0 ? value <= to : value >= to; value += step) {
          this.variables.set(statement.variable, value);
          yield* this.block(statement.body);
        }
        return;
      }
      case "call": {
        if (this.depth >= MAX_DEPTH) {
          throw new RunError("too_deep", "The turtle is lost in its own helpers.", statement.token);
        }
        const procedure = this.program.procedures.get(statement.name)!;
        // The parameter is the procedure's own: saved, set, and restored after the call.
        const parameter = procedure.parameter;
        const saved = parameter === null ? 0 : this.variables.get(parameter)!;
        if (parameter !== null && statement.argument !== null) {
          this.variables.set(parameter, this.number(statement.argument));
        }
        this.depth++;
        yield* this.block(procedure.body);
        this.depth--;
        if (parameter !== null) this.variables.set(parameter, saved);
        return;
      }
    }
  }

  private number(expr: Expr): number {
    return this.expr(expr) as number;
  }

  private expr(expr: Expr): Value {
    const world = this.world;
    switch (expr.kind) {
      case "number":
        return expr.value;
      case "variable":
        return this.variables.get(expr.name)!;
      case "value":
        return expr.name;
      case "arithmetic": {
        const left = this.number(expr.left);
        const right = this.number(expr.right);
        const value = expr.op === "PLUS" ? left + right : expr.op === "MINUS" ? left - right : left * right;
        return Math.max(-999, Math.min(999, value));
      }
      case "sensor": {
        const front = frontOf(world);
        switch (expr.name) {
          case "FRONT": {
            const thing = front.cell?.thing ?? null;
            if (front.cell === null) return "ROCK";
            if (thing === null || (thing.kind === "GATE" && thing.open)) return "FREE";
            return thing.kind;
          }
          case "HERE": {
            const floor = world.cells[world.turtle.y][world.turtle.x].floor;
            return floor === "SAND" || floor === "SEA" ? "NONE" : floor;
          }
          case "COLOUR": {
            const thing = front.cell?.thing ?? null;
            if (thing?.kind === "BOX") return thing.colour;
            if (thing?.kind === "LAMP") return thing.on ? "YELLOW" : "NONE";
            const floor = front.cell?.floor ?? "SAND";
            return floor === "SAND" || floor === "SEA" ? "NONE" : floor;
          }
          case "CARRYING":
            return world.turtle.carrying.length;
          case "TIDE":
            return world.globals.TIDE;
          case "LIGHT":
            return world.globals.LIGHT(world.tick);
        }
        throw new Error(`Unknown sensor ${expr.name}`);
      }
    }
  }

  private cond(cond: Cond): boolean {
    switch (cond.kind) {
      case "not":
        return !this.cond(cond.cond);
      case "and":
        return this.cond(cond.left) && this.cond(cond.right);
      case "or":
        return this.cond(cond.left) || this.cond(cond.right);
      case "compare": {
        const left = this.expr(cond.left);
        const right = this.expr(cond.right);
        switch (cond.op) {
          case "EQUAL":
            return left === right;
          case "NOT_EQUAL":
            return left !== right;
          case "LESS":
            return (left as number) < (right as number);
          case "GREATER":
            return (left as number) > (right as number);
        }
      }
    }
  }
}

/** Run the program on the world (which it changes), one step at a time. */
export function run(program: Program, world: World): Generator<Step> {
  return new Interpreter(program, world).run();
}
