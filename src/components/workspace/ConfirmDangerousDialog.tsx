import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@components/ui/alert-dialog";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";

/**
 * Sprint 186 — type-to-confirm dialog for Safe Mode warn-tier.
 *
 * When the user has Safe Mode set to "warn" and triggers a dangerous SQL
 * statement on a production-tagged connection, the commit gate hands off to
 * this dialog. The user must type the analyzer's reason string verbatim
 * (e.g. "DELETE without WHERE clause", "DROP TABLE") to enable the
 * destructive Confirm button.
 *
 * Comparison rule (Sprint 186 contract): trim both sides, case-sensitive.
 */
export interface ConfirmDangerousDialogProps {
  open: boolean;
  reason: string;
  sqlPreview: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDangerousDialog({
  open,
  reason,
  sqlPreview,
  onConfirm,
  onCancel,
}: ConfirmDangerousDialogProps) {
  const [typed, setTyped] = useState("");

  // Reset the typed buffer whenever the dialog re-opens or the reason changes,
  // so a stale match from a prior run cannot pre-enable Confirm.
  useEffect(() => {
    if (open) setTyped("");
  }, [open, reason]);

  const matches = typed.trim() === reason;

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="w-[28rem]" tone="destructive">
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm dangerous statement</AlertDialogTitle>
          <AlertDialogDescription>
            Reason: <span className="font-semibold">{reason}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <pre
          className="max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono text-xs text-muted-foreground"
          aria-label="SQL preview"
        >
          {sqlPreview}
        </pre>
        <label className="text-sm text-foreground">
          Type <span className="font-semibold">{`"${reason}"`}</span> to confirm
          <Input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches) {
                e.preventDefault();
                onConfirm();
              }
            }}
            aria-label="Type danger reason to confirm"
            data-testid="confirm-dangerous-input"
            className="mt-1"
            autoFocus
          />
        </label>
        <AlertDialogFooter className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!matches}
            aria-disabled={!matches}
            onClick={onConfirm}
          >
            Run anyway
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
