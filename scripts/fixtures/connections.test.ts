// Sprint 237.1 — Storage envelope cross-compat.
//
// 작성 일자: 2026-05-10. fixture upsert 가 Rust `crypto::decrypt`
// (src-tauri/src/storage/crypto.rs) 가 그대로 푸는 ciphertext 를
// 만드는지 검증. plaintext 를 그대로 넣어 "Ciphertext too short"
// 회귀를 차단하기 위한 가드.
//
// Rust 와 동일 알고리즘을 Node `createDecipheriv` 로 reproduction
// 해서, fixture 가 만든 envelope 을 *받는 쪽 코드와 동일한 절차*
// 로 풀 수 있는지를 검증한다 (FFI 없이도 contract 호환 가드 가능).
//
// 격리 — TABLE_VIEW_TEST_DATA_DIR 로 임시 디렉토리를 잡아 사용자
// 의 실제 ~/Library/Application Support/table-view 를 절대 건드리지
// 않는다.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDecipheriv, randomBytes as nodeRandomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { upsertConnections, clearConnections } from "./connections.js";
import { loadSpec } from "./spec.js";

let tempDir: string;
let originalEnv: string | undefined;

// Pre-push runs this storage fixture file alongside Rust coverage.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  tempDir = mkdtempSync(resolve(tmpdir(), "fixture-conn-"));
  originalEnv = process.env.TABLE_VIEW_TEST_DATA_DIR;
  process.env.TABLE_VIEW_TEST_DATA_DIR = tempDir;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.TABLE_VIEW_TEST_DATA_DIR;
  else process.env.TABLE_VIEW_TEST_DATA_DIR = originalEnv;
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(`${tempDir}-fixtures`, { recursive: true, force: true });
});

