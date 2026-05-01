import { ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@components/ui/button";
import { useSafeModeStore } from "@stores/safeModeStore";

/**
 * Sprint 185 — Safe Mode toggle.
 *
 * Workspace-toolbar control that flips `useSafeModeStore.mode`. When
 * strict (default), production-tagged connections block WHERE-less DML
 * and DDL drops at commit time (see `useDataGridEdit` and
 * `EditableQueryResultGrid`). When off, the gate is bypassed for the
 * current session — persisted across windows via the Sprint 151 bridge.
 */
export default function SafeModeToggle() {
  const mode = useSafeModeStore((s) => s.mode);
  const toggle = useSafeModeStore((s) => s.toggle);

  const isStrict = mode === "strict";
  const label = isStrict ? "Safe Mode" : "Safe Mode: Off";
  const tooltip = isStrict
    ? "Safe Mode is on (click to disable production guard)"
    : "Safe Mode is off (click to re-enable production guard)";

  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      aria-label={label}
      aria-pressed={isStrict}
      title={tooltip}
      data-mode={mode}
      onClick={toggle}
      className={
        isStrict
          ? "border border-[#ef4444] text-foreground"
          : "text-muted-foreground"
      }
    >
      {isStrict ? (
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
      ) : (
        <ShieldOff className="h-4 w-4" aria-hidden="true" />
      )}
      <span className="ml-1 text-xs">{label}</span>
    </Button>
  );
}
