import {
  type BsonType,
  coerceToEjson,
  ejsonToEditableString,
} from "@lib/mongo/bsonTypes";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Type-aware inline editor for BSON wrappers.
 *
 * Invariants:
 * - The user's raw string is always controlled state. A failed coerce
 *   blocks the commit and shows a hint → the user fixes it and hits Enter
 *   again.
 * - Esc invokes onCancel only (no commit).
 * - F.2's plain-string Pencil is for cells whose BSON type is not
 *   recognised; this component mounts only on cells with a recognised
 *   wrapper.
 */
interface BsonTypeEditorProps {
  type: BsonType;
  /** Canonical EJSON wrapper. Empty input on a detect mismatch. */
  initialValue: unknown;
  /** Called with the canonical EJSON wrapper object once validation passes. */
  onCommit: (value: Record<string, unknown>) => void;
  onCancel: () => void;
  ariaLabel: string;
}

export default function BsonTypeEditor({
  type,
  initialValue,
  onCommit,
  onCancel,
  ariaLabel,
}: BsonTypeEditorProps) {
  const { t } = useTranslation("document");
  const [draft, setDraft] = useState<string>(() =>
    ejsonToEditableString(type, initialValue),
  );
  const [error, setError] = useState<string | null>(null);

  const typeHint: Record<BsonType, string> = {
    objectId: t("bsonTypeEditor.hintObjectId"),
    date: t("bsonTypeEditor.hintDate"),
    decimal128: t("bsonTypeEditor.hintDecimal128"),
    binData: t("bsonTypeEditor.hintBinData"),
  };

  const tryCommit = () => {
    const result = coerceToEjson(type, draft);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    onCommit(result.value);
  };

  return (
    <span className="flex w-full flex-col gap-0.5">
      <input
        type="text"
        autoFocus
        aria-label={ariaLabel}
        aria-invalid={error !== null}
        className="w-full bg-transparent px-1 py-0 text-xs text-foreground outline-none ring-1 ring-primary"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            tryCommit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      {error ? (
        <span
          role="alert"
          className="text-3xs text-destructive"
          data-testid="bson-editor-error"
        >
          {error}
        </span>
      ) : (
        <span
          className="text-3xs text-muted-foreground"
          data-testid="bson-editor-hint"
        >
          {typeHint[type]}
        </span>
      )}
    </span>
  );
}
