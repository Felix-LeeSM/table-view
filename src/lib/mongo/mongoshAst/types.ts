// Sprint 401 (2026-05-17) — public types for the mongosh AST.
//
// 작성 이유: sprint-384 의 4-file split 에서 본 타입들이 `lexer.ts` 에 있었으나,
// sprint-401 가 lexer / parser / argList 를 Rust+WASM 로 옮기면서 TS-side
// 타입만 따로 분리. WASM module 의 `parse_mongosh` 반환 shape 와 1:1
// 매칭되며, Rust crate (`src-tauri/mongosh-parser-core/src/ast.rs`) 의
// `MongoshStatement` 와 `MongoshErrorKind` enum 을 mirror 한다.

export type MongoshErrorKind =
  | "unsupported-syntax"
  | "bson-literal"
  | "multiple-statements"
  | "variable-declaration"
  | "function-declaration"
  | "non-db-statement";

export interface MongoshAdminCommand {
  readonly kind: "admin-command";
  /** `runCommand` 또는 `adminCommand`. caller 가 dispatch 분기에 사용. */
  readonly commandName: "runCommand" | "adminCommand";
  /** 본문 (`{<command>: <arg>, ...options}`). JSON-compatible. */
  readonly body: Record<string, unknown>;
}

export interface MongoshCollectionCommand {
  readonly kind: "collection-command";
  readonly collection: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface MongoshParseError {
  readonly kind: "error";
  readonly errorKind: MongoshErrorKind;
  readonly message: string;
}

export type MongoshStatementResult =
  | MongoshAdminCommand
  | MongoshCollectionCommand
  | MongoshParseError;
