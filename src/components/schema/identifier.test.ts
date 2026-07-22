// Purpose: SQL identifier validation matrix — issue #1626 test pushdown
// (2026-07-22). RenameTableDialog.test.tsx + AddColumnDialog.test.tsx
// each re-asserted the SAME reject matrix (space / quote / leading-digit
// / >63 bytes / NULL / empty) against their own copy of the validator
// (P1 drift, 2026-07-17 test audit). The validator is now one shared
// util (identifier.ts); this file owns the full matrix once. The dialogs
// keep only a representative wire-up case (invalid -> error + Apply
// disabled).

import { describe, it, expect } from "vitest";
import { validateIdentifier, IDENTIFIER_MAX_BYTES } from "./identifier";

describe("validateIdentifier", () => {
  // Reason: rejection matrix — every invalid class the two schema
  // dialogs previously re-asserted, verified once here (#1626,
  // 2026-07-22). Table-driven: a new invalid class is one row.
  const rejected: ReadonlyArray<readonly [string, string, RegExp]> = [
    ["embedded space", "bad name", /letter or underscore/],
    ["embedded double-quote", 'bad"name', /letter or underscore/],
    ["leading digit", "1bad", /letter or underscore/],
    ["embedded NULL byte", "bad\0name", /letter or underscore/],
    [">63 bytes (ASCII)", "a".repeat(64), /must not exceed 63 bytes/],
    ["empty string", "", /must not be empty/],
    ["whitespace-only (trims to empty)", "   ", /must not be empty/],
  ];

  it.each(rejected)(
    "rejects %s with the labelled message",
    (_label, input, message) => {
      expect(validateIdentifier(input, "Table name")).toMatch(message);
    },
  );

  // Reason: the >63 gate is UTF-8 byte length via TextEncoder, not char
  // length — a multibyte name can pass a char count yet exceed 63 bytes.
  // Guards the encode-before-measure branch (regression: reverting to
  // `.length` would let this through).
  it("measures the byte limit in UTF-8, not characters", () => {
    const multibyte = "€".repeat(22); // 22 chars, 66 bytes
    expect(new TextEncoder().encode(multibyte).length).toBeGreaterThan(
      IDENTIFIER_MAX_BYTES,
    );
    expect(validateIdentifier(multibyte, "Table name")).toMatch(
      /must not exceed 63 bytes/,
    );
  });

  // Reason: `label` prefixes every message so one impl serves both the
  // Rename ("Table name") and AddColumn ("Column name") dialogs — this
  // is the dedup that removes the P1 drift, so pin the exact strings.
  it("prefixes each message with the caller-supplied label", () => {
    expect(validateIdentifier("", "Column name")).toBe(
      "Column name must not be empty",
    );
    expect(validateIdentifier("a".repeat(64), "Column name")).toBe(
      "Column name must not exceed 63 bytes",
    );
    expect(validateIdentifier("1bad", "Column name")).toBe(
      "Column name must start with a letter or underscore and contain only alphanumeric characters and underscores",
    );
  });

  // Reason: acceptance — valid identifiers return null. Trim is part of
  // the contract (surrounding whitespace must not fail a valid name) and
  // exactly 63 bytes is the inclusive boundary.
  it.each([
    ["simple lowercase", "users"],
    ["leading underscore", "_private"],
    ["alphanumeric + underscore", "col_1_x"],
    ["surrounding whitespace trimmed", "  users  "],
    ["exactly 63 bytes (boundary)", "a".repeat(63)],
  ])("accepts %s (returns null)", (_label, input) => {
    expect(validateIdentifier(input, "Table name")).toBeNull();
  });
});
