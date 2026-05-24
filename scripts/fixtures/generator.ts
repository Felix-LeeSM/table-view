// Faker-driven row generator with edge integrity gating.
// Produces an in-memory `EntityRows` map keyed by entity name; downstream
// dialect modules (postgres.ts, mongo.ts) consume those rows. FK columns
// reference IDs of already-generated rows (uniform random); edge values
// only inject categories compatible with the column's metadata.
import { Faker, ko, ja, zh_CN, en, base as fakerBase } from "@faker-js/faker";
import type {
  BaseSpec,
  Column,
  FixtureConnection,
  ProfileSpec,
  ResolvedSpec,
} from "./spec.js";
import { effectiveColumnConstraints, entityOrder } from "./spec.js";

const LOCALES = {
  en: new Faker({ locale: [en, fakerBase] }),
  ko: new Faker({ locale: [ko, en, fakerBase] }),
  ja: new Faker({ locale: [ja, en, fakerBase] }),
  zh: new Faker({ locale: [zh_CN, en, fakerBase] }),
} as const;

type LocaleKey = keyof typeof LOCALES | "edge";

export type Row = Record<string, unknown>;
export type EntityRows = Record<string, Row[]>;

const EDGE_LONG = "x".repeat(2048);
const EDGE_RTL = "שלום عالم — مرحبا";
const EDGE_EMOJI = "🌟⭐ 안녕 👋 こんにちは";
const EDGE_QUOTES = `line1\nline2 "quoted" 'apos' \t\\`;

interface GenerateContext {
  faker: Faker;
  rng: () => number;
  base: BaseSpec;
  profile: ProfileSpec;
  rows: EntityRows;
}

/**
 * Generate every entity's rows in topological FK order.
 * Returns a map keyed by entity name; each value is an array of plain JS
 * objects (one per row), with column names as keys.
 */
export function generateAll(spec: ResolvedSpec): EntityRows {
  const order = entityOrder(spec.base);
  const rows: EntityRows = {};
  // Seeded RNG for picking locale + edge categories deterministically.
  const rootFaker = new Faker({ locale: [en, fakerBase] });
  rootFaker.seed(spec.profileSpec.seed);

  // Seed each locale faker with a *distinct* offset. With identical seeds
  // the locale fakers' RNG streams are bit-identical, so locale-A row 1
  // and locale-B row 1 produce the same UUID — guaranteed PK collisions.
  let off = 0;
  for (const f of Object.values(LOCALES)) f.seed(spec.profileSpec.seed + off++);

  const rng = () => rootFaker.number.float({ min: 0, max: 1 });

  // Build per-entity unique-column indices once for fast O(1) duplicate
  // probing during validation. Without these, validation is O(N²) and
  // becomes the dominant cost for development-scale row counts.
  const uniqueIndex: Record<string, Map<string, Set<unknown>>> = {};

  for (const entityName of order) {
    const entity = spec.base.entities[entityName];
    if (!entity) continue;
    const count = spec.profileSpec.rows[entityName] ?? 0;
    const out: Row[] = [];
    const uniqueCols = new Map<string, Set<unknown>>();
    for (const [colName, col] of Object.entries(entity.columns)) {
      const c = effectiveColumnConstraints(col);
      if (c.unique) uniqueCols.set(colName, new Set());
    }
    uniqueIndex[entityName] = uniqueCols;

    for (let i = 0; i < count; i++) {
      // Per-doc 3 retries on validation failure: regenerate the row a few
      // times before declaring the spec over-constrained. Each retry has a
      // fresh RNG state because pickLocale + generateRow advance the
      // shared rng() stream on every call, so retries don't redraw the
      // same value.
      let row: Row | undefined;
      let lastErr: Error | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        const locale = pickLocale(rng, spec.profileSpec.locale_mix);
        const candidate = generateRow(entity.columns, locale, {
          faker: LOCALES[locale === "edge" ? "en" : locale],
          rng,
          base: spec.base,
          profile: spec.profileSpec,
          rows,
        });
        try {
          validateRowConstraints(
            entityName,
            candidate,
            entity.columns,
            uniqueCols,
          );
          row = candidate;
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
        }
      }
      if (!row) {
        throw new Error(
          `${entityName}: row ${i} could not be generated within 3 retries — ${lastErr?.message ?? "unknown"}.\n` +
            `This usually means the spec is over-constrained (e.g. unique enum with too few values for the row count).`,
        );
      }
      // Update unique-column indices with the accepted row.
      for (const [colName, seen] of uniqueCols) seen.add(row[colName]);
      out.push(row);
    }
    rows[entityName] = out;
  }
  return rows;
}

