// Redis type showcase — a balanced gallery with several curated keys per shape
// the app's KV inspector renders, so a dev opens the store on a spread of every
// Redis data type instead of a wall of one. (The entity hashes are capped to a
// small sample in redis.ts for the same reason.) Mirrors pg-showcase.ts: a
// hand-authored gallery (not Faker-generated), idempotent (each key DEL'd
// before write), applied inside applyRedis under the `showcase:` namespace so
// it never collides with the sampled entity hashes (customer:*, product:*,
// order:*, ticket:*).
//
// The app (src-tauri/src/db/redis) dispatches on Redis TYPE and renders exactly
// these seven shapes — so those are the seven the gallery covers:
//   string  — GET; raw <pre>, or a JSON-tree when the value parses to obj/array
//   hash    — HSCAN;  field/value table
//   list    — LRANGE; index/value table
//   set     — SSCAN;  member table
//   zset    — ZRANGE WITHSCORES; member/score table
//   stream  — XRANGE; id/fields reader panel
//   json    — JSON.GET (RedisJSON module); DocumentTree
//
// bitmap / hyperloglog / geo are intentionally omitted: Redis TYPE reports them
// as string / string / zset, so the app has no dedicated renderer — they'd add
// noise, not a new view.
//
// RedisJSON needs the ReJSON module (Redis Stack). If it's absent, JSON.SET
// fails and only that one key is logged-and-skipped, exactly like pg-showcase
// skips an xml table on a libxml-less build.
import type Redis from "ioredis";

const NS = "showcase";

// Edge strings mirror generator.ts's EDGE_* so the showcase exercises the same
// unicode / RTL / emoji / control-char paths the row generator does.
const EDGE_EMOJI = "🌟⭐ 안녕 👋 こんにちは";
const EDGE_RTL = "שלום عالم — مرحبا";
const EDGE_MULTILINE = 'line1\nline2 "quoted" \t\\ end';

// Extra elements appended to a few paging-sensitive collections so SSCAN/HSCAN
// cursors and LRANGE/ZRANGE limits are exercised — enough to page, not so many
// they dwarf the rest of the gallery. Env-overridable like pg-showcase's
// SHOWCASE_ROWS; a non-numeric value falls back to the default.
const parsedBulk = Number(process.env.REDIS_SHOWCASE_ROWS ?? 40);
const BULK = Number.isFinite(parsedBulk)
  ? Math.max(0, Math.floor(parsedBulk))
  : 40;

export type ShowcaseEntry =
  | { key: string; kind: "string"; value: string; ttl?: number; note: string }
  | { key: string; kind: "binary"; hex: string; ttl?: number; note: string }
  | {
      key: string;
      kind: "hash";
      fields: [string, string][];
      ttl?: number;
      note: string;
    }
  | { key: string; kind: "list"; items: string[]; ttl?: number; note: string }
  | { key: string; kind: "set"; members: string[]; ttl?: number; note: string }
  | {
      key: string;
      kind: "zset";
      // score `Infinity` / `-Infinity` map to Redis `+inf` / `-inf` at apply.
      members: [string, number][];
      ttl?: number;
      note: string;
    }
  | {
      key: string;
      kind: "stream";
      entries: { id: string; fields: [string, string][] }[];
      ttl?: number;
      note: string;
    }
  | { key: string; kind: "json"; value: unknown; ttl?: number; note: string };

export const KINDS = [
  "string",
  "binary",
  "hash",
  "list",
  "set",
  "zset",
  "stream",
  "json",
] as const;

/** Number of top-level elements a key holds (for the seed log). */
function elementCount(e: ShowcaseEntry): number {
  switch (e.kind) {
    case "hash":
      return e.fields.length;
    case "list":
      return e.items.length;
    case "set":
      return e.members.length;
    case "zset":
      return e.members.length;
    case "stream":
      return e.entries.length;
    default:
      return 1;
  }
}

/**
 * The gallery. Pure + deterministic so it can be asserted offline (see
 * redis-showcase.test.ts) exactly like pg-showcase's buildBlocks.
 * `bulk` extra elements are appended to the paging-sensitive collections.
 */
