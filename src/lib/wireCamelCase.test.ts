import { describe, expect, it } from "vitest";
import {
  normalizeActiveStatuses,
  normalizeConnectionConfig,
  normalizeConnectionStatus,
} from "./wireCamelCase";

// Purpose: backend wire payload camelCase normalization for connection fields (2026-06-17)
describe("normalizeConnectionConfig", () => {
  // Reason: issue #901 adds SQL Server trust_server_certificate on the Rust wire (2026-06-17)
  it("normalizes SQL Server trust_server_certificate from snake_case", () => {
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
        tls_enabled: true,
        trust_server_certificate: false,
      }),
    ).toMatchObject({
      dbType: "mssql",
      tlsEnabled: true,
      trustServerCertificate: false,
    });
  });

  // Reason: camelCase IPC snapshots should round-trip the same MSSQL trust decision (2026-06-17)
  it("preserves camelCase trustServerCertificate", () => {
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
        tlsEnabled: true,
        trustServerCertificate: true,
      }),
    ).toMatchObject({
      dbType: "mssql",
      tlsEnabled: true,
      trustServerCertificate: true,
    });
  });

  // Reason: existing MSSQL records without trust_server_certificate must not silently hydrate to true (2026-06-17)
  it("does not default missing trustServerCertificate to true", () => {
    const connection = normalizeConnectionConfig({
      id: "mssql-legacy",
      name: "SQL Server legacy",
      db_type: "mssql",
      host: "localhost",
      port: 1433,
      user: "sa",
      database: "master",
      has_password: true,
      paradigm: "rdb",
      tls_enabled: true,
    });

    expect(connection.trustServerCertificate).toBeUndefined();
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