// Replicate Rust `crypto::decrypt` (AES-256-GCM, 12-byte nonce
// prepended to ciphertext, 16-byte auth tag appended). Used as the
// *receiver* side of the contract Node-side fixture writes target.
function decrypt(b64: string, key: Buffer): string {
  const combined = Buffer.from(b64, "base64");
  if (combined.length < 12 + 16) {
    throw new Error(`ciphertext too short: ${combined.length} bytes`);
  }
  const nonce = combined.subarray(0, 12);
  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(12, combined.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

describe("connections — storage envelope contract (Rust crypto::decrypt compat)", () => {
  it("auto-creates the .key file (32-byte base64) when missing", async () => {
    await upsertConnections(loadSpec("e2e"));
    const keyPath = resolve(tempDir, ".key");
    const key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
    expect(key.length).toBe(32);
  });

  it("emits passwords that round-trip through AES-256-GCM with the .key", async () => {
    await upsertConnections(loadSpec("e2e"));
    const key = Buffer.from(
      readFileSync(resolve(tempDir, ".key"), "utf8").trim(),
      "base64",
    );
    const conns = JSON.parse(
      readFileSync(resolve(tempDir, "connections.json"), "utf8"),
    ) as { connections: { id: string; db_type: string; password: string }[] };
    const passwordBackedConnections = conns.connections.filter(
      (c) => !["sqlite", "duckdb", "redis"].includes(c.db_type),
    );
    expect(passwordBackedConnections.length).toBeGreaterThan(0);
    for (const c of passwordBackedConnections) {
      const plain = decrypt(c.password, key);
      expect(plain.length).toBeGreaterThan(0);
      expect(c.password).not.toBe(plain);
    }
  });

  it("respects an existing .key (does not regenerate) so the app can already own one", async () => {
    const fixedKey = nodeRandomBytes(32);
    writeFileSync(
      resolve(tempDir, ".key"),
      fixedKey.toString("base64"),
      "utf8",
    );
    await upsertConnections(loadSpec("e2e"));
    const onDisk = Buffer.from(
      readFileSync(resolve(tempDir, ".key"), "utf8").trim(),
      "base64",
    );
    expect(onDisk.equals(fixedKey)).toBe(true);
  });

  it("upsert is idempotent — running twice yields no duplicate ids", async () => {
    await upsertConnections(loadSpec("e2e"));
    await upsertConnections(loadSpec("e2e"));
    const conns = JSON.parse(
      readFileSync(resolve(tempDir, "connections.json"), "utf8"),
    ) as { connections: { id: string }[] };
    const ids = conns.connections.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("upserts SQLite as a local file connection without password ciphertext", async () => {
    await upsertConnections(loadSpec("e2e"));
    const data = JSON.parse(
      readFileSync(resolve(tempDir, "connections.json"), "utf8"),
    ) as {
      connections: {
        id: string;
        db_type: string;
        host: string;
        port: number;
        user: string;
        password: string;
        database: string;
        read_only: boolean;
      }[];
    };

    const sqlite = data.connections.find((c) => c.id === "fixture-e2e-sqlite");

    expect(sqlite).toEqual(
      expect.objectContaining({
        db_type: "sqlite",
        host: "",
        port: 0,
        user: "",
        password: "",
        // #1449: fixture DB files must resolve OUTSIDE the app data dir
        // (tempDir) — the backend rejects internal paths on connect.
        database: resolve(
          `${tempDir}-fixtures`,
          "sqlite",
          "table_view_e2e.sqlite",
        ),
        read_only: false,
      }),
    );
  });

  it("creates idempotent file-backed SQLite and DuckDB fixture databases", async () => {
    await upsertConnections(loadSpec("e2e"));
    await upsertConnections(loadSpec("e2e"));

    const data = JSON.parse(
      readFileSync(resolve(tempDir, "connections.json"), "utf8"),
    ) as {
      connections: {
        id: string;
        db_type: string;
        database: string;
      }[];
    };

    const sqlite = data.connections.find((c) => c.id === "fixture-e2e-sqlite");
    const duckdb = data.connections.find((c) => c.id === "fixture-e2e-duckdb");

    expect(sqlite?.database).toContain("table_view_e2e.sqlite");
    expect(duckdb?.database).toContain("table_view_e2e.duckdb");
    expect(existsSync(sqlite?.database ?? "")).toBe(true);
    expect(existsSync(duckdb?.database ?? "")).toBe(true);
  });

  it("surfaces MariaDB, MSSQL, and Oracle fixture connections with localhost compose defaults", async () => {
    await upsertConnections(loadSpec("e2e"));

    const key = Buffer.from(
      readFileSync(resolve(tempDir, ".key"), "utf8").trim(),
      "base64",
    );
    const data = JSON.parse(
      readFileSync(resolve(tempDir, "connections.json"), "utf8"),
    ) as {
      connections: {
        id: string;
        db_type: string;
        host: string;
        port: number;
        user: string;
        password: string;
        database: string;
      }[];
    };

    const mariadb = data.connections.find(
      (c) => c.id === "fixture-e2e-mariadb",
    );
    const mssql = data.connections.find((c) => c.id === "fixture-e2e-mssql");
    const oracle = data.connections.find((c) => c.id === "fixture-e2e-oracle");
    expect(mariadb).toEqual(
      expect.objectContaining({
        db_type: "mariadb",
        host: "localhost",
        port: 23306,
        user: "testuser",
        database: "table_view_e2e",
      }),
    );
    expect(decrypt(mariadb!.password, key)).toBe("testpass");
    expect(mssql).toEqual(
      expect.objectContaining({
        db_type: "mssql",
        host: "localhost",
        port: 14333,
        user: "sa",
        database: "table_view_e2e",
      }),
    );
    expect(decrypt(mssql!.password, key)).toBe("Testpass123!");
    expect(oracle).toEqual(
      expect.objectContaining({
        db_type: "oracle",
        host: "localhost",
        port: 1521,
        user: "testuser",
        database: "XEPDB1",
      }),
    );
    expect(decrypt(oracle!.password, key)).toBe("testpass");
  });

  it("does not rewrite user-created SQLite or DuckDB file connections", async () => {
    const path = resolve(tempDir, "connections.json");
    writeFileSync(
      path,
      JSON.stringify(
        {
          connections: [
            {
              id: "user-sqlite",
              name: "User SQLite",
              db_type: "sqlite",
              host: "",
              port: 0,
              user: "",
              password: "",
              database: "/user/data/main.sqlite",
              group_id: null,
              color: null,
              connection_timeout: null,
              keep_alive_interval: null,
              environment: null,
              auth_source: null,
              replica_set: null,
              tls_enabled: null,
            },
            {
              id: "user-duckdb",
              name: "User DuckDB",
              db_type: "duckdb",
              host: "",
              port: 0,
              user: "",
              password: "",
              database: "/user/data/main.duckdb",
              group_id: null,
              color: null,
              connection_timeout: null,
              keep_alive_interval: null,
              environment: null,
              auth_source: null,
              replica_set: null,
              tls_enabled: null,
            },
          ],
          groups: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    await upsertConnections(loadSpec("e2e"));

    const data = JSON.parse(readFileSync(path, "utf8")) as {
      connections: { id: string; database: string }[];
    };
    expect(data.connections.find((c) => c.id === "user-sqlite")?.database).toBe(
      "/user/data/main.sqlite",
    );
    expect(data.connections.find((c) => c.id === "user-duckdb")?.database).toBe(
      "/user/data/main.duckdb",
    );
  });

  it("clear removes only fixture-* connections, leaving user entries intact", async () => {
    await upsertConnections(loadSpec("e2e"));
    // Inject a non-fixture entry the user might have added.
    const path = resolve(tempDir, "connections.json");
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      connections: { id: string }[];
      groups: { id: string }[];
    };
    data.connections.push({
      id: "user-own-connection",
      name: "mine",
      // shape padded so JSON.parse stays happy if read again
    } as { id: string });
    writeFileSync(path, JSON.stringify(data, null, 2), "utf8");

    const r = clearConnections();
    expect(r.removed).toBeGreaterThan(0);
    const after = JSON.parse(readFileSync(path, "utf8")) as {
      connections: { id: string }[];
    };
    expect(
      after.connections.find((c) => c.id === "user-own-connection"),
    ).toBeTruthy();
    expect(
      after.connections.find((c) => c.id.startsWith("fixture-")),
    ).toBeUndefined();
  });
});
