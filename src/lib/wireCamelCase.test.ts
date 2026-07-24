import { describe, expect, it } from "vitest";
import {
  normalizeActiveStatuses,
  normalizeConnectionConfig,
  normalizeConnectionStatus,
} from "./wireCamelCase";

// Purpose: backend wire payload camelCase normalization for connection fields;
// #1649 (ADR 0058) folds the TLS posture into `sslMode` + `caCertPath`.
describe("normalizeConnectionConfig", () => {
  // Reason: #1649 — the backend wire now carries `sslMode` (kebab-case);
  // camelCase + snake_case keys and the verify-ca CA path both hydrate. (2026-07-25)
  it("normalizes sslMode + caCertPath from the wire (both cases)", () => {
    expect(
      normalizeConnectionConfig({
        id: "pg-1",
        name: "PG",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
        user: "postgres",
        database: "db",
        has_password: true,
        paradigm: "rdb",
        ssl_mode: "verify-ca",
        ca_cert_path: "/etc/ssl/ca.pem",
      }),
    ).toMatchObject({
      dbType: "postgresql",
      sslMode: "verify-ca",
      caCertPath: "/etc/ssl/ca.pem",
    });

    expect(
      normalizeConnectionConfig({
        id: "pg-2",
        name: "PG",
        dbType: "postgresql",
        host: "localhost",
        port: 5432,
        user: "postgres",
        database: "db",
        hasPassword: true,
        paradigm: "rdb",
        sslMode: "require",
      }),
    ).toMatchObject({ sslMode: "require" });
  });

  // Reason: #1649 — a pre-migration snapshot still carries the legacy
  // `(tlsEnabled, trustServerCertificate)` pair; it must fold to the same
  // posture the backend `SslMode::from_legacy` produces. (2026-07-25)
  it("folds a legacy tlsEnabled/trustServerCertificate snapshot into sslMode", () => {
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
      }).sslMode,
    ).toBe("verify-full");

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
      }).sslMode,
    ).toBe("require");
  });

  // Reason: #1649 — a legacy record with `tls_enabled` but no trust decision
  // must fold to the secure `verify-full`, never skip-verify. (2026-07-25)
  it("folds legacy tls_enabled without a trust decision to verify-full", () => {
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

    expect(connection.sslMode).toBe("verify-full");
  });

  // Reason: #1649 — a payload with no TLS keys at all hydrates to the driver
  // default `prefer` (no silent encryption claim). (2026-07-25)
  it("defaults a payload with no TLS keys to prefer", () => {
    const connection = normalizeConnectionConfig({
      id: "pg-legacy",
      name: "PG legacy",
      db_type: "postgresql",
      host: "localhost",
      port: 5432,
      user: "postgres",
      database: "db",
      has_password: false,
      paradigm: "rdb",
    });
    expect(connection.sslMode).toBe("prefer");
    expect(connection.caCertPath).toBeUndefined();
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
