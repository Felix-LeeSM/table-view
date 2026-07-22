// Sprint 333/352 (2026-05-15) — Mongo paradigm 의 collection validator
// + validationLevel + validationAction 를 `collMod` IPC 로 read / apply /
// clear 한다. v0 는 raw JSON textarea + Save / Clear 버튼이었고, Sprint
// 352 에서 level (`off|strict|moderate`) + action (`error|warn`) 의
// select 컨트롤이 추가됐다. `level === "off"` 이면 action select 는
// 비활성 — MongoDB 가 level off 일 때 action 을 무시하므로 hint 와 함께
// 시각적으로 차단한다.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRefreshEvent } from "@/hooks/useRefreshEvent";
import { safeStringifyCell } from "@/lib/jsonCell";
import {
  getMongoValidator,
  setMongoValidator,
  type MongoValidationAction,
  type MongoValidationLevel,
  type MongoValidatorRead,
} from "@/lib/tauri";

export interface ValidatorPanelProps {
  connectionId: string;
  database: string;
  collection: string;
}

// MongoDB 의 서버 측 기본값. read response 에서 해당 필드가 null 이면
// (e.g. 백워드 컴팻 envelope 또는 collection 이 collMod 를 받은 적 없음)
// 이 값을 select 의 초기값으로 사용한다.
const DEFAULT_LEVEL: MongoValidationLevel = "strict";
const DEFAULT_ACTION: MongoValidationAction = "error";

const LEVEL_OPTIONS: ReadonlyArray<MongoValidationLevel> = [
  "off",
  "strict",
  "moderate",
];
const ACTION_OPTIONS: ReadonlyArray<MongoValidationAction> = ["error", "warn"];

/** Narrow an `unknown` IPC payload to {@link MongoValidatorRead}. Tolerates
 * the pre-Sprint-352 envelope shapes (`null`, `{ validator } | null`)
 * so a stale backend / stubbed test fixture keeps the panel functional. */
function normaliseReadResponse(raw: unknown): MongoValidatorRead {
  if (raw === null || raw === undefined) {
    return { validator: null, validationLevel: null, validationAction: null };
  }
  if (typeof raw === "object") {
    const candidate = raw as Partial<MongoValidatorRead> & {
      validator?: unknown;
    };
    // Legacy `getMongoValidator` could return the validator JSON object
    // directly (no envelope). Detect that by the absence of `validator`
    // field on the outer object — if no validator key but the object
    // looks like a validator expression, treat the whole thing as the
    // validator payload.
    const hasEnvelopeKey =
      "validator" in candidate ||
      "validationLevel" in candidate ||
      "validationAction" in candidate;
    if (!hasEnvelopeKey) {
      return {
        validator: raw as Record<string, unknown>,
        validationLevel: null,
        validationAction: null,
      };
    }
    return {
      validator:
        (candidate.validator as Record<string, unknown> | null | undefined) ??
        null,
      validationLevel: candidate.validationLevel ?? null,
      validationAction: candidate.validationAction ?? null,
    };
  }
  return { validator: null, validationLevel: null, validationAction: null };
}

