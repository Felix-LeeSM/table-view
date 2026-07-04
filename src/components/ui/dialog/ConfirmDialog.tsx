import { useTranslation } from "react-i18next";
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
// `ConfirmDialog` preset (Layer 2 of the dialog 2-layer system; see
// `memory/engineering/conventions/frontend/dialogs/memory.md`).
//
// Uses Layer-1 primitives only — `<AlertDialog*>` from
// `src/components/ui/alert-dialog.tsx`. It does not reach into Radix
// directly and does not hand-roll close-button DOM. `danger=true` forwards
// to `<AlertDialogContent tone="destructive">`.
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
  const { t } = useTranslation("ui");
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
            {t("cancel")}
          </Button>
          <Button
            variant={danger ? "destructive" : "default"}
            size="sm"
            onClick={onConfirm}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? t("processing") : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
