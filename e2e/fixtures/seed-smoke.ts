import { readFile } from "node:fs/promises";
import { MongoClient, type Document } from "mongodb";
import { createConnection } from "mysql2/promise";
import { Client as PgClient } from "pg";
import Redis from "ioredis";
import sql from "mssql";
import oracledb from "oracledb";
import { readE2eSeedFixture } from "../../scripts/fixtures/e2e-seed-paths.js";

const pgConfig = {
  host: process.env.E2E_PG_HOST ?? process.env.PGHOST ?? "localhost",
  port: Number(process.env.E2E_PG_PORT ?? process.env.PGPORT ?? 15432),
  user: process.env.PGUSER ?? "testuser",
  password: process.env.PGPASSWORD ?? "testpass",
  database: process.env.PGDATABASE ?? "table_view_test",
};

const mongoConfig = {
  host: process.env.E2E_MONGO_HOST ?? "localhost",
  port: Number(process.env.E2E_MONGO_PORT ?? process.env.MONGO_PORT ?? 37017),
  user: process.env.MONGO_USER ?? "testuser",
  password: process.env.MONGO_PASSWORD ?? "testpass",
  authDb: process.env.E2E_MONGO_AUTH_DB ?? "admin",
  database: process.env.E2E_MONGO_DB ?? "table_view_test",
};

const mysqlConfig = {
  host: process.env.E2E_MYSQL_HOST ?? process.env.MYSQL_HOST ?? "localhost",
  port: Number(process.env.E2E_MYSQL_PORT ?? process.env.MYSQL_PORT ?? 13306),
  user: process.env.MYSQL_USER ?? "testuser",
  password: process.env.MYSQL_PASSWORD ?? "testpass",
  database: process.env.MYSQL_DATABASE ?? "table_view_test",
};

const mariadbConfig = {
  host: process.env.E2E_MARIADB_HOST ?? process.env.MARIADB_HOST ?? "localhost",
  port: Number(
    process.env.E2E_MARIADB_PORT ?? process.env.MARIADB_PORT ?? 23306,
  ),
  user: process.env.MARIADB_USER ?? "testuser",
  password: process.env.MARIADB_PASSWORD ?? "testpass",
  database: process.env.MARIADB_DATABASE ?? "table_view_test",
};

const mssqlConfig = {
  host: process.env.E2E_MSSQL_HOST ?? process.env.MSSQL_HOST ?? "localhost",
  port: Number(process.env.E2E_MSSQL_PORT ?? process.env.MSSQL_PORT ?? 14333),
  user: process.env.MSSQL_USER ?? "sa",
  password: process.env.MSSQL_PASSWORD ?? "Testpass123!",
  database:
    process.env.E2E_MSSQL_DATABASE ??
    process.env.MSSQL_DATABASE ??
    "table_view_test",
};

const oracleConfig = {
  host: process.env.E2E_ORACLE_HOST ?? process.env.ORACLE_HOST ?? "localhost",
  port: Number(process.env.E2E_ORACLE_PORT ?? process.env.ORACLE_PORT ?? 1521),
  user: process.env.ORACLE_USER ?? "testuser",
  password: process.env.ORACLE_PASSWORD ?? "testpass",
  serviceName:
    process.env.E2E_ORACLE_SERVICE ?? process.env.ORACLE_SERVICE ?? "XEPDB1",
};

const redisConfig = {
  host: process.env.E2E_REDIS_HOST ?? process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.E2E_REDIS_PORT ?? process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD ?? "",
  database: Number(process.env.E2E_REDIS_DB ?? 2),
};

const valkeyConfig = {
  host: process.env.E2E_VALKEY_HOST ?? process.env.VALKEY_HOST ?? "localhost",
  port: Number(process.env.E2E_VALKEY_PORT ?? process.env.VALKEY_PORT ?? 16379),
  password: process.env.VALKEY_PASSWORD ?? "",
  database: Number(process.env.E2E_VALKEY_DB ?? 2),
};