export function buildShowcase(bulk: number = BULK): ShowcaseEntry[] {
  const n = Math.max(0, bulk);
  // `from..from+n-1`, used to bulk-fill a few paging-sensitive collections.
  const seq = (from: number) => Array.from({ length: n }, (_, i) => i + from);

  return [
    // ── strings — five ways the app renders a plain Redis string ────────────
    {
      key: `${NS}:string:counter`,
      kind: "string",
      value: "42",
      note: "bare scalar → raw <pre> (not JSON-tree: scalars aren't tree-capable)",
    },
    {
      key: `${NS}:string:config`,
      kind: "string",
      // A utf8 string that *parses* to an object → app renders a JSON tree,
      // no RedisJSON module needed. Covers the commit-0e8188fd smart renderer.
      value: JSON.stringify({
        theme: "dark",
        pageSize: 50,
        features: ["kv", "erd", "slow-query"],
        locale: "ko-KR",
        nested: { retries: 3, note: EDGE_EMOJI, nil: null },
      }),
      note: "JSON-object string → DocumentTree",
    },
    {
      key: `${NS}:string:greeting`,
      kind: "string",
      value: `${EDGE_EMOJI} · ${EDGE_RTL}\n${EDGE_MULTILINE}`,
      note: "non-JSON unicode/RTL/multiline utf8 → raw <pre>",
    },
    {
      key: `${NS}:string:binary`,
      kind: "binary",
      // Non-utf8 bytes (a PNG signature + noise) → app falls back to hex view.
      hex: "89504e470d0a1a0a0000000d49484452deadbeef00ff",
      note: "non-utf8 binary → hex view",
    },
    {
      key: `${NS}:string:session`,
      kind: "string",
      value: "sess_9f8b7a6c5d4e3f2a1b0c",
      ttl: 3600,
      note: "TTL badge → expires state (Timer icon, {n}s)",
    },

    // ── hashes ───────────────────────────────────────────────────────────────
    {
      key: `${NS}:hash:user:1001`,
      kind: "hash",
      fields: [
        ["name", "Aoi 葵"],
        ["email", "aoi@example.jp"],
        ["locale", "ja-JP"],
        ["balance", "1299.99"],
        ["bio", EDGE_EMOJI],
        ["verified", "true"],
      ],
      note: "field/value table + unicode fields",
    },
    {
      key: `${NS}:hash:product:sku-42`,
      kind: "hash",
      fields: [
        ["title", "메카니컬 키보드 ⌨️"],
        ["price", "129.00"],
        ["currency", "USD"],
        ["stock", "37"],
        ["rating", "4.7"],
      ],
      note: "second hash so the type isn't a singleton",
    },
    {
      key: `${NS}:hash:cart:session-7`,
      kind: "hash",
      fields: [
        ["sku-42", "1"],
        ["sku-88", "3"],
        ["coupon", "WELCOME10"],
      ],
      ttl: 1800,
      note: "hash + TTL (an ephemeral cart)",
    },

    // ── lists (ordered, RPUSH) ───────────────────────────────────────────────
    {
      key: `${NS}:list:deploy-log`,
      kind: "list",
      items: [
        "build started",
        "tests: 128 passed",
        "artifact pushed 📦",
        EDGE_RTL,
        "deploy ok ✅",
        ...seq(1).map((i) => `event ${i}`),
      ],
      note: "index/value table (ordered); bulk-filled for LRANGE paging",
    },
    {
      key: `${NS}:list:queue:emails`,
      kind: "list",
      items: ["welcome@a.com", "receipt@b.jp", "digest@c.kr", "alert@d.de"],
      note: "short FIFO queue",
    },
    {
      key: `${NS}:list:recent-searches`,
      kind: "list",
      items: ["기계식 키보드", "usb-c dock", "モニター", "🖱️ mouse"],
      note: "unicode list items",
    },

    // ── sets (unordered unique, SADD) ────────────────────────────────────────
    {
      key: `${NS}:set:tags`,
      kind: "set",
      members: [
        "featured",
        "sale",
        "신상품",
        "🌟",
        "clearance",
        ...seq(1).map((i) => `tag-${i}`),
      ],
      note: "member table; bulk-filled for SSCAN cursor paging",
    },
    {
      key: `${NS}:set:online-users`,
      kind: "set",
      members: ["u-1001", "u-1002", "u-1042", "u-2007"],
      ttl: 60,
      note: "set + short TTL (presence)",
    },
    {
      key: `${NS}:set:countries`,
      kind: "set",
      members: ["🇰🇷 KR", "🇯🇵 JP", "🇩🇪 DE", "🇧🇷 BR"],
      note: "unicode/emoji members",
    },

    // ── zsets (member/score, ZADD) ───────────────────────────────────────────
    {
      key: `${NS}:zset:leaderboard`,
      kind: "zset",
      members: [
        ["alice", 1500],
        ["보라 🥇", 1499.5],
        ["carol", 0],
        ["dave", -42],
        ["ceiling", Infinity],
        ["floor", -Infinity],
        ...seq(1).map((i): [string, number] => [`player-${i}`, i]),
      ],
      note: "member/score incl. +inf/-inf/negative/float; ZRANGE paging",
    },
    {
      key: `${NS}:zset:trending`,
      kind: "zset",
      members: [
        ["keyboard", 92],
        ["monitor", 71],
        ["dock", 55],
        ["mouse 🖱️", 33],
      ],
      note: "small ranked set",
    },
    {
      key: `${NS}:zset:latency-ms`,
      kind: "zset",
      members: [
        ["p50", 12.5],
        ["p90", 48.2],
        ["p99", 210.7],
        ["p999", 1503.4],
      ],
      note: "float scores",
    },

    // ── streams (XADD id + fields) ───────────────────────────────────────────
    {
      key: `${NS}:stream:orders`,
      kind: "stream",
      entries: [
        {
          id: "1-1",
          fields: [
            ["event", "created"],
            ["order_id", "A-1001"],
            ["amount", "42.00"],
          ],
        },
        {
          id: "2-1",
          fields: [
            ["event", "paid"],
            ["order_id", "A-1001"],
            ["note", EDGE_EMOJI],
          ],
        },
        {
          id: "3-1",
          fields: [
            ["event", "shipped"],
            ["order_id", "A-1001"],
            ["carrier", "DHL"],
          ],
        },
        ...seq(4).map((i) => ({
          id: `${i}-1`,
          fields: [
            ["event", "tick"],
            ["seq", String(i)],
          ] as [string, string][],
        })),
      ],
      note: "id/fields reader panel; bulk-filled for XRANGE paging",
    },
    {
      key: `${NS}:stream:sensor`,
      kind: "stream",
      entries: [
        {
          id: "1-1",
          fields: [
            ["temp_c", "21.4"],
            ["humidity", "48"],
          ],
        },
        {
          id: "2-1",
          fields: [
            ["temp_c", "21.6"],
            ["humidity", "47"],
          ],
        },
      ],
      note: "second stream (sensor telemetry)",
    },

    // ── RedisJSON (module-gated; best-effort, skipped without ReJSON) ────────
    {
      key: `${NS}:json:profile`,
      kind: "json",
      value: {
        id: "u-1001",
        name: "Aoi 葵",
        active: true,
        score: 1499.5,
        tags: ["featured", "🌟", "신상품"],
        address: { city: "Tokyo 東京", zip: null },
        history: [
          { at: "2025-06-01", action: "signup" },
          { at: "2025-06-02", action: "purchase", total: 42 },
        ],
      },
      note: "RedisJSON → DocumentTree (needs ReJSON module; skipped if absent)",
    },
    {
      key: `${NS}:json:feature-flags`,
      kind: "json",
      value: {
        kv_write: true,
        erd: true,
        slow_query: false,
        rollout: { pct: 25, cohorts: ["beta", "internal"] },
      },
      note: "second RedisJSON document (feature flags)",
    },
  ];
}

