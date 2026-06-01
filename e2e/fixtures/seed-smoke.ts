import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MongoClient, type Document } from "mongodb";
import { createConnection } from "mysql2/promise";
import { Client as PgClient } from "pg";

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

function seedDocumentFilter(document: Document): Document {
  if (document._id !== undefined) return { _id: document._id };
  if (document.email !== undefined) return { email: document.email };
  throw new Error("MongoDB seed documents require _id or email");
}

await seedPostgres();
await seedMongo();
await seedMysql();
await seedMariadb();
console.log(
  "[e2e:seed] Postgres, MongoDB, MySQL, and MariaDB smoke fixtures are ready.",
);
