/**
 * #1063 — shared sslmode dropdown for the trust-dependent RDB engines
 * (PostgreSQL / MySQL / MariaDB). These route through the backend
 * `resolve_tls_decision` boundary, so their TLS posture is a four-way choice
 * (disable / prefer / require / verify-full) rather than the plain on/off +
 * trust checkbox the on/off engines use. The dropdown is a pure view over the
 * stored `(tlsEnabled, trustServerCertificate)` fields (see `sslModeFromFields`
 * / `sslModeFields`), so no new persisted field is introduced.
 */
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import {
  SSL_MODE_OPTIONS,
  sslModeFields,
  sslModeFromFields,
  type ConnectionDraft,
  type SslMode,
} from "../../model";

const SSL_MODE_LABEL_KEYS: Record<SslMode, string> = {
  disable: "form.sslModeDisable",
  prefer: "form.sslModePrefer",
  require: "form.sslModeRequire",
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
  const mode = sslModeFromFields(
    draft.tlsEnabled,
    draft.trustServerCertificate,
  );
  return (
    <div>
      <label htmlFor="conn-ssl-mode" className={labelClass}>
        {t("form.labelSslMode")}
      </label>
      <Select
        value={mode}
        onValueChange={(value) => onChange(sslModeFields(value as SslMode))}
      >
        <SelectTrigger
          id="conn-ssl-mode"
          className={inputClass}
          aria-label={t("form.labelSslMode")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SSL_MODE_OPTIONS.map((option) => (
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
