import { describe, expect, it } from "vitest";
import { normalizeConnectionConfig } from "./wireCamelCase";

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
