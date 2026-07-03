import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import ConfirmDialog from "@components/ui/dialog/ConfirmDialog";

/**
 * #1101 — shared "Discard unsaved changes?" gate for the close paths that
 * discard window-local pending grid edits / uncommitted SQL (Cmd+W, native
 * window close, disconnect). The TabBar X button already had this guard
 * inline; this hook lifts the same `ConfirmDialog` UX so every close path
 * routes through one confirmation instead of re-inventing a dialog.
 *
 * Usage:
 *   const { guard, dialog } = useDiscardConfirm();
 *   // ...
 *   guard(isDirty, () => performClose());   // runs immediately when clean
 *   // render `{dialog}` somewhere in the tree
 */
export function useDiscardConfirm(): {
  guard: (isDirty: boolean, onProceed: () => void) => void;
  dialog: React.ReactNode;
} {
  const { t } = useTranslation("layout");
  const [pending, setPending] = useState<(() => void) | null>(null);

  const guard = useCallback((isDirty: boolean, onProceed: () => void) => {
    if (!isDirty) {
      onProceed();
      return;
    }
    // Store the callback behind the confirm dialog. The functional
    // updater form keeps zustand/React from calling `onProceed` as a
    // state reducer.
    setPending(() => onProceed);
  }, []);

  const dialog = pending ? (
    <ConfirmDialog
      title={t("tabBar.discardTitle")}
      message={t("tabBar.discardGenericMessage")}
      confirmLabel={t("tabBar.discardConfirm")}
      danger
      onConfirm={() => {
        const run = pending;
        setPending(null);
        run();
      }}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { guard, dialog };
}
