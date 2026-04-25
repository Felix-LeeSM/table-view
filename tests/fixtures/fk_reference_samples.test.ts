/**
 * Sprint-88 AC-01: TS-side proof that `tests/fixtures/fk_reference_samples.json`
 * is loadable from vitest. The companion Rust integration test
 * (`src-tauri/tests/fixture_loading.rs`) proves the same file is also loadable
 * from `cargo test` via `include_str!`.
 *
 * sprint-89 (#FK-1) will reuse the same fixture to drive the parser/serializer
 * round-trip without duplicating sample data on either side.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fk_reference_samples.json",
);

function loadFixture(): FkReferenceFixture {
  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as FkReferenceFixture;
}

describe("fk_reference_samples.json (TS loader)", () => {
  it("loads via readFileSync + JSON.parse", () => {
    const fixture = loadFixture();
    expect(fixture.$schema).toBe("fk_reference_samples@1");
    expect(fixture.format).toBe("<schema>.<table>(<column>)");
  });

  it("contains at least 3 sample pairs (input + expected serialization)", () => {
    const fixture = loadFixture();
    expect(fixture.samples.length).toBeGreaterThanOrEqual(3);
    for (const sample of fixture.samples) {
      expect(sample.schema).toBeTypeOf("string");
      expect(sample.table).toBeTypeOf("string");
      expect(sample.column).toBeTypeOf("string");
      expect(sample.expected).toBe(
        `${sample.schema}.${sample.table}(${sample.column})`,
      );
    }
  });

  it("includes a special-character / boundary case sample", () => {
    const fixture = loadFixture();
    const hasSpecial = fixture.samples.some(
      (s) =>
        /[ \-_]/.test(s.schema) ||
        /[ \-_]/.test(s.table) ||
        /[ \-_]/.test(s.column),
    );
    expect(hasSpecial).toBe(true);
  });
});