const elasticsearchConfig = {
  host:
    process.env.E2E_ELASTICSEARCH_HOST ??
    process.env.ELASTICSEARCH_HOST ??
    "localhost",
  port: Number(
    process.env.E2E_ELASTICSEARCH_PORT ??
      process.env.ELASTICSEARCH_PORT ??
      19200,
  ),
  user: process.env.ELASTICSEARCH_USER ?? "",
  password: process.env.ELASTICSEARCH_PASSWORD ?? "",
  index: process.env.E2E_ELASTICSEARCH_INDEX ?? "table-view-elastic-2026.05.24",
};

const opensearchConfig = {
  host:
    process.env.E2E_OPENSEARCH_HOST ??
    process.env.OPENSEARCH_HOST ??
    "localhost",
  port: Number(
    process.env.E2E_OPENSEARCH_PORT ?? process.env.OPENSEARCH_PORT ?? 29200,
  ),
  user: process.env.OPENSEARCH_USER ?? "",
  password: process.env.OPENSEARCH_PASSWORD ?? "",
  index: process.env.E2E_OPENSEARCH_INDEX ?? "table-view-opensearch-2026.05.24",
};

type MongoSeedIndex = {
  name?: string;
  keys: Document;
  options?: Document;
};

type MongoSeedCollection = {
  name: string;
  indexes?: MongoSeedIndex[];
  documents: Document[];
};

type MongoSeedFixture = {
  collections: MongoSeedCollection[];
};

type RedisSeedCommand =
  | { command: "SELECT"; database: number }
  | { command: "FLUSHDB" }
  | { command: "SET"; key: string; value: string; ttlSeconds?: number }
  | { command: "HSET"; key: string; fields: Record<string, string> }
  | { command: "XADD"; key: string; id: string; fields: Record<string, string> }
  | { command: "SADD"; key: string; members: string[] }
  | {
      command: "ZADD";
      key: string;
      members: { score: number; member: string }[];
    };

type RedisSeedFixture = {
  database: number;
  commands: RedisSeedCommand[];
};

type SearchSeedFixture = {
  indexes: Array<{ name: string; aliases?: string[] }>;
  aliases?: Array<{ name: string; index: string; writeIndex?: boolean }>;
  mappings: Array<{ index: string; raw: unknown }>;
  templates?: Array<{ name: string; raw: unknown }>;
  searchResult: {
    hits: Array<{ id: string; source: Record<string, unknown> }>;
  };
};

type SearchSeedRuntime = {
  label: string;
  fixtureKey: "elasticsearch" | "opensearch";
  host: string;
  port: number;
  user: string;
  password: string;
  index: string;
};

type SeedTarget =
  | "postgres"
  | "mongodb"
  | "mysql"
  | "mariadb"
  | "mssql"
  | "oracle"
  | "redis"
  | "valkey"
  | "elasticsearch"
  | "opensearch";

const ALL_SEED_TARGETS = [
  "postgres",
  "mongodb",
  "mysql",
  "mariadb",
  "mssql",
  "oracle",
  "redis",
  "valkey",
  "elasticsearch",
  "opensearch",
] as const satisfies readonly SeedTarget[];

const SEED_TARGETS_BY_SPEC_KEY: Record<string, readonly SeedTarget[]> = {
  postgres: ["postgres"],
  "postgres-safe-mode": ["postgres"],
  "postgres-safe-mode-matrix": ["postgres"],
  "postgres-explain": ["postgres"],
  "postgres-extension-completion": ["postgres"],
  "postgres-cancellation": ["postgres"],
  "postgres-structure-ddl": ["postgres"],
  "erd-dense": ["postgres"],
  mysql: ["mysql"],
  mariadb: ["mariadb"],
  mssql: ["mssql"],
  oracle: ["oracle"],
  mongodb: ["mongodb"],
  "phase-28-slice-A": ["mongodb"],
  redis: ["redis"],
  "redis-empty-state-window": [],
  valkey: ["valkey"],
  elasticsearch: ["elasticsearch"],
  opensearch: ["opensearch"],
  "history-source-5": ["postgres", "mongodb"],
  sqlite: [],
  duckdb: [],
  "duckdb-file-analytics": [],
};

async function retry(label: string, fn: () => Promise<void>) {
  const timeoutMs = 60000;
  const started = Date.now();
  let lastError: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      await fn();
      return;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`${label} did not become ready: ${String(lastError)}`);
}

async function seedPostgres() {
  const sql = await readE2eSeedFixture("postgresql");
  await retry("Postgres", async () => {
    const client = new PgClient(pgConfig);
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  });
}

