import { useState } from "react";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/runtime/toast";
import { cn } from "@/lib/utils";

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
  const resolvedDisabledReason = disabledReason ?? t("nothingToCopy");
  const [copying, setCopying] = useState(false);
  const disabled = copying || text.trim().length === 0;

  async function handleCopy() {
    if (disabled) return;
    try {
      setCopying(true);
      await navigator.clipboard.writeText(text);
      toast.success(t("copiedToClipboard"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t("copyFailed", { message }));
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
