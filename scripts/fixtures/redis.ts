// Redis fixture generator — KV pattern using `ioredis`.
// Stores entities as Redis Hashes with key pattern `<prefix>:<id>`.
// Mirrors export shape of other generators where applicable.
//
// A Redis/KV store is browsed key-by-key, not paged as a table, so seeding the
// full row counts (20K+ hashes) drowns every other data type in a wall of
// hashes. We keep only a small SAMPLE of each entity as realistic hashes and
// let the type showcase (redis-showcase.ts) carry the variety, so the KV
// inspector opens on a balanced gallery. Override the sample size with
// REDIS_ENTITY_CAP (a non-numeric value falls back to the default).
import Redis from "ioredis";
import type { ResolvedSpec } from "./spec.js";
import type { EntityRows } from "./generator.js";
import { entityOrder } from "./spec.js";
import { applyRedisShowcase } from "./redis-showcase.js";

const parsedEntityCap = Number(process.env.REDIS_ENTITY_CAP ?? 6);
const ENTITY_CAP = Number.isFinite(parsedEntityCap)
  ? Math.max(0, Math.floor(parsedEntityCap))
  : 6;

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
      // Sample, don't bulk-load: a handful of realistic hashes per entity is
      // enough for the KV viewer; the rest would just bury the other types.
      const data = (rows[entityName] ?? []).slice(0, ENTITY_CAP);
      const start = Date.now();
      await insertEntity(client, entity, data);
      log(entityName, data.length, Date.now() - start);
    }
    // Redis type gallery (string/hash/list/set/zset/stream/json) so every shape
    // the KV inspector renders is visible. Dev-profile only so e2e/CI seed
    // shapes stay unchanged — same gating as applyPgShowcase.
    if (spec.profile === "development") {
      await applyRedisShowcase(client, log);
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