async function seedMongo() {
  const fixture = JSON.parse(
    await readE2eSeedFixture("mongodb"),
  ) as MongoSeedFixture;
  const uri = `mongodb://${encodeURIComponent(mongoConfig.user)}:${encodeURIComponent(
    mongoConfig.password,
  )}@${mongoConfig.host}:${mongoConfig.port}/${mongoConfig.authDb}`;

  await retry("MongoDB", async () => {
    const client = new MongoClient(uri);
    await client.connect();
    try {
      const db = client.db(mongoConfig.database);
      for (const collectionSpec of fixture.collections) {
        const collection = db.collection(collectionSpec.name);
        for (const index of collectionSpec.indexes ?? []) {
          await collection.createIndex(index.keys, {
            ...index.options,
            ...(index.name ? { name: index.name } : {}),
          });
        }
        for (const document of collectionSpec.documents) {
          await collection.replaceOne(seedDocumentFilter(document), document, {
            upsert: true,
          });
        }
      }
    } finally {
      await client.close();
    }
  });
}

async function seedMysql() {
  const sql = await readE2eSeedFixture("mysql");
  await retry("MySQL", async () => {
    const connection = await createConnection({
      ...mysqlConfig,
      multipleStatements: true,
    });
    try {
      await connection.query(sql);
    } finally {
      await connection.end();
    }
  });
}

async function seedMariadb() {
  const sql = await readE2eSeedFixture("mariadb");
  await retry("MariaDB", async () => {
    const connection = await createConnection({
      ...mariadbConfig,
      multipleStatements: true,
    });
    try {
      await connection.query(sql);
    } finally {
      await connection.end();
    }
  });
}

async function seedMssql() {
  const seedSql = await readFile("e2e/fixtures/seed.mssql.sql", "utf-8");
  await retry("MSSQL", async () => {
    await ensureMssqlDatabase();
    const pool = await mssqlPool(mssqlConfig.database);
    try {
      for (const statement of splitSqlServerBatches(seedSql)) {
        await pool.request().query(statement);
      }
    } finally {
      await pool.close();
    }
  });
}

async function ensureMssqlDatabase() {
  const pool = await mssqlPool("master");
  try {
    await pool
      .request()
      .input("name", sql.NVarChar, mssqlConfig.database)
      .query(
        `IF DB_ID(@name) IS NULL EXEC('CREATE DATABASE ${quoteMssqlIdentifier(
          mssqlConfig.database,
        )}')`,
      );
  } finally {
    await pool.close();
  }
}

async function mssqlPool(database: string) {
  return await sql.connect({
    server: mssqlConfig.host,
    port: mssqlConfig.port,
    user: mssqlConfig.user,
    password: mssqlConfig.password,
    database,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
  });
}

