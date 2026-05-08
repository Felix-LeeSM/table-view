import { ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";
import { Button } from "@components/ui/button";
import { useSafeModeStore, type SafeMode } from "@stores/safeModeStore";

/**
 * Safe Mode toggle — workspace-toolbar control that cycles
 * `useSafeModeStore.mode` (strict → warn → off → strict). The strict → warn
 * step prevents a single click from silently disabling the production
 * guard; the destructive confirm dialog opens at commit time on
 * production regardless of mode (see `ConfirmDangerousDialog`).
 *
 * Sprint 245 (ADR 0022 Phase 1) — mode 3-tier semantic redefined to a
 * destructive-only policy. The store enum / icons / cycle order are
 * preserved; only the tooltip copy and the underlying decision matrix
 * (`decideSafeModeAction`) changed:
 *
 *   - strict: destructive confirm in *all* environments (production +
 *     non-production). Useful for shared-staging / learning DBs where a
 *     dev wants the same dialog gate as production.
 *   - warn (default): destructive confirm in production only.
 *     Non-production is unguarded.
 *   - off: prod-auto — production still confirms (the toolbar toggle
 *     can't bypass the prod safety net); non-prod is fully unguarded.
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
      "Confirms destructive statements in all environments (production + non-production strict). Destructive includes:",
      " • DROP TABLE / DATABASE / SCHEMA / INDEX / VIEW",
      " • TRUNCATE TABLE",
      " • ALTER TABLE … DROP COLUMN / DROP CONSTRAINT",
      " • UPDATE / DELETE without WHERE",
      "",
      "Safe writes (INSERT, UPDATE WHERE, CREATE, ALTER additive) flow through without a dialog — Cmd+Z protects recent commits.",
    ].join("\n"),
    ariaPressed: "true",
    icon: ShieldCheck,
  },
  warn: {
    label: "Safe Mode: Warn",
    tooltip: [
      "Safe Mode: Warn (click to disable)",
      "",
      "Confirms destructive statements in production only. Non-production environments (local / testing / development / staging) are never gated.",
      "",
      "Safe writes flow through everywhere — Cmd+Z protects recent commits.",
    ].join("\n"),
    ariaPressed: "mixed",
    icon: ShieldAlert,
  },
  off: {
    label: "Safe Mode: Off",
    tooltip: [
      "Safe Mode: Off (click to re-enable for non-production)",
      "",
      "Production-tagged connections still confirm destructive statements automatically (production-auto). Non-production is fully unguarded — use Off for one-off destructive maintenance on local / testing / development / staging.",
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
