// Issue #1062 (T5 review) / #1649 — TLS posture carryover guard.
//
// The MSSQL form seeds an encrypted posture. Switching to a DBMS whose form has
// no TLS control (pg/mysql/mariadb/oracle/sqlite/duckdb) previously carried
// that posture over with no in-form control to recover it. These lock the
// carryover rule and the edit form's normalization of what it reads from
// storage, now expressed as `sslMode` rather than the removed
// `(tlsEnabled, trustServerCertificate)` pair.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ConnectionConfig, DatabaseType } from "../../model";
import { useConnectionDraftForm } from "./useConnectionDraftForm";

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
    "resets the posture to prefer when switching MSSQL → %s (no TLS toggle)",
    (target) => {
      const { result } = renderHook(() => useConnectionDraftForm());
      // Port stays default across each hop, so the switch applies immediately
      // without the custom-port confirm gate.
      act(() => result.current.handleDbTypeChange("mssql"));
      expect(result.current.form.sslMode).toBe("require");
      act(() => result.current.handleDbTypeChange(target));
      expect(result.current.form.sslMode).toBe("prefer");
      // The CA reference is bound to the server whose CA it names, so it never
      // survives an engine switch either.
      expect(result.current.form.caCertPath).toBeNull();
    },
  );

  it.each<DatabaseType>(["redis", "valkey", "mongodb"])(
    "carries encryption but not skip-verify when switching MSSQL → %s (TLS toggle form)",
    (target) => {
      const { result } = renderHook(() => useConnectionDraftForm());
      act(() => result.current.handleDbTypeChange("mssql"));
      act(() => result.current.handleDbTypeChange(target));
      // Still encrypted (MSSQL's `require` was TLS on), but downgraded to the
      // verifying posture — the skip-verify decision does not follow.
      expect(result.current.form.sslMode).toBe("verify-full");
    },
  );
});

describe("useConnectionDraftForm — edit-form normalization of the stored posture", () => {
  // Reason: #1649 — the pre-#1649 test here locked the healing of the
  // `(tls=true, trust=None)` residue the backend hard-rejected (#1062). That
  // state is unrepresentable in `SslMode` and the backend folds any stored
  // legacy pair on read, so the surviving normalization is MSSQL's
  // encrypt-by-default seed. (2026-08-02)
  it("opens a stored MSSQL prefer as verify-full without clobbering an explicit posture", () => {
    const preferred = storedConnection({ dbType: "mssql", sslMode: "prefer" });
    expect(
      renderHook(() => useConnectionDraftForm(preferred)).result.current.form
        .sslMode,
    ).toBe("verify-full");

    const disabled = storedConnection({ dbType: "mssql", sslMode: "disable" });
    expect(
      renderHook(() => useConnectionDraftForm(disabled)).result.current.form
        .sslMode,
    ).toBe("disable");
  });

  it("preserves a stored verify-full posture for a stored PostgreSQL connection", () => {
    const conn = storedConnection({
      dbType: "postgresql",
      sslMode: "verify-full",
    });
    const { result } = renderHook(() => useConnectionDraftForm(conn));
    expect(result.current.form.sslMode).toBe("verify-full");
  });

  it("preserves the stored posture for a stored MongoDB connection (TLS toggle form)", () => {
    const conn = storedConnection({
      dbType: "mongodb",
      paradigm: "document",
      sslMode: "verify-full",
    });
    const { result } = renderHook(() => useConnectionDraftForm(conn));
    expect(result.current.form.sslMode).toBe("verify-full");
  });
});

// Issue #1063 — the on/off TLS engines (mongo/redis/valkey/search) gained a
// meaningful skip-verify posture (`require`). Switching between them must NOT
// carry that choice onto the next engine, or a dev cluster's skip-verify
// silently follows a prod connection. Encryption may carry; skip-verify must
// downgrade to the verifying posture.
describe("useConnectionDraftForm — skip-verify never carries across dbType switch (#1063)", () => {
  it("downgrades require to verify-full when switching a skip-verify MongoDB draft to Redis", () => {
    const conn = storedConnection({
      dbType: "mongodb",
      paradigm: "document",
      port: 27017, // mongo default → switch applies without the confirm gate
      sslMode: "require",
    });
    const { result } = renderHook(() => useConnectionDraftForm(conn));
    expect(result.current.form.sslMode).toBe("require");

    act(() => result.current.handleDbTypeChange("redis"));

    // Encryption carries, but the skip-verify decision is dropped.
    expect(result.current.form.sslMode).toBe("verify-full");
  });

  // Reason: B1 review finding — the paste path (`applyParsedConnection`) bypassed
  // the dropdown's `applyDbTypeChange` sanitize, so a stored MSSQL draft's
  // skip-verify posture survived a `redis://` paste and reached the backend as
  // redis `insecure=true`. (2026-07-17)
  it("drops a carried skip-verify choice when a pasted URL changes the engine (#1063 B1)", () => {
    const conn = storedConnection({ dbType: "mssql", sslMode: "require" });
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
    // Encryption may carry; the skip-verify choice must not.
    expect(result.current.form.sslMode).toBe("verify-full");
  });

  // Reason: the sanitize must not clobber a TLS posture the pasted URL states
  // explicitly (e.g. `?sslmode=require`). Order matters: sanitize first, then
  // the parsed fields override. (2026-07-17)
  it("still applies explicit TLS params carried by the pasted URL", () => {
    const conn = storedConnection({ dbType: "mssql", sslMode: "require" });
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
    // The explicit sslmode=require (skip-verify) survives the sanitize.
    expect(result.current.form.sslMode).toBe("require");
  });
});
