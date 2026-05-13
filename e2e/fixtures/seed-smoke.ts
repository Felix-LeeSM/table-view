import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
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
  const uri = `mongodb://${encodeURIComponent(mongoConfig.user)}:${encodeURIComponent(
    mongoConfig.password,
  )}@${mongoConfig.host}:${mongoConfig.port}/${mongoConfig.authDb}`;

  await retry("MongoDB", async () => {
    const client = new MongoClient(uri);
    await client.connect();
    try {
      const db = client.db(mongoConfig.database);
      const collection = db.collection("smoke_users");
      await collection.createIndex({ email: 1 }, { unique: true });
      await collection.updateOne(
        { email: "mona@example.com" },
        {
          $set: {
            name: "Mona",
            email: "mona@example.com",
            role: "smoke",
          },
        },
        { upsert: true },
      );
    } finally {
      await client.close();
    }
  });
}

await seedPostgres();
await seedMongo();
console.log("[e2e:seed] Postgres and MongoDB smoke fixtures are ready.");
