import { Button } from "@components/ui/button";
import { Loader2, Plug } from "lucide-react";
import {
  DialogFeedback,
  type DialogFeedbackState,
} from "@components/ui/dialog";

export interface ConnectionDialogFooterProps {
  feedbackState: DialogFeedbackState;
  feedbackMessage: string | undefined;
  error: string | null;
  testing: boolean;
  saving: boolean;
  isEditing: boolean;
  onTest: () => void;
  onCancel: () => void;
  onSave: () => void;
}

/**
 * Sprint 213 — presentational footer of `ConnectionDialog`.
 *
 *   - `<DialogFeedback slotName="test-feedback" />` (sprint-95 layer-1
 *     migration, sprint-92 `data-slot` selector contract preserved).
 *   - `error` save-error region (`role="alert"`, sprint-178 sanitised).
 *   - Footer with Test Connection (left) + Cancel/Save (right) — the
 *     dialog-level escape-hatch split documented at the top of
 *     `ConnectionDialog.tsx` (`memory/engineering/conventions/frontend/dialogs/memory.md`).
 *
 * Stateless. All decisions (state -> message, error string, loading
 * flags) come from props.
 */
export default function ConnectionDialogFooter({
  feedbackState,
  feedbackMessage,
  error,
  testing,
  saving,
  isEditing,
  onTest,
  onCancel,
  onSave,
}: ConnectionDialogFooterProps) {
  return (
    <>
      {/* Alerts — pinned outside the scroll container so Test result /
          save error are always visible regardless of scroll position or
          Advanced Settings being open.

          Sprint-95 Layer-1 migration: this slot is now rendered by the
          base `<DialogFeedback>` primitive. The `slotName` override keeps
          the sprint-92 `data-slot="test-feedback"` selector contract
          intact so `expectNodeStable` continues to track the same DOM
          node across state transitions. `DialogFeedback` itself owns the
          "always mounted + min-h reserved" guarantee that previously
          lived inline here. */}
      <DialogFeedback
        slotName="test-feedback"
        state={feedbackState}
        message={feedbackMessage}
        loadingText="Testing..."
        className="border-t border-border px-4 py-3"
      />
      {error && (
        <div
          role="alert"
          className="border-t border-border bg-destructive/10 px-4 py-3 text-sm text-destructive duration-200 animate-in fade-in slide-in-from-top-1"
        >
          {error}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <div className="flex items-center">
          <Button variant="ghost" size="sm" onClick={onTest} disabled={testing}>
            {testing ? <Loader2 className="animate-spin size-3.5" /> : <Plug />}
            Test Connection
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : isEditing ? "Update" : "Save"}
          </Button>
        </div>
      </div>
    </>
  );
}
