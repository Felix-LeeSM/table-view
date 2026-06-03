import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MongoClient, type Document } from "mongodb";
import { createConnection } from "mysql2/promise";
import { Client as PgClient } from "pg";
import Redis from "ioredis";

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
  const sql = await readFile(resolve("e2e/fixtures/seed.sql"), "utf-8");
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
    await readFile(resolve("e2e/fixtures/seed.mongodb.json"), "utf-8"),
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
  const sql = await readFile(resolve("e2e/fixtures/seed.mysql.sql"), "utf-8");
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
  const sql = await readFile(resolve("e2e/fixtures/seed.mariadb.sql"), "utf-8");
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

async function seedRedis() {
  const fixture = JSON.parse(
    await readFile(resolve("e2e/fixtures/seed.redis.json"), "utf-8"),
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
    await readFile(resolve("e2e/fixtures/seed.valkey.json"), "utf-8"),
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

function seedDocumentFilter(document: Document): Document {
  if (document._id !== undefined) return { _id: document._id };
  if (document.email !== undefined) return { email: document.email };
  throw new Error("MongoDB seed documents require _id or email");
}

await seedPostgres();
await seedMongo();
await seedMysql();
await seedMariadb();
await seedRedis();
await seedValkey();
console.log(
  "[e2e:seed] Postgres, MongoDB, MySQL, MariaDB, Redis, and Valkey smoke fixtures are ready.",
);
