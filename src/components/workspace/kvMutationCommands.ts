import type { StatementAnalysis } from "@lib/sql/sqlSafety";
import type { KvValue, KvValueEnvelope } from "@/types/kv";

// Pure command/logic layer for KvMutationPanel (#1466) and the inline row CRUD
// on KvCollectionValueTable (#1415). No React — one place so the manual add
// form and the inline row actions share one Safe Mode gate and never drift.

export interface PendingMutation {
  kind: "string" | "command" | "delete" | "expire" | "persist";
  label: string;
  summary: string;
  value?: string;
  command?: string;
  confirmKey?: string;
  seconds?: number;
  // #1466 — element removals (HDEL/LREM/SREM/ZREM) are destructive: routed to
  // the danger Safe Mode tier so they hit the same confirm dialog as key delete.
  destructive?: boolean;
}

export type MutationField =
  | "text"
  | "field"
  | "entry"
  | "score"
  | "index"
  | "count"
  | "expire"
  | "deleteKey"
  | "persistKey";
export type MutationForm = Record<MutationField, string>;

export const EMPTY_MUTATION_FORM: MutationForm = {
  text: "",
  field: "",
  entry: "",
  score: "",
  index: "",
  count: "",
  expire: "",
  deleteKey: "",
  persistKey: "",
};

export function mutationFormForValue(value: KvValueEnvelope): MutationForm {
  return {
    ...EMPTY_MUTATION_FORM,
    text: value.value.type === "string" ? (value.value.text ?? "") : "",
  };
}

// #1415 — one structured collection row, tagged by its Redis type. The table
// emits this; the panel translates it into the same HDEL/LREM/SREM/ZREM/HSET/
// LSET/ZADD verbs the manual add form already routes through the Safe Mode gate.
export type KvEntryPayload =
  | { kind: "hash"; field: string; value: string }
  | { kind: "list"; index: number; value: string }
  | { kind: "set"; member: string }
  | { kind: "zSet"; member: string; score: number };

export interface KvEntryActionIntent {
  op: "edit" | "delete";
  payload: KvEntryPayload;
  requestId: number;
}

export function canRenderKvMutationPanel(
  _value: KvValueEnvelope,
  mutationEnabled: boolean,
): boolean {
  // #1075 — Redis/Valkey share one mutation surface; per-type support is
  // decided by unsupportedMutationMessage, not by product.
  return mutationEnabled;
}

// #1415 — inline row edit/delete is only safe when the whole collection is
// mutable through the panel, i.e. exactly when the manual form would accept it.
// Reuses unsupportedMutationMessage so the gate never drifts from the two
// surfaces.
export function canMutateKvEntries(
  value: KvValueEnvelope,
  mutationEnabled: boolean,
  t: (key: string) => string,
): boolean {
  return mutationEnabled && unsupportedMutationMessage(value, t) === null;
}

export function analyzeKvMutationSafety(
  mutation: PendingMutation,
  key: string,
): StatementAnalysis {
  if (mutation.kind === "delete") {
    return {
      kind: "other",
      severity: "danger",
      reasons: [`KV delete key ${key}`],
    };
  }
  if (mutation.kind === "string") {
    return {
      kind: "other",
      severity: "warn",
      reasons: [`KV overwrite string key ${key}`],
    };
  }
  if (mutation.kind === "expire") {
    return {
      kind: "other",
      severity: "warn",
      reasons: [`KV expire key ${key}`],
    };
  }
  if (mutation.kind === "persist") {
    return {
      kind: "other",
      severity: "warn",
      reasons: [`KV persist key ${key}`],
    };
  }
  if (mutation.destructive) {
    // #1466 — element removal loses data: same danger tier as key delete so
    // the strict / production Safe Mode confirm dialog gates it identically.
    return {
      kind: "other",
      severity: "danger",
      reasons: [`KV remove element via ${mutation.label} on ${key}`],
    };
  }
  return {
    kind: "other",
    severity: "warn",
    reasons: [`KV mutation command ${mutation.label}`],
  };
}

export function unsupportedMutationMessage(
  envelope: KvValueEnvelope,
  t: (key: string) => string,
): string | null {
  const { value } = envelope;
  switch (value.type) {
    case "string":
      return value.encoding === "utf8" && value.text !== undefined
        ? null
        : t("kvMutation.unsupported.binaryString");
    case "hash":
      return value.done && value.nextCursor === "0"
        ? null
        : t("kvMutation.unsupported.partialHash");
    case "set":
      return value.done && value.nextCursor === "0"
        ? null
        : t("kvMutation.unsupported.partialSet");
    case "list":
      return value.entries.length >= value.total
        ? null
        : t("kvMutation.unsupported.partialList");
    case "zSet":
      return value.entries.length >= value.total
        ? null
        : t("kvMutation.unsupported.partialZset");
    case "stream":
      return t("kvMutation.unsupported.stream");
    case "json":
      return t("kvMutation.unsupported.json");
    case "missing":
      return t("kvMutation.unsupported.missing");
    case "unsupported":
      return value.message || t("kvMutation.unsupported.unsupportedKeyType");
  }
}

