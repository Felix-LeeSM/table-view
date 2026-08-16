// ---------------------------------------------------------------------------
// Sprint-96 escape hatch — Layer-1 primitives only (no Layer-2 preset).
//
// The other 7 dialogs (`GroupDialog`, `ImportExportDialog`, `BlobViewerDialog`,
// `CellDetailDialog`, `SqlPreviewDialog`, `MqlPreviewModal`,
// `AddDocumentModal`) are wrapped by the new `ConfirmDialog` / `FormDialog` /
// `PreviewDialog` / `TabsDialog` presets. ConnectionDialog stays on the raw
// Layer-1 primitives (`<Dialog*>` + `<DialogFeedback>` from
// `@components/ui/dialog`) because it has bespoke needs that no preset
// captures cleanly:
//   1. Custom footer split (Test Connection on the left, Cancel + Save on the
//      right) with `justify-between`.
//   2. The sprint-92 `expectNodeStable` contract on the
//      `data-slot="test-feedback"` slot — driven by `DialogFeedback`'s
//      `slotName` override that callers other than this file don't need.
//   3. URL-mode toggle + scrollable inner column with `max-h-[60vh]`.
//   4. Save error rendered alongside (not inside) the test-feedback slot.
//
// Sprint 138 (#4 — DBMS-aware connection form): the inner network/auth/db
// row(s) are no longer rendered inline. `dbType` switches into DBMS-aware
// sub-components (Pg/Mysql/Oracle/Sqlite/Mongo/Redis/Search) so the form shape and
// defaults match each DBMS. The `assertNever` exhaustive check in the
// switch statement guarantees a new `DatabaseType` variant breaks the
// build instead of silently falling through to the PG layout.
//
// Sprint 213 (post-209 P6) — entry-pattern split. The 829-line god file
// has been decomposed into:
//   - `ConnectionDialog.tsx`             (this entry, thin orchestration)
//   - `ConnectionDialog/useConnectionDraftForm`  (draft + DB type confirm
//                                                 + password resolve + trim
//                                                 + applyParsedConnection)
//   - `ConnectionDialog/useConnectionUrlImport`  (URL parse + paste detect
//                                                 + host:port blur split)
//   - `ConnectionDialog/ConnectionDialogBody`    (presentational form/URL
//                                                 toggle + DBMS fields +
//                                                 Advanced + detected note)
//   - `ConnectionDialog/ConnectionDialogFooter`  (DialogFeedback + save
//                                                 error + Test/Cancel/Save)
//   - `ConnectionDialog/sanitize`                (`sanitizeMessage` body;
//                                                 entry re-exports below)
//
// External callers (`Sidebar.tsx`, `HomePage.tsx`, `dialog.test.tsx`) keep
// importing from `@components/connection/ConnectionDialog` exactly as
// before; sub-files are entry-internal. Behaviour change 0 — every
// regression test in `ConnectionDialog.test.tsx` (1362 lines) +
// `ConnectionDialog.urlInput.test.tsx` (697 lines) keeps passing.
// ---------------------------------------------------------------------------

import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  type DialogFeedbackState,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import ConfirmDialog from "@components/ui/dialog/ConfirmDialog";
import { useConnectionMutations } from "@lib/runtime/connection/useConnectionMutations";
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectionConfig, ConnectionDraft } from "../model";
import { DATABASE_DEFAULTS } from "../model";
import { useConnectionStore } from "../store";
import ConnectionDialogBody from "./ConnectionDialog/ConnectionDialogBody";
import ConnectionDialogFooter from "./ConnectionDialog/ConnectionDialogFooter";
import { sanitizeMessage } from "./ConnectionDialog/sanitize";
import { useConnectionDraftForm } from "./ConnectionDialog/useConnectionDraftForm";
import { useConnectionUrlImport } from "./ConnectionDialog/useConnectionUrlImport";
import {
  type ConnFieldKey,
  validateConnectionDraft,
} from "./forms/fieldValidation";

// Sprint 213 — re-export the (relocated) `sanitizeMessage` helper so
// external callers keep using `import { sanitizeMessage } from
// "@components/connection/ConnectionDialog"`. Body lives in
// `ConnectionDialog/sanitize.ts`; refactor only — replaceAll +
// URL-encoded variant masking are byte-identical to the pre-split
// implementation.
export { sanitizeMessage };

interface ConnectionDialogProps {
  connection?: ConnectionConfig;
  onClose: () => void;
}

/**
 * Sprint-92 (#CONN-DIALOG-6): Test Connection result state is modelled as a
 * discriminated union over four explicit states. Previously this was a
 * combination of `testing: boolean` + `testResult: {success, message} | null`,
 * which left the (testing=true, testResult=non-null) corner ambiguous and
 * caused the alert slot to unmount/remount between clicks. The slot is now
 * always mounted (see `data-slot="test-feedback"` below) and only its content
 * varies with `status`.
 *
 * Issue #2437 — the Test Connection button carries this status itself (icon +
 * colour), and the slot is `sr-only` until the user opens the details
 * disclosure next to it. The slot keeps its roles and its mount, so screen
 * readers still get the full message announced the moment it arrives; what
 * went away is the empty band it used to reserve before any test ran. See
 * `ConnectionDialogFooter`.
 */
