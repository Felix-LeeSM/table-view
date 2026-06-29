import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import * as tauri from "@lib/tauri";
import { useDdlPreviewExecution } from "@components/structure/useDdlPreviewExecution";
import { ConfirmDestructiveDialog } from "@features/workspace";
import SqlSyntax from "@components/shared/SqlSyntax";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import type { CreateTriggerRequest } from "@/types/schema";

/**
 * Sprint 273 — `CreateTriggerDialog`. Modal for `CREATE TRIGGER`.
 *
 * Form fields (top → bottom):
 *   - Trigger name (text input, identifier validation)
 *   - Timing radio group: BEFORE / AFTER / INSTEAD OF
 *   - Events checkbox group: INSERT / UPDATE / DELETE (multi-select)
 *   - Orientation radio group: ROW / STATEMENT. STATEMENT disabled when
 *     timing === "INSTEAD OF" (defense-in-depth — backend rejects too).
 *   - WHEN expression (optional free-text textarea)
 *   - Function picker: schema + name. Combobox over
 *     `schemaStore.functions[connId][db]` (flatMap across schemas) with
 *     free-text fallback so the user can target a function the cache
 *     hasn't fetched. Rendered as an `<input list>` + `<datalist>` —
 *     accessible, supports both autocomplete and free-text edit.
 *   - Function arguments (optional free-text). Server doubles every `'`
 *     before interpolating into `(args)` (Sprint 272 findings § P3 fix).
 *   - Collapsible Show DDL pane (default open), 250ms debounced auto-
 *     refresh on every form edit.
 *
 * Apply enabled when:
 *   - trigger name passes identifier validation,
 *   - events.length ≥ 1,
 *   - INSTEAD OF → events.length === 1 (UI mirrors backend rejection),
 *   - INSTEAD OF → orientation === "ROW",
 *   - function name + function schema pass identifier validation,
 *   - preview SQL has been fetched, no preview error in flight.
 *
 * `useDdlPreviewExecution` (Sprint 214) drives the lifecycle. On
 * `AppError::DbMismatch` (user-initiated Apply), the hook routes
 * through Sprint 267 `syncMismatchedActiveDb` and surfaces the
 * canonical Retry toast. CREATE TRIGGER is classified `ddl-other`/safe
 * so the gate is a no-op in the safe tier; the `pendingConfirm` mount
 * stays in place for the warn-tier (defense-in-depth, mirrors Sprint
 * 235/236 dialogs).
 */

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const IDENTIFIER_MAX_BYTES = 63;

const TIMINGS: readonly ["BEFORE", "AFTER", "INSTEAD OF"] = [
  "BEFORE",
  "AFTER",
  "INSTEAD OF",
];
const ORIENTATIONS: readonly ["ROW", "STATEMENT"] = ["ROW", "STATEMENT"];
const EVENTS: readonly ["INSERT", "UPDATE", "DELETE"] = [
  "INSERT",
  "UPDATE",
  "DELETE",
];

function validateIdentifier(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return `${label} must not be empty`;
  }
  if (new TextEncoder().encode(trimmed).length > IDENTIFIER_MAX_BYTES) {
    return `${label} must not exceed ${IDENTIFIER_MAX_BYTES} bytes`;
  }
  if (!IDENTIFIER_RE.test(trimmed)) {
    return `${label} must start with a letter or underscore and contain only alphanumeric characters and underscores`;
  }
  return null;
}

export interface CreateTriggerDialogProps {
  /** Connection id used by Safe Mode + function picker source. */
  connectionId: string;
  /**
   * Active database — schemaStore cache key dimension (Sprint 263) and
   * `expectedDatabase` payload (Sprint 271c).
   */
  database: string;
  /** Schema name (display + payload). */
  schemaName: string;
  /** Parent table name (display + payload). */
  tableName: string;
  /** Modal closes when set false. */
  open: boolean;
  /** Called on Cancel / outside-close / commit-success. */
  onClose: () => void;
  /**
   * Called once after a successful commit so the SchemaTree can
   * re-fetch the parent table's trigger slice. Awaited inside
   * `useDdlPreviewExecution.runCommit` via the hook's `onRefresh` prop.
   */
  onRefresh: () => Promise<void>;
}

