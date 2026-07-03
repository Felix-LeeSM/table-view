/**
 * Sprint 256 (ADR 0023, AC-256-05) — `ExecuteButton`.
 *
 * Composed Execute affordance applied to every confirm-write surface
 * (Q5-(b) decision: colour × env + target label, NO verb extraction).
 * Five callsites swap their hand-rolled buttons for this single
 * component:
 *   - `<SqlPreviewDialog>`            (RDB structure preview)
 *   - `<MqlPreviewModal>`             (Mongo preview)
 *   - `<DataGrid>`                     (inline edit preview footer)
 *   - `<EditableQueryResultGrid>`     (raw query toolbar Execute)
 *   - `<ConfirmDestructiveDialog>`    (footer Confirm / Execute)
 *
 *   severity × environment matrix:
 *     WARN + dev|null|local|testing|development  → `--tv-success`     (green)
 *     WARN + staging                              → `--tv-warning`     (orange)
 *     WARN + production                           → `--tv-destructive` (red)
 *     STOP + any                                  → `--tv-destructive` (red)
 *
 * Label format:
 *   - env null/dev (local/testing/development) → "Execute"
 *   - env staging/production                   → "Execute on <conn>"
 *   - tooltip (`title`) always carries the full label so a truncated
 *     long connection name remains discoverable (Q5 "폭 압박" mitigation).
 *   - `max-w-[260px] truncate` ensures the visible label never blows up
 *     a tight footer.
 */
import type { Ref } from "react";
import { Loader2, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import { cn } from "@/lib/utils";

export type ExecuteSeverity = "warn" | "danger";

export interface ExecuteButtonProps {
  /**
   * Statement severity. `warn` = proceed-with-confirm; `danger` = STOP
   * tier (always red regardless of env). Maps to ADR 0023's 3-tier
   * classifier (info / warn / danger).
   */
  severity: ExecuteSeverity;
  /**
   * Connection environment (raw `connection.environment` from the
   * store). `null` and unknown strings collapse to "dev-or-null".
   */
  environment: string | null;
  /**
   * Display name for the connection (`connection.name`). Used for the
   * "Execute on <conn>" target label when env ∈ {staging, production}.
   * `null` collapses the label to the plain "Execute" form.
   */
  connectionLabel: string | null;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  /** Optional aria-label override (used when the visible label is too generic). */
  ariaLabel?: string;
  /** Optional autoFocus pass-through for the dialog primary action. */
  autoFocus?: boolean;
  /**
   * Optional ref to the underlying `<button>`. Dialogs use it to move
   * focus onto the primary action once it arms (#1111), so the
   * muscle-memory Enter lands on Confirm rather than Cancel.
   */
  ref?: Ref<HTMLButtonElement>;
  /** Optional className passthrough. */
  className?: string;
  /** Optional data-testid override for legacy regression tests. */
  testId?: string;
}

interface ColorTokens {
  bg: string;
  fg: string;
  hoverBg: string;
}

function pickColorTokens(
  severity: ExecuteSeverity,
  environment: string | null,
): ColorTokens {
  if (severity === "danger") {
    return {
      bg: "var(--tv-destructive)",
      fg: "var(--tv-destructive-foreground)",
      hoverBg: "color-mix(in srgb, var(--tv-destructive) 90%, black)",
    };
  }
  if (environment === "production") {
    return {
      bg: "var(--tv-destructive)",
      fg: "var(--tv-destructive-foreground)",
      hoverBg: "color-mix(in srgb, var(--tv-destructive) 90%, black)",
    };
  }
  if (environment === "staging") {
    return {
      bg: "var(--tv-warning)",
      fg: "var(--tv-warning-foreground)",
      hoverBg: "color-mix(in srgb, var(--tv-warning) 90%, black)",
    };
  }
  // dev / local / testing / development / null → success (green).
  return {
    bg: "var(--tv-success)",
    fg: "var(--tv-success-foreground)",
    hoverBg: "color-mix(in srgb, var(--tv-success) 90%, black)",
  };
}

function severityEnvKey(
  severity: ExecuteSeverity,
  environment: string | null,
): string {
  if (severity === "danger") return "danger";
  if (environment === "production") return "warn:prod";
  if (environment === "staging") return "warn:staging";
  return "warn:dev";
}

export default function ExecuteButton({
  severity,
  environment,
  connectionLabel,
  loading,
  disabled,
  onClick,
  ariaLabel,
  autoFocus,
  ref,
  className,
  testId,
}: ExecuteButtonProps) {
  const { t } = useTranslation("ui");
  const isEnvLabelled =
    environment === "staging" || environment === "production";
  const fullLabel = loading
    ? t("executing")
    : isEnvLabelled && connectionLabel
      ? t("executeOn", { connectionLabel })
      : t("execute");
  const tokens = pickColorTokens(severity, environment);

  return (
    <Button
      type="button"
      size="sm"
      variant="default"
      ref={ref}
      autoFocus={autoFocus}
      disabled={disabled || loading}
      aria-busy={loading}
      onClick={onClick}
      aria-label={ariaLabel ?? fullLabel}
      title={fullLabel}
      data-testid={testId ?? "execute-button"}
      data-severity-env={severityEnvKey(severity, environment)}
      className={cn(
        "min-w-0 transition-colors",
        // The Button base owns paddings + height; we layer color via
        // inline style so all 72 themes inherit the env tokens.
        className,
      )}
      style={{
        backgroundColor: tokens.bg,
        color: tokens.fg,
        // Hover state — exposed as a custom property the root :hover
        // rule reads through tailwind's arbitrary `[--tv-hover-bg:...]`
        // form. Falling back to `bg` keeps the colour stable when the
        // browser doesn't support `color-mix`.
        ["--tv-hover-bg" as string]: tokens.hoverBg,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = tokens.hoverBg;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = tokens.bg;
      }}
    >
      {loading ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <Play aria-hidden="true" />
      )}
      <span data-execute-button-label className="truncate max-w-execute-label">
        {fullLabel}
      </span>
    </Button>
  );
}
