// Redis fixture generator — KV pattern using `ioredis`.
// Stores entities as Redis Hashes with key pattern `<prefix>:<id>`.
// Mirrors export shape of other generators where applicable.
import Redis from "ioredis";
import type { ResolvedSpec } from "./spec.js";
import type { EntityRows } from "./generator.js";
import { entityOrder } from "./spec.js";

export interface RedisConnection {
  host: string;
  port: number;
  password: string;
  db: number;
}

export function redisEnvConn(db: number): RedisConnection {
  return {
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD ?? "",
    db,
  };
}

function createClient(conn: RedisConnection): Redis {
  return new Redis({
    host: conn.host,
    port: conn.port,
    password: conn.password || undefined,
    db: conn.db,
    lazyConnect: true,
  });
}

async function withClient<T>(
  conn: RedisConnection,
  fn: (client: Redis) => Promise<T>,
): Promise<T> {
  const client = createClient(conn);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.quit();
  }
}

// Ensure is a no-op — Redis creates DBs implicitly on first write.
export async function ensureRedisDatabase(
  conn: RedisConnection,
): Promise<void> {
  await withClient(conn, async (client) => {
    await client.ping();
  });
}

export async function dropRedisDatabase(conn: RedisConnection): Promise<void> {
  await withClient(conn, async (client) => {
    await client.flushdb();
  });
}

export async function redisIsPopulated(
  conn: RedisConnection,
  spec: ResolvedSpec,
): Promise<boolean> {
  const first = entityOrder(spec.base).find((n) =>
    spec.base.entities[n]?.targets.includes("redis"),
  );
  if (!first) return false;
  const entity = spec.base.entities[first];
  if (!entity?.redis) return false;
  return withClient(conn, async (client) => {
    const key = `${entity.redis.key_prefix}:*`;
    const keys = await client.keys(key);
    return keys.length > 0;
  });
}

export async function applyRedis(
  conn: RedisConnection,
  spec: ResolvedSpec,
  rows: EntityRows,
  log: (entity: string, count: number, ms: number) => void,
): Promise<void> {
  await withClient(conn, async (client) => {
    for (const entityName of entityOrder(spec.base)) {
      const entity = spec.base.entities[entityName];
      if (!entity || !entity.redis || !entity.targets.includes("redis"))
        continue;
      const data = rows[entityName] ?? [];
      const start = Date.now();
      await insertEntity(client, entity, data);
      log(entityName, data.length, Date.now() - start);
    }
  });
}

async function insertEntity(
  client: Redis,
  entity: {
    redis?: { key_prefix: string };
    columns: Record<string, unknown>;
  },
  data: Record<string, unknown>[],
): Promise<void> {
  if (!entity.redis || data.length === 0) return;
  const prefix = entity.redis.key_prefix;

  // Find the PK column for the key suffix
  const pkCol = Object.entries(entity.columns).find(
    ([, col]) => (col as { primary?: boolean }).primary,
  )?.[0];

  const pipeline = client.pipeline();
  for (const row of data) {
    const id = pkCol ? String(row[pkCol] ?? "") : String(Math.random());
    const key = `${prefix}:${id}`;

    // Flatten row to string values for HSET
    const hashFields: Record<string, string> = {};
    for (const [colName, value] of Object.entries(row)) {
      if (value === null || value === undefined) continue;
      hashFields[colName] =
        typeof value === "object" ? JSON.stringify(value) : String(value);
    }

    pipeline.hset(key, hashFields);

    // Add to entity set for enumeration
    pipeline.sadd(`idx:${prefix}`, id);
  }

  await pipeline.exec();
}
