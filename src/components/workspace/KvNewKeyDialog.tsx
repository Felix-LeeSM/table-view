import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { Button } from "@components/ui/button";
import FormDialog from "@components/ui/dialog/FormDialog";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { getKvValue, executeKvCommand, setKvStringValue } from "@lib/tauri/kv";
import { useConnectionStore } from "@stores/connectionStore";
import ConfirmDestructiveDialog from "./ConfirmDestructiveDialog";
import { analyzeKvMutationSafety } from "./kvMutationCommands";
import {
  buildCreateKeyPlan,
  emptyCreateForm,
  KV_CREATE_TYPES,
  type KvCreatePlan,
} from "./kvCreateKeyCommands";

interface KvNewKeyDialogProps {
  connectionId: string;
  database: number;
  onClose: () => void;
  // Success hook — open the new key's detail tab + refresh the sidebar list.
  onCreated: (key: string) => void;
}

const fieldClass =
  "w-full rounded border border-border bg-background px-2 py-1 text-3xs outline-none";

export default function KvNewKeyDialog({
  connectionId,
  database,
  onClose,
  onCreated,
}: KvNewKeyDialogProps) {
  const { t } = useTranslation("workspace");
  const [form, setForm] = useState(() => emptyCreateForm());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{
    plan: KvCreatePlan;
    reason: string;
  } | null>(null);
  const gate = useSafeModeGate(connectionId);
  const connection = useConnectionStore((s) =>
    s.connections.find((c) => c.id === connectionId),
  );

  const build = useMemo(() => buildCreateKeyPlan(form), [form]);
  const preview = build.ok ? build.plan.command : null;
  const validationHint = build.ok
    ? null
    : t(build.error.key, build.error.params);

  const patch = (next: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...next }));
    setError(null);
  };
  const setPair = (i: number, next: Partial<{ a: string; b: string }>) =>
    patch({
      pairs: form.pairs.map((p, idx) => (idx === i ? { ...p, ...next } : p)),
    });
  const addPair = () => patch({ pairs: [...form.pairs, { a: "", b: "" }] });
  const removePair = (i: number) =>
    patch({
      pairs:
        form.pairs.length > 1
          ? form.pairs.filter((_, idx) => idx !== i)
          : form.pairs,
    });
  const setItem = (i: number, v: string) =>
    patch({ items: form.items.map((it, idx) => (idx === i ? v : it)) });
  const addItem = () => patch({ items: [...form.items, ""] });
  const removeItem = (i: number) =>
    patch({
      items:
        form.items.length > 1
          ? form.items.filter((_, idx) => idx !== i)
          : form.items,
    });

  const runCreate = async (plan: KvCreatePlan) => {
    const key = form.key.trim();
    setSaving(true);
    setError(null);
    try {
      // Overwrite guard (all types). string is also atomically guarded by the
      // rejectOverwrite NX below, but aggregate/json HSET/SADD/RPUSH/JSON.SET
      // MERGE into an existing key — so block before executing. A missing key
      // returns a `missing` envelope (not an error), so a genuine new key
      // passes through.
      const existing = await getKvValue(connectionId, { database, key });
      if (existing.value.type !== "missing") {
        setError(t("kvNewKey.error.keyExists", { key }));
        return;
      }
      if (plan.via === "string") {
        await setKvStringValue(connectionId, {
          database,
          key,
          value: plan.value ?? "",
          ttlSeconds: plan.ttlSeconds,
          safety: "rejectOverwrite",
        });
      } else {
        await executeKvCommand(connectionId, {
          database,
          command: plan.command,
        });
      }
      onCreated(key);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  };

  const onSubmit = () => {
    if (!build.ok) {
      setError(t(build.error.key, build.error.params));
      return;
    }
    const plan = build.plan;
    // Same Safe Mode gate as KvMutationPanel. Create is a non-destructive write
    // (warn tier), so the matrix allows it and the confirm dialog stays dormant;
    // routing through the gate keeps the production confirm path wired.
    const decision = gate.decide(
      analyzeKvMutationSafety(
        {
          kind: "command",
          label: plan.label,
          summary: plan.command,
          command: plan.command,
        },
        form.key.trim(),
      ),
    );
    if (decision.action === "block") {
      setError(decision.reason);
      return;
    }
    if (decision.action === "confirm") {
      setConfirm({ plan, reason: decision.reason });
      return;
    }
    void runCreate(plan);
  };

  const isProduction = connection?.environment === "production";
  const confirmEnvironment = isProduction ? "production" : "non-production";

  const pairRows = (labelA: string, labelB: string) => (
    <div className="grid gap-1">
      {form.pairs.map((p, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            aria-label={`${labelA} ${i + 1}`}
            className={fieldClass}
            value={p.a}
            onChange={(e) => setPair(i, { a: e.target.value })}
            placeholder={labelA}
          />
          <input
            aria-label={`${labelB} ${i + 1}`}
            className={fieldClass}
            value={p.b}
            onChange={(e) => setPair(i, { b: e.target.value })}
            placeholder={labelB}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("kvNewKey.removeRow")}
            disabled={form.pairs.length <= 1}
            onClick={() => removePair(i)}
          >
            <X size={12} aria-hidden />
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="xs" onClick={addPair}>
        <Plus size={12} aria-hidden />
        {t("kvNewKey.addRow")}
      </Button>
    </div>
  );

  const itemRows = (label: string) => (
    <div className="grid gap-1">
      {form.items.map((v, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            aria-label={`${label} ${i + 1}`}
            className={fieldClass}
            value={v}
            onChange={(e) => setItem(i, e.target.value)}
            placeholder={label}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("kvNewKey.removeRow")}
            disabled={form.items.length <= 1}
            onClick={() => removeItem(i)}
          >
            <X size={12} aria-hidden />
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="xs" onClick={addItem}>
        <Plus size={12} aria-hidden />
        {t("kvNewKey.addRow")}
      </Button>
    </div>
  );

  return (
    <>
      <FormDialog
        title={t("kvNewKey.title")}
        description={t("kvNewKey.description")}
        onSubmit={onSubmit}
        onCancel={onClose}
        submitLabel={t("kvNewKey.create")}
        isSubmitting={saving}
        submitDisabled={!build.ok}
        className="w-[30rem]"
      >
        <div className="grid gap-1">
          <span className="text-3xs text-muted-foreground">
            {t("kvNewKey.typeLabel")}
          </span>
          <div
            role="group"
            aria-label={t("kvNewKey.typeLabel")}
            className="flex flex-wrap gap-1"
          >
            {KV_CREATE_TYPES.map((ty) => (
              <Button
                key={ty}
                variant={form.type === ty ? "default" : "secondary"}
                size="xs"
                aria-pressed={form.type === ty}
                onClick={() =>
                  // Reset the value fields when the type changes; keep the key.
                  setForm((f) => ({ ...emptyCreateForm(ty), key: f.key }))
                }
              >
                {ty}
              </Button>
            ))}
          </div>
        </div>

        <label className="grid gap-1 text-3xs text-muted-foreground">
          {t("kvNewKey.keyLabel")}
          <input
            aria-label={t("kvNewKey.keyLabel")}
            className={fieldClass}
            value={form.key}
            onChange={(e) => patch({ key: e.target.value })}
            placeholder={t("kvNewKey.keyPlaceholder")}
          />
        </label>

        {form.type === "string" && (
          <>
            <label className="grid gap-1 text-3xs text-muted-foreground">
              {t("kvNewKey.stringValue")}
              <textarea
                aria-label={t("kvNewKey.stringValue")}
                className="h-20 w-full resize-y rounded border border-border bg-background p-2 text-3xs outline-none"
                value={form.stringValue}
                onChange={(e) => patch({ stringValue: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-3xs text-muted-foreground">
              {t("kvNewKey.ttlLabel")}
              <input
                aria-label={t("kvNewKey.ttlLabel")}
                className={fieldClass}
                value={form.ttl}
                onChange={(e) => patch({ ttl: e.target.value })}
                placeholder={t("kvNewKey.ttlPlaceholder")}
              />
            </label>
          </>
        )}

        {form.type === "json" && (
          <label className="grid gap-1 text-3xs text-muted-foreground">
            {t("kvNewKey.jsonValue")}
            <textarea
              aria-label={t("kvNewKey.jsonValue")}
              className="h-24 w-full resize-y rounded border border-border bg-background p-2 font-mono text-3xs outline-none"
              value={form.jsonValue}
              onChange={(e) => patch({ jsonValue: e.target.value })}
              placeholder='{"field":"value"}'
            />
          </label>
        )}

        {form.type === "hash" &&
          pairRows(t("kvNewKey.field"), t("kvNewKey.value"))}
        {form.type === "list" && itemRows(t("kvNewKey.element"))}
        {form.type === "set" && itemRows(t("kvNewKey.member"))}
        {form.type === "zSet" &&
          pairRows(t("kvNewKey.score"), t("kvNewKey.member"))}
        {form.type === "stream" && (
          <>
            <label className="grid gap-1 text-3xs text-muted-foreground">
              {t("kvNewKey.streamId")}
              <input
                aria-label={t("kvNewKey.streamId")}
                className={fieldClass}
                value={form.streamId}
                onChange={(e) => patch({ streamId: e.target.value })}
                placeholder="*"
              />
            </label>
            {pairRows(t("kvNewKey.field"), t("kvNewKey.value"))}
          </>
        )}

        <div className="grid gap-1">
          <span className="text-3xs text-muted-foreground">
            {t("kvNewKey.previewLabel")}
          </span>
          <pre
            aria-label={t("kvNewKey.previewLabel")}
            className="max-h-24 overflow-auto rounded bg-muted p-2 font-mono text-3xs text-muted-foreground"
          >
            {preview ?? validationHint}
          </pre>
        </div>

        {error && (
          <div role="alert" className="text-3xs text-destructive">
            {error}
          </div>
        )}
      </FormDialog>

      <ConfirmDestructiveDialog
        open={confirm !== null}
        reason={confirm?.reason ?? ""}
        sqlPreview={confirm?.plan.command ?? ""}
        environment={confirmEnvironment}
        connectionId={connectionId}
        statements={confirm ? [confirm.plan.command] : []}
        paradigm="kv"
        connectionLabel={connection?.name ?? connectionId}
        onConfirm={() => {
          if (confirm) void runCreate(confirm.plan);
        }}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