export function ValidatorPanel({
  connectionId,
  database,
  collection,
}: ValidatorPanelProps) {
  const { t } = useTranslation("document");
  const [validatorText, setValidatorText] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [level, setLevel] = useState<MongoValidationLevel>(DEFAULT_LEVEL);
  const [originalLevel, setOriginalLevel] =
    useState<MongoValidationLevel>(DEFAULT_LEVEL);
  const [action, setAction] = useState<MongoValidationAction>(DEFAULT_ACTION);
  const [originalAction, setOriginalAction] =
    useState<MongoValidationAction>(DEFAULT_ACTION);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // #1718 (Part of #1717) — a soft refresh (Cmd+R) on the Mongo Structure pane
  // broadcasts `refresh-structure`; bumping this nonce re-runs the read effect.
  const [reloadNonce, setReloadNonce] = useState(0);
  useRefreshEvent("refresh-structure", () => setReloadNonce((n) => n + 1));

  useEffect(() => {
    if (database === "" || collection === "") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Cast through `unknown` so the legacy-envelope normaliser can
    // inspect the response without TypeScript narrowing it prematurely.
    (getMongoValidator(connectionId, database, collection) as Promise<unknown>)
      .then((raw) => {
        if (cancelled) return;
        const parsed = normaliseReadResponse(raw);
        const text =
          parsed.validator === null
            ? ""
            : safeStringifyCell(parsed.validator, 2);
        const nextLevel = parsed.validationLevel ?? DEFAULT_LEVEL;
        const nextAction = parsed.validationAction ?? DEFAULT_ACTION;
        setValidatorText(text);
        setOriginalText(text);
        setLevel(nextLevel);
        setOriginalLevel(nextLevel);
        setAction(nextAction);
        setOriginalAction(nextAction);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `reloadNonce` re-triggers the read on a soft refresh (#1718).
  }, [connectionId, database, collection, reloadNonce]);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    let parsed: Record<string, unknown> | null;
    const trimmed = validatorText.trim();
    if (trimmed === "") {
      parsed = null;
    } else {
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch (e) {
        setSaveError(
          e instanceof Error
            ? t("validatorPanel.errorInvalidJsonDetail", { message: e.message })
            : t("validatorPanel.errorInvalidJson"),
        );
        return;
      }
    }
    setSaving(true);
    try {
      await setMongoValidator(
        connectionId,
        database,
        collection,
        parsed,
        level,
        action,
      );
      setOriginalText(validatorText);
      setOriginalLevel(level);
      setOriginalAction(action);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [connectionId, database, collection, validatorText, level, action, t]);

  const handleClear = useCallback(async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await setMongoValidator(
        connectionId,
        database,
        collection,
        null,
        level,
        action,
      );
      setValidatorText("");
      setOriginalText("");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [connectionId, database, collection, level, action]);

  const dirty =
    validatorText !== originalText ||
    level !== originalLevel ||
    action !== originalAction;
  // MongoDB ignores `validationAction` when `validationLevel === "off"`.
  // Disable the action select with `aria-disabled` so screen readers
  // announce it consistently with the rest of the project.
  const actionDisabled = level === "off";

  return (
    <section
      aria-label={t("validatorPanel.ariaLabel")}
      className="flex flex-col gap-2 p-3"
      data-testid="validator-panel"
    >
      <header className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>
          Validator — {database}.{collection}
        </span>
        {loading && (
          <span className="flex items-center gap-1 text-3xs">
            <Loader2 className="animate-spin" size={10} aria-hidden />
            {t("validatorPanel.loading")}
          </span>
        )}
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="validator-panel-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="font-medium text-muted-foreground">Level</span>
          <select
            aria-label={t("validatorPanel.levelAriaLabel")}
            data-testid="validator-level-select"
            className="h-7 rounded-md border border-border bg-background px-2 text-xs"
            value={level}
            onChange={(e) => setLevel(e.target.value as MongoValidationLevel)}
          >
            {LEVEL_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-muted-foreground">Action</span>
          <select
            aria-label={t("validatorPanel.actionAriaLabel")}
            data-testid="validator-action-select"
            className="h-7 rounded-md border border-border bg-background px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            value={action}
            onChange={(e) => setAction(e.target.value as MongoValidationAction)}
            disabled={actionDisabled}
            aria-disabled={actionDisabled ? "true" : undefined}
          >
            {ACTION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        {actionDisabled && (
          <span
            data-testid="validator-action-disabled-hint"
            className="text-3xs text-muted-foreground"
          >
            {t("validatorPanel.actionDisabledHint")}
          </span>
        )}
      </div>

      <textarea
        aria-label={t("validatorPanel.editorAriaLabel")}
        data-testid="validator-panel-editor"
        spellCheck={false}
        value={validatorText}
        onChange={(e) => setValidatorText(e.target.value)}
        placeholder='{ "$jsonSchema": { "bsonType": "object", "required": ["name"] } }'
        className="h-48 w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
      />

      {saveError !== null && (
        <div
          role="alert"
          data-testid="validator-panel-save-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {saveError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          data-testid="validator-panel-clear"
          disabled={saving || (originalText === "" && validatorText === "")}
          onClick={handleClear}
        >
          {t("validatorPanel.clearButton")}
        </Button>
        <Button
          size="sm"
          data-testid="validator-panel-save"
          disabled={saving || !dirty}
          onClick={handleSave}
        >
          {saving ? t("validatorPanel.saving") : t("validatorPanel.save")}
        </Button>
      </div>
    </section>
  );
}
