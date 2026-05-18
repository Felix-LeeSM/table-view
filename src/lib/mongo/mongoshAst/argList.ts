// Sprint 384 (2026-05-17) — shared argument-list parser.
//
// 작성 이유: sprint-383 (review note 2) 가 `parseCollectionCommand` 의
// main arg-list 와 chain-arg loop 가 동일 `(arg1, arg2, ...)` 셰이프를
// share 하기 위해 도입한 helper. 본 sprint 가 mongoshAst.ts split 시
// 별도 파일로 끌어낸다. `parseValue` 가 parser.ts 안에 있고
// parser.ts 는 본 모듈을 import 하므로 *injection* (parseValue 를 인자로
// 받음) 패턴으로 circular import 를 피한다.

import {
  TokenStream,
  describeToken,
  err,
  type MongoshParseError,
} from "./lexer";

export type ParseValueResult =
  | { kind: "ok"; value: unknown }
  | { kind: "error"; error: MongoshParseError };

export type ParseValueFn = (stream: TokenStream) => ParseValueResult;

export function parseArgList(
  stream: TokenStream,
  methodName: string,
  parseValue: ParseValueFn,
):
  | { kind: "ok"; value: unknown[] }
  | { kind: "error"; error: MongoshParseError } {
  if (!stream.consumePunct("(")) {
    return {
      kind: "error",
      error: err(
        "unsupported-syntax",
        `expected \`(\` after method \`${methodName}\``,
      ),
    };
  }
  const args: unknown[] = [];
  if (stream.consumePunct(")")) {
    return { kind: "ok", value: args };
  }
  while (true) {
    const value = parseValue(stream);
    if (value.kind === "error") return { kind: "error", error: value.error };
    args.push(value.value);
    if (stream.consumePunct(",")) {
      // Tolerate trailing comma before `)`.
      if (stream.consumePunct(")")) return { kind: "ok", value: args };
      continue;
    }
    if (stream.consumePunct(")")) return { kind: "ok", value: args };
    const stray = stream.peek();
    return {
      kind: "error",
      error: err(
        "unsupported-syntax",
        stray
          ? `expected \`,\` or \`)\` in argument list, got \`${describeToken(stray)}\``
          : "unterminated argument list",
      ),
    };
  }
}
