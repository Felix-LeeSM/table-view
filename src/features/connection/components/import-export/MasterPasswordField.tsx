import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@components/ui/input";
import { cn } from "@/lib/utils";

export interface MasterPasswordFieldProps {
  value: string;
  onChange: (next: string) => void;
  /** Stable id for the underlying input. Generated when omitted. */
  id?: string;
  /** Label rendered above the input. Defaults to "Master password". */
  label?: string;
  /** Auto-focus the input on mount. */
  autoFocus?: boolean;
  /** Minimum length required before the inline error clears. Defaults to 8. */
  minLength?: number;
  /** Optional id of an external description / error region for aria-describedby. */
  "aria-describedby"?: string;
  /** Disabled when true. */
  disabled?: boolean;
  /** Optional placeholder copy for the input. */
  placeholder?: string;
  /** Optional help text rendered under the input (above any error). */
  helpText?: string;
}

/**
 * Sprint 140 — master password input used by both Encrypted Export and
 * Encrypted Import flows. Renders:
 *   - a labelled `<input>` with a show/hide toggle (Lucide eye icons),
 *   - an inline error when `0 < value.length < minLength`,
 *   - aria attributes connecting the field to its error region.
 *
 * The component does not render an error when `value` is empty so the
 * caller can decide whether an empty password is acceptable (e.g. plain
 * JSON import path) or render its own "required" message above this
 * field.
 */
export default function MasterPasswordField({
  value,
  onChange,
  id,
  label = "Master password",
  autoFocus,
  minLength = 8,
  "aria-describedby": describedByProp,
  disabled,
  placeholder = "At least 8 characters",
  helpText,
}: MasterPasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const reactId = useId();
  const inputId = id ?? `master-pw-${reactId}`;
  const errorId = `${inputId}-error`;
  const helpId = `${inputId}-help`;

  const tooShort = value.length > 0 && value.length < minLength;
  const errorMessage = tooShort
    ? `Master password must be at least ${minLength} characters.`
    : null;

  // Compose aria-describedby from caller + internal regions.
  const describedBy =
    [describedByProp, helpText ? helpId : null, errorMessage ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className="space-y-1">
      <label
        htmlFor={inputId}
        className="block text-xs font-medium text-secondary-foreground"
      >
        {label}
      </label>
      <div className="relative">
        <Input
          id={inputId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          autoComplete="new-password"
          spellCheck={false}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={tooShort || undefined}
          aria-describedby={describedBy}
          className={cn(
            "pr-10 font-mono text-xs",
            tooShort && "border-destructive",
          )}
        />
        <button
          type="button"
          aria-label={visible ? "Hide master password" : "Show master password"}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors",
            "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {helpText && (
        <p id={helpId} className="text-3xs text-muted-foreground">
          {helpText}
        </p>
      )}
      {errorMessage && (
        <p
          id={errorId}
          role="alert"
          className="text-3xs font-medium text-destructive"
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}