function pickLocale(rng: () => number, mix: Record<string, number>): LocaleKey {
  const r = rng();
  let acc = 0;
  for (const [k, v] of Object.entries(mix)) {
    acc += v;
    if (r < acc) return k as LocaleKey;
  }
  return "en";
}

function generateRow(
  columns: Record<string, Column>,
  locale: LocaleKey,
  ctx: GenerateContext,
): Row {
  const row: Row = {};
  // Pre-compute edge column choice (single string column gets edge value)
  let edgeColumn: string | null = null;
  if (locale === "edge") {
    const eligibleCols = Object.entries(columns)
      .filter(([, col]) => isEdgeEligible(col))
      .map(([name]) => name);
    if (eligibleCols.length > 0) {
      edgeColumn =
        eligibleCols[Math.floor(ctx.rng() * eligibleCols.length)] ?? null;
    }
  }

  for (const [name, col] of Object.entries(columns)) {
    if (edgeColumn === name) {
      row[name] = pickEdgeValue(col, ctx);
    } else {
      row[name] = generateNormalValue(col, locale, ctx);
    }
  }
  return row;
}

function isEdgeEligible(col: Column): boolean {
  // Edge values target string-y columns. PK / FK / non-string types are excluded.
  if (col.primary) return false;
  if (col.type === "ref") return false;
  return (
    col.type === "email" ||
    col.type === "full_name" ||
    col.type === "product_name" ||
    col.type === "phone" ||
    col.type === "address" ||
    col.type === "text"
  );
}

function pickEdgeValue(col: Column, ctx: GenerateContext): unknown {
  const c = effectiveColumnConstraints(col);
  const candidates: Array<[string, unknown]> = [];

  // Every fixed-string edge category produces a *single canonical value*
  // (e.g. EDGE_EMOJI is the same string every time). For UNIQUE columns
  // this means at most one row in the entire dataset could use any given
  // category — and with locale_mix.edge typically 1-15% of rows, multiple
  // edge rows targeting the same UNIQUE column would collide. So unique
  // columns get NO fixed-string edges; they fall through to a normal
  // value. (`null` itself counts as a unique value, so at most one
  // nullable+unique column row can be null — we still allow it.)
  if (c.nullable) candidates.push(["null", null]);
  if (!c.unique) {
    if (!c.minLength) candidates.push(["empty", ""]);
    if (!c.maxLength || c.maxLength >= EDGE_LONG.length)
      candidates.push(["very_long", EDGE_LONG]);
    if (!c.maxLength || c.maxLength >= EDGE_EMOJI.length)
      candidates.push(["emoji", EDGE_EMOJI]);
    if (!c.maxLength || c.maxLength >= EDGE_RTL.length)
      candidates.push(["rtl", EDGE_RTL]);
    if (!c.maxLength || c.maxLength >= EDGE_QUOTES.length)
      candidates.push(["quotes_newlines", EDGE_QUOTES]);
  }

  if (candidates.length === 0) {
    return generateNormalValue(col, "en", ctx);
  }
  const idx = Math.floor(ctx.rng() * candidates.length);
  const value = candidates[idx]?.[1];
  // truncate very_long if column has max_length set but allowed it
  if (
    typeof value === "string" &&
    col.max_length &&
    value.length > col.max_length
  ) {
    return value.slice(0, col.max_length);
  }
  return value;
}

