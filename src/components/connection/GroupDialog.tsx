import { useState } from "react";
import FormDialog from "@components/ui/dialog/FormDialog";
import { Input } from "@components/ui/input";
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
 * - Sprint 96: migrated to the `FormDialog` preset (Layer 2). The preset
 *   owns the title + body + submit/cancel footer boilerplate; this file
 *   keeps the form-specific bits (palette radio group, name validation).
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
    <FormDialog
      title={isEditing ? "Edit Group" : "New Group"}
      description={
        isEditing
          ? "Rename this group or change its color accent."
          : "Create a group to organize your connections. Pick a color to make it easy to spot."
      }
      className="w-96 bg-secondary p-4"
      onSubmit={handleSave}
      onCancel={onClose}
      submitLabel={isEditing ? "Save" : "Create Group"}
      isSubmitting={saving}
      submitDisabled={!name.trim()}
    >
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
    </FormDialog>
  );
}
