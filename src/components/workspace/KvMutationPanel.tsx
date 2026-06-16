import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Button } from "@components/ui/button";
import {
  deleteKvKey,
  executeKvCommand,
  setKvStringValue,
  updateKvTtl,
} from "@lib/tauri/kv";
import type { KvValueEnvelope } from "@/types/kv";

interface KvMutationPanelProps {
  value: KvValueEnvelope;
  connectionId: string;
  database: number;
  mutationScope?: KvMutationScope;
  onMutationSuccess: (key: string) => Promise<void>;
}

export type KvMutationScope = "redis" | "valkey";

export function canRenderKvMutationPanel(
  value: KvValueEnvelope,
  mutationEnabled: boolean,
  mutationScope: KvMutationScope,
): boolean {
  if (!mutationEnabled) return false;
  if (mutationScope === "redis") return true;
  return (
    value.value.type === "string" &&
    value.value.encoding === "utf8" &&
    value.value.text !== undefined
  );
}

interface PendingMutation {
  kind: "string" | "command" | "delete" | "expire" | "persist";
  label: string;
  summary: string;
  value?: string;
  command?: string;
  confirmKey?: string;
  seconds?: number;
}

type MutationField =
  | "text"
  | "field"
  | "entry"
  | "score"
  | "expire"
  | "deleteKey"
  | "persistKey";
type MutationForm = Record<MutationField, string>;

const EMPTY_MUTATION_FORM: MutationForm = {
  text: "",
  field: "",
  entry: "",
  score: "",
  expire: "",
  deleteKey: "",
  persistKey: "",
};

function mutationFormForValue(value: KvValueEnvelope): MutationForm {
  return {
    ...EMPTY_MUTATION_FORM,
    text: value.value.type === "string" ? (value.value.text ?? "") : "",
  };
}