/**
 * Apply the showcase into the connected Redis db. Best-effort per key: a key
 * that fails (e.g. a `json` key on a Redis without the ReJSON module) is logged
 * and skipped so the rest of the gallery still lands. Assumes it runs after the
 * entity hashes within the same applyRedis client.
 */
export async function applyRedisShowcase(
  client: Redis,
  log: (entity: string, count: number, ms: number) => void,
): Promise<void> {
  for (const entry of buildShowcase()) {
    const start = Date.now();
    try {
      await writeEntry(client, entry);
      log(entry.key, elementCount(entry), Date.now() - start);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`${entry.key} <skipped: ${msg}>`, 0, Date.now() - start);
    }
  }
}

async function writeEntry(client: Redis, e: ShowcaseEntry): Promise<void> {
  // RedisJSON has no pipeline helper in ioredis; issue it directly (and let a
  // missing-module error propagate to the per-key catch).
  if (e.kind === "json") {
    await client.del(e.key);
    await client.call("JSON.SET", e.key, "$", JSON.stringify(e.value));
    if (e.ttl) await client.expire(e.key, e.ttl);
    return;
  }

  const p = client.pipeline();
  p.del(e.key);
  switch (e.kind) {
    case "string":
      p.set(e.key, e.value);
      break;
    case "binary":
      p.set(e.key, Buffer.from(e.hex, "hex"));
      break;
    case "hash":
      p.hset(e.key, Object.fromEntries(e.fields));
      break;
    case "list":
      p.rpush(e.key, ...e.items);
      break;
    case "set":
      p.sadd(e.key, ...e.members);
      break;
    case "zset": {
      const args = e.members.flatMap(([m, s]) => [redisScore(s), m]);
      p.zadd(e.key, ...args);
      break;
    }
    case "stream":
      for (const entry of e.entries) {
        p.xadd(e.key, entry.id, ...entry.fields.flat());
      }
      break;
  }
  if (e.ttl) p.expire(e.key, e.ttl);

  const results = await p.exec();
  // pipeline.exec resolves with per-command [err, reply]; surface the first err
  // so a bad command is caught and logged, not silently swallowed.
  const failed = results?.find(([err]) => err);
  if (failed?.[0]) throw failed[0];
}

/** Redis wants the literal tokens `+inf` / `-inf`, not JS `Infinity`. */
export function redisScore(score: number): string | number {
  if (score === Infinity) return "+inf";
  if (score === -Infinity) return "-inf";
  return score;
}
