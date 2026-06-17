import { type ChangeEvent, type Ref, useEffect, useRef, useState } from "react";
import { Button } from "@components/ui/button";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import {
  deleteKvKey,
  executeKvCommand,
  setKvStringValue,
  updateKvTtl,
} from "@lib/tauri/kv";
import { useConnectionStore } from "@stores/connectionStore";
import type { StatementAnalysis } from "@lib/sql/sqlSafety";
import type { KvValueEnvelope } from "@/types/kv";
import ConfirmDestructiveDialog from "./ConfirmDestructiveDialog";

interface KvMutationPanelProps {
  value: KvValueEnvelope;
  connectionId: string;
  database: number;
  mutationScope?: KvMutationScope;
  actionIntent?: KvMutationActionIntent | null;
  onMutationSuccess: (key: string) => Promise<void>;
}

export type KvMutationScope = "redis" | "valkey";
export interface KvMutationActionIntent {
  kind: "edit" | "delete";
  key: string;
  requestId: number;
}

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

interface SafeModePendingMutation {
  mutation: PendingMutation;
  reason: string;
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
  actionIntent = null,
  onMutationSuccess,
}: KvMutationPanelProps) {
  const [form, setForm] = useState<MutationForm>(() =>
    mutationFormForValue(value),
  );
  const [pending, setPending] = useState<PendingMutation | null>(null);
  const [safeModeConfirm, setSafeModeConfirm] =
    useState<SafeModePendingMutation | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const safeModeGate = useSafeModeGate(connectionId, {
    missingConnectionEnvironment: "production",
  });
  const connection = useConnectionStore((s) =>
    s.connections.find((candidate) => candidate.id === connectionId),
  );
  const formDirtyRef = useRef(false);
  const stringValueRef = useRef<HTMLTextAreaElement>(null);
  const firstEditInputRef = useRef<HTMLInputElement>(null);
  const deleteConfirmInputRef = useRef<HTMLInputElement>(null);
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
    setSafeModeConfirm(null);
    setMutationError(null);
  }, [value]);

  useEffect(() => {
    if (!actionIntent || actionIntent.key !== value.key) return;
    const target =
      actionIntent.kind === "delete"
        ? deleteConfirmInputRef.current
        : (stringValueRef.current ?? firstEditInputRef.current);
    target?.scrollIntoView?.({ block: "nearest" });
    target?.focus();
  }, [actionIntent, value.key]);

  const bind =
    (field: MutationField) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      formDirtyRef.current = true;
      setForm((current) => ({ ...current, [field]: event.target.value }));
      setPending(null);
      setSafeModeConfirm(null);
    };

  const input = (
    label: string,
    field: MutationField,
    placeholder = label.toLocaleLowerCase(),
    inputRef?: Ref<HTMLInputElement>,
  ) => (
    <input
      ref={inputRef}
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
    setSafeModeConfirm(null);
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

  const confirmPendingMutation = () => {
    if (!pending) return;
    const decision = safeModeGate.decide(
      analyzeKvMutationSafety(pending, value.key),
    );
    if (decision.action === "confirm") {
      setSafeModeConfirm({ mutation: pending, reason: decision.reason });
      return;
    }
    if (decision.action === "block") {
      setMutationError(decision.reason);
      return;
    }
    void executePendingMutation(pending);
  };

  const confirmSafeModeMutation = async () => {
    if (!safeModeConfirm) return;
    await executePendingMutation(safeModeConfirm.mutation);
  };

  const executePendingMutation = async (mutation: PendingMutation) => {
    const keyRequest = { database, key: value.key };
    setSaving(true);
    setMutationError(null);
    try {
      switch (mutation.kind) {
        case "string":
          await setKvStringValue(connectionId, {
            ...keyRequest,
            value: mutation.value ?? "",
            safety: "allowOverwrite",
          });
          break;
        case "command":
          await executeKvCommand(connectionId, {
            database,
            command: mutation.command ?? "",
          });
          break;
        case "delete":
          await deleteKvKey(connectionId, {
            ...keyRequest,
            confirmKey: mutation.confirmKey ?? "",
          });
          break;
        case "expire":
          await updateKvTtl(connectionId, {
            ...keyRequest,
            update: { mode: "expire", seconds: mutation.seconds ?? 0 },
          });
          break;
        case "persist":
          await updateKvTtl(connectionId, {
            ...keyRequest,
            update: { mode: "persist", confirmKey: mutation.confirmKey ?? "" },
          });
      }
      setPending(null);
      setSafeModeConfirm(null);
      formDirtyRef.current = false;
      await onMutationSuccess(value.key);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmEnvironment =
    connection?.environment === "production" ? "production" : "non-production";
  const connectionLabel = connection?.name ?? connectionId;

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
            ref={stringValueRef}
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
          {input("Hash field", "field", "field", firstEditInputRef)}
          {input("Hash value", "entry", "value")}
          {action("Preview HSET", () => previewCollectionMutation("HSET"))}
        </div>
      )}
      {collectionMutationsEnabled && value.value.type === "list" && (
        <div className="grid gap-1">
          {input("List value", "entry", "list value", firstEditInputRef)}
          {action("Preview RPUSH", () => previewCollectionMutation("RPUSH"))}
        </div>
      )}
      {collectionMutationsEnabled && value.value.type === "set" && (
        <div className="grid gap-1">
          {input("Set member", "entry", "set member", firstEditInputRef)}
          {action("Preview SADD", () => previewCollectionMutation("SADD"))}
        </div>
      )}
      {collectionMutationsEnabled && value.value.type === "zSet" && (
        <div className="grid gap-1">
          {input("ZSet score", "score", "score", firstEditInputRef)}
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
        {input(
          "Delete confirm key",
          "deleteKey",
          "type exact key",
          deleteConfirmInputRef,
        )}
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
          onClick={confirmPendingMutation}
        >
          {saving ? "Applying" : `Confirm ${pending.label}`}
        </Button>
      )}
      <ConfirmDestructiveDialog
        open={safeModeConfirm !== null}
        reason={safeModeConfirm?.reason ?? ""}
        sqlPreview={safeModeConfirm?.mutation.summary ?? ""}
        environment={confirmEnvironment}
        connectionId={connectionId}
        statements={safeModeConfirm ? [safeModeConfirm.mutation.summary] : []}
        paradigm="kv"
        connectionLabel={connectionLabel}
        onConfirm={() => void confirmSafeModeMutation()}
        onCancel={() => setSafeModeConfirm(null)}
      />
    </div>
  );
}

function analyzeKvMutationSafety(
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
  return {
    kind: "other",
    severity: "warn",
    reasons: [`KV mutation command ${mutation.label}`],
  };
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
