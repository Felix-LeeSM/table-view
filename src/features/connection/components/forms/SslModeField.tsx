/**
 * #1063 / #1649 — shared sslmode dropdown for the trust-dependent RDB engines
 * (PostgreSQL / MySQL / MariaDB). These route through the backend
 * `resolve_tls_decision` boundary, so their TLS posture is a five-way choice
 * (disable / prefer / require / verify-ca / verify-full). #1649 (ADR 0058)
 * promotes `sslMode` to a real persisted field and adds `verify-ca`: when it is
 * selected, a CA certificate path input appears so a private/self-signed CA
 * (`caCertPath`) is trusted *in addition to* the driver's built-in public roots.
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
  type ConnectionDraft,
  type SslMode,
} from "../../model";
import { fieldValidationProps, type ConnFieldKey } from "./fieldValidation";

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
  invalidField?: ConnFieldKey | null;
}

export default function SslModeField({
  draft,
  onChange,
  inputClass,
  labelClass,
  invalidField,
}: SslModeFieldProps) {
  const { t } = useTranslation("featuresConnection");
  const mode = draft.sslMode ?? "prefer";
  return (
    <div>
      <label htmlFor="conn-ssl-mode" className={labelClass}>
        {t("form.labelSslMode")}
      </label>
      <Select
        value={mode}
        onValueChange={(value) =>
          onChange({
            sslMode: value as SslMode,
            // #1649 — a CA path is only meaningful for verify-ca; drop a stale
            // one when the user moves to any other posture.
            ...(value === "verify-ca" ? {} : { caCertPath: null }),
          })
        }
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
      {/* #1649 — verify-ca adds a user-supplied CA to the trust anchors; reveal
          the path input so the feature is reachable. The CA file is required for
          this posture: with no anchor to add, `verify-ca` *is* `verify-full`,
          so the save is blocked rather than storing a posture that claims a
          private trust anchor the connection does not have. */}
      {mode === "verify-ca" && (
        <div className="mt-2">
          <label htmlFor="conn-ca-cert-path" className={labelClass}>
            {t("form.labelCaCertPath")}
          </label>
          <input
            id="conn-ca-cert-path"
            className={inputClass}
            value={draft.caCertPath ?? ""}
            onChange={(e) => onChange({ caCertPath: e.target.value || null })}
            placeholder={t("form.placeholderCaCertPath")}
            {...fieldValidationProps("caCertPath", true, invalidField)}
          />
          <p className="mt-1 text-2xs text-muted-foreground">
            {t("form.caCertPathHint")}
          </p>
        </div>
      )}
    </div>
  );
}
