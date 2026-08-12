/**
 * #1063 — shared sslmode dropdown for the RDB engines that resolve the whole
 * posture rather than a plain on/off toggle: PostgreSQL / MySQL / MariaDB and,
 * since #2154, Oracle. These route through the backend `resolve_tls_decision`
 * boundary, so their TLS posture is a multi-way choice rather than the on/off +
 * trust checkbox the other engines use.
 *
 * #1649 — the dropdown now binds directly to the persisted `sslMode` field
 * instead of deriving a view over a boolean pair. `verify-ca` is not among the
 * offered options: it needs a CA file, and the file picker is the follow-up
 * slice. A connection already stored as `verify-ca` still renders its own
 * value (see `sslModeChoices`) so opening the dialog cannot silently rewrite
 * a posture the form cannot yet author.
 *
 * #2154 — the offered list is read from `sslModeOptionsFor(draft.dbType)`
 * rather than passed in, so the dropdown and the URL-paste path cannot offer
 * different sets for the same engine.
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
  sslModeOptionsFor,
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
        // #1649 — the CA anchor belongs to `verify-ca` alone, so any pick here
        // drops it: a stored `verify-ca` the user moved away from must not be
        // resurrected later by the skip-verify round trip
        // (`draftVerifyingSslMode`), and an anchor no posture reads must not be
        // persisted. Unconditional because `verify-ca` is never in
        // `SSL_MODE_OPTIONS` — `sslModeChoices` only re-adds it when it is
        // already the selected value, and a controlled Radix `Select` fires no
        // change for the value it already holds.
        onValueChange={(value) =>
          onChange({ sslMode: value as SslMode, caCertPath: null })
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
          {sslModeChoices(mode, sslModeOptionsFor(draft.dbType)).map(
            (option) => (
              <SelectItem key={option} value={option}>
                {t(SSL_MODE_LABEL_KEYS[option])}
              </SelectItem>
            ),
          )}
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
