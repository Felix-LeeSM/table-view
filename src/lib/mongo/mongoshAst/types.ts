// 2026-05-17 — public types for the mongosh AST.
//
// Reason: these types used to live in `lexer.ts`; when the lexer / parser /
// argList moved to Rust+WASM, only the TS-side types were split out. They
// match the shape that `parse_mongosh` in the WASM module returns 1:1 and
// mirror the `MongoshStatement` and `MongoshErrorKind` enums of the Rust
// crate (`src-tauri/mongosh-parser-core/src/ast.rs`).

export type MongoshErrorKind =
  | "unsupported-syntax"
  | "bson-literal"
  | "multiple-statements"
  | "variable-declaration"
  | "function-declaration"
  | "non-db-statement";

export interface MongoshAdminCommand {
  readonly kind: "admin-command";
  /** `runCommand` or `adminCommand`. */
  readonly commandName: "runCommand" | "adminCommand";
  /** The body (`{<command>: <arg>, ...options}`). JSON-compatible. */
  readonly body: Record<string, unknown>;
}

export interface MongoshCollectionCommand {
  readonly kind: "collection-command";
  readonly collection: string;
  readonly method: string;
  readonly args: readonly unknown[];
  readonly cursorChain?: readonly CursorChainStep[];
}

export interface CursorChainStep {
  readonly name: string;
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
