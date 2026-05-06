import type { RefObject } from "react";
import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import CreateTableDialog from "../CreateTableDialog";

/**
 * Drop-table confirmation and rename modals for `SchemaTree`. State
 * (open/loading/input/error) lives in `useSchemaTreeActions` and is
 * threaded through props so both components stay presentational.
 */

/** Confirmation dialog state — exported so the hook + entry component share. */
export interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  onConfirm: () => void;
}

/** Rename dialog state — same. */
export interface RenameDialogState {
  tableName: string;
  schemaName: string;
  initialValue: string;
}

interface DropTableConfirmDialogProps {
  confirmDialog: ConfirmDialogState | null;
  isOperating: boolean;
  onCancel: () => void;
}

export function DropTableConfirmDialog({
  confirmDialog,
  isOperating,
  onCancel,
}: DropTableConfirmDialogProps) {
  return (
    <Dialog open={!!confirmDialog} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="w-80 bg-secondary p-4" showCloseButton={false}>
        <div className="rounded-lg border border-border bg-secondary p-4 shadow-xl">
          <DialogHeader>
            <DialogTitle className="mb-2 text-sm font-semibold text-foreground">
              {confirmDialog?.title}
            </DialogTitle>
            <DialogDescription className="mb-4 text-sm text-secondary-foreground">
              {confirmDialog?.message}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isOperating}
            >
              Cancel
            </Button>
            <Button
              variant={confirmDialog?.danger ? "destructive" : "default"}
              size="sm"
              onClick={confirmDialog?.onConfirm}
              disabled={isOperating}
              aria-label={confirmDialog?.confirmLabel}
            >
              {isOperating ? "Dropping..." : confirmDialog?.confirmLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sprint 226 — `CreateTableDialog` mount slot. The dialog body owns its
 * form state + lifecycle hook; this thin wrapper threads the SchemaTree
 * `connectionId` + the selected schema name + the post-commit refresh
 * callback. Mounted alongside `DropTableConfirmDialog` and
 * `RenameTableDialog` so SchemaTree's JSX shell stays readable.
 */
interface CreateTableDialogSlotProps {
  connectionId: string;
  createTableDialog: { schemaName: string } | null;
  onClose: () => void;
  onRefresh: (schemaName: string) => Promise<void> | void;
}

export function CreateTableDialogSlot({
  connectionId,
  createTableDialog,
  onClose,
  onRefresh,
}: CreateTableDialogSlotProps) {
  if (!createTableDialog) return null;
  return (
    <CreateTableDialog
      connectionId={connectionId}
      schemaName={createTableDialog.schemaName}
      open
      onClose={onClose}
      onRefresh={async () => {
        await onRefresh(createTableDialog.schemaName);
      }}
    />
  );
}

interface RenameTableDialogProps {
  renameDialog: RenameDialogState | null;
  renameInput: string;
  renameError: string | null;
  isOperating: boolean;
  renameInputRef: RefObject<HTMLInputElement | null>;
  onChangeInput: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RenameTableDialog({
  renameDialog,
  renameInput,
  renameError,
  isOperating,
  renameInputRef,
  onChangeInput,
  onConfirm,
  onCancel,
}: RenameTableDialogProps) {
  return (
    <Dialog open={!!renameDialog} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="w-80 bg-secondary p-4" showCloseButton={false}>
        <div className="rounded-lg border border-border bg-secondary p-4 shadow-xl">
          <DialogHeader>
            <DialogTitle className="mb-2 text-sm font-semibold text-foreground">
              Rename Table
            </DialogTitle>
            <DialogDescription className="mb-2 text-xs text-muted-foreground">
              {renameDialog?.schemaName}.{renameDialog?.tableName}
            </DialogDescription>
          </DialogHeader>
          <input
            ref={renameInputRef}
            type="text"
            className="mb-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
            value={renameInput}
            onChange={(e) => onChangeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onConfirm();
              }
            }}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            aria-label="New table name"
          />
          {renameError && (
            <p className="mb-2 text-xs text-destructive">{renameError}</p>
          )}
          <DialogFooter className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isOperating}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={onConfirm}
              disabled={isOperating}
              aria-label="Rename"
            >
              {isOperating ? "Renaming..." : "Rename"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
