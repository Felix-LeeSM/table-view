import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import type { KvMutationActionIntent } from "./KvMutationPanel";

interface KvKeyActionsProps {
  productLabel: string;
  selectedMutationReady: boolean;
  onMutationAction: (kind: KvMutationActionIntent["kind"]) => void;
  onNewKey: () => void;
}

export function KvKeyActions({
  productLabel,
  selectedMutationReady,
  onMutationAction,
  onNewKey,
}: KvKeyActionsProps) {
  const { t } = useTranslation("workspace");
  return (
    <div
      className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2"
      aria-label={t("kvKeyActions.containerAria", { productLabel })}
    >
      <Button
        variant="secondary"
        size="xs"
        aria-label={t("kvKeyActions.newKey.aria")}
        title={t("kvKeyActions.newKey.title")}
        onClick={onNewKey}
      >
        <Plus size={12} aria-hidden />
        {t("kvKeyActions.newKey.label")}
      </Button>
      <Button
        variant="secondary"
        size="xs"
        aria-label={t("kvKeyActions.edit.aria")}
        title={t("kvKeyActions.edit.title")}
        disabled={!selectedMutationReady}
        onClick={() => onMutationAction("edit")}
      >
        <Pencil size={12} aria-hidden />
        {t("kvKeyActions.edit.label")}
      </Button>
      <Button
        variant="destructive"
        size="xs"
        aria-label={t("kvKeyActions.delete.aria")}
        title={t("kvKeyActions.delete.title")}
        disabled={!selectedMutationReady}
        onClick={() => onMutationAction("delete")}
      >
        <Trash2 size={12} aria-hidden />
        {t("kvKeyActions.delete.label")}
      </Button>
    </div>
  );
}
