import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@components/ui/button";
import type { KvMutationActionIntent } from "./KvMutationPanel";

interface KvKeyActionsProps {
  productLabel: string;
  selectedMutationReady: boolean;
  onMutationAction: (kind: KvMutationActionIntent["kind"]) => void;
}

export function KvKeyActions({
  productLabel,
  selectedMutationReady,
  onMutationAction,
}: KvKeyActionsProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2"
      aria-label={`${productLabel} key actions`}
    >
      <Button
        variant="secondary"
        size="xs"
        aria-label="New key (unsupported)"
        title="New key creation is not supported in the bounded KV workbench."
        disabled
      >
        <Plus size={12} aria-hidden />
        New key
      </Button>
      <Button
        variant="secondary"
        size="xs"
        aria-label="Edit selected key"
        title="Edit selected key"
        disabled={!selectedMutationReady}
        onClick={() => onMutationAction("edit")}
      >
        <Pencil size={12} aria-hidden />
        Edit
      </Button>
      <Button
        variant="destructive"
        size="xs"
        aria-label="Delete selected key"
        title="Delete selected key"
        disabled={!selectedMutationReady}
        onClick={() => onMutationAction("delete")}
      >
        <Trash2 size={12} aria-hidden />
        Delete
      </Button>
    </div>
  );
}
