import { ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";
import { Button } from "@components/ui/button";
import { useSafeModeStore, type SafeMode } from "@stores/safeModeStore";

/**
 * Safe Mode toggle — workspace-toolbar control that cycles
 * `useSafeModeStore.mode` (strict → warn → off → strict). The strict → warn
 * step prevents a single click from silently disabling the production
 * guard; warn opens a type-to-confirm dialog at commit time instead of
 * blocking outright (see `ConfirmDangerousDialog`).
 *
 * Visuals use icon-shape-only differentiation (ShieldCheck / ShieldAlert /
 * ShieldOff carry distinct silhouettes). Verbose mode-by-mode description
 * lives in the native `title` tooltip — uniform with every other
 * workspace-toolbar button.
 */
const MODE_META: Record<
  SafeMode,
  {
    label: string;
    tooltip: string;
    ariaPressed: "true" | "mixed" | "false";
    icon: typeof ShieldCheck;
  }
> = {
  strict: {
    label: "Safe Mode",
    tooltip: [
      "Safe Mode: Strict (click to switch to warn)",
      "",
      "On production connections, blocks Execute on:",
      " • DROP TABLE / DATABASE / SCHEMA / INDEX / VIEW",
      " • TRUNCATE TABLE",
      " • ALTER TABLE … DROP COLUMN / DROP CONSTRAINT",
      " • UPDATE / DELETE without WHERE",
      "",
      "Non-production environments (local / testing / development / staging) are never gated.",
    ].join("\n"),
    ariaPressed: "true",
    icon: ShieldCheck,
  },
  warn: {
    label: "Safe Mode: Warn",
    tooltip: [
      "Safe Mode: Warn (click to disable)",
      "",
      "Same statements as Strict, but production prompts type-to-confirm before commit instead of blocking.",
      "",
      "Non-production environments are never gated.",
    ].join("\n"),
    ariaPressed: "mixed",
    icon: ShieldAlert,
  },
  off: {
    label: "Safe Mode: Off",
    tooltip: [
      "Safe Mode: Off (click to re-enable for non-production)",
      "",
      "Production-tagged connections still force Safe Mode automatically.",
      "Use Off only for one-off destructive maintenance on local / testing",
      "/ development / staging.",
    ].join("\n"),
    ariaPressed: "false",
    icon: ShieldOff,
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
    >
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span className="ml-1 text-xs">{meta.label}</span>
    </Button>
  );
}