function generateNormalValue(
  col: Column,
  locale: LocaleKey,
  ctx: GenerateContext,
): unknown {
  const f = ctx.faker;
  switch (col.type) {
    case "uuid":
      return f.string.uuid();
    case "email":
      return f.internet.email().toLowerCase();
    case "full_name":
      return f.person.fullName();
    case "product_name":
      return f.commerce.productName();
    case "sku":
      return f.string.alphanumeric({ length: 8, casing: "upper" });
    case "phone":
      return f.phone.number();
    case "address":
      return f.location.streetAddress();
    case "decimal": {
      const [min, max] = (col.range as [number, number]) ?? [0, 100];
      return Number(f.number.float({ min, max, fractionDigits: 2 }).toFixed(2));
    }
    case "int": {
      const [min, max] = (col.range as [number, number]) ?? [0, 100];
      return f.number.int({ min, max });
    }
    case "timestamp": {
      const { from, to } = parseRangeDays(col.range);
      return f.date.between({ from, to }).toISOString();
    }
    case "enum":
      return f.helpers.arrayElement(col.values ?? ["a"]);
    case "boolean":
      return f.datatype.boolean();
    case "text":
      return f.lorem.sentence();
    case "json":
      return { tag: f.lorem.word(), n: f.number.int({ min: 0, max: 100 }) };
    case "array_of": {
      const [lo, hi] = col.count ?? [0, 3];
      const n = f.number.int({ min: lo, max: hi });
      return Array.from({ length: n }, () => f.lorem.word());
    }
    case "ref": {
      const refKey = col.to ?? "";
      const [entity, idCol] = refKey.split(".");
      const target = entity ? ctx.rows[entity] : undefined;
      if (!target || target.length === 0) {
        if (effectiveColumnConstraints(col).nullable) return null;
        throw new Error(
          `ref '${refKey}' has no rows generated yet (FK ordering bug or empty target).`,
        );
      }
      const picked = target[Math.floor(ctx.rng() * target.length)];
      if (!picked || idCol === undefined) return null;
      return picked[idCol];
    }
    default:
      return null;
  }
}

function parseRangeDays(range: Column["range"]): { from: Date; to: Date } {
  const now = Date.now();
  const decode = (v: unknown): Date => {
    if (typeof v === "number") return new Date(now + v * 86400000);
    if (typeof v === "string") {
      const m = /^(-?\d+)d$/.exec(v);
      if (m && m[1]) return new Date(now + Number(m[1]) * 86400000);
      return new Date(v);
    }
    return new Date(now);
  };
  const [a, b] = (range ?? ["-365d", "0d"]) as [unknown, unknown];
  const from = decode(a);
  const to = decode(b);
  return from <= to ? { from, to } : { from: to, to: from };
}

function validateRowConstraints(
  entityName: string,
  row: Row,
  columns: Record<string, Column>,
  uniqueIndex: Map<string, Set<unknown>>,
): void {
  for (const [colName, col] of Object.entries(columns)) {
    const c = effectiveColumnConstraints(col);
    const value = row[colName];

    if (!c.nullable && value === null) {
      throw new Error(`${entityName}.${colName}: NOT NULL violated (got null)`);
    }
    if (
      c.maxLength &&
      typeof value === "string" &&
      value.length > c.maxLength
    ) {
      throw new Error(
        `${entityName}.${colName}: max_length=${c.maxLength} violated (got length=${value.length})`,
      );
    }
    if (c.unique && value !== null) {
      const seen = uniqueIndex.get(colName);
      if (seen?.has(value)) {
        throw new Error(
          `${entityName}.${colName}: UNIQUE violated (duplicate value '${String(value).slice(0, 60)}')`,
        );
      }
    }
  }
}

type FixtureTarget =
  | "pg"
  | "mongo"
  | "mysql"
  | "sqlite"
  | "duckdb"
  | "mariadb"
  | "mssql"
  | "oracle"
  | "redis";

export function flattenConnections(profile: ProfileSpec): Array<{
  spec: FixtureConnection;
  target: FixtureTarget;
}> {
  const out: Array<{ spec: FixtureConnection; target: FixtureTarget }> = [];
  for (const c of profile.connections?.pg ?? [])
    out.push({ spec: c, target: "pg" });
  for (const c of profile.connections?.mongo ?? [])
    out.push({ spec: c, target: "mongo" });
  for (const c of profile.connections?.mysql ?? [])
    out.push({ spec: c, target: "mysql" });
  for (const c of profile.connections?.sqlite ?? [])
    out.push({ spec: c, target: "sqlite" });
  for (const c of profile.connections?.duckdb ?? [])
    out.push({ spec: c, target: "duckdb" });
  for (const c of profile.connections?.mariadb ?? [])
    out.push({ spec: c, target: "mariadb" });
  for (const c of profile.connections?.mssql ?? [])
    out.push({ spec: c, target: "mssql" });
  for (const c of profile.connections?.oracle ?? [])
    out.push({ spec: c, target: "oracle" });
  for (const c of profile.connections?.redis ?? [])
    out.push({ spec: c, target: "redis" });
  return out;
}
