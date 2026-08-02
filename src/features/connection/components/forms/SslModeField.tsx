/**
 * #1063 — shared sslmode dropdown for the trust-dependent RDB engines
 * (PostgreSQL / MySQL / MariaDB). These route through the backend
 * `resolve_tls_decision` boundary, so their TLS posture is a multi-way choice
 * rather than the plain on/off + trust checkbox the on/off engines use.
 *
 * #1649 — the dropdown now binds directly to the persisted `sslMode` field
 * instead of deriving a view over a boolean pair. `verify-ca` is not among the
 * offered options: it needs a CA file, and the file picker is the follow-up
 * slice. A connection already stored as `verify-ca` still renders its own
 * value (see `sslModeChoices`) so opening the dialog cannot silently rewrite
 * a posture the form cannot yet author.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { useTranslation } from "react-i18next";
import {
  type ConnectionDraft,
  draftSslMode,
  type SslMode,
  sslModeChoices,
} from "../../model";

const SSL_MODE_LABEL_KEYS: Record<SslMode, string> = {
  disable: "form.sslModeDisable",
  prefer: "form.sslModePrefer",
  require: "form.sslModeRequire",
  "verify-ca": "form.sslModeVerifyCa",
  "verify-full": "form.sslModeVerifyFull",
};

export interface SslModeFieldProps {
  draft: ConnectionDraft;
  onChange: (patch: Partial<ConnectionDraft>) => void;
  inputClass: string;
  labelClass: string;
}

export default function SslModeField({
  draft,
  onChange,
  inputClass,
  labelClass,
}: SslModeFieldProps) {
  const { t } = useTranslation("featuresConnection");
  const mode = draftSslMode(draft);
  return (
    <div>
      <label htmlFor="conn-ssl-mode" className={labelClass}>
        {t("form.labelSslMode")}
      </label>
      <Select
        value={mode}
        onValueChange={(value) => onChange({ sslMode: value as SslMode })}
      >
        <SelectTrigger
          id="conn-ssl-mode"
          className={inputClass}
          aria-label={t("form.labelSslMode")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sslModeChoices(mode).map((option) => (
            <SelectItem key={option} value={option}>
              {t(SSL_MODE_LABEL_KEYS[option])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1 text-2xs text-muted-foreground">
        {t("form.tlsHintSslMode")}
      </p>
      {/* `require` encrypts but skips certificate verification — warn about the
          MITM exposure so the user picks it deliberately, not by accident. This
          is persistent advisory copy (read in document order), not a live
          alert region. */}
      {mode === "require" && (
        <p className="mt-1 text-2xs text-destructive">
          {t("form.trustWarning")}
        </p>
      )}
    </div>
  );
}