export function KvMutationPanel({
  value,
  connectionId,
  database,
  mutationScope = "redis",
  onMutationSuccess,
}: KvMutationPanelProps) {
  const [form, setForm] = useState<MutationForm>(() =>
    mutationFormForValue(value),
  );
  const [pending, setPending] = useState<PendingMutation | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formDirtyRef = useRef(false);
  const valueIdentityRef = useRef({
    key: value.key,
    type: value.value.type,
  });
  const unsupported = unsupportedMutationMessage(value, mutationScope);
  const collectionMutationsEnabled = mutationScope === "redis";
  const fieldClass =
    "rounded border border-border bg-background px-2 py-1 text-3xs outline-none";

  useEffect(() => {
    const previous = valueIdentityRef.current;
    const identityChanged =
      previous.key !== value.key || previous.type !== value.value.type;
    valueIdentityRef.current = { key: value.key, type: value.value.type };
    if (!identityChanged && formDirtyRef.current) return;
    formDirtyRef.current = false;
    setForm(mutationFormForValue(value));
    setPending(null);
    setMutationError(null);
  }, [value]);

  const bind =
    (field: MutationField) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      formDirtyRef.current = true;
      setForm((current) => ({ ...current, [field]: event.target.value }));
      setPending(null);
    };

  const input = (
    label: string,
    field: MutationField,
    placeholder = label.toLocaleLowerCase(),
  ) => (
    <input
      aria-label={label}
      className={fieldClass}
      value={form[field]}
      onChange={bind(field)}
      placeholder={placeholder}
    />
  );

  const action = (label: string, onClick: () => void) => (
    <Button variant="secondary" size="xs" disabled={saving} onClick={onClick}>
      {label}
    </Button>
  );

  const preview = (next: PendingMutation | null, error?: string) => {
    setMutationError(error ?? null);
    setPending(next);
  };

  const previewCommand = (label: string, summary: string, command: string) =>
    preview({ kind: "command", label, summary, command });

  const requireText = (raw: string, label: string) => {
    const trimmed = raw.trim();
    if (!trimmed) preview(null, `${label} is required.`);
    return trimmed;
  };

  const previewCollectionMutation = (
    verb: "HSET" | "RPUSH" | "SADD" | "ZADD",
  ) => {
    if (verb === "HSET") {
      const nextField = requireText(form.field, "Hash field");
      if (!nextField) return;
      previewCommand(
        "HSET",
        `Preview: HSET ${value.key} ${nextField} ${form.entry}`,
        `HSET ${redisToken(value.key)} ${redisToken(nextField)} ${redisToken(form.entry)}`,
      );
      return;
    }

    if (verb === "ZADD") {
      const nextMember = requireText(form.entry, "ZSet member");
      if (!nextMember) return;
      if (!Number.isFinite(Number(form.score))) {
        preview(null, "ZSet score must be a number.");
        return;
      }
      previewCommand(
        "ZADD",
        `Preview: ZADD ${value.key} ${form.score.trim()} ${nextMember}`,
        `ZADD ${redisToken(value.key)} ${form.score.trim()} ${redisToken(nextMember)}`,
      );
      return;
    }

    const label = verb === "RPUSH" ? "List value" : "Set member";
    const nextValue = requireText(form.entry, label);
    if (!nextValue) return;
    previewCommand(
      verb,
      `Preview: ${verb} ${value.key} ${nextValue}`,
      `${verb} ${redisToken(value.key)} ${redisToken(nextValue)}`,
    );
  };

  const previewExact = (kind: "delete" | "persist", confirmKey: string) => {
    if (confirmKey !== value.key) {
      preview(null, `Type the exact key before previewing ${kind}.`);
      return;
    }
    preview({
      kind,
      label: kind === "delete" ? "Delete" : "Persist",
      summary: `Preview: ${kind} ${value.key}.`,
      confirmKey,
    });
  };

  const confirmPendingMutation = async () => {
    if (!pending) return;
    const keyRequest = { database, key: value.key };
    setSaving(true);
    setMutationError(null);
    try {
      switch (pending.kind) {
        case "string":
          await setKvStringValue(connectionId, {
            ...keyRequest,
            value: pending.value ?? "",
            safety: "allowOverwrite",
          });
          break;
        case "command":
          await executeKvCommand(connectionId, {
            database,
            command: pending.command ?? "",
          });
          break;
        case "delete":
          await deleteKvKey(connectionId, {
            ...keyRequest,
            confirmKey: pending.confirmKey ?? "",
          });
          break;
        case "expire":
          await updateKvTtl(connectionId, {
            ...keyRequest,
            update: { mode: "expire", seconds: pending.seconds ?? 0 },
          });
          break;
        case "persist":
          await updateKvTtl(connectionId, {
            ...keyRequest,
            update: { mode: "persist", confirmKey: pending.confirmKey ?? "" },
          });
      }
      setPending(null);
      formDirtyRef.current = false;
      await onMutationSuccess(value.key);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (unsupported) {
    return (
      <div
        role="alert"
        className="mt-2 rounded border border-border bg-muted/30 p-2 text-3xs text-muted-foreground"
      >
        {unsupported}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded border border-border bg-background/60 p-2">
      <div className="font-medium text-secondary-foreground">Mutation</div>
      {value.value.type === "string" && (
        <div className="space-y-1">
          <textarea
            aria-label="String value"
            className="h-20 w-full resize-y rounded border border-border bg-background p-2 text-3xs outline-none"
            value={form.text}
            onChange={bind("text")}
          />
          {action("Preview string set", () =>
            preview({
              kind: "string",
              label: "String set",
              summary: `Preview: SET ${value.key} to ${form.text.length} character(s) with overwrite.`,
              value: form.text,
            }),
          )}
        </div>
      )}
      {collectionMutationsEnabled && value.value.type === "hash" && (
        <div className="grid gap-1">
          {input("Hash field", "field", "field")}
          {input("Hash value", "entry", "value")}
          {action("Preview HSET", () => previewCollectionMutation("HSET"))}
        </div>
      )}
      {collectionMutationsEnabled && value.value.type === "list" && (
        <div className="grid gap-1">
          {input("List value", "entry")}
          {action("Preview RPUSH", () => previewCollectionMutation("RPUSH"))}
        </div>
      )}
      {collectionMutationsEnabled && value.value.type === "set" && (
        <div className="grid gap-1">
          {input("Set member", "entry")}
          {action("Preview SADD", () => previewCollectionMutation("SADD"))}
        </div>
      )}
      {collectionMutationsEnabled && value.value.type === "zSet" && (
        <div className="grid gap-1">
          {input("ZSet score", "score", "score")}
          {input("ZSet member", "entry")}
          {action("Preview ZADD", () => previewCollectionMutation("ZADD"))}
        </div>
      )}
      <div className="grid gap-1 border-t border-border pt-2">
        {input("Expire seconds", "expire")}
        {action("Preview expire", () => {
          const seconds = Number(form.expire);
          if (!Number.isInteger(seconds) || seconds <= 0) {
            preview(null, "Expire seconds must be a positive integer.");
            return;
          }
          preview({
            kind: "expire",
            label: "Expire",
            summary: `Preview: expire ${value.key} after ${seconds}s.`,
            seconds,
          });
        })}
      </div>
      <div className="grid gap-1 border-t border-border pt-2">
        {input("Persist confirm key", "persistKey", "type exact key")}
        {action("Preview persist", () =>
          previewExact("persist", form.persistKey),
        )}
      </div>
      <div className="grid gap-1 border-t border-border pt-2">
        {input("Delete confirm key", "deleteKey", "type exact key")}
        {action("Preview delete", () => previewExact("delete", form.deleteKey))}
      </div>
      {pending && (
        <div role="status" className="text-3xs text-secondary-foreground">
          {pending.summary}
        </div>
      )}
      {mutationError && (
        <div role="alert" className="text-3xs text-destructive">
          {mutationError}
        </div>
      )}
      {pending && (
        <Button
          variant="default"
          size="xs"
          disabled={saving}
          onClick={() => void confirmPendingMutation()}
        >
          {saving ? "Applying" : `Confirm ${pending.label}`}
        </Button>
      )}
    </div>
  );
}

function unsupportedMutationMessage(
  envelope: KvValueEnvelope,
  mutationScope: KvMutationScope,
): string | null {
  const { value } = envelope;
  if (mutationScope === "valkey" && value.type !== "string") {
    return "Valkey direct mutation controls are only enabled for UTF-8 string keys.";
  }
  switch (value.type) {
    case "string":
      return value.encoding === "utf8" && value.text !== undefined
        ? null
        : "Binary string mutation is unsupported in this panel.";
    case "hash":
    case "set":
      return value.done && value.nextCursor === "0"
        ? null
        : `Partial ${value.type} previews cannot be mutated from this panel.`;
    case "list":
    case "zSet":
      return value.entries.length >= value.total
        ? null
        : `Partial ${value.type === "zSet" ? "zset" : "list"} previews cannot be mutated from this panel.`;
    case "stream":
      return "Stream value mutation is unsupported in this panel.";
    case "json":
      return "JSON value mutation is unsupported in this panel.";
    case "missing":
      return "Missing keys cannot be mutated from this panel.";
    case "unsupported":
      return value.message || "Unsupported Redis key type.";
  }
}

function redisToken(value: string): string {
  if (/^[^\s'"\\]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
