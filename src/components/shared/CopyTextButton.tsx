import { Copy } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_BORDERLESS } from "@/components/ui/focusRing";
import { toast } from "@/lib/runtime/toast";
import { cn } from "@/lib/utils";

/**
 * Write to the clipboard and say so. Both affordances in this file share it so
 * the confirmation cannot drift apart between them — `useCopyToClipboard`
 * (`@lib/runtime`) exists because four call-sites had each grown their own
 * subtly different version of this.
 *
 * Failures land in a toast rather than being swallowed: a missing carrier
 * (insecure context, jsdom with no polyfill) throws on the property access,
 * which the same `catch` reports.
 */
function useCopyWithToast(): (text: string) => Promise<void> {
  const { t } = useTranslation("shared");
  return useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t("copiedToClipboard"));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(t("copyFailed", { message }));
      }
    },
    [t],
  );
}

export interface CopyTextButtonProps {
  text: string;
  ariaLabel: string;
  disabledReason?: string;
  className?: string;
}

export function CopyTextButton({
  text,
  ariaLabel,
  disabledReason,
  className,
}: CopyTextButtonProps) {
  const { t } = useTranslation("shared");
  const copyWithToast = useCopyWithToast();
  const resolvedDisabledReason = disabledReason ?? t("nothingToCopy");
  const [copying, setCopying] = useState(false);
  const disabled = copying || text.trim().length === 0;

  async function handleCopy() {
    if (disabled) return;
    try {
      setCopying(true);
      await copyWithToast(text);
    } finally {
      setCopying(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={ariaLabel}
      title={disabled ? resolvedDisabledReason : ariaLabel}
      disabled={disabled}
      onClick={() => void handleCopy()}
      className={cn("text-muted-foreground", className)}
    >
      <Copy size={12} aria-hidden />
    </Button>
  );
}

export interface CopyableTextProps {
  /** Rendered verbatim and copied verbatim — what you see is what you get. */
  text: string;
  className?: string;
}

/**
 * A value that copies itself when you activate it (#2432). Use it where the
 * value came from outside the app and is short enough to read on one line —
 * a cell value, an identifier, a host — and where no click already means
 * something else on that spot. Longer output (a document, a statement, a
 * plan) keeps `CopyTextButton` next to it instead, so the user is not left
 * guessing where a click's boundary is.
 *
 * The affordance is `cursor-copy` plus a dotted underline on hover, and the
 * shared focus ring on keyboard focus. A native `<button>` carries the
 * keyboard path for free: Enter and Space activate it, so the value is not
 * mouse-only. The visible value stays the accessible name — the "click to
 * copy" hint rides on `title`, which reads as the description instead of
 * replacing what the value is.
 *
 * An empty value renders as inert text: a focusable control with nothing to
 * announce and nothing to copy is a tab stop that wastes the user's time.
 */
export function CopyableText({ text, className }: CopyableTextProps) {
  const { t } = useTranslation("shared");
  const copyWithToast = useCopyWithToast();

  if (text === "") return <span className={className} />;

  return (
    <button
      type="button"
      title={t("clickToCopy")}
      onClick={() => void copyWithToast(text)}
      className={cn(
        "cursor-copy rounded-sm text-left underline-offset-2",
        "hover:underline hover:decoration-dotted",
        "focus-visible:outline-none",
        FOCUS_RING_BORDERLESS,
        className,
      )}
    >
      {text}
    </button>
  );
}
