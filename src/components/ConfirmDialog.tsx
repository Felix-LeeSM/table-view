import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "./ui/alert-dialog";

interface ConfirmDialogProps {
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
      <AlertDialogContent className="w-80 bg-(--color-bg-secondary) p-4">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm font-semibold text-(--color-text-primary)">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm text-(--color-text-secondary)">
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4 flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className={`rounded px-3 py-1.5 text-sm font-medium text-white ${
              danger
                ? "bg-(--color-danger) hover:opacity-90"
                : "bg-(--color-accent) hover:opacity-90"
            } ${loading ? "cursor-not-allowed opacity-50" : ""}`}
            onClick={onConfirm}
            disabled={loading}
            aria-label={confirmLabel}
          >
            {loading ? "Processing..." : confirmLabel}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
