import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@components/ui/alert-dialog";
import { Button } from "@components/ui/button";

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
      <AlertDialogContent className="w-80 bg-secondary p-4">
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
