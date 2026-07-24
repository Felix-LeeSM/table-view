// Issue #1062/#1063/#1649 — TLS draft carryover guard.
//
// The MSSQL form seeds the `require` posture. #1649 (ADR 0058) promotes the TLS
// posture to the `sslMode` enum; switching to a DBMS whose form has no TLS
// toggle (pg/mysql/mariadb/oracle/sqlite/duckdb) resets it to `prefer`, while
// the on/off engines (mongo/redis/valkey/search) carry only the on/off state
// (never the skip-verify choice). These lock the carryover + the edit-form
// hydration of a stored posture.
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

describe("useConnectionDraftForm — TLS carryover on dbType switch (#1649)", () => {
  it.each<DatabaseType>(["postgresql", "mysql", "mariadb", "oracle"])(
    "resets sslMode to prefer when switching MSSQL → %s (no TLS toggle)",
    (target) => {
      const { result } = renderHook(() => useConnectionDraftForm());
      // Port stays default across each hop, so the switch applies immediately
      // without the custom-port confirm gate.
      act(() => result.current.handleDbTypeChange("mssql"));
      expect(result.current.form.sslMode).toBe("require");
      act(() => result.current.handleDbTypeChange(target));
      expect(result.current.form.sslMode).toBe("prefer");
      expect(result.current.form.caCertPath).toBeNull();
    },
  );

  it.each<DatabaseType>(["redis", "valkey", "mongodb"])(
    "carries only the on/off state (require → verify-full) MSSQL → %s (TLS toggle form)",
    (target) => {
      const { result } = renderHook(() => useConnectionDraftForm());
      act(() => result.current.handleDbTypeChange("mssql"));
      act(() => result.current.handleDbTypeChange(target));
      // Encryption carries; the skip-verify (`require`) choice never does.
      expect(result.current.form.sslMode).toBe("verify-full");
    },
  );
});

describe("useConnectionDraftForm — edit-form hydrates the stored sslMode (#1649)", () => {
  it("carries a stored verify-ca posture + CA path verbatim for PostgreSQL", () => {
    const conn = storedConnection({
      dbType: "postgresql",
      sslMode: "verify-ca",
      caCertPath: "/etc/ssl/ca.pem",
    });
    const { result } = renderHook(() => useConnectionDraftForm(conn));
    expect(result.current.form.sslMode).toBe("verify-ca");
    expect(result.current.form.caCertPath).toBe("/etc/ssl/ca.pem");
  });

  it("carries a stored verify-full posture for PostgreSQL", () => {
    const conn = storedConnection({
      dbType: "postgresql",
      sslMode: "verify-full",
    });
    const { result } = renderHook(() => useConnectionDraftForm(conn));
    expect(result.current.form.sslMode).toBe("verify-full");
  });

  it("carries a stored TLS posture for a MongoDB connection (TLS toggle form)", () => {
    const conn = storedConnection({
      dbType: "mongodb",
      paradigm: "document",
      sslMode: "verify-full",
    });
    const { result } = renderHook(() => useConnectionDraftForm(conn));
    expect(result.current.form.sslMode).toBe("verify-full");
  });
});

// Issue #1063/#1649 — the on/off TLS engines gained a meaningful skip-verify
// (`require`). Switching between engines must NOT carry a skip-verify choice
// onto the next engine, or a dev cluster's insecure posture silently follows a
// prod connection. Encryption may carry (as verify-full); require must not.
describe("useConnectionDraftForm — skip-verify never carries across dbType switch (#1649)", () => {
  it("downgrades require to verify-full when switching a MongoDB draft to Redis", () => {
    const conn = storedConnection({
      dbType: "mongodb",
      paradigm: "document",
      port: 27017, // mongo default → switch applies without the confirm gate
      sslMode: "require",
    });
    const { result } = renderHook(() => useConnectionDraftForm(conn));
    expect(result.current.form.sslMode).toBe("require");

    act(() => result.current.handleDbTypeChange("redis"));

    // Encryption carries as verify-full; the skip-verify decision is dropped.
    expect(result.current.form.sslMode).toBe("verify-full");
  });

  // Reason: B1 review finding — the paste path (`applyParsedConnection`) bypassed
  // the dropdown's `applyDbTypeChange` sanitize, so a stored MSSQL draft's
  // `require` (skip-verify) survived a `redis://` paste and reached the backend
  // as redis `insecure=true`. (2026-07-25)
  it("drops a carried skip-verify choice when a pasted URL changes the engine (#1063 B1)", () => {
    const conn = storedConnection({
      dbType: "mssql",
      sslMode: "require",
    });
    const { result } = renderHook(() => useConnectionDraftForm(conn));
    expect(result.current.form.sslMode).toBe("require");

    // Paste a redis URL that carries no TLS parameter (the B1 repro).
    act(() =>
      result.current.applyParsedConnection(
        {
          dbType: "redis",
          host: "prod-host",
          port: 6379,
          user: "",
          database: "0",
          paradigm: "kv",
        },
        "paste",
      ),
    );

    expect(result.current.form.dbType).toBe("redis");
    // Encryption may carry (verify-full); the skip-verify choice must not.
    expect(result.current.form.sslMode).toBe("verify-full");
  });

  // Reason: the sanitize must not clobber a TLS posture the pasted URL states
  // explicitly (e.g. `?sslmode=require`). Order matters: sanitize first, then
  // the parsed fields override. (2026-07-25)
  it("still applies an explicit sslMode carried by the pasted URL", () => {
    const conn = storedConnection({
      dbType: "mssql",
      sslMode: "require",
    });
    const { result } = renderHook(() => useConnectionDraftForm(conn));

    // postgresql://...?sslmode=require → the parser emits sslMode: "require".
    act(() =>
      result.current.applyParsedConnection(
        {
          dbType: "postgresql",
          host: "h",
          port: 5432,
          user: "u",
          database: "db",
          sslMode: "require",
          paradigm: "rdb",
        },
        "paste",
      ),
    );

    expect(result.current.form.dbType).toBe("postgresql");
    // The explicit sslmode=require survives the sanitize (which would otherwise
    // reset pg to prefer).
    expect(result.current.form.sslMode).toBe("require");
  });
});
