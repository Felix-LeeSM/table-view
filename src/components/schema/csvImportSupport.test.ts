import { describe, expect, it } from "vitest";

import { supportsCsvImport } from "./csvImportSupport";

// Purpose: #1639 Stage 1 — the "Import CSV…" menu gate is PG-first. This is a
// UX/security-adjacent gate (surfacing the entry point on an engine without a
// commit path would be error-on-click once #1640 ships), so the allowlist
// contract is worth pinning. (2026-07-17)
describe("supportsCsvImport", () => {
  it("returns true only for postgresql (PG-first)", () => {
    expect(supportsCsvImport("postgresql")).toBe(true);
  });

  it("returns false for other engines and undefined", () => {
    for (const dbType of [
      "mysql",
      "mariadb",
      "sqlite",
      "mongodb",
      "redis",
      undefined,
    ]) {
      expect(supportsCsvImport(dbType)).toBe(false);
    }
  });
});
