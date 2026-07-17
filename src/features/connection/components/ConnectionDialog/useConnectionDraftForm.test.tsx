// Issue #1062 (T5 review) — TLS draft carryover guard.
//
// The MSSQL form seeds `tlsEnabled=true`. Switching to a DBMS whose form has
// no TLS toggle (pg/mysql/mariadb/oracle/sqlite/duckdb) previously carried
// that `true` over while resetting `trust` to null, producing the
// `tls_enabled=true, trust=None` combo the backend now hard-rejects — with no
// in-form control to recover. These lock the carryover + the edit-form
// normalization of pre-existing bug residue.
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConnectionDraftForm } from "./useConnectionDraftForm";
import type { ConnectionConfig, DatabaseType } from "../../model";

function storedConnection(
  overrides: Partial<ConnectionConfig> & { dbType: DatabaseType },
): ConnectionConfig {
  return {
    id: "c1",
    name: "Stored",
    host: "localhost",
    port: 5432,
    user: "u",
    database: "d",
    groupId: null,
    color: null,
    hasPassword: true,
    paradigm: "rdb",
    ...overrides,
  };
}

describe("useConnectionDraftForm — TLS carryover on dbType switch (#1062)", () => {
  it.each<DatabaseType>(["postgresql", "mysql", "mariadb", "oracle"])(
    "resets tlsEnabled to null when switching MSSQL → %s (no TLS toggle)",
    (target) => {
      const { result } = renderHook(() => useConnectionDraftForm());
      // Port stays default across each hop, so the switch applies immediately
      // without the custom-port confirm gate.
      act(() => result.current.handleDbTypeChange("mssql"));
      expect(result.current.form.tlsEnabled).toBe(true);
      act(() => result.current.handleDbTypeChange(target));
      expect(result.current.form.tlsEnabled).toBeNull();
      expect(result.current.form.trustServerCertificate).toBeNull();
    },
  );

  it.each<DatabaseType>(["redis", "valkey", "mongodb"])(
    "keeps carried tlsEnabled when switching MSSQL → %s (TLS toggle form)",
    (target) => {
      const { result } = renderHook(() => useConnectionDraftForm());
      act(() => result.current.handleDbTypeChange("mssql"));
      act(() => result.current.handleDbTypeChange(target));
      expect(result.current.form.tlsEnabled).toBe(true);
    },
  );
});

describe("useConnectionDraftForm — edit-form normalization of stored residue (#1062)", () => {
  it("drops the reject residue (tls=true, trust=None) for a stored PostgreSQL connection", () => {
    const conn = storedConnection({
      dbType: "postgresql",
      tlsEnabled: true,
      trustServerCertificate: null,
    });
    const { result } = renderHook(() => useConnectionDraftForm(conn));
    expect(result.current.form.tlsEnabled).toBeNull();
  });

  it("preserves an explicit valid combo (tls=true, trust=false) for a stored PostgreSQL connection", () => {
    const conn = storedConnection({
      dbType: "postgresql",
      tlsEnabled: true,
      trustServerCertificate: false,
    });
    const { result } = renderHook(() => useConnectionDraftForm(conn));
    expect(result.current.form.tlsEnabled).toBe(true);
    expect(result.current.form.trustServerCertificate).toBe(false);
  });

  it("preserves tlsEnabled for a stored MongoDB connection (TLS toggle form)", () => {
    const conn = storedConnection({
      dbType: "mongodb",
      paradigm: "document",
      tlsEnabled: true,
      trustServerCertificate: null,
    });
    const { result } = renderHook(() => useConnectionDraftForm(conn));
    expect(result.current.form.tlsEnabled).toBe(true);
  });
});

// Issue #1063 — the on/off TLS engines (mongo/redis/valkey/search) gained a
// meaningful `trustServerCertificate` (skip-verify). Switching between them
// must NOT carry a skip-verify choice onto the next engine, or a dev cluster's
// trust=true silently follows a prod connection. Encryption (tlsEnabled) may
// carry; trust must reset.
describe("useConnectionDraftForm — skip-verify never carries across dbType switch (#1063)", () => {
  it("resets trust to null when switching a trusted MongoDB draft to Redis", () => {
    const conn = storedConnection({
      dbType: "mongodb",
      paradigm: "document",
      port: 27017, // mongo default → switch applies without the confirm gate
      tlsEnabled: true,
      trustServerCertificate: true,
    });
    const { result } = renderHook(() => useConnectionDraftForm(conn));
    expect(result.current.form.trustServerCertificate).toBe(true);

    act(() => result.current.handleDbTypeChange("redis"));

    // Encryption carries, but the skip-verify decision is dropped.
    expect(result.current.form.tlsEnabled).toBe(true);
    expect(result.current.form.trustServerCertificate).toBeNull();
  });
});
