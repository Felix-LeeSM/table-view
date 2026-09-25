import { Button } from "@components/ui/button";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * `CreateTableDialogHeader` — a thin title bar: title +
 * `DialogDescription sr-only` + close `<X>` button only.
 *
 * The schema picker block (label + `<Select>`) is NOT in the header, per
 * user feedback ("put the schema picker in the body, above the table
 * name, not in the header"). It lives in the `CreateTableDialog.tsx`
 * body, ABOVE the Table name input.
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
