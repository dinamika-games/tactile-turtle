// The parser of the tile language (DESIGN.md, section 3).
//
// The program is a stream of tokens; rows mean nothing. Blocks are closed
// with END:
//
//   program   := statement*
//   statement := FORWARD | LEFT | RIGHT | PICK_UP | DROP | SWITCH | USE | WAIT
//              | PAINT expr
//              | (★ | ●) expr?                           (call; with a number if it has a parameter)
//              | var ← expr
//              | REPEAT expr statement* END
//              | WHILE cond statement* END
//              | IF cond statement* (ELSE statement*)? END
//              | FOR var ← expr TO expr statement* END
//              | DEFINE (★ | ●) var? statement* END     (only at the top; var: the parameter)
//   cond      := and (OR and)*
//   and       := not (AND not)*
//   not       := NOT not | expr (= | ≠ | < | >) expr
//   expr      := term ((+ | −) term)*
//   term      := atom (× atom)*
//   atom      := number | var | sensor | value
//
// An expression ends where the next token is not an operator, so that
// statements need no separator: "a ← 3 FORWARD" is two statements.

import type { Token } from "./tokens.ts";

export type Type = "number" | "colour" | "thing";

export type Expr =
  | { kind: "number"; value: number; token: Token }
  | { kind: "variable"; name: string; token: Token }
  | { kind: "sensor"; name: string; token: Token }
  | { kind: "value"; name: string; token: Token }
  | { kind: "arithmetic"; op: "PLUS" | "MINUS" | "TIMES"; left: Expr; right: Expr; token: Token };

export type Cond =
  | { kind: "compare"; op: "EQUAL" | "NOT_EQUAL" | "LESS" | "GREATER"; left: Expr; right: Expr; token: Token }
  | { kind: "not"; cond: Cond; token: Token }
  | { kind: "and" | "or"; left: Cond; right: Cond; token: Token };

export type Action = "FORWARD" | "LEFT" | "RIGHT" | "PICK_UP" | "DROP" | "SWITCH" | "USE" | "WAIT";

export type Statement =
  | { kind: "action"; action: Action; token: Token }
  | { kind: "paint"; colour: Expr; token: Token }
  | { kind: "call"; name: "STAR" | "DOT"; argument: Expr | null; token: Token }
  | { kind: "assign"; variable: string; expr: Expr; token: Token }
  | { kind: "repeat"; count: Expr; body: Statement[]; token: Token }
  | { kind: "while"; cond: Cond; body: Statement[]; token: Token }
  | { kind: "if"; cond: Cond; then: Statement[]; otherwise: Statement[] | null; token: Token }
  | { kind: "for"; variable: string; from: Expr; to: Expr; body: Statement[]; token: Token }
  | { kind: "define"; name: "STAR" | "DOT"; parameter: string | null; body: Statement[]; token: Token };

/** A procedure: its parameter (a variable of its own, or none) and its body. */
export interface Procedure {
  readonly parameter: string | null;
  readonly body: Statement[];
}

export interface Program {
  readonly statements: Statement[];
  readonly procedures: Map<"STAR" | "DOT", Procedure>;
}

/**
 * An error, with the token to point at (null: the end of the program).
 * The message is in English; ``code`` and ``params`` let the game translate it.
 */
export class ParseError extends Error {
  readonly code: string;
  readonly params: Record<string, string>;
  readonly token: Token | null;

  constructor(code: string, message: string, token: Token | null, params: Record<string, string> = {}) {
    super(message);
    this.code = code;
    this.params = params;
    this.token = token;
  }
}

const ACTIONS = new Set<string>(["FORWARD", "LEFT", "RIGHT", "PICK_UP", "DROP", "SWITCH", "USE", "WAIT"]);
const SENSOR_TYPES: Record<string, Type> = {
  FRONT: "thing",
  HERE: "colour",
  COLOUR: "colour",
  CARRYING: "number",
  TIDE: "number",
  LIGHT: "colour",
};
const VALUE_TYPES: Record<string, Type> = {
  RED: "colour",
  GREEN: "colour",
  BLUE: "colour",
  YELLOW: "colour",
  ROCK: "thing",
  HATCHLING: "thing",
  BOX: "thing",
  LAMP: "thing",
  GATE: "thing",
  // FREE: nothing in the way (a thing); NONE: no colour (a colour).
  FREE: "thing",
  NONE: "colour",
};

