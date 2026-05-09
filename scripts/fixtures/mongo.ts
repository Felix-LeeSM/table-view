// Mongo dialect: lazy DB creation + bulk insert + embed shaping.
// Embedded relationships (per `mongo.embed` spec) are folded into parent
// documents (kind: 'one' → single object; kind: 'many' → array).
// Embedded child entities are NOT also written as standalone collections.
import { MongoClient } from "mongodb";
import type { ResolvedSpec } from "./spec.js";
import type { EntityRows } from "./generator.js";
import { entityOrder } from "./spec.js";

export interface MongoConnection {
  host: string;
  port: number;
  user: string;
  password: string;
}

export function mongoEnvConn(): MongoConnection {
  return {
    host: process.env.MONGO_HOST ?? "localhost",
    port: Number(process.env.MONGO_PORT ?? 37017),
    user: process.env.MONGO_USER ?? "testuser",
    password: process.env.MONGO_PASSWORD ?? "testpass",
  };
}

function uri(c: MongoConnection): string {
  const u = encodeURIComponent(c.user);
  const p = encodeURIComponent(c.password);
  return `mongodb://${u}:${p}@${c.host}:${c.port}/?authSource=admin`;
}

async function withClient<T>(
  c: MongoConnection,
  fn: (client: MongoClient) => Promise<T>,
): Promise<T> {
  const client = new MongoClient(uri(c));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export async function dropMongoDatabase(
  c: MongoConnection,
  dbName: string,
): Promise<void> {
  await withClient(c, async (client) => {
    await client.db(dbName).dropDatabase();
  });
}

export async function mongoIsPopulated(
  c: MongoConnection,
  dbName: string,
  spec: ResolvedSpec,
): Promise<boolean> {
  const first = entityOrder(spec.base).find((n) =>
    spec.base.entities[n]?.targets.includes("mongo"),
  );
  if (!first) return false;
  const entity = spec.base.entities[first];
  if (!entity?.mongo) return false;
  return withClient(c, async (client) => {
    const col = client.db(dbName).collection(entity.mongo!.collection);
    return (await col.countDocuments({}, { limit: 1 })) > 0;
  });
}

export async function applyMongo(
  c: MongoConnection,
  dbName: string,
  spec: ResolvedSpec,
  rows: EntityRows,
  log: (entity: string, count: number, ms: number) => void,
): Promise<void> {
  // Determine which entities are "embed source only" (children of an embed
  // in a mongo-targeting parent + not directly mongo-targeting). These get
  // skipped at the top-level collection write.
  const embedSources = new Set<string>();
  for (const entity of Object.values(spec.base.entities)) {
    if (!entity.mongo?.embed) continue;
    for (const e of Object.values(entity.mongo.embed)) embedSources.add(e.from);
  }

  await withClient(c, async (client) => {
    const db = client.db(dbName);
    for (const entityName of entityOrder(spec.base)) {
      const entity = spec.base.entities[entityName];
      if (!entity?.mongo || !entity.targets.includes("mongo")) continue;
      // Some entities are mongo-targeted themselves AND embedded into another
      // mongo entity (rare); current spec keeps these disjoint, so we just
      // honor `targets` without further heuristics.
      const data = rows[entityName] ?? [];
      const start = Date.now();
      const docs = data.map((r) => shapeDocument(entityName, r, spec, rows));
      if (docs.length > 0) {
        await db
          .collection(entity.mongo.collection)
          .insertMany(docs, { ordered: false });
      }
      log(entityName, docs.length, Date.now() - start);
      void embedSources;
    }
  });
}

function shapeDocument(
  entityName: string,
  row: Record<string, unknown>,
  spec: ResolvedSpec,
  allRows: EntityRows,
): Record<string, unknown> {
  const entity = spec.base.entities[entityName];
  if (!entity?.mongo) return { ...row };

  const doc: Record<string, unknown> = { ...row };
  // _id from `id` column when present.
  if (typeof doc.id === "string") {
    doc._id = doc.id;
  }

  const embed = entity.mongo.embed ?? {};
  for (const [fieldName, e] of Object.entries(embed)) {
    const childRows = allRows[e.from] ?? [];
    const childEntity = spec.base.entities[e.from];
    // Find the FK column on the child that points back to this entity.
    const fkCol = childEntity
      ? Object.entries(childEntity.columns).find(
          ([, col]) =>
            col.type === "ref" && col.to?.startsWith(entityName + "."),
        )?.[0]
      : undefined;
    if (!fkCol) continue;

    const matched = childRows.filter((cr) => cr[fkCol] === row.id);
    if (e.kind === "many") doc[fieldName] = matched.map(stripIdShape);
    else
      doc[fieldName] =
        matched.length > 0 && matched[0] ? stripIdShape(matched[0]) : null;
  }
  return doc;
}

function stripIdShape(r: Record<string, unknown>): Record<string, unknown> {
  // Embedded sub-docs keep their `id` field but don't get an `_id` (parent's _id is canonical).
  const { ...rest } = r;
  return rest;
}
