import { describe, expect, it } from "vitest";
import {
  normalizeActiveStatuses,
  normalizeConnectionConfig,
  normalizeConnectionStatus,
} from "./wireCamelCase";

// Purpose: backend wire payload camelCase normalization for connection fields (2026-06-17)
describe("normalizeConnectionConfig", () => {
  // Reason: #1649 — the boolean pair is gone from the wire; the TLS posture
  // arrives as `ssl_mode` plus an optional `ca_cert_path`. (2026-08-02)
  it("normalizes ssl_mode and ca_cert_path from snake_case", () => {
    expect(
      normalizeConnectionConfig({
        id: "mssql-1",
        name: "SQL Server",
        db_type: "mssql",
        host: "localhost",
        port: 1433,
        user: "sa",
        database: "master",
        has_password: true,
        paradigm: "rdb",
        ssl_mode: "verify-ca",
        ca_cert_path: "/etc/ssl/certs/corp-ca.pem",
      }),
    ).toMatchObject({
      dbType: "mssql",
      sslMode: "verify-ca",
      caCertPath: "/etc/ssl/certs/corp-ca.pem",
    });
  });

  // Reason: camelCase IPC snapshots should round-trip the same MSSQL trust decision (2026-06-17)
  it("preserves camelCase sslMode and caCertPath", () => {
    expect(
      normalizeConnectionConfig({
        id: "mssql-2",
        name: "SQL Server",
        dbType: "mssql",
        host: "localhost",
        port: 1433,
        user: "sa",
        database: "master",
        hasPassword: true,
        paradigm: "rdb",
        // A CA path outlives a switch away from verify-ca (the skip-verify
        // toggle keeps it), so this pairing is representable on the wire.
        sslMode: "require",
        caCertPath: "/opt/corp-ca.pem",
      }),
    ).toMatchObject({
      dbType: "mssql",
      sslMode: "require",
      caCertPath: "/opt/corp-ca.pem",
    });
  });

  // Reason: #1649 — a payload with no posture, or one this build does not know
  // (hand-edited store row, a future backend value), must degrade to the driver
  // default instead of throwing or masquerading as a verifying posture.
  // `prefer` is never weaker than the pre-#1062 behavior. (2026-08-02)
  it("falls back to prefer for a missing or unknown wire sslMode", () => {
    const base = {
      id: "mssql-legacy",
      name: "SQL Server legacy",
      db_type: "mssql",
      host: "localhost",
      port: 1433,
      user: "sa",
      database: "master",
      has_password: true,
      paradigm: "rdb",
    };

    expect(normalizeConnectionConfig(base).sslMode).toBe("prefer");
    expect(
      normalizeConnectionConfig({ ...base, ssl_mode: "verify_ca" }).sslMode,
    ).toBe("prefer");
    expect(normalizeConnectionConfig({ ...base, ssl_mode: true }).sslMode).toBe(
      "prefer",
    );
  });
});

// Purpose: review #1490 B1 — normalizeConnectionStatus is the single hydrate
// ingress (store hydrateFromSession + runtime/snapshot/loadAll); a credential
// echo persisted by a pre-fix session must be masked HERE so every render
// surface (ConnectionItem, WorkspaceSidebar, SchemaPanel) is covered by one
// guard (2026-07-11)
describe("normalizeConnectionStatus credential masking", () => {
  it("masks URI userinfo and key=value credentials in hydrated error messages", () => {
    expect(
      normalizeConnectionStatus({
        type: "error",
        message:
          "connect failed: postgres://app:S3cretPw1@db:5432/x password='S3cretPw1'",
      }),
    ).toEqual({
      type: "error",
      message: "connect failed: postgres://app:***@db:5432/x password=***",
    });
  });

  it("masks every status in a hydrated activeStatuses record", () => {
    const out = normalizeActiveStatuses({
      c1: { type: "error", message: "IO error: redis://:S3cretPw1@r:6379/0" },
      c2: { type: "connected", activeDb: "prod" },
    });
    expect(out).toEqual({
      c1: { type: "error", message: "IO error: redis://:***@r:6379/0" },
      c2: { type: "connected", activeDb: "prod" },
    });
    expect(JSON.stringify(out)).not.toContain("S3cretPw1");
  });
});
