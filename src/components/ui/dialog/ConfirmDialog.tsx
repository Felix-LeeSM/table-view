import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@components/ui/alert-dialog";
import { Button } from "@components/ui/button";

// ---------------------------------------------------------------------------
// Sprint-96 Layer 2 — `ConfirmDialog` preset
//
// Generalised version of the original `src/components/shared/ConfirmDialog`.
// API is preserved verbatim (title / message / confirmLabel / danger /
// loading / onConfirm / onCancel) so the existing `@components/shared/...`
// import path keeps working as a thin re-export.
//
// Dialog 2-Layer rules (see `docs/dialog-conventions.md`):
//   - This preset uses Layer-1 primitives only — `<AlertDialog*>` from
//     `src/components/ui/alert-dialog.tsx`. It does not reach into Radix
//     directly and does not hand-roll close-button DOM.
//   - Tone forwarding: `danger=true` maps to the destructive border token
//     via `<AlertDialogContent tone="destructive">` (sprint-95 AC-05).
// ---------------------------------------------------------------------------

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent
        className="w-80 bg-secondary p-4"
        tone={danger ? "destructive" : "default"}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm font-semibold text-foreground">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm text-secondary-foreground">
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant={danger ? "destructive" : "default"}
            size="sm"
            onClick={onConfirm}
            disabled={loading}
            aria-label={confirmLabel}
          >
            {loading ? "Processing..." : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