function splitSqlServerBatches(seedSql: string): string[] {
  return seedSql
    .split(/^\s*GO\s*$/gim)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function quoteMssqlIdentifier(identifier: string): string {
  return `[${identifier.replace(/]/g, "]]")}]`;
}

async function seedOracle() {
  const seedSql = await readFile("e2e/fixtures/seed.oracle.sql", "utf-8");
  await retry("Oracle", async () => {
    const connection = await oracledb.getConnection({
      user: oracleConfig.user,
      password: oracleConfig.password,
      connectString: `${oracleConfig.host}:${oracleConfig.port}/${oracleConfig.serviceName}`,
    });
    try {
      for (const statement of splitOracleStatements(seedSql)) {
        await connection.execute(statement);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.close();
    }
  });
}

function splitOracleStatements(seedSql: string): string[] {
  const statements: string[] = [];
  let buffer: string[] = [];
  let inBlock = false;

  for (const line of seedSql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("--") || trimmed.length === 0) continue;
    if (trimmed === "/" && buffer.length === 0) continue;

    if (
      /^(BEGIN|DECLARE|CREATE\s+OR\s+REPLACE\s+(?:PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE))/i.test(
        trimmed,
      )
    ) {
      inBlock = true;
    }

    if (inBlock) {
      if (trimmed === "/") {
        const statement = buffer.join("\n").trim();
        if (statement) statements.push(statement);
        buffer = [];
        inBlock = false;
      } else {
        buffer.push(line);
      }
      continue;
    }

    buffer.push(line);
    if (trimmed.endsWith(";")) {
      const statement = buffer.join("\n").trim().replace(/;$/, "").trim();
      if (statement) statements.push(statement);
      buffer = [];
    }
  }

  const trailing = buffer.join("\n").trim();
  if (trailing) statements.push(trailing.replace(/;$/, "").trim());
  return statements;
}

async function seedRedis() {
  const fixture = JSON.parse(
    await readE2eSeedFixture("redis"),
  ) as RedisSeedFixture;

  await retry("Redis", async () => {
    const client = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password || undefined,
      db: redisConfig.database,
      lazyConnect: true,
    });
    await client.connect();
    try {
      for (const command of fixture.commands) {
        switch (command.command) {
          case "SELECT":
            await client.select(command.database);
            break;
          case "FLUSHDB":
            await client.flushdb();
            break;
          case "SET":
            if (command.ttlSeconds) {
              await client.set(
                command.key,
                command.value,
                "EX",
                command.ttlSeconds,
              );
            } else {
              await client.set(command.key, command.value);
            }
            break;
          case "HSET":
            await client.hset(command.key, command.fields);
            break;
          case "XADD":
            await client.xadd(
              command.key,
              command.id,
              ...Object.entries(command.fields).flat(),
            );
            break;
          case "SADD":
            await client.sadd(command.key, ...command.members);
            break;
          case "ZADD":
            await client.zadd(
              command.key,
              ...command.members.flatMap(({ score, member }) => [
                String(score),
                member,
              ]),
            );
        }
      }
    } finally {
      await client.quit();
    }
  });
}

async function seedValkey() {
  const fixture = JSON.parse(
    await readE2eSeedFixture("valkey"),
  ) as RedisSeedFixture;

  await retry("Valkey", async () => {
    const client = new Redis({
      host: valkeyConfig.host,
      port: valkeyConfig.port,
      password: valkeyConfig.password || undefined,
      db: valkeyConfig.database,
      lazyConnect: true,
    });
    await client.connect();
    try {
      for (const command of fixture.commands) {
        switch (command.command) {
          case "SELECT":
            await client.select(command.database);
            break;
          case "FLUSHDB":
            await client.flushdb();
            break;
          case "SET":
            if (command.ttlSeconds) {
              await client.set(
                command.key,
                command.value,
                "EX",
                command.ttlSeconds,
              );
            } else {
              await client.set(command.key, command.value);
            }
            break;
          case "HSET":
            await client.hset(command.key, command.fields);
            break;
          case "XADD":
            await client.xadd(
              command.key,
              command.id,
              ...Object.entries(command.fields).flat(),
            );
            break;
          case "SADD":
            await client.sadd(command.key, ...command.members);
            break;
          case "ZADD":
            await client.zadd(
              command.key,
              ...command.members.flatMap(({ score, member }) => [
                String(score),
                member,
              ]),
            );
        }
      }
    } finally {
      await client.quit();
    }
  });
}

