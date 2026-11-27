import { describe, expect, it } from "vitest";

import { parse, ParseError } from "../src/lang/parser.ts";
import { tokenizeText } from "../src/lang/tokens.ts";
import en from "../i18n/en.json" with { type: "json" };

function parseText(text: string) {
  return parse(tokenizeText(text));
}

function errorOf(text: string): ParseError {
  try {
    parseText(text);
  } catch (error) {
    if (error instanceof ParseError) return error;
    throw error;
  }
  throw new Error(`No error for: ${text}`);
}

describe("the parser", () => {
  it("reads statements without separators", () => {
    const program = parseText("a ← 3 FORWARD REPEAT a LEFT END");
    expect(program.statements.map((statement) => statement.kind)).toEqual([
      "assign",
      "action",
      "repeat",
    ]);
  });

  it("joins digits within a word into one number", () => {
    const program = parseText("REPEAT 12 FORWARD END");
    const repeat = program.statements[0];
    expect(repeat.kind === "repeat" && repeat.count.kind === "number" && repeat.count.value).toBe(12);
  });

  it("does not care about rows", () => {
    expect(parseText("REPEAT 4\nFORWARD\nEND")).toEqual(
      expect.objectContaining({ statements: expect.any(Array) }),
    );
  });

  it("reads IF with ELSE and nested blocks", () => {
    const program = parseText("IF FRONT = ROCK LEFT ELSE IF HERE = RED RIGHT END FORWARD END");
    const statement = program.statements[0];
    expect(statement.kind).toBe("if");
    if (statement.kind === "if") {
      expect(statement.then).toHaveLength(1);
      expect(statement.otherwise?.map((s) => s.kind)).toEqual(["if", "action"]);
    }
  });

  it("gives AND precedence over OR", () => {
    const statement = parseText("IF a = 1 OR a = 2 AND b = 3 WAIT END").statements[0];
    expect(statement.kind === "if" && statement.cond.kind).toBe("or");
  });

  it("knows procedures", () => {
    const program = parseText("DEFINE ★ LEFT LEFT END ★ ★");
    expect(program.procedures.get("STAR")).toMatchObject({ parameter: null, body: [{}, {}] });
  });

  it("knows procedures with a parameter", () => {
    const program = parseText("DEFINE ★ a REPEAT a FORWARD END END ★ 3 ★ 2 + 1");
    expect(program.procedures.get("STAR")?.parameter).toBe("a");
    expect(program.statements.filter((s) => s.kind === "call")).toHaveLength(2);
  });

  it("does not take an assignment for a parameter", () => {
    const program = parseText("DEFINE ★ a ← 2 END ★");
    expect(program.procedures.get("STAR")?.parameter).toBeNull();
  });

  it.each([
    ["REPEAT 3 FORWARD", "missing_end"],
    ["FORWARD END", "unexpected_close"],
    ["REPEAT FORWARD END", "need_value"],
    ["REPEAT RED FORWARD END", "need_number"],
    ["IF FRONT LEFT END", "need_comparison"],
    ["IF FRONT = 3 LEFT END", "compare_types"],
    ["IF HERE < RED LEFT END", "order_type"],
    ["IF HERE = FREE LEFT END", "compare_types"],
    ["IF FRONT = NONE LEFT END", "compare_types"],
    ["PAINT ROCK", "paint_colour"],
    ["a FORWARD", "variable_alone"],
    ["★", "undefined_procedure"],
    ["REPEAT 2 DEFINE ★ LEFT END END", "define_nested"],
    ["DEFINE ★ LEFT END DEFINE ★ RIGHT END", "defined_twice"],
    ["= 3", "unexpected"],
    ["DEFINE ★ a FORWARD END ★", "need_value"],
    ["DEFINE ★ a FORWARD END ★ RED", "need_number"],
    ["a ← 1 + RED", "arithmetic_type"],
    ["FOR 3", "for_variable"],
    ["FOR a 3", "for_assign"],
    ["FOR a ← 1 3", "for_to"],
    ["FOR a ← 1 TO", "need_value"],
    ["DEFINE FORWARD END", "define_name"],
    ["IF FRONT = LEFT END", "need_value"],
  ])("explains %j with %s, in every language", (text, code) => {
    const error = errorOf(text);
    expect(error.code).toBe(code);
    // The sentence to translate it, with a {placeholder} for every param.
    const sentence = (en.texts as Record<string, string>)[`error.${error.text}`];
    expect(sentence).toBeTypeOf("string");
    expect([...sentence.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()).toEqual(Object.keys(error.params).sort());
  });

  it("points at the tile of the error", () => {
    const error = errorOf("FORWARD\nREPEAT 2 LEFT");
    expect(error.token?.kind.key).toBe("REPEAT");
    expect(error.token?.row).toBe(1);
  });

  it("accepts ASCII spellings", () => {
    expect(() => parseText("a <- 2 IF a != 3 AND a == 2 b <- a * 2 - 1 END")).not.toThrow();
  });
});
