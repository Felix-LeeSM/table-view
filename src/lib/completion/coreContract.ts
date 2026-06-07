export type CompletionLanguage = "sql" | "mongosh";

export type SqlCompletionState =
  | "StatementStart"
  | "SelectList"
  | "RelationName"
  | "DatabaseName"
  | "ColumnRef"
  | "FunctionRef"
  | "InsertColumns"
  | "UpdateSetTarget"
  | "OrderByExpr"
  | "ShellMeta"
  | "Unsupported";

export type CompletionItemKind =
  | "keyword"
  | "database"
  | "schema"
  | "table"
  | "view"
  | "column"
  | "function"
  | "operator"
  | "snippet"
  | "meta-command"
  | "hint";

export interface CompletionCursorOffsets {
  utf16: number;
  utf8: number;
}

export interface CompletionReplaceRange {
  from: CompletionCursorOffsets;
  to: CompletionCursorOffsets;
}

export interface CompletionItem {
  label: string;
  kind: CompletionItemKind;
  apply?: string;
  detail?: string;
  boost?: number;
  runtimeExecutable?: boolean;
}

export interface CompletionResultMetadata {
  engine: "ts" | "wasm";
  dialect?: string;
  shell?: string;
  catalogRevision?: string;
  completionState?: SqlCompletionState;
}

export interface CompletionResult {
  items: readonly CompletionItem[];
  replaceRange: CompletionReplaceRange;
  incomplete: boolean;
  metadata: CompletionResultMetadata;
}

export function completionCursorOffsets(
  text: string,
  cursorUtf16: number,
): CompletionCursorOffsets {
  assertUtf16Offset(text, cursorUtf16);
  return {
    utf16: cursorUtf16,
    utf8: utf8ByteOffsetFromUtf16(text, cursorUtf16),
  };
}

export function completionReplaceRange(
  text: string,
  fromUtf16: number,
  toUtf16: number,
): CompletionReplaceRange {
  if (fromUtf16 > toUtf16) {
    throw new RangeError("completion replace range start must be <= end");
  }
  return {
    from: completionCursorOffsets(text, fromUtf16),
    to: completionCursorOffsets(text, toUtf16),
  };
}

export function utf8ByteOffsetFromUtf16(
  text: string,
  cursorUtf16: number,
): number {
  assertUtf16Offset(text, cursorUtf16);
  return new TextEncoder().encode(text.slice(0, cursorUtf16)).byteLength;
}

function assertUtf16Offset(text: string, cursorUtf16: number): void {
  if (!Number.isInteger(cursorUtf16)) {
    throw new RangeError("completion cursor must be an integer UTF-16 offset");
  }
  if (cursorUtf16 < 0 || cursorUtf16 > text.length) {
    throw new RangeError("completion cursor is outside the text buffer");
  }
}