export default function CreateTriggerDialog({
  connectionId,
  database,
  schemaName,
  tableName,
  open,
  onClose,
  onRefresh,
}: CreateTriggerDialogProps) {
  const { t } = useTranslation("schemaDialogs");
  const dialogId = useId();
  const [triggerName, setTriggerName] = useState("");
  const [timing, setTiming] = useState<(typeof TIMINGS)[number]>("BEFORE");
  const [events, setEvents] = useState<Set<(typeof EVENTS)[number]>>(
    () => new Set(["INSERT"]),
  );
  const [orientation, setOrientation] =
    useState<(typeof ORIENTATIONS)[number]>("ROW");
  const [whenExpression, setWhenExpression] = useState("");
  const [functionSchema, setFunctionSchema] = useState(schemaName);
  const [functionName, setFunctionName] = useState("");
  const [functionArguments, setFunctionArguments] = useState("");
  // Preview pane defaults open — auto-debounced fetch fills it as the
  // user types. Mirrors Sprint 235 / 236 dialogs.
  const [showDdl, setShowDdl] = useState(true);

  const connectionEnvironment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );

  // Function picker source — flatMap across every schema's function
  // list in the `(connId, db)` slice. Free-text fallback covers the
  // race where the user opens the modal before the function cache is
  // populated.
  const functionsBySchema = useSchemaStore(
    (s) => s.functions[connectionId]?.[database],
  );
  const functionOptions = useMemo(() => {
    if (!functionsBySchema) return [] as { schema: string; name: string }[];
    const out: { schema: string; name: string }[] = [];
    for (const [schemaKey, list] of Object.entries(functionsBySchema)) {
      for (const fn of list) {
        out.push({ schema: schemaKey, name: fn.name });
      }
    }
    return out;
  }, [functionsBySchema]);

  const ddl = useDdlPreviewExecution({
    connectionId,
    onRefresh: async () => {
      await onRefresh();
      onClose();
    },
  });

  // Reset form state on (re)open. Same pattern as Sprint 235 / 236
  // dialogs. `tableName` / `schemaName` are the seeds so retargeting
  // the modal to a new table resets the form.
  useEffect(() => {
    if (open) {
      setTriggerName("");
      setTiming("BEFORE");
      setEvents(new Set(["INSERT"]));
      setOrientation("ROW");
      setWhenExpression("");
      setFunctionSchema(schemaName);
      setFunctionName("");
      setFunctionArguments("");
      setShowDdl(true);
      ddl.cancelPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tableName, schemaName]);

  const triggerNameError = validateIdentifier(triggerName, "Trigger name");
  const functionSchemaError = validateIdentifier(
    functionSchema,
    "Function schema",
  );
  const functionNameError = validateIdentifier(functionName, "Function name");
  const eventsArray = useMemo(() => Array.from(events), [events]);
  const insteadOfMultiEventError =
    timing === "INSTEAD OF" && eventsArray.length > 1
      ? t("createTrigger.insteadOfMultiEvent")
      : null;
  const insteadOfStatementError =
    timing === "INSTEAD OF" && orientation === "STATEMENT"
      ? t("createTrigger.insteadOfStatement")
      : null;

  const canPreview =
    !triggerNameError &&
    !functionSchemaError &&
    !functionNameError &&
    eventsArray.length > 0 &&
    !insteadOfMultiEventError &&
    !insteadOfStatementError;
  const canApply = canPreview && !ddl.previewLoading && !!ddl.previewSql;

  // 250ms debounced auto-refresh — mirrors Sprint 235 / 236 dialogs.
  useEffect(() => {
    if (!open) return;
    if (!canPreview) return;
    const handle = window.setTimeout(() => {
      const trimmedWhen = whenExpression.trim();
      const trimmedArgs = functionArguments.trim();
      const buildRequest = (previewOnly: boolean): CreateTriggerRequest => ({
        connectionId,
        schema: schemaName,
        table: tableName,
        triggerName: triggerName.trim(),
        timing,
        events: eventsArray,
        orientation,
        whenExpression: trimmedWhen.length > 0 ? whenExpression : undefined,
        functionSchema: functionSchema.trim(),
        functionName: functionName.trim(),
        functionArguments:
          trimmedArgs.length > 0 ? functionArguments : undefined,
        previewOnly,
        // Sprint 271c — opt-in DbMismatch guard.
        expectedDatabase: database,
      });
      void ddl.loadPreview(
        async () => {
          const result = await tauri.createTrigger(buildRequest(true));
          return { sql: result.sql };
        },
        () => async () => {
          await tauri.createTrigger(buildRequest(false));
        },
      );
    }, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    canPreview,
    triggerName,
    timing,
    eventsArray,
    orientation,
    whenExpression,
    functionSchema,
    functionName,
    functionArguments,
    connectionId,
    schemaName,
    tableName,
    database,
  ]);

  const toggleEvent = (event: (typeof EVENTS)[number]) => {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(event)) {
        next.delete(event);
      } else {
        next.add(event);
      }
      return next;
    });
  };

  const handleShowDdl = () => {
    setShowDdl((s) => !s);
  };

  const handleApply = async () => {
    if (!ddl.previewSql) return;
    await ddl.attemptExecute();
  };

  const handleCancel = () => {
    ddl.cancelPreview();
    onClose();
  };

  const ddlButtonLabel = showDdl ? t("hideDdl") : t("showDdl");
  const functionListId = `${dialogId}-function-list`;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) handleCancel();
        }}
      >
        <DialogContent
          className="w-dialog-md bg-secondary p-0"
          showCloseButton={false}
        >
          <div className="rounded-lg bg-secondary shadow-xl">
            <DialogHeader className="border-b border-border px-4 py-3">
              <DialogTitle className="text-sm font-semibold text-foreground">
                {t("createTrigger.title")}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {schemaName}.{tableName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 px-4 py-3">
              {/* Trigger name */}
              <div>
                <label
                  htmlFor={`${dialogId}-name`}
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  {t("createTrigger.triggerNameLabel")}
                </label>
                <input
                  id={`${dialogId}-name`}
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={triggerName}
                  onChange={(e) => setTriggerName(e.target.value)}
                  placeholder={t("createTrigger.triggerNamePlaceholder")}
                  aria-label={t("createTrigger.triggerNameAria")}
                  autoFocus
                />
                {triggerNameError && triggerName.length > 0 && (
                  <p
                    className="mt-1 text-xs text-destructive"
                    role="alert"
                    aria-label={t("createTrigger.triggerNameErrorAria")}
                  >
                    {triggerNameError}
                  </p>
                )}
              </div>

              {/* Timing radio group */}
              <div
                role="radiogroup"
                aria-label={t("createTrigger.timingGroupAria")}
              >
                <span className="mb-1 block text-xs font-medium text-secondary-foreground">
                  {t("createTrigger.timingLabel")}
                </span>
                <div className="flex gap-3">
                  {TIMINGS.map((option) => (
                    <label
                      key={option}
                      className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground"
                    >
                      <input
                        type="radio"
                        name={`${dialogId}-timing`}
                        value={option}
                        checked={timing === option}
                        onChange={() => setTiming(option)}
                        aria-label={t("createTrigger.timingOptionAria", {
                          option,
                        })}
                      />
                      {option}
                    </label>
                  ))}
                </div>
              </div>

              {/* Events checkbox group */}
              <div role="group" aria-label={t("createTrigger.eventsGroupAria")}>
                <span className="mb-1 block text-xs font-medium text-secondary-foreground">
                  {t("createTrigger.eventsLabel")}
                </span>
                <div className="flex gap-3">
                  {EVENTS.map((event) => (
                    <label
                      key={event}
                      className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={events.has(event)}
                        onChange={() => toggleEvent(event)}
                        aria-label={t("createTrigger.eventOptionAria", {
                          event,
                        })}
                      />
                      {event}
                    </label>
                  ))}
                </div>
                {eventsArray.length === 0 && (
                  <p
                    className="mt-1 text-xs text-destructive"
                    role="alert"
                    aria-label={t("createTrigger.eventsErrorAria")}
                  >
                    {t("createTrigger.selectAtLeastOneEvent")}
                  </p>
                )}
                {insteadOfMultiEventError && (
                  <p
                    className="mt-1 text-xs text-destructive"
                    role="alert"
                    aria-label={t("createTrigger.insteadOfMultiEventAria")}
                  >
                    {insteadOfMultiEventError}
                  </p>
                )}
              </div>

              {/* Orientation radio group */}
              <div
                role="radiogroup"
                aria-label={t("createTrigger.orientationGroupAria")}
              >
                <span className="mb-1 block text-xs font-medium text-secondary-foreground">
                  {t("createTrigger.orientationLabel")}
                </span>
                <div className="flex gap-3">
                  {ORIENTATIONS.map((option) => {
                    const isDisabled =
                      option === "STATEMENT" && timing === "INSTEAD OF";
                    return (
                      <label
                        key={option}
                        className={`flex cursor-pointer items-center gap-1.5 text-xs text-foreground ${isDisabled ? "opacity-50" : ""}`}
                      >
                        <input
                          type="radio"
                          name={`${dialogId}-orientation`}
                          value={option}
                          checked={orientation === option}
                          disabled={isDisabled}
                          onChange={() => setOrientation(option)}
                          aria-label={t("createTrigger.orientationOptionAria", {
                            option,
                          })}
                        />
                        {option}
                      </label>
                    );
                  })}
                </div>
                {insteadOfStatementError && (
                  <p
                    className="mt-1 text-xs text-destructive"
                    role="alert"
                    aria-label={t("createTrigger.insteadOfStatementAria")}
                  >
                    {insteadOfStatementError}
                  </p>
                )}
              </div>

              {/* WHEN expression */}
              <div>
                <label
                  htmlFor={`${dialogId}-when`}
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  {t("createTrigger.whenLabel")}
                </label>
                <textarea
                  id={`${dialogId}-when`}
                  className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                  value={whenExpression}
                  onChange={(e) => setWhenExpression(e.target.value)}
                  placeholder={t("createTrigger.whenPlaceholder")}
                  rows={2}
                  aria-label={t("createTrigger.whenAria")}
                />
              </div>

              {/* Function picker — schema + name */}
              <div>
                <span className="mb-1 block text-xs font-medium text-secondary-foreground">
                  {t("createTrigger.executeFunctionLabel")}
                </span>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                  <input
                    id={`${dialogId}-fn-schema`}
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                    value={functionSchema}
                    onChange={(e) => setFunctionSchema(e.target.value)}
                    placeholder={t("createTrigger.functionSchemaPlaceholder")}
                    aria-label={t("createTrigger.functionSchemaAria")}
                  />
                  <span className="text-xs text-muted-foreground">.</span>
                  <input
                    id={`${dialogId}-fn-name`}
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                    value={functionName}
                    onChange={(e) => {
                      const next = e.target.value;
                      setFunctionName(next);
                      // If the user picks an option from the datalist
                      // whose display form matches `schema.name`, auto-
                      // populate the schema field so the user doesn't
                      // have to edit both. Free-text edits leave
                      // `functionSchema` untouched.
                      const match = functionOptions.find(
                        (opt) => `${opt.schema}.${opt.name}` === next,
                      );
                      if (match) {
                        setFunctionSchema(match.schema);
                        setFunctionName(match.name);
                      }
                    }}
                    placeholder={t("createTrigger.functionNamePlaceholder")}
                    aria-label={t("createTrigger.functionNameAria")}
                    list={functionListId}
                  />
                  <datalist id={functionListId}>
                    {functionOptions.map((opt) => (
                      <option
                        key={`${opt.schema}.${opt.name}`}
                        value={`${opt.schema}.${opt.name}`}
                      />
                    ))}
                  </datalist>
                </div>
                {functionSchemaError && functionSchema.length > 0 && (
                  <p
                    className="mt-1 text-xs text-destructive"
                    role="alert"
                    aria-label={t("createTrigger.functionSchemaErrorAria")}
                  >
                    {functionSchemaError}
                  </p>
                )}
                {functionNameError && functionName.length > 0 && (
                  <p
                    className="mt-1 text-xs text-destructive"
                    role="alert"
                    aria-label={t("createTrigger.functionNameErrorAria")}
                  >
                    {functionNameError}
                  </p>
                )}
              </div>

              {/* Function arguments */}
              <div>
                <label
                  htmlFor={`${dialogId}-fn-args`}
                  className="mb-1 block text-xs font-medium text-secondary-foreground"
                >
                  {t("createTrigger.argumentsLabel")}
                </label>
                <input
                  id={`${dialogId}-fn-args`}
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  value={functionArguments}
                  onChange={(e) => setFunctionArguments(e.target.value)}
                  placeholder={t("createTrigger.argumentsPlaceholder")}
                  aria-label={t("createTrigger.argumentsAria")}
                />
              </div>
            </div>

            <div className="border-t border-border">
              <button
                type="button"
                onClick={handleShowDdl}
                className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-secondary-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                aria-expanded={showDdl}
                aria-controls={`${dialogId}-ddl-preview`}
                aria-label={ddlButtonLabel}
              >
                <span>{ddlButtonLabel}</span>
                {showDdl ? (
                  <ChevronUp className="size-3" />
                ) : (
                  <ChevronDown className="size-3" />
                )}
              </button>
              {showDdl && (
                <div
                  id={`${dialogId}-ddl-preview`}
                  className="border-t border-border bg-background px-4 py-2"
                >
                  {ddl.previewLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      {t("generatingPreview")}
                    </div>
                  ) : ddl.previewError ? (
                    <pre
                      className="max-h-scroll-md overflow-auto whitespace-pre-wrap rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
                      role="alert"
                    >
                      {ddl.previewError}
                    </pre>
                  ) : ddl.previewSql ? (
                    <pre className="max-h-scroll-md overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-xs font-mono text-foreground">
                      <SqlSyntax sql={ddl.previewSql} />
                    </pre>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">
                      {t("ddlHintFillTrigger")}
                    </span>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="border-t border-border px-4 py-3">
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                {t("cancel")}
              </Button>
              <Button
                size="sm"
                onClick={handleApply}
                disabled={!canApply}
                aria-label={t("createTrigger.applyAria")}
              >
                {ddl.previewLoading ? (
                  <Loader2 className="animate-spin size-3.5" />
                ) : null}
                {t("apply")}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {ddl.pendingConfirm && (
        <ConfirmDestructiveDialog
          open
          reason={ddl.pendingConfirm.reason}
          sqlPreview={ddl.pendingConfirm.sql}
          environment={
            connectionEnvironment === "production"
              ? "production"
              : "non-production"
          }
          connectionId={connectionId}
          statements={[ddl.pendingConfirm.sql]}
          paradigm="rdb"
          onConfirm={() => {
            void ddl.confirmDangerous();
          }}
          onCancel={ddl.cancelDangerous}
        />
      )}
    </>
  );
}
