import { type ChangeEvent, type Ref, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import {
  deleteKvKey,
  executeKvCommand,
  setKvStringValue,
  updateKvTtl,
} from "@lib/tauri/kv";
import { useConnectionStore } from "@stores/connectionStore";
import type { KvValueEnvelope } from "@/types/kv";
import ConfirmDestructiveDialog from "./ConfirmDestructiveDialog";
import {
  analyzeKvMutationSafety,
  entryDeletePending,
  entryPrefillForm,
  type KvEntryActionIntent,
  type MutationField,
  type MutationForm,
  mutationFormForValue,
  type PendingMutation,
  redisToken,
  unsupportedMutationMessage,
} from "./kvMutationCommands";

// Pure command/gate logic lives in ./kvMutationCommands (shared with the inline
// row CRUD on KvCollectionValueTable, #1415). This file is the panel view only.
export {
  canMutateKvEntries,
  canRenderKvMutationPanel,
  type KvEntryActionIntent,
  type KvEntryPayload,
} from "./kvMutationCommands";

interface KvMutationPanelProps {
  value: KvValueEnvelope;
  connectionId: string;
  database: number;
  actionIntent?: KvMutationActionIntent | null;
  entryActionIntent?: KvEntryActionIntent | null;
  onMutationSuccess: (key: string) => Promise<void>;
}

export interface KvMutationActionIntent {
  kind: "edit" | "delete";
  key: string;
  requestId: number;
}

interface SafeModePendingMutation {
  mutation: PendingMutation;
  reason: string;
}

export function KvMutationPanel({
  value,
  connectionId,
  database,
  actionIntent = null,
  entryActionIntent = null,
  onMutationSuccess,
}: KvMutationPanelProps) {
  const { t } = useTranslation("workspace");
  const [form, setForm] = useState<MutationForm>(() =>
    mutationFormForValue(value),
  );
  const [pending, setPending] = useState<PendingMutation | null>(null);
  const [safeModeConfirm, setSafeModeConfirm] =
    useState<SafeModePendingMutation | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const safeModeGate = useSafeModeGate(connectionId);
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
  const unsupported = unsupportedMutationMessage(value, t);
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

  // #1415/#1683 — a row Delete builds the destructive command directly (one
  // click -> preview -> the same danger-tier confirm). A row Edit (hash/list) or
  // Copy (set/zSet copy-to-form) prefills the add form's fields so the user
  // tweaks the value and confirms via the existing verb button — both are
  // add-form prefill, not an in-place write. Guarded by requestId so a
  // post-mutation value reload never replays.
  const handledEntryRequestRef = useRef(0);
  useEffect(() => {
    if (!entryActionIntent) return;
    if (entryActionIntent.requestId === handledEntryRequestRef.current) return;
    handledEntryRequestRef.current = entryActionIntent.requestId;
    const { op, payload } = entryActionIntent;
    setMutationError(null);
    setSafeModeConfirm(null);
    if (op === "delete") {
      setPending(entryDeletePending(payload, value, t));
      return;
    }
    formDirtyRef.current = true;
    setForm((current) => ({ ...current, ...entryPrefillForm(payload) }));
    setPending(null);
    firstEditInputRef.current?.focus();
  }, [entryActionIntent, value, t]);

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

  const previewCommand = (
    label: string,
    summary: string,
    command: string,
    destructive = false,
  ) => preview({ kind: "command", label, summary, command, destructive });

  const requireText = (raw: string, field: string) => {
    const trimmed = raw.trim();
    if (!trimmed) preview(null, t("kvMutation.error.fieldRequired", { field }));
    return trimmed;
  };

  const requireInteger = (raw: string, errorKey: string) => {
    const trimmed = raw.trim();
    // Match the backend `parse_i64` grammar exactly so "1e3" / "0x1" never
    // reach the bounded command as a look-alike integer.
    if (!/^-?\d+$/.test(trimmed)) {
      preview(null, t(errorKey));
      return null;
    }
    return trimmed;
  };

  // #1466 element removals + list edit. Read the field/index/member to target
  // from the structured table above, then preview → confirm through the same
  // gate as the add axis. `redisToken` quotes only the value operands; numeric
  // index/count are emitted raw so the bounded parser reads them as integers.
  const previewHdel = () => {
    const field = requireText(form.field, "Hash field");
    if (!field) return;
    previewCommand(
      "HDEL",
      `Preview: HDEL ${value.key} ${field}`,
      `HDEL ${redisToken(value.key)} ${redisToken(field)}`,
      true,
    );
  };

  const previewLpush = () => {
    const nextValue = requireText(form.entry, "List value");
    if (!nextValue) return;
    previewCommand(
      "LPUSH",
      `Preview: LPUSH ${value.key} ${nextValue}`,
      `LPUSH ${redisToken(value.key)} ${redisToken(nextValue)}`,
    );
  };

  const previewLset = () => {
    const index = requireInteger(
      form.index,
      "kvMutation.error.listIndexNotInteger",
    );
    if (index === null) return;
    const nextValue = requireText(form.entry, "List value");
    if (!nextValue) return;
    previewCommand(
      "LSET",
      `Preview: LSET ${value.key} ${index} ${nextValue}`,
      `LSET ${redisToken(value.key)} ${index} ${redisToken(nextValue)}`,
    );
  };

  const previewLrem = () => {
    const count = requireInteger(
      form.count,
      "kvMutation.error.listCountNotInteger",
    );
    if (count === null) return;
    const nextValue = requireText(form.entry, "List value");
    if (!nextValue) return;
    previewCommand(
      "LREM",
      `Preview: LREM ${value.key} ${count} ${nextValue}`,
      `LREM ${redisToken(value.key)} ${count} ${redisToken(nextValue)}`,
      true,
    );
  };

  const previewMemberRemoval = (verb: "SREM" | "ZREM", field: string) => {
    const member = requireText(form.entry, field);
    if (!member) return;
    previewCommand(
      verb,
      `Preview: ${verb} ${value.key} ${member}`,
      `${verb} ${redisToken(value.key)} ${redisToken(member)}`,
      true,
    );
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
        preview(null, t("kvMutation.error.zsetScoreNotNumber"));
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
      preview(null, t("kvMutation.error.typeExactBeforePreview", { kind }));
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
      <div className="font-medium text-secondary-foreground">
        {t("kvMutation.sectionHeader")}
      </div>
      {value.value.type === "string" && (
        <div className="space-y-1">
          <textarea
            ref={stringValueRef}
            aria-label={t("kvMutation.stringValue")}
            className="h-20 w-full resize-y rounded border border-border bg-background p-2 text-3xs outline-none"
            value={form.text}
            onChange={bind("text")}
          />
          {action(t("kvMutation.previewStringSet"), () =>
            preview({
              kind: "string",
              label: "String set",
              summary: `Preview: SET ${value.key} to ${form.text.length} character(s) with overwrite.`,
              value: form.text,
            }),
          )}
        </div>
      )}
      {value.value.type === "hash" && (
        <div className="grid gap-1">
          {input(
            t("kvMutation.hashField"),
            "field",
            "field",
            firstEditInputRef,
          )}
          {input(t("kvMutation.hashValue"), "entry", "value")}
          {action(t("kvMutation.previewHset"), () =>
            previewCollectionMutation("HSET"),
          )}
          {action(t("kvMutation.previewHdel"), previewHdel)}
        </div>
      )}
      {value.value.type === "list" && (
        <div className="grid gap-1">
          {input(
            t("kvMutation.listValue"),
            "entry",
            "list value",
            firstEditInputRef,
          )}
          {action(t("kvMutation.previewRpush"), () =>
            previewCollectionMutation("RPUSH"),
          )}
          {action(t("kvMutation.previewLpush"), previewLpush)}
          {input(t("kvMutation.listIndex"), "index", "index")}
          {action(t("kvMutation.previewLset"), previewLset)}
          {input(t("kvMutation.listRemoveCount"), "count", "1")}
          {action(t("kvMutation.previewLrem"), previewLrem)}
        </div>
      )}
      {value.value.type === "set" && (
        <div className="grid gap-1">
          {input(
            t("kvMutation.setMember"),
            "entry",
            "set member",
            firstEditInputRef,
          )}
          {action(t("kvMutation.previewSadd"), () =>
            previewCollectionMutation("SADD"),
          )}
          {action(t("kvMutation.previewSrem"), () =>
            previewMemberRemoval("SREM", "Set member"),
          )}
        </div>
      )}
      {value.value.type === "zSet" && (
        <div className="grid gap-1">
          {input(
            t("kvMutation.zsetScore"),
            "score",
            "score",
            firstEditInputRef,
          )}
          {input(t("kvMutation.zsetMember"), "entry")}
          {action(t("kvMutation.previewZadd"), () =>
            previewCollectionMutation("ZADD"),
          )}
          {action(t("kvMutation.previewZrem"), () =>
            previewMemberRemoval("ZREM", "ZSet member"),
          )}
        </div>
      )}
      <div className="grid gap-1 border-t border-border pt-2">
        {input(t("kvMutation.expireSeconds"), "expire")}
        {action(t("kvMutation.previewExpire"), () => {
          const seconds = Number(form.expire);
          if (!Number.isInteger(seconds) || seconds <= 0) {
            preview(null, t("kvMutation.error.expireNotPositive"));
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
        {input(
          t("kvMutation.persistConfirmKey"),
          "persistKey",
          t("kvMutation.typeExactKey"),
        )}
        {action(t("kvMutation.previewPersist"), () =>
          previewExact("persist", form.persistKey),
        )}
      </div>
      <div className="grid gap-1 border-t border-border pt-2">
        {input(
          t("kvMutation.deleteConfirmKey"),
          "deleteKey",
          t("kvMutation.typeExactKey"),
          deleteConfirmInputRef,
        )}
        {action(t("kvMutation.previewDelete"), () =>
          previewExact("delete", form.deleteKey),
        )}
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
          {saving
            ? t("kvMutation.applying")
            : t("kvMutation.confirmLabel", { label: pending.label })}
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
