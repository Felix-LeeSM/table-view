import { describe, it, expect } from "vitest";
import { assertNever } from "./paradigm";

describe("assertNever", () => {
  it("throws when called at runtime with an unexpected value", () => {
    // We intentionally bypass the never type to simulate a runtime fallthrough,
    // which mirrors what would happen if a server payload carried an unknown
    // paradigm string after the type union was stale.
    expect(() => assertNever("kafka" as never)).toThrow(
      /unhandled paradigm value/,
    );
  });

  it("includes the unexpected value in the thrown message", () => {
    expect(() => assertNever("graph" as never)).toThrow(/graph/);
  });
});