type TestResultState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export default function ConnectionDialog({
  connection,
  onClose,
}: ConnectionDialogProps) {
  const { t } = useTranslation("featuresConnection");
  const [inputMode, setInputMode] = useState<"form" | "url">("form");
  const [testResult, setTestResult] = useState<TestResultState>({
    status: "idle",
  });
  const testing = testResult.status === "pending";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Issue #1135 — which field the last failed save flagged, so the offending
  // input can carry `aria-invalid` + `aria-describedby` and receive focus.
  const [invalidField, setInvalidField] = useState<ConnFieldKey | null>(null);

  const draftForm = useConnectionDraftForm(connection);
  const {
    form,
    setForm,
    passwordInput,
    setPasswordInput,
    clearPassword,
    setClearPassword,
    walletPasswordInput,
    setWalletPasswordInput,
    clearWalletPassword,
    setClearWalletPassword,
    hadWalletPassword,
    resolveWalletPassword,
    isEditing,
    hadPassword,
    isFileConnection,
    isMongo,
    isSearch,
    pendingDbTypeChange,
    handleDbTypeChange,
    handleConfirmDbTypeReplace,
    handleCancelDbTypeReplace,
    resolvePassword,
    trimDraft,
    applyParsedConnection,
  } = draftForm;

  const urlImport = useConnectionUrlImport({
    dbType: form.dbType,
    applyParsedConnection,
    setHostPort: (host, port) => setForm((f) => ({ ...f, host, port })),
  });

  // Sprint-95 Layer-1 migration: project the local 4-state union onto the
  // generic DialogFeedback contract. `pending` → `loading` is the only naming
  // delta; messages flow through unchanged.
  const feedbackState: DialogFeedbackState =
    testResult.status === "pending" ? "loading" : testResult.status;
  const feedbackMessage =
    testResult.status === "success" || testResult.status === "error"
      ? testResult.message
      : undefined;

  const { addConnection, updateConnection } = useConnectionMutations();
  const testConnection = useConnectionStore((s) => s.testConnection);

  const handleTest = async () => {
    // #2437 — validate before anything leaves the dialog. An empty form used
    // to reach the driver and burn its 30s timeout (#2429); now the same rule
    // Save enforces fails it here, in the same banner, with the same focus
    // move. No IPC is dispatched.
    const draft = validateAndTrim();
    if (!draft) return;
    // Sprint-92: publish pending first so the alert slot shows the spinner +
    // "Testing..." while the request is in flight; the slot itself stays
    // mounted across this transition.
    setTestResult({ status: "pending" });
    try {
      const msg = await testConnection(draft, connection?.id ?? null);
      setTestResult({ status: "success", message: msg });
    } catch (e) {
      // Sprint 178 (AC-178-05): the backend's error message can naively
      // echo the connection string (including the password). Sanitise
      // the rendered message so no password substring lands in any
      // role="alert"/role="status"/aria-live region.
      setTestResult({
        status: "error",
        message: sanitizeMessage(String(e), passwordInput, form.password),
      });
    }
  };

  // Issue #1135 — move focus to the first invalid field. The inputs live 2-3
  // levels down across 8 DBMS form components and all carry stable ids, so
  // reading the id here is far less code than threading a ref through every
  // form. ponytail: focus by stable id; upgrade to refs only if a form drops
  // its stable id.
  const focusInvalidField = (field: ConnFieldKey) => {
    const id =
      field === "name"
        ? "conn-name"
        : field === "host"
          ? "conn-host"
          : isFileConnection
            ? "conn-sqlite-path"
            : "conn-database";
    document.getElementById(id)?.focus();
  };

  const failValidation = (field: ConnFieldKey | null, message: string) => {
    setError(message);
    setInvalidField(field);
    // A form-wide failure (MSSQL auth-method combo) owns no input to focus.
    if (field) focusInvalidField(field);
  };

  /**
   * #2437 — the pre-flight both Save and Test Connection run. Returns the
   * trimmed draft to dispatch, or `null` when validation failed (the banner,
   * the `aria-invalid` flag and the focus move are already published).
   *
   * Sprint 178: validation reads trimmed values so a user typing only
   * whitespace into Name/Host gets the same "required" error a blank input
   * would give. Password is left verbatim per ADR-0005 — `trimDraft` only
   * trims non-password keys.
   */
  const validateAndTrim = (): ConnectionDraft | null => {
    const trimmed = trimDraft({
      ...form,
      password: resolvePassword(),
      walletPassword: resolveWalletPassword(),
    });
    const failure = validateConnectionDraft(
      trimmed,
      { isFileConnection, isMongo, isSearch },
      t,
    );
    if (failure) {
      failValidation(failure.field, failure.message);
      return null;
    }
    setError(null);
    setInvalidField(null);
    return trimmed;
  };

  const handleSave = async () => {
    const trimmed = validateAndTrim();
    if (!trimmed) return;

    setSaving(true);
    try {
      // Sprint 178 (AC-178-02): outgoing payload uses trimmed values.
      // Password (resolvePassword()) is set on the trimmed copy
      // verbatim — `trimDraft` only trims non-password keys.
      if (isEditing) {
        await updateConnection(trimmed);
      } else {
        await addConnection(trimmed);
        // After a new connection is saved, surface it to the user — Sidebar
        // listens for this and flips to Connections mode if needed.
        window.dispatchEvent(new Event("connection-added"));
      }
      onClose();
    } catch (e) {
      // Sprint 178 (AC-178-05): sanitise error text so a backend that
      // echoes the connection string does not surface the password.
      setError(sanitizeMessage(String(e), passwordInput, form.password));
    }
    setSaving(false);
  };

  const handleParseAndContinue = () => {
    if (urlImport.parseAndApply()) {
      setInputMode("form");
    }
  };

  // Issue #1135 — Enter now submits the form (parity with GroupDialog). The
  // hidden submit button below makes implicit submission work with multiple
  // inputs; visible buttons stay `type="button"` so their click semantics are
  // unchanged. `noValidate` keeps our custom banner/focus in charge instead of
  // native constraint bubbles.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- in-flight #1529 (connection-form rework) owns this file; leave the React.FormEvent<HTMLFormElement> fix as a follow-up to avoid a merge conflict
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMode === "url") {
      handleParseAndContinue();
    } else {
      void handleSave();
    }
  };

  const inputClass =
    "w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring";
  const labelClass = "mb-1 block text-xs font-medium text-secondary-foreground";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex w-dialog-sm flex-col gap-0 bg-secondary p-0"
        showCloseButton={false}
      >
        {/* Header — DialogHeader's row-based default (sprint-91) puts the X
            inline with the title without any extra override. */}
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle
            id="dialog-title"
            className="text-sm font-semibold text-foreground"
          >
            {isEditing ? t("dialog.titleEdit") : t("dialog.titleNew")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isEditing ? t("dialog.descEdit") : t("dialog.descNew")}
          </DialogDescription>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label={t("dialog.closeAria")}
          >
            <X />
          </Button>
        </DialogHeader>

        {/* Issue #1135 — real <form> so Enter submits (parity with the other
            dialogs). `noValidate` defers to our custom validation banner + focus
            instead of native constraint bubbles. */}
        <form onSubmit={handleFormSubmit} noValidate>
          <ConnectionDialogBody
            isEditing={isEditing}
            inputMode={inputMode}
            setInputMode={setInputMode}
            urlValue={urlImport.urlValue}
            setUrlValue={urlImport.setUrlValue}
            urlError={urlImport.urlError}
            setUrlError={urlImport.setUrlError}
            onParseAndContinue={handleParseAndContinue}
            form={form}
            setForm={setForm}
            handleDbTypeChange={handleDbTypeChange}
            handleHostPaste={urlImport.handleHostPaste}
            handleHostBlur={urlImport.handleHostBlur}
            detectedScheme={urlImport.detectedScheme}
            tlsNotice={urlImport.tlsNotice}
            passwordInput={passwordInput}
            setPasswordInput={setPasswordInput}
            hadPassword={hadPassword}
            clearPassword={clearPassword}
            setClearPassword={setClearPassword}
            walletPasswordInput={walletPasswordInput}
            setWalletPasswordInput={setWalletPasswordInput}
            hadWalletPassword={hadWalletPassword}
            clearWalletPassword={clearWalletPassword}
            setClearWalletPassword={setClearWalletPassword}
            inputClass={inputClass}
            labelClass={labelClass}
            invalidField={invalidField}
          />

          <ConnectionDialogFooter
            feedbackState={feedbackState}
            feedbackMessage={feedbackMessage}
            error={error}
            testing={testing}
            saving={saving}
            isEditing={isEditing}
            onTest={handleTest}
            onCancel={onClose}
            onSave={handleSave}
          />

          {/* Hidden submit target — enables Enter-to-submit with multiple
              inputs without changing any visible button's click behaviour.
              No text (would duplicate the footer Save button); aria-hidden +
              tabIndex -1 keep it out of the a11y tree and tab order. */}
          <button
            type="submit"
            aria-label={isEditing ? t("footer.update") : t("footer.save")}
            aria-hidden="true"
            tabIndex={-1}
            className="sr-only"
          />
        </form>
      </DialogContent>
      {pendingDbTypeChange && (
        <ConfirmDialog
          title={t("dialog.replacePortTitle")}
          message={t("dialog.replacePortMessage", {
            from: form.dbType,
            to: pendingDbTypeChange.to,
            port: form.port,
            defaultPort: DATABASE_DEFAULTS[pendingDbTypeChange.to],
          })}
          confirmLabel={t("dialog.replacePortConfirm", {
            defaultPort: DATABASE_DEFAULTS[pendingDbTypeChange.to],
          })}
          onConfirm={handleConfirmDbTypeReplace}
          onCancel={handleCancelDbTypeReplace}
        />
      )}
    </Dialog>
  );
}
