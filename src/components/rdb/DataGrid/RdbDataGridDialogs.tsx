import type { DataGridEditState } from "@components/datagrid/useDataGridEdit";
import ConfirmDestructiveDialog from "@components/workspace/ConfirmDestructiveDialog";
import { SqlPreviewDialog } from "./SqlPreviewDialog";

interface RdbDataGridDialogsProps {
  connectionId: string;
  connectionEnvironment: string | null;
  connectionLabel: string | null;
  editState: DataGridEditState;
}

export function RdbDataGridDialogs({
  connectionId,
  connectionEnvironment,
  connectionLabel,
  editState,
}: RdbDataGridDialogsProps) {
  return (
    <>
      <SqlPreviewDialog
        editState={editState}
        connectionEnvironment={connectionEnvironment}
        connectionLabel={connectionLabel}
      />
      {editState.pendingConfirm && (
        <ConfirmDestructiveDialog
          open={true}
          reason={editState.pendingConfirm.reason}
          sqlPreview={editState.pendingConfirm.sql}
          environment={
            connectionEnvironment === "production"
              ? "production"
              : "non-production"
          }
          connectionId={connectionId}
          statements={
            editState.pendingConfirm.sql ? [editState.pendingConfirm.sql] : []
          }
          paradigm="rdb"
          onConfirm={() => {
            void editState.confirmDangerous();
          }}
          onCancel={editState.cancelDangerous}
        />
      )}
    </>
  );
}
