// Fixture spec loader + zod validation.
// Reads `fixtures/base.yaml` + `fixtures/profiles/<profile>.yaml`, deep-merges
// into a single `ResolvedSpec`, and validates the column-type vocabulary +
// integrity-metadata constraints documented in
// `docs/fixture-data-workflow-handoff.md`.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const PRIMITIVE_TYPES = [
  "uuid",
  "email",
  "full_name",
  "product_name",
  "sku",
  "phone",
  "address",
  "decimal",
  "int",
  "timestamp",
  "enum",
  "array_of",
  "ref",
  "text",
  "boolean",
  "json",
] as const;

const STRING_TYPES = new Set([
  "email",
  "full_name",
  "product_name",
  "sku",
  "phone",
  "address",
  "text",
  "uuid",
]);

export type ColumnType = (typeof PRIMITIVE_TYPES)[number];
export const isStringType = (t: ColumnType) => STRING_TYPES.has(t);

const ColumnSchema = z
  .object({
    type: z.enum(PRIMITIVE_TYPES),
    primary: z.boolean().optional(),
    unique: z.boolean().optional(),
    nullable: z.boolean().optional(),
    locale_aware: z.boolean().optional(),
    max_length: z.number().int().positive().optional(),
    min_length: z.number().int().nonnegative().optional(),
    range: z
      .tuple([
        z.union([z.number(), z.string()]),
        z.union([z.number(), z.string()]),
      ])
      .optional(),
    values: z.array(z.string()).optional(),
    item: z.string().optional(),
    count: z.tuple([z.number().int(), z.number().int()]).optional(),
    to: z.string().optional(),
  })
  .strict();

const EmbedSchema = z.object({
  from: z.string(),
  kind: z.enum(["one", "many"]),
});

const EntityTargetSchema = z.enum([
  "pg",
  "mongo",
  "mysql",
  "sqlite",
  "duckdb",
  "mariadb",
  "mssql",
  "oracle",
  "redis",
]);

const EntitySchema = z
  .object({
    targets: z.array(EntityTargetSchema).nonempty(),
    pg: z.object({ schema: z.string(), table: z.string() }).optional(),
    mongo: z
      .object({
        collection: z.string(),
        embed: z.record(z.string(), EmbedSchema).optional(),
      })
      .optional(),
    // Sprint 288 — MySQL entity placement. database = schema 라 schema 필드
    // 없이 table 만. yaml 에선 `mysql: { table: customers }` 처럼 사용.
    mysql: z.object({ table: z.string() }).optional(),
    // SQLite uses local database files with table-only placement.
    sqlite: z.object({ table: z.string() }).optional(),
    // DuckDB shares PG's schema+table placement model.
    duckdb: z.object({ schema: z.string(), table: z.string() }).optional(),
    // MariaDB shares MySQL's table-only placement model.
    mariadb: z.object({ table: z.string() }).optional(),
    // MSSQL uses schema.table within the connected database.
    mssql: z.object({ schema: z.string(), table: z.string() }).optional(),
    // Oracle: connected user owns tables, so table-only.
    oracle: z.object({ table: z.string() }).optional(),
    // Redis: key prefix for the entity's hash keys.
    redis: z.object({ key_prefix: z.string() }).optional(),
    columns: z.record(z.string(), ColumnSchema),
  })
  .strict();

const BaseSpecSchema = z
  .object({
    entities: z.record(z.string(), EntitySchema),
  })
  .strict();

const ConnectionSpec = z
  .object({
    id: z
      .string()
      .regex(/^fixture-/, "fixture connection id must be 'fixture-' prefixed"),
    name: z.string(),
    color: z.string().optional(),
    environment: z.string().optional(),
  })
  .strict();

const ProfileSpecSchema = z
  .object({
    seed: z.number().int(),
    database: z.object({
      pg: z.string(),
      mongo: z.string(),
      mysql: z.string().optional(),
      sqlite: z.string().optional(),
      duckdb: z.string().optional(),
      mariadb: z.string().optional(),
      mssql: z.string().optional(),
      oracle: z.string().optional(),
      redis: z.number().int().min(0).max(15).optional(),
    }),
    locale_mix: z.record(z.string(), z.number().min(0).max(1)),
    rows: z.record(z.string(), z.number().int().nonnegative()),
    connections: z
      .object({
        pg: z.array(ConnectionSpec).optional(),
        mongo: z.array(ConnectionSpec).optional(),
        mysql: z.array(ConnectionSpec).optional(),
        sqlite: z.array(ConnectionSpec).optional(),
        duckdb: z.array(ConnectionSpec).optional(),
        mariadb: z.array(ConnectionSpec).optional(),
        mssql: z.array(ConnectionSpec).optional(),
        oracle: z.array(ConnectionSpec).optional(),
        redis: z.array(ConnectionSpec).optional(),
      })
      .optional(),
  })
  .strict();

