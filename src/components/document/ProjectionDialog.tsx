import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { Button } from "@components/ui/button";

/**
 * Sprint 325 — Slice H: server-side field projection dialog.
 *
 * include vs exclude 모드 + per-column checkbox. Apply 는 Mongo find body
 * 의 `projection` shape (`{ field: 1 | 0 }`) 를 생성. Clear 는 projection
 * 비움 (= 전체 field 반환).
 *
 * Invariants:
 * - `initial` 이 `null` 이면 default include mode + 모든 checkbox 해제.
 * - `initial` 이 `{ name: 1 }` 류면 include mode + 해당 field 체크 (값 모두 1).
 * - `initial` 이 `{ name: 0 }` 류면 exclude mode + 해당 field 체크.
 * - mixed (`{ name: 1, age: 0 }`) 는 비-canonical — backend 가 reject 하므로
 *   v0 dialog 는 hydration 시 mode 를 첫 entry 의 value 로 결정 (관용).
 */
interface ProjectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: ReadonlyArray<{ name: string }>;
  initial: Record<string, 0 | 1> | null;
  onApply: (projection: Record<string, 0 | 1>) => void;
  onClear: () => void;
}

function deriveInitial(initial: Record<string, 0 | 1> | null): {
  mode: "include" | "exclude";
  selected: ReadonlySet<string>;
} {
  if (!initial) return { mode: "include", selected: new Set() };
  const entries = Object.entries(initial);
  if (entries.length === 0) return { mode: "include", selected: new Set() };
  const firstValue = entries[0]![1];
  const mode = firstValue === 1 ? "include" : "exclude";
  return {
    mode,
    selected: new Set(entries.map(([k]) => k)),
  };
}

export default function ProjectionDialog({
  open,
  onOpenChange,
  columns,
  initial,
  onApply,
  onClear,
}: ProjectionDialogProps) {
  const { t } = useTranslation("document");
  const initialDerived = deriveInitial(initial);
  const [mode, setMode] = useState<"include" | "exclude">(initialDerived.mode);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialDerived.selected),
  );

  // Re-hydrate when `initial` changes (e.g. user reopens after Clear).
  useEffect(() => {
    const next = deriveInitial(initial);
    setMode(next.mode);
    setSelected(new Set(next.selected));
  }, [initial]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleApply = () => {
    const value: 0 | 1 = mode === "include" ? 1 : 0;
    const projection: Record<string, 0 | 1> = {};
    for (const name of selected) projection[name] = value;
    onApply(projection);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("projectionDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <fieldset className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="projection-mode"
                checked={mode === "include"}
                onChange={() => setMode("include")}
                aria-label={t("projectionDialog.includeModeAriaLabel")}
              />
              {t("projectionDialog.includeMode")}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="projection-mode"
                checked={mode === "exclude"}
                onChange={() => setMode("exclude")}
                aria-label={t("projectionDialog.excludeModeAriaLabel")}
              />
              {t("projectionDialog.excludeMode")}
            </label>
          </fieldset>
          <ul className="flex max-h-72 flex-col gap-1 overflow-auto rounded border border-border p-2">
            {columns.map((c) => (
              <li key={c.name}>
                <label className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-xs hover:bg-muted">
                  <input
                    type="checkbox"
                    aria-label={c.name}
                    checked={selected.has(c.name)}
                    onChange={() => toggle(c.name)}
                  />
                  <span className="font-mono">{c.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter className="flex justify-between gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onClear}>
            {t("projectionDialog.clear")}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("projectionDialog.cancel")}
            </Button>
            <Button onClick={handleApply}>{t("projectionDialog.apply")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
