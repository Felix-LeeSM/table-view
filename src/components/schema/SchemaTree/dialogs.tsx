import { useMemo } from "react";
import { useSchemaStore } from "@stores/schemaStore";
import CreateTableDialog from "../CreateTableDialog";
import RenameTableDialog from "../RenameTableDialog";
import DropTableDialog from "../DropTableDialog";
import ImportCsvDialog from "../ImportCsvDialog";

/**
 * Dialog mount slots for `SchemaTree`. Sprint 235 collapses the legacy
 * `DropTableConfirmDialog` + `RenameTableDialog` (the minimal pre-Phase
 * 27 dialogs) into thin slot wrappers that forward to the new
 * Phase 27-shaped modals (`RenameTableDialog` + `DropTableDialog` —
 * `useDdlPreviewExecution` reuse, inline DDL preview, typing-confirm,
 * Safe Mode dispatch).
 *
 * The `CreateTableDialogSlot` (Sprint 226) stays unchanged.
 *
 * Sprint 275 — `CreateTriggerDialogSlot` / `DropTriggerDialogSlot` were
 * retired; trigger CRUD now mounts inside `StructurePanel` (sidebar
 * Triggers child group removed). The Create/Drop dialog components
 * themselves (`CreateTriggerDialog` / `DropTriggerDialog`) live on
 * unchanged.
 */

/**
 * Sprint 226 — `CreateTableDialog` mount slot. Threads connectionId +
 * the right-clicked schema name + the post-commit refresh callback.
 */
interface CreateTableDialogSlotProps {
  connectionId: string;
  database: string;
  createTableDialog: { schemaName: string } | null;
  onClose: () => void;
  onRefresh: (schemaName: string) => Promise<void> | void;
}

export function CreateTableDialogSlot({
  connectionId,
  database,
  createTableDialog,
  onClose,
  onRefresh,
}: CreateTableDialogSlotProps) {
  // Sprint 227 — populate the modal's Target schema dropdown from the
  // window-local schema store. Sprint 263 — schemas are now keyed by
  // `(connId, db)`.
  const schemaInfos = useSchemaStore(
    (s) => s.schemas[connectionId]?.[database],
  );
  const availableSchemaNames = useMemo(
    () => (schemaInfos ?? []).map((info) => info.name),
    [schemaInfos],
  );
  if (!createTableDialog) return null;
  return (
    <CreateTableDialog
      connectionId={connectionId}
      database={database}
      schemaName={createTableDialog.schemaName}
      availableSchemas={availableSchemaNames}
      open
      onClose={onClose}
      onRefresh={async () => {
        await onRefresh(createTableDialog.schemaName);
      }}
    />
  );
}

/**
 * Sprint 235 — `RenameTableDialog` mount slot. Wraps the new modal so
 * the SchemaTree shell stays readable (mirror `CreateTableDialogSlot`).
 */
interface RenameTableDialogSlotProps {
  connectionId: string;
  database: string;
  renameTableDialog: { schemaName: string; tableName: string } | null;
  onClose: () => void;
}

export function RenameTableDialogSlot({
  connectionId,
  database,
  renameTableDialog,
  onClose,
}: RenameTableDialogSlotProps) {
  if (!renameTableDialog) return null;
  return (
    <RenameTableDialog
      connectionId={connectionId}
      database={database}
      schemaName={renameTableDialog.schemaName}
      tableName={renameTableDialog.tableName}
      open
      onClose={onClose}
    />
  );
}

/**
 * Sprint 235 — `DropTableDialog` mount slot. Same shape as
 * `RenameTableDialogSlot`.
 */
interface DropTableDialogSlotProps {
  connectionId: string;
  database: string;
  dropTableDialog: { schemaName: string; tableName: string } | null;
  onClose: () => void;
}

export function DropTableDialogSlot({
  connectionId,
  database,
  dropTableDialog,
  onClose,
}: DropTableDialogSlotProps) {
  if (!dropTableDialog) return null;
  return (
    <DropTableDialog
      connectionId={connectionId}
      database={database}
      schemaName={dropTableDialog.schemaName}
      tableName={dropTableDialog.tableName}
      open
      onClose={onClose}
    />
  );
}

/**
 * #1639 — `ImportCsvDialog` mount slot (read-only CSV import wizard). Same
 * open/close shape as the rename/drop slots.
 */
interface ImportCsvDialogSlotProps {
  connectionId: string;
  database: string;
  importCsvDialog: { schemaName: string; tableName: string } | null;
  onClose: () => void;
}

export function ImportCsvDialogSlot({
  connectionId,
  database,
  importCsvDialog,
  onClose,
}: ImportCsvDialogSlotProps) {
  if (!importCsvDialog) return null;
  return (
    <ImportCsvDialog
      connectionId={connectionId}
      database={database}
      schemaName={importCsvDialog.schemaName}
      tableName={importCsvDialog.tableName}
      onClose={onClose}
    />
  );
}