export type Column = z.infer<typeof ColumnSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type BaseSpec = z.infer<typeof BaseSpecSchema>;
export type ProfileSpec = z.infer<typeof ProfileSpecSchema>;
export type FixtureConnection = z.infer<typeof ConnectionSpec>;

export interface ResolvedSpec {
  profile: string;
  base: BaseSpec;
  profileSpec: ProfileSpec;
}

const FIXTURES_DIR = resolve(process.cwd(), "fixtures");

export function loadSpec(profile: string): ResolvedSpec {
  const basePath = resolve(FIXTURES_DIR, "base.yaml");
  const profPath = resolve(FIXTURES_DIR, "profiles", `${profile}.yaml`);
  if (!existsSync(basePath))
    throw new Error(`fixture base not found: ${basePath}`);
  if (!existsSync(profPath))
    throw new Error(
      `fixture profile not found: ${profPath} (profile=${profile})`,
    );

  const base = BaseSpecSchema.parse(parseYaml(readFileSync(basePath, "utf8")));
  const profileSpec = ProfileSpecSchema.parse(
    parseYaml(readFileSync(profPath, "utf8")),
  );

  validateCoherence(base, profileSpec, profile);

  return { profile, base, profileSpec };
}

function validateCoherence(
  base: BaseSpec,
  profile: ProfileSpec,
  profileName: string,
) {
  // every base entity must have a row count in the profile
  for (const entityName of Object.keys(base.entities)) {
    if (!(entityName in profile.rows)) {
      throw new Error(
        `profile '${profileName}' missing row count for entity '${entityName}'. Add '${entityName}: <n>' to fixtures/profiles/${profileName}.yaml.`,
      );
    }
  }

  // every profile row count must reference a known entity
  for (const rowKey of Object.keys(profile.rows)) {
    if (!(rowKey in base.entities)) {
      throw new Error(
        `profile '${profileName}' references unknown entity '${rowKey}' in rows. Known: ${Object.keys(base.entities).join(", ")}.`,
      );
    }
  }

  // locale_mix sum ~ 1.0
  const sum = Object.values(profile.locale_mix).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(
      `profile '${profileName}' locale_mix must sum to 1.0 (got ${sum.toFixed(4)})`,
    );
  }

  // every ref column points at a known entity column
  for (const [entityName, entity] of Object.entries(base.entities)) {
    for (const [colName, col] of Object.entries(entity.columns)) {
      if (col.type === "ref") {
        if (!col.to)
          throw new Error(`${entityName}.${colName}: ref column missing 'to'`);
        const [refEntity, refCol] = col.to.split(".");
        if (!refEntity || !refCol) {
          throw new Error(
            `${entityName}.${colName}: ref 'to' must be 'entity.column' (got '${col.to}')`,
          );
        }
        const target = base.entities[refEntity];
        if (!target)
          throw new Error(
            `${entityName}.${colName}: ref target entity '${refEntity}' not found`,
          );
        if (!target.columns[refCol]) {
          throw new Error(
            `${entityName}.${colName}: ref target column '${col.to}' not found`,
          );
        }
      }
    }
  }
}

/** Topological sort entities so referenced ones come first. */
export function entityOrder(base: BaseSpec): string[] {
  const visited = new Set<string>();
  const order: string[] = [];

  function visit(name: string, stack: string[]) {
    if (visited.has(name)) return;
    if (stack.includes(name)) {
      throw new Error(
        `circular FK dependency: ${[...stack, name].join(" → ")}`,
      );
    }
    const entity = base.entities[name];
    if (!entity) throw new Error(`unknown entity '${name}'`);
    for (const col of Object.values(entity.columns)) {
      if (col.type === "ref" && col.to) {
        const refEntity = col.to.split(".")[0];
        if (refEntity && refEntity !== name) {
          visit(refEntity, [...stack, name]);
        }
      }
    }
    visited.add(name);
    order.push(name);
  }

  for (const name of Object.keys(base.entities)) visit(name, []);
  return order;
}

export function effectiveColumnConstraints(col: Column) {
  // PK auto-implies nullable=false + unique=true
  const primary = col.primary === true;
  return {
    primary,
    nullable: primary ? false : col.nullable === true,
    unique: primary ? true : col.unique === true,
    maxLength: col.max_length,
    minLength: col.min_length,
  };
}
