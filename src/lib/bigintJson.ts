// Issue #1307 — global BigInt JSON serialization patch.
//
// ADR 0026 promotes precision-sensitive integer cells to `BigInt` uniformly
// (see `numericWrap.ts`). Native `JSON.stringify` throws
// `TypeError: Do not know how to serialize a BigInt`, and that throw fires
// deep inside react-dom's dev-build render logging (`logComponentRender` →
// `JSON.stringify(props)`), which runs in the commit phase — no ErrorBoundary
// can catch it, so a table with BigInt cells freezes the whole app.
//
// Defining `BigInt.prototype.toJSON` makes every `JSON.stringify` path
// (react-dom internals included) emit the decimal string form instead of
// throwing — the exact representation ADR 0026's wire format already uses.
// A global prototype patch is a legitimate choice here because this is the
// application entrypoint, not a library: we own the runtime and no consumer
// can be surprised by the augmentation.
//
// The existing precise-serialization paths (`safeStringifyCell` /
// `bigIntDecimalReplacer` in `jsonCell.ts`) stay — they give callers explicit
// control (e.g. wire round-trips); this patch is only the last-resort default
// for stringify sites we don't own.

declare global {
  interface BigInt {
    toJSON(): string;
  }
}

// Guard: install once, tolerate re-import under test / HMR.
if (typeof BigInt.prototype.toJSON !== "function") {
  BigInt.prototype.toJSON = function (this: bigint): string {
    return this.toString();
  };
}

export {};