export function redisToken(value: string): string {
  if (/^[^\s'"\\]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// KV JSON tree write (PR4, 2026-07-18) — the four whole-value overwrite targets
// the tree editor can re-serialize into. `string`/`json` are single-value keys
// (PR3); `hash`/`list` are one JSON field/element inside a collection (PR4).
// Redis has no partial JSON patch, so every target overwrites its whole slot
// (last-writer-wins, no WATCH/CAS).
export type KvTreeWriteTarget =
  | { kind: "string"; key: string }
  | { kind: "json"; key: string }
  | { kind: "hash"; key: string; field: string }
  | { kind: "list"; key: string; index: number };

// Build the exact overwrite command for a re-serialized tree value. `summary`
// is shown verbatim in the Safe Mode preview and `command`/`value` is what runs
// — same string, so preview == execution (the data-loss mitigation for JSON
// round-trip normalization). Operands go through `redisToken` for shell-safe
// quoting; the numeric list index is emitted raw so the bounded parser reads it
// as an integer, mirroring the manual LSET path in KvMutationPanel.
export function buildTreeWriteMutation(
  target: KvTreeWriteTarget,
  json: string,
): PendingMutation {
  const key = redisToken(target.key);
  switch (target.kind) {
    case "string": {
      // Routed through the typed set_kv_string_value command, not the raw
      // command bridge — the `string` tier carries the payload in `value`.
      const summary = `SET ${key} ${redisToken(json)}`;
      return { kind: "string", label: "String set", summary, value: json };
    }
    case "json": {
      const command = `JSON.SET ${key} $ ${redisToken(json)}`;
      return { kind: "command", label: "JSON.SET", summary: command, command };
    }
    case "hash": {
      const command = `HSET ${key} ${redisToken(target.field)} ${redisToken(json)}`;
      return { kind: "command", label: "HSET", summary: command, command };
    }
    case "list": {
      const command = `LSET ${key} ${target.index} ${redisToken(json)}`;
      return { kind: "command", label: "LSET", summary: command, command };
    }
  }
}

// PR4 — a hash field / list element whose value is JSON can be tree-edited into
// a whole-value HSET/LSET overwrite. Set members and zSet entries are out of
// scope (PR5) and never get an editable tree → null.
export function treeWriteTargetForEntry(
  key: string,
  payload: KvEntryPayload,
): KvTreeWriteTarget | null {
  switch (payload.kind) {
    case "hash":
      return { kind: "hash", key, field: payload.field };
    case "list":
      return { kind: "list", key, index: payload.index };
    default:
      return null;
  }
}

function collectionTotal(value: KvValue): number | null {
  switch (value.type) {
    case "hash":
    case "list":
    case "set":
    case "zSet":
      return value.total;
    default:
      return null;
  }
}

// #1415 — row Delete. Builds the destructive verb + the same "Preview: ..."
// summary shape the manual removals use, then flags the two hazards the panel
// can detect: last-entry GC (Redis drops the key) and LREM head-first removal
// when the target value repeats in the loaded page.
export function entryDeletePending(
  payload: KvEntryPayload,
  envelope: KvValueEnvelope,
  t: (key: string) => string,
): PendingMutation {
  const key = envelope.key;
  let label: string;
  let command: string;
  let summary: string;
  switch (payload.kind) {
    case "hash":
      label = "HDEL";
      command = `HDEL ${redisToken(key)} ${redisToken(payload.field)}`;
      summary = `Preview: HDEL ${key} ${payload.field}`;
      break;
    case "list":
      label = "LREM";
      command = `LREM ${redisToken(key)} 1 ${redisToken(payload.value)}`;
      summary = `Preview: LREM ${key} 1 ${payload.value}`;
      break;
    case "set":
      label = "SREM";
      command = `SREM ${redisToken(key)} ${redisToken(payload.member)}`;
      summary = `Preview: SREM ${key} ${payload.member}`;
      break;
    case "zSet":
      label = "ZREM";
      command = `ZREM ${redisToken(key)} ${redisToken(payload.member)}`;
      summary = `Preview: ZREM ${key} ${payload.member}`;
      break;
  }
  const notes: string[] = [];
  if (collectionTotal(envelope.value) === 1) {
    notes.push(t("kvMutation.note.lastEntryGc"));
  }
  if (
    payload.kind === "list" &&
    envelope.value.type === "list" &&
    envelope.value.entries.filter((e) => e.value === payload.value).length > 1
  ) {
    notes.push(t("kvMutation.note.lremFirstMatch"));
  }
  return {
    kind: "command",
    label,
    summary: [summary, ...notes].join(" "),
    command,
    destructive: true,
  };
}

// #1415 — row Edit prefill. Set members are immutable strings, so the table
// never offers Edit for them (no case here).
export function entryEditForm(payload: KvEntryPayload): Partial<MutationForm> {
  switch (payload.kind) {
    case "hash":
      return { field: payload.field, entry: payload.value };
    case "list":
      return { index: String(payload.index), entry: payload.value };
    case "zSet":
      return { score: String(payload.score), entry: payload.member };
    case "set":
      return {};
  }
}
