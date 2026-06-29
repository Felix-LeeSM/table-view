import { ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import { useSafeModeStore, type SafeMode } from "@stores/safeModeStore";

/**
 * Safe Mode toggle — workspace-toolbar control that cycles
 * `useSafeModeStore.mode` (strict → warn → off → strict). The strict → warn
 * step prevents a single click from silently disabling the production
 * guard; the destructive confirm dialog opens at commit time on
 * production regardless of mode (see `ConfirmDestructiveDialog`).
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
const MODE_ICON: Record<SafeMode, typeof ShieldCheck> = {
  strict: ShieldCheck,
  warn: ShieldAlert,
  off: ShieldOff,
};

const MODE_ARIA_PRESSED: Record<SafeMode, "true" | "mixed" | "false"> = {
  strict: "true",
  warn: "mixed",
  off: "false",
};

export default function SafeModeToggle() {
  const { t } = useTranslation("workspace");
  const mode = useSafeModeStore((s) => s.mode);
  const toggle = useSafeModeStore((s) => s.toggle);
  const Icon = MODE_ICON[mode];
  const label = t(`safeMode.${mode}.label`);
  const tooltip = t(`safeMode.${mode}.tooltip`);

  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      aria-label={label}
      aria-pressed={MODE_ARIA_PRESSED[mode]}
      title={tooltip}
      data-mode={mode}
      onClick={toggle}
    >
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span className="ml-1 text-xs">{label}</span>
    </Button>
  );
}
