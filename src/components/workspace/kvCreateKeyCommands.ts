import { buildStreamAddMutation, redisToken } from "./kvMutationCommands";

// New-key composer (type-first, PR1 of the KV UX redesign). Pure command/logic
// layer so the dialog view and its tests share one builder — the previewed
// command is exactly what runs (preview == execution), and every operand goes
// through `redisToken` so an injection value ("; FLUSHALL) collapses into a
// single quoted token instead of a second command.
//
// Physical constraint: Redis cannot hold an empty aggregate (an empty
// hash/list/set/zSet/stream is GC'd on creation), so aggregate types require at
// least one first value here. `string`/`json` create from a single value.

export type KvCreateType =
  | "string"
  | "json"
  | "hash"
  | "list"
  | "set"
  | "zSet"
  | "stream";

// Selector order — string/json (single value) first, then the aggregate types.
export const KV_CREATE_TYPES: readonly KvCreateType[] = [
  "string",
  "json",
  "hash",
  "list",
  "set",
  "zSet",
  "stream",
] as const;

// a/b pair — hash(field,value) · zSet(score,member) · stream(field,value).
export interface KvPairInput {
  a: string;
  b: string;
}

export interface KvCreateForm {
  type: KvCreateType;
  key: string;
  ttl: string; // string EX seconds (optional); string type only
  stringValue: string;
  jsonValue: string;
  pairs: KvPairInput[]; // hash / zSet / stream
  items: string[]; // list / set
  streamId: string; // stream entry id (default "*")
}

export function emptyCreateForm(type: KvCreateType = "string"): KvCreateForm {
  return {
    type,
    key: "",
    ttl: "",
    stringValue: "",
    jsonValue: "",
    pairs: [{ a: "", b: "" }],
    items: [""],
    streamId: "*",
  };
}

// i18n error descriptor — the pure layer stays translation-free; the dialog
// resolves `key`/`params` through `t`.
export interface KvCreateError {
  key: string;
  params?: Record<string, string | number>;
}

export interface KvCreatePlan {
  // "string" runs via the typed set_kv_string_value (rejectOverwrite/NX); every
  // other type runs the `command` string verbatim through execute_kv_command.
  via: "string" | "command";
  command: string; // preview + (command path) the exact executed string
  label: string;
  value?: string; // via "string"
  ttlSeconds?: number; // via "string"
}

export type KvCreateBuildResult =
  | { ok: true; plan: KvCreatePlan }
  | { ok: false; error: KvCreateError };

function err(
  key: string,
  params?: KvCreateError["params"],
): KvCreateBuildResult {
  return { ok: false, error: { key, params } };
}

function parseTtl(raw: string): { ttlSeconds?: number; error?: KvCreateError } {
  const t = raw.trim();
  if (t === "") return {};
  // Match the backend `ttlSeconds must be > 0` grammar: positive integer only.
  if (!/^\d+$/.test(t) || Number(t) <= 0) {
    return { error: { key: "kvNewKey.error.ttlNotPositive" } };
  }
  return { ttlSeconds: Number(t) };
}

export function buildCreateKeyPlan(form: KvCreateForm): KvCreateBuildResult {
  const key = form.key.trim();
  if (!key) return err("kvNewKey.error.keyRequired");
  const keyToken = redisToken(key);

  switch (form.type) {
    case "string": {
      const ttl = parseTtl(form.ttl);
      if (ttl.error) return { ok: false, error: ttl.error };
      // Preview shows NX because rejectOverwrite runs `SET key value NX [EX n]`
      // (preview == execution). Injection is moot on this path — the value is a
      // bound IPC parameter, not concatenated into a command.
      const command =
        `SET ${keyToken} ${redisToken(form.stringValue)} NX` +
        (ttl.ttlSeconds != null ? ` EX ${ttl.ttlSeconds}` : "");
      return {
        ok: true,
        plan: {
          via: "string",
          command,
          label: "SET",
          value: form.stringValue,
          ttlSeconds: ttl.ttlSeconds,
        },
      };
    }
    case "json": {
      const parsed = form.jsonValue.trim();
      if (parsed === "") return err("kvNewKey.error.invalidJson");
      let normalized: string;
      try {
        // Round-trip so an invalid document is rejected before execution and
        // the previewed JSON is exactly what JSON.SET writes.
        normalized = JSON.stringify(JSON.parse(parsed));
      } catch {
        return err("kvNewKey.error.invalidJson");
      }
      const command = `JSON.SET ${keyToken} $ ${redisToken(normalized)}`;
      return { ok: true, plan: { via: "command", command, label: "JSON.SET" } };
    }
    case "hash": {
      const fields = form.pairs.filter((p) => p.a.trim() !== "");
      if (fields.length === 0) return err("kvNewKey.error.emptyHash");
      const parts = fields
        .map((p) => `${redisToken(p.a.trim())} ${redisToken(p.b)}`)
        .join(" ");
      const command = `HSET ${keyToken} ${parts}`;
      return { ok: true, plan: { via: "command", command, label: "HSET" } };
    }
    case "list": {
      const els = form.items.filter((v) => v !== "");
      if (els.length === 0) return err("kvNewKey.error.emptyList");
      const command = `RPUSH ${keyToken} ${els.map(redisToken).join(" ")}`;
      return { ok: true, plan: { via: "command", command, label: "RPUSH" } };
    }
    case "set": {
      const members = form.items.filter((v) => v !== "");
      if (members.length === 0) return err("kvNewKey.error.emptySet");
      const command = `SADD ${keyToken} ${members.map(redisToken).join(" ")}`;
      return { ok: true, plan: { via: "command", command, label: "SADD" } };
    }
    case "zSet": {
      const rows = form.pairs.filter((p) => p.b.trim() !== "");
      if (rows.length === 0) return err("kvNewKey.error.emptyZset");
      const parts: string[] = [];
      for (const r of rows) {
        const score = r.a.trim();
        // Score emitted raw so Redis reads it as a double; the finite-number
        // gate rejects anything with shell metacharacters, so raw is injection-
        // safe (mirrors the manual ZADD path in KvMutationPanel).
        if (score === "" || !Number.isFinite(Number(score))) {
          return err("kvNewKey.error.zsetScore");
        }
        parts.push(`${score} ${redisToken(r.b.trim())}`);
      }
      const command = `ZADD ${keyToken} ${parts.join(" ")}`;
      return { ok: true, plan: { via: "command", command, label: "ZADD" } };
    }
    case "stream": {
      const id = form.streamId.trim() || "*";
      const fields = form.pairs
        .filter((p) => p.a.trim() !== "")
        .map((p) => ({ field: p.a.trim(), value: p.b }));
      if (fields.length === 0) return err("kvNewKey.error.emptyStream");
      // Reuse the existing XADD builder so the create path and the stream-panel
      // append share one token/escape implementation.
      const command = buildStreamAddMutation(key, id, fields).command ?? "";
      return { ok: true, plan: { via: "command", command, label: "XADD" } };
    }
  }
}
