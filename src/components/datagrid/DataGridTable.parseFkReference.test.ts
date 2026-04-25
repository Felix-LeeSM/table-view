/// <reference types="vite/client" />
/**
 * Sprint-89 (#FK-1) — parser contract test.
 *
 * Sprint-88 set this file up as a regression-first test that pinned the
 * "current broken behavior" of `parseFkReference` (inline regex copy +
 * `toBeNull` assertions). Sprint-89 has now (a) exported `parseFkReference`
 * from `DataGridTable.tsx` and (b) aligned the backend so that the wire
 * format is `"<schema>.<table>(<column>)"`. The assertions below were
 * therefore flipped from "returns null" to "returns the parsed object" and
 * the inline regex copy was removed in favour of importing the real
 * production symbol.
 *
 * The fixture-driven block proves both halves of the contract:
 *
 *   1. `format_fk_reference` (Rust) → `expected` string  (cargo test side)
 *   2. `parseFkReference` (TS) → `{ schema, table, column }`  (this file)
 *
 * Together they guarantee the Rust serializer and the TS parser cannot
 * drift again without one or both test suites failing.
 */
import { describe, expect, it } from "vitest";

import { parseFkReference } from "@/components/datagrid/DataGridTable";
// Vite ships JSON imports out of the box, but the project's tsconfig does
// not enable `resolveJsonModule`, so we go through `?raw` and `JSON.parse`
// to keep the strict tsconfig untouched while still loading the fixture
// from a single source of truth (`tests/fixtures/fk_reference_samples.json`).
import fixtureRaw from "../../../tests/fixtures/fk_reference_samples.json?raw";

interface FkReferenceSample {
  name: string;
  schema: string;
  table: string;
  column: string;
  expected: string;
}

interface FkReferenceFixture {
  $schema: string;
  description: string;
  format: string;
  samples: FkReferenceSample[];
}

function loadFixture(): FkReferenceFixture {
  return JSON.parse(fixtureRaw) as FkReferenceFixture;
}

describe("DataGridTable.parseFkReference (contract test, sprint-89)", () => {
  it('parses the canonical "<schema>.<table>(<column>)" form', () => {
    expect(parseFkReference("public.users(id)")).toEqual({
      schema: "public",
      table: "users",
      column: "id",
    });
  });

  it("parses an underscored schema/table/column triple", () => {
    expect(parseFkReference("sales_v2.orders(user_id)")).toEqual({
      schema: "sales_v2",
      table: "orders",
      column: "user_id",
    });
  });

  it("parses identifiers with hyphens and spaces", () => {
    // Greedy `.+` segments still split correctly because the trailing
    // `(...)` block forces the column to land in the third group, leaving
    // the `<schema>.<table>` half to consume the (single) dot.
    expect(parseFkReference("audit-log.events(event id)")).toEqual({
      schema: "audit-log",
      table: "events",
      column: "event id",
    });
  });

  it('returns null on the bare "<table>.<column>" form (no parens)', () => {
    // Pre-sprint-89 backends emitted `"users.id"`; the new contract requires
    // the parenthesised column suffix, so this input must be rejected.
    expect(parseFkReference("users.id")).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(parseFkReference("")).toBeNull();
  });
});

describe("DataGridTable.parseFkReference round-trip vs. shared fixture", () => {
  it("recovers every fixture sample from its serialized form", () => {
    const fixture = loadFixture();
    expect(fixture.samples.length).toBeGreaterThanOrEqual(3);
    for (const sample of fixture.samples) {
      const parsed = parseFkReference(sample.expected);
      expect(parsed, `sample ${sample.name} must parse cleanly`).toEqual({
        schema: sample.schema,
        table: sample.table,
        column: sample.column,
      });
    }
  });
});