const COMPARISONS = new Set(["EQUAL", "NOT_EQUAL", "LESS", "GREATER"]);

function describe(token: Token | null): string {
  if (token === null) return "the end of the program";
  return token.kind.group === "number" ? String(token.value) : (token.kind.symbol ?? token.kind.key);
}

export function typeOf(expr: Expr): Type {
  switch (expr.kind) {
    case "number":
    case "variable":
    case "arithmetic":
      return "number";
    case "sensor":
      return SENSOR_TYPES[expr.name];
    case "value":
      return VALUE_TYPES[expr.name];
  }
}

function comparable(left: Type, right: Type): boolean {
  return left === right;
}

class Parser {
  private position = 0;
  private readonly tokens: readonly Token[];

  /** The procedures that take a parameter (known before the calls are parsed). */
  private readonly withParameter = new Set<string>();

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
    tokens.forEach((token, i) => {
      if (token.kind.key === "DEFINE" && hasParameter(tokens, i + 1)) this.withParameter.add(tokens[i + 1].kind.key);
    });
  }

  private peek(): Token | null {
    return this.tokens[this.position] ?? null;
  }

  private next(): Token | null {
    const token = this.peek();
    if (token !== null) this.position++;
    return token;
  }

  private isKey(token: Token | null, ...keys: string[]): boolean {
    return token !== null && keys.includes(token.kind.key);
  }

  parseProgram(): Program {
    const statements: Statement[] = [];
    while (this.peek() !== null) {
      if (this.isKey(this.peek(), "END", "ELSE")) {
        const token = this.peek()!;
        throw new ParseError(
          "unexpected_close",
          `This ${describe(token)} closes nothing: there is no REPEAT, WHILE, IF, FOR or DEFINE open.`,
          token,
          { tile: describe(token) },
        );
      }
      statements.push(this.parseStatement(true));
    }

    const procedures = new Map<"STAR" | "DOT", Procedure>();
    for (const statement of statements) {
      if (statement.kind === "define") {
        if (procedures.has(statement.name)) {
          throw new ParseError(
            "defined_twice",
            `${describe(statement.token)} is defined twice.`,
            statement.token,
          );
        }
        procedures.set(statement.name, { parameter: statement.parameter, body: statement.body });
      }
    }
    checkCalls(statements, procedures);
    return { statements, procedures };
  }

  /** Statements up to (not including) END or ELSE. */
  private parseBlock(opener: Token): Statement[] {
    const body: Statement[] = [];
    for (;;) {
      const token = this.peek();
      if (token === null) {
        throw new ParseError(
          "missing_end",
          `This ${describe(opener)} needs an END.`,
          opener,
          { tile: describe(opener) },
        );
      }
      if (this.isKey(token, "END", "ELSE")) return body;
      body.push(this.parseStatement(false));
    }
  }

  private expectEnd(opener: Token): void {
    const token = this.next();
    if (!this.isKey(token, "END")) {
      throw new ParseError(
        "missing_end",
        `This ${describe(opener)} needs an END.`,
        token ?? opener,
        { tile: describe(opener) },
      );
    }
  }

  private parseStatement(topLevel: boolean): Statement {
    const token = this.next()!;
    const key = token.kind.key;

    if (ACTIONS.has(key)) {
      return { kind: "action", action: key as Action, token };
    }

    switch (key) {
      case "PAINT": {
        const colour = this.parseExpr(token, "PAINT needs a colour.");
        const type = typeOf(colour);
        if (type !== "colour") {
          throw new ParseError("paint_colour", "PAINT needs a colour.", colour.token);
        }
        return { kind: "paint", colour, token };
      }
      case "STAR":
      case "DOT": {
        const argument = this.withParameter.has(key)
          ? this.parseNumber(token, `${describe(token)} needs a number.`)
          : null;
        return { kind: "call", name: key, argument, token };
      }
      case "a":
      case "b":
      case "c": {
        const arrow = this.next();
        if (!this.isKey(arrow, "ASSIGN")) {
          throw new ParseError(
            "variable_alone",
            `After the variable ${key}, I need ← and a value.`,
            arrow ?? token,
            { variable: key },
          );
        }
        const expr = this.parseNumber(arrow!, `After ←, I need a number.`);
        return { kind: "assign", variable: key, expr, token };
      }
      case "REPEAT": {
        const count = this.parseNumber(token, "After REPEAT, I need a number.");
        const body = this.parseBlock(token);
        this.expectEnd(token);
        return { kind: "repeat", count, body, token };
      }
      case "WHILE": {
        const cond = this.parseCond(token);
        const body = this.parseBlock(token);
        this.expectEnd(token);
        return { kind: "while", cond, body, token };
      }
      case "IF": {
        const cond = this.parseCond(token);
        const then = this.parseBlock(token);
        let otherwise: Statement[] | null = null;
        if (this.isKey(this.peek(), "ELSE")) {
          this.next();
          otherwise = this.parseBlock(token);
        }
        this.expectEnd(token);
        return { kind: "if", cond, then, otherwise, token };
      }
      case "FOR": {
        const variable = this.next();
        if (variable === null || variable.kind.group !== "variable") {
          throw new ParseError("for_variable", "After FOR, I need a variable (a, b or c).", variable ?? token);
        }
        const arrow = this.next();
        if (!this.isKey(arrow, "ASSIGN")) {
          throw new ParseError("for_assign", `After FOR ${variable.kind.key}, I need ←.`, arrow ?? variable);
        }
        const from = this.parseNumber(arrow!, "After ←, I need a number.");
        const to = this.next();
        if (!this.isKey(to, "TO")) {
          throw new ParseError("for_to", "FOR needs TO and the last number.", to ?? token);
        }
        const last = this.parseNumber(to!, "After TO, I need a number.");
        const body = this.parseBlock(token);
        this.expectEnd(token);
        return { kind: "for", variable: variable.kind.key, from, to: last, body, token };
      }
      case "DEFINE": {
        if (!topLevel) {
          throw new ParseError("define_nested", "DEFINE cannot be inside another block.", token);
        }
        const name = this.next();
        if (!this.isKey(name, "STAR", "DOT")) {
          throw new ParseError("define_name", "After DEFINE, I need ★ or ●.", name ?? token);
        }
        // DEFINE ★ a: a is the parameter, unless the body starts with "a ←".
        const parameter = hasParameter(this.tokens, this.position - 1) ? this.next()!.kind.key : null;
        const body = this.parseBlock(token);
        this.expectEnd(token);
        return { kind: "define", name: name!.kind.key as "STAR" | "DOT", parameter, body, token };
      }
    }

    throw new ParseError(
      "unexpected",
      `A statement cannot start with ${describe(token)}.`,
      token,
      { tile: describe(token) },
    );
  }

  private parseNumber(after: Token, message: string): Expr {
    const expr = this.parseExpr(after, message);
    if (typeOf(expr) !== "number") {
      throw new ParseError("need_number", message, expr.token);
    }
    return expr;
  }

  private parseExpr(after: Token, message: string): Expr {
    let left = this.parseTerm(after, message);
    while (this.isKey(this.peek(), "PLUS", "MINUS")) {
      const op = this.next()!;
      const right = this.parseTerm(op, `After ${describe(op)}, I need a number.`);
      this.checkArithmetic(left, right, op);
      left = { kind: "arithmetic", op: op.kind.key as "PLUS" | "MINUS", left, right, token: op };
    }
    return left;
  }

  private parseTerm(after: Token, message: string): Expr {
    let left = this.parseAtom(after, message);
    while (this.isKey(this.peek(), "TIMES")) {
      const op = this.next()!;
      const right = this.parseAtom(op, `After ×, I need a number.`);
      this.checkArithmetic(left, right, op);
      left = { kind: "arithmetic", op: "TIMES", left, right, token: op };
    }
    return left;
  }

  private checkArithmetic(left: Expr, right: Expr, op: Token): void {
    if (typeOf(left) !== "number" || typeOf(right) !== "number") {
      throw new ParseError("arithmetic_type", `${describe(op)} works only with numbers.`, op);
    }
  }

  private parseAtom(after: Token, message: string): Expr {
    const token = this.peek();
    if (token === null) throw new ParseError("need_value", message, after);
    switch (token.kind.group) {
      case "number":
        this.next();
        return { kind: "number", value: token.value!, token };
      case "variable":
        this.next();
        return { kind: "variable", name: token.kind.key, token };
      case "sensor":
        this.next();
        return { kind: "sensor", name: token.kind.key, token };
      case "value":
        this.next();
        return { kind: "value", name: token.kind.key, token };
    }
    throw new ParseError("need_value", message, token);
  }

  private parseCond(opener: Token): Cond {
    let left = this.parseAnd(opener);
    while (this.isKey(this.peek(), "OR")) {
      const op = this.next()!;
      const right = this.parseAnd(op);
      left = { kind: "or", left, right, token: op };
    }
    return left;
  }

  private parseAnd(opener: Token): Cond {
    let left = this.parseNot(opener);
    while (this.isKey(this.peek(), "AND")) {
      const op = this.next()!;
      const right = this.parseNot(op);
      left = { kind: "and", left, right, token: op };
    }
    return left;
  }

  private parseNot(opener: Token): Cond {
    if (this.isKey(this.peek(), "NOT")) {
      const token = this.next()!;
      return { kind: "not", cond: this.parseNot(token), token };
    }
    const message = `After ${describe(opener)}, I need a comparison, e.g. FRONT = ROCK.`;
    const left = this.parseExpr(opener, message);
    const op = this.peek();
    if (op === null || !COMPARISONS.has(op.kind.key)) {
      throw new ParseError("need_comparison", message, op ?? left.token);
    }
    this.next();
    const right = this.parseExpr(op, `After ${describe(op)}, I need a value.`);
    const opKey = op.kind.key as "EQUAL" | "NOT_EQUAL" | "LESS" | "GREATER";
    const leftType = typeOf(left);
    const rightType = typeOf(right);
    if (opKey === "LESS" || opKey === "GREATER") {
      if (leftType !== "number" || rightType !== "number") {
        throw new ParseError("order_type", `${describe(op)} works only with numbers.`, op);
      }
    } else if (!comparable(leftType, rightType)) {
      throw new ParseError(
        "compare_types",
        `I can't compare a ${leftType} with a ${rightType}.`,
        op,
        { left: leftType, right: rightType },
      );
    }
    return { kind: "compare", op: opKey, left, right, token: op };
  }
}

/** Is the procedure name at ``index`` followed by a parameter (a variable, not "a ←")? */
function hasParameter(tokens: readonly Token[], index: number): boolean {
  const name = tokens[index];
  const variable = tokens[index + 1];
  const after = tokens[index + 2];
  return (
    name !== undefined &&
    (name.kind.key === "STAR" || name.kind.key === "DOT") &&
    variable !== undefined &&
    variable.kind.group === "variable" &&
    after?.kind.key !== "ASSIGN"
  );
}

function checkCalls(statements: readonly Statement[], procedures: Map<string, Procedure>): void {
  for (const statement of statements) {
    switch (statement.kind) {
      case "call":
        if (!procedures.has(statement.name)) {
          throw new ParseError(
            "undefined_procedure",
            `${describe(statement.token)} is called but never defined.`,
            statement.token,
          );
        }
        break;
      case "repeat":
      case "while":
      case "for":
      case "define":
        checkCalls(statement.body, procedures);
        break;
      case "if":
        checkCalls(statement.then, procedures);
        if (statement.otherwise !== null) checkCalls(statement.otherwise, procedures);
        break;
    }
  }
}

export function parse(tokens: readonly Token[]): Program {
  return new Parser(tokens).parseProgram();
}
