import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@components/ui/dialog";
import { Input } from "@components/ui/input";
import { Button } from "@components/ui/button";
import { CONNECTION_COLOR_PALETTE } from "@lib/connectionColor";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionGroup } from "@/types/connection";

interface GroupDialogProps {
  /** Existing group for rename/recolor; undefined for create. */
  group?: ConnectionGroup;
  onClose: () => void;
}

/**
 * Single dialog that doubles as "create group" and "edit group color/name".
 * - Name is required.
 * - Color is optional: picked from the shared connection palette (Sprint 78
 *   keeps the palette stable — no new hex values).
 * - Reuses the `Dialog` primitive that the rest of the app already uses
 *   (delete-connection confirmation, connection dialog) so the dialog shell
 *   behaves consistently across the surface.
 */
export default function GroupDialog({ group, onClose }: GroupDialogProps) {
  const isEditing = !!group;
  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState<string | null>(group?.color ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addGroup = useConnectionStore((s) => s.addGroup);
  const updateGroup = useConnectionStore((s) => s.updateGroup);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Group name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isEditing && group) {
        await updateGroup({ ...group, name: trimmed, color });
      } else {
        await addGroup({
          id: "",
          name: trimmed,
          color,
          collapsed: false,
        });
      }
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="w-96 bg-secondary p-4" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-foreground">
            {isEditing ? "Edit Group" : "New Group"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs text-muted-foreground">
            {isEditing
              ? "Rename this group or change its color accent."
              : "Create a group to organize your connections. Pick a color to make it easy to spot."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 flex flex-col gap-3">
          <label
            className="flex flex-col gap-1 text-xs font-medium text-secondary-foreground"
            htmlFor="group-dialog-name"
          >
            Name
            <Input
              id="group-dialog-name"
              value={name}
              placeholder="e.g. Production"
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-secondary-foreground">
              Color (optional)
            </span>
            <div
              role="radiogroup"
              aria-label="Group color"
              className="flex flex-wrap items-center gap-2"
            >
              <button
                type="button"
                role="radio"
                aria-checked={color === null}
                aria-label="No color"
                title="No color"
                onClick={() => setColor(null)}
                className={`flex h-6 w-6 items-center justify-center rounded-full border border-border bg-muted text-3xs text-muted-foreground transition-shadow ${
                  color === null
                    ? "ring-2 ring-primary ring-offset-1 ring-offset-secondary"
                    : ""
                }`}
              >
                —
              </button>
              {CONNECTION_COLOR_PALETTE.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  role="radio"
                  aria-checked={color === swatch}
                  aria-label={`Color ${swatch}`}
                  title={swatch}
                  onClick={() => setColor(swatch)}
                  className={`h-6 w-6 rounded-full border border-border transition-shadow ${
                    color === swatch
                      ? "ring-2 ring-primary ring-offset-1 ring-offset-secondary"
                      : ""
                  }`}
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {isEditing ? "Save" : "Create Group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
