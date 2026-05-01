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
 *
 * Post-Sprint-187 hotfix — visuals: drop the hard-coded hex border in
 * favour of icon-shape-only differentiation (ShieldCheck / ShieldAlert /
 * ShieldOff already carry distinct silhouettes). The verbose mode-by-mode
 * description lives in the native `title` tooltip — same surface as every
 * other workspace-toolbar button (DisconnectButton, HistoryButton) so the
 * affordance is uniform. The HoverCard prototype was reverted because it
 * fired alongside the title attribute and Info-icon variants would have
 * collided with the parent button's tooltip on hover.
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
