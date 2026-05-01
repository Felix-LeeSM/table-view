import { ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";
import { Button } from "@components/ui/button";
import { useSafeModeStore, type SafeMode } from "@stores/safeModeStore";

/**
 * Sprint 185 — Safe Mode toggle.
 * Sprint 186 — extended to a 3-way cycle (strict → warn → off → strict).
 *
 * Workspace-toolbar control that flips `useSafeModeStore.mode`. The strict
 * → warn step prevents a single click from silently disabling the production
 * guard; warn opens a type-to-confirm dialog at commit time instead of
 * blocking outright (see `ConfirmDangerousDialog`).
 */
const MODE_META: Record<
  SafeMode,
  {
    label: string;
    tooltip: string;
    ariaPressed: "true" | "mixed" | "false";
    icon: typeof ShieldCheck;
    className: string;
  }
> = {
  strict: {
    label: "Safe Mode",
    tooltip:
      "Safe Mode is on (strict — production blocks dangerous SQL; click to switch to warn)",
    ariaPressed: "true",
    icon: ShieldCheck,
    className: "border border-[#ef4444] text-foreground",
  },
  warn: {
    label: "Safe Mode: Warn",
    tooltip:
      "Safe Mode is in warn mode (production prompts before dangerous SQL; click to disable)",
    ariaPressed: "mixed",
    icon: ShieldAlert,
    className: "border border-[#f59e0b] text-foreground",
  },
  off: {
    label: "Safe Mode: Off",
    tooltip: "Safe Mode is off (click to re-enable production guard)",
    ariaPressed: "false",
    icon: ShieldOff,
    className: "text-muted-foreground",
  },
};

export default function SafeModeToggle() {
  const mode = useSafeModeStore((s) => s.mode);
  const toggle = useSafeModeStore((s) => s.toggle);
  const meta = MODE_META[mode];
  const Icon = meta.icon;

  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      aria-label={meta.label}
      aria-pressed={meta.ariaPressed}
      title={meta.tooltip}
      data-mode={mode}
      onClick={toggle}
      className={meta.className}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="ml-1 text-xs">{meta.label}</span>
    </Button>
  );
}
