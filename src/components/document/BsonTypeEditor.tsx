import { useState } from "react";
import {
  type BsonType,
  coerceToEjson,
  ejsonToEditableString,
} from "@lib/mongo/bsonTypes";

/**
 * Sprint 323 — Slice G.1: type-aware inline editor for BSON wrappers.
 *
 * Invariants:
 * - 사용자 raw-string 은 항상 controlled state. coerce 실패 시 commit
 *   막고 hint 노출 → 사용자가 고치고 다시 Enter.
 * - Esc 는 onCancel 만 invoke (commit 안 함).
 * - F.2 의 plain-string Pencil 은 BSON type 미인식 cell 전용; 이 컴포넌트
 *   는 wrapper 인식된 cell 에서만 mount 된다 (Sprint 324 G.2 wire-up).
 */
interface BsonTypeEditorProps {
  type: BsonType;
  /** canonical EJSON wrapper. detect 미스매치 시 빈 input. */
  initialValue: unknown;
  /** 검증 통과 시 canonical EJSON wrapper 객체로 호출. */
  onCommit: (value: Record<string, unknown>) => void;
  onCancel: () => void;
  ariaLabel: string;
}

const typeHint: Record<BsonType, string> = {
  objectId: "24-hex (e.g. 65abcdef0123456789abcdef)",
  date: "ISO 8601 (e.g. 2026-05-15T12:00:00Z)",
  decimal128: "Numeric string (e.g. 1234.5678)",
  binData: "Base64 payload (subType 00)",
};

export default function BsonTypeEditor({
  type,
  initialValue,
  onCommit,
  onCancel,
  ariaLabel,
}: BsonTypeEditorProps) {
  const [draft, setDraft] = useState<string>(() =>
    ejsonToEditableString(type, initialValue),
  );
  const [error, setError] = useState<string | null>(null);

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
