import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";

/**
 * `CreateTableDialogHeader` — extracted 2026-05-07 (Sprint 227 redesign)
 * and slimmed in Sprint 234 (Phase 27 sprint 9).
 *
 * Sprint 234 change:
 *   - The schema picker block (label + `<Select>`) was REMOVED from the
 *     header per user feedback ("schema picker 위치는 header 말고 body
 *     안 (table name 위)"). The picker now lives in
 *     `CreateTableDialog.tsx` body, ABOVE the Table name input. The
 *     header collapses back to a thin title bar — title +
 *     `DialogDescription sr-only` + close `<X>` button only.
 *
 * The `selectedSchema` value is still used by the screen-reader-only
 * `DialogDescription` so the modal's accessible description tells the
 * user which schema the table will be created in.
 */
export interface CreateTableDialogHeaderProps {
  /** Drives the screen-reader-only description text. */
  selectedSchema: string;
  onClose: () => void;
}

export default function CreateTableDialogHeader({
  selectedSchema,
  onClose,
}: CreateTableDialogHeaderProps) {
  const { t } = useTranslation("schemaDialogs");
  return (
    <DialogHeader layout="column" className="border-b border-border px-4 py-3">
      <div className="flex items-center justify-between">
        <DialogTitle className="text-sm font-semibold text-foreground">
          {t("createTable.title")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("createTable.descriptionAria", { schema: selectedSchema })}
        </DialogDescription>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={t("closeDialog")}
        >
          <X />
        </Button>
      </div>
    </DialogHeader>
  );
}
