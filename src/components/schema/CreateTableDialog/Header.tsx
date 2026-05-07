import { X } from "lucide-react";
import { Button } from "@components/ui/button";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";

/**
 * `CreateTableDialogHeader` — extracted 2026-05-07 per user feedback.
 * Mirrors the `ConnectionDialog` header pattern (single-row title + X
 * inside `DialogHeader` row layout) and adds a second row for the
 * target-schema dropdown. Pulled out of the parent so the title bar
 * isn't tangled with body / preview / footer JSX. Pure presentational
 * — schema list + selection + close handler all flow in as props.
 *
 * Schema picker visibility: the picker only renders when there is at
 * least one schema in `schemaOptions`. (When MySQL/MariaDB land in
 * Phase 17+, those drivers will pass an empty list and the row
 * collapses naturally; no extra capability flag plumbing needed in
 * this file.)
 */
export interface CreateTableDialogHeaderProps {
  selectedSchema: string;
  schemaOptions: string[];
  onSchemaChange: (next: string) => void;
  onClose: () => void;
}

export default function CreateTableDialogHeader({
  selectedSchema,
  schemaOptions,
  onSchemaChange,
  onClose,
}: CreateTableDialogHeaderProps) {
  const showSchemaPicker = schemaOptions.length > 0;
  return (
    <DialogHeader layout="column" className="border-b border-border px-4 py-3">
      <div className="flex items-center justify-between">
        <DialogTitle className="text-sm font-semibold text-foreground">
          Create Table
        </DialogTitle>
        <DialogDescription className="sr-only">
          Create a new table in {selectedSchema}
        </DialogDescription>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X />
        </Button>
      </div>
      {showSchemaPicker && (
        <div className="flex items-center gap-2">
          <label
            htmlFor="create-table-target-schema"
            className="text-xs font-medium text-secondary-foreground"
          >
            Target schema
          </label>
          <Select value={selectedSchema} onValueChange={onSchemaChange}>
            <SelectTrigger
              id="create-table-target-schema"
              aria-label="Target schema"
              size="sm"
              className="min-w-32"
            >
              <SelectValue placeholder="schema" />
            </SelectTrigger>
            <SelectContent>
              {schemaOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </DialogHeader>
  );
}