async function seedSearch(runtime: SearchSeedRuntime) {
  const fixture = JSON.parse(
    await readE2eSeedFixture(runtime.fixtureKey),
  ) as SearchSeedFixture;
  const fixtureIndex = fixture.indexes[0]?.name;
  if (!fixtureIndex) {
    throw new Error(
      `${runtime.label} seed fixture requires at least one index`,
    );
  }
  const index = runtime.index;

  await retry(runtime.label, async () => {
    await searchRequest(runtime, "/");
    for (const template of fixture.templates ?? []) {
      await searchRequest(
        runtime,
        `/_index_template/${encodeURIComponent(template.name)}`,
        {
          method: "DELETE",
          allowNotFound: true,
        },
      );
    }
    for (const indexName of new Set([fixtureIndex, index])) {
      await searchRequest(runtime, `/${encodeURIComponent(indexName)}`, {
        method: "DELETE",
        allowNotFound: true,
      });
    }

    const mapping = fixture.mappings.find(
      (item) => item.index === fixtureIndex,
    );
    await searchRequest(runtime, `/${encodeURIComponent(index)}`, {
      method: "PUT",
      body: JSON.stringify({
        mappings: mapping?.raw ?? { properties: {} },
      }),
    });

    for (const template of fixture.templates ?? []) {
      await searchRequest(
        runtime,
        `/_index_template/${encodeURIComponent(template.name)}`,
        {
          method: "PUT",
          body: JSON.stringify(template.raw),
        },
      );
    }

    for (const alias of fixture.aliases ?? []) {
      if (alias.index !== fixtureIndex && alias.index !== index) continue;
      await searchRequest(
        runtime,
        `/${encodeURIComponent(index)}/_alias/${encodeURIComponent(alias.name)}`,
        {
          method: "PUT",
          body: JSON.stringify({ is_write_index: alias.writeIndex ?? false }),
        },
      );
    }

    const bulkBody = fixture.searchResult.hits
      .flatMap((hit) => [
        JSON.stringify({ index: { _index: index, _id: hit.id } }),
        JSON.stringify(hit.source),
      ])
      .join("\n");
    const bulkResult = await searchRequest(runtime, "/_bulk?refresh=true", {
      method: "POST",
      body: `${bulkBody}\n`,
    });
    if (isRecord(bulkResult) && bulkResult.errors === true) {
      throw new Error(
        `${runtime.label} bulk seed failed: ${JSON.stringify(bulkResult)}`,
      );
    }
  });
}

async function seedElasticsearch() {
  await seedSearch({
    label: "Elasticsearch",
    fixtureKey: "elasticsearch",
    ...elasticsearchConfig,
  });
}

async function seedOpenSearch() {
  await seedSearch({
    label: "OpenSearch",
    fixtureKey: "opensearch",
    ...opensearchConfig,
  });
}

async function searchRequest(
  runtime: SearchSeedRuntime,
  path: string,
  options: {
    method?: string;
    body?: string;
    allowNotFound?: boolean;
  } = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (runtime.user || runtime.password) {
    headers.Authorization = `Basic ${Buffer.from(
      `${runtime.user}:${runtime.password}`,
    ).toString("base64")}`;
  }
  const response = await fetch(
    `http://${runtime.host}:${runtime.port}${path}`,
    {
      method: options.method ?? "GET",
      headers,
      body: options.body,
    },
  );
  if (options.allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `${runtime.label} ${options.method ?? "GET"} ${path} failed with ${response.status}: ${await response.text()}`,
    );
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function seedDocumentFilter(document: Document): Document {
  if (document._id !== undefined) return { _id: document._id };
  if (document.email !== undefined) return { email: document.email };
  throw new Error("MongoDB seed documents require _id or email");
}

async function seedTarget(target: SeedTarget) {
  switch (target) {
    case "postgres":
      await seedPostgres();
      return;
    case "mongodb":
      await seedMongo();
      return;
    case "mysql":
      await seedMysql();
      return;
    case "mariadb":
      await seedMariadb();
      return;
    case "mssql":
      await seedMssql();
      return;
    case "oracle":
      await seedOracle();
      return;
    case "redis":
      await seedRedis();
      return;
    case "valkey":
      await seedValkey();
      return;
    case "elasticsearch":
      await seedElasticsearch();
      return;
    case "opensearch":
      await seedOpenSearch();
      return;
  }
}

function specKeyForCurrentRun(): string | null {
  const explicitSpecKey = process.env.E2E_SPEC_KEY?.trim();
  if (explicitSpecKey) return explicitSpecKey;

  const explicitSpec = process.env.E2E_SPEC?.trim();
  return (
    explicitSpec
      ?.split("/")
      .pop()
      ?.replace(/\.spec\.ts$/, "") ?? null
  );
}

function seedTargetsForCurrentRun(
  specKey: string | null,
): readonly SeedTarget[] {
  return specKey
    ? (SEED_TARGETS_BY_SPEC_KEY[specKey] ?? ALL_SEED_TARGETS)
    : ALL_SEED_TARGETS;
}

const seedSpecKey = specKeyForCurrentRun();
const seedTargets = seedTargetsForCurrentRun(seedSpecKey);
for (const target of seedTargets) {
  await seedTarget(target);
}
console.log(
  `[e2e:seed] spec=${seedSpecKey ?? "all-specs"} targets=${seedTargets.length > 0 ? seedTargets.join(", ") : "no external"} smoke fixtures are ready.`,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
