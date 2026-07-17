import type { KvValueEnvelope } from "@/types/kv";

// Shared KV value formatters — used by both the sidebar key row (count/bytes
// badges) and the detail panel (header + value body). Extracted so the two
// surfaces cannot drift (KV UX redesign, 2026-07-07).

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const kib = value / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

// KV JSON tree Phase 1 (2026-07-17) — a value renders as an interactive JSON
// tree only when it is a JSON object or array (Mongo `isNestedCapable`
// parity). Bare scalars — `42`, `"foo"`, `true`, `null` — stay as raw text so
// a one-value string isn't inflated into a single-node tree.
export function isJsonTreeCapable(value: unknown): boolean {
  return value !== null && typeof value === "object";
}

// Parse `text` as JSON and return the parsed value only when it is
// tree-capable (object/array); otherwise null. Never throws — malformed /
// empty / scalar input all fall back to null so the caller renders raw text.
export function jsonTreeValue(text: string): unknown | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isJsonTreeCapable(parsed)) return parsed;
  } catch {
    // not JSON — raw text.
  }
  return null;
}

export function renderValueText(envelope: KvValueEnvelope): string {
  const { value } = envelope;
  switch (value.type) {
    case "string":
      return value.text ?? value.hex ?? "";
    case "hash":
      return value.fields
        .map((field) => `${field.field}: ${field.value}`)
        .join("\n");
    case "list":
      return value.entries
        .map((entry) => `${entry.index}: ${entry.value}`)
        .join("\n");
    case "set":
      return value.members.join("\n");
    case "zSet":
      return value.entries
        .map((entry) => `${entry.member}: ${entry.score}`)
        .join("\n");
    case "stream":
      return value.entries
        .map(
          (entry) =>
            `${entry.id} ${entry.fields.map((f) => `${f.field}=${f.value}`).join(" ")}`,
        )
        .join("\n");
    case "json":
      return JSON.stringify(value.value, null, 2);
    case "missing":
      return "(missing)";
    case "unsupported":
      return value.message;
  }
}
