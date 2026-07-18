import { describe, expect, it } from "vitest";
import {
  analyzeKvMutationSafety,
  buildStreamAddMutation,
  buildStreamDeleteMutation,
  buildStreamTrimMutation,
} from "./kvMutationCommands";

// Purpose: stream write command mapping (PR5b, #1683) — the pure boundary that
// turns the append-only XADD / XDEL / XTRIM verbs into the exact command string
// and its Safe Mode tier. Streams have no in-place entry-field edit, so these
// three are the whole write vocabulary. This is the lowest layer where the
// preview==execution invariant and the injection quoting live.

describe("buildStreamAddMutation", () => {
  it("maps id + field-value pairs to a single XADD command (preview == execution)", () => {
    const mutation = buildStreamAddMutation("events", "*", [
      { field: "type", value: "login" },
      { field: "user", value: "ada" },
    ]);
    expect(mutation.kind).toBe("command");
    expect(mutation.command).toBe("XADD events * type login user ada");
    // Append is a non-destructive write — never flagged destructive.
    expect(mutation.destructive).toBeUndefined();
    expect(mutation.summary).toBe(mutation.command);
  });

  it("accepts an explicit entry id alongside the * default", () => {
    const mutation = buildStreamAddMutation("events", "1526919030474-0", [
      { field: "k", value: "v" },
    ]);
    expect(mutation.command).toBe("XADD events 1526919030474-0 k v");
  });

  // Injection guard — a field name or value with whitespace / a verb-like word
  // is quoted+escaped by redisToken so it can never split into extra command
  // tokens (each token is `.arg()`-encoded individually in the backend).
  it("quotes operands containing whitespace so they stay one token each", () => {
    const mutation = buildStreamAddMutation("s", "*", [
      { field: "full name", value: "drop table; FLUSHALL x" },
    ]);
    expect(mutation.command).toBe(
      'XADD s * "full name" "drop table; FLUSHALL x"',
    );
  });
});

describe("buildStreamDeleteMutation / buildStreamTrimMutation", () => {
  it("maps an entry id to a destructive XDEL", () => {
    const mutation = buildStreamDeleteMutation("events", "1-0");
    expect(mutation.command).toBe("XDEL events 1-0");
    expect(mutation.destructive).toBe(true);
    expect(mutation.summary).toBe(mutation.command);
  });

  it("maps a max length to a destructive XTRIM MAXLEN, count emitted raw", () => {
    const mutation = buildStreamTrimMutation("events", 100);
    expect(mutation.command).toBe("XTRIM events MAXLEN 100");
    expect(mutation.destructive).toBe(true);
  });
});

describe("analyzeKvMutationSafety — stream tiers", () => {
  // XADD is a warn-tier write (production still confirms via the gate); XDEL and
  // XTRIM lose data so they take the danger tier, same as key delete.
  it("classifies XADD as warn and XDEL/XTRIM as danger", () => {
    expect(
      analyzeKvMutationSafety(
        buildStreamAddMutation("s", "*", [{ field: "a", value: "b" }]),
        "s",
      ).severity,
    ).toBe("warn");
    expect(
      analyzeKvMutationSafety(buildStreamDeleteMutation("s", "1-0"), "s")
        .severity,
    ).toBe("danger");
    expect(
      analyzeKvMutationSafety(buildStreamTrimMutation("s", 10), "s").severity,
    ).toBe("danger");
  });
});
