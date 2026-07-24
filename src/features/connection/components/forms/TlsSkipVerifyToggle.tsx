/**
 * #1063 — shared skip-verify opt-in for the on/off TLS engines
 * (MongoDB / Redis / Valkey / Elasticsearch / OpenSearch). These engines only
 * exposed a plain "Enable TLS" checkbox before, which always meant full
 * certificate verification — leaving self-signed clusters no path but turning
 * TLS off entirely. This renders the explicit, opt-in "trust server certificate"
 * checkbox (only while TLS is on) plus an in-form warning so choosing it is a
 * deliberate act. The backend maps `trustServerCertificate` onto each driver's
 * skip-verify flag (`allow_invalid_certificates` / `insecure` /
 * `danger_accept_invalid_certs`).
 */
import { useTranslation } from "react-i18next";
import {
  sslModeSkipVerify,
  sslModeTlsOn,
  type ConnectionDraft,
} from "../../model";

export interface TlsSkipVerifyToggleProps {
  draft: ConnectionDraft;
  onChange: (patch: Partial<ConnectionDraft>) => void;
}

export default function TlsSkipVerifyToggle({
  draft,
  onChange,
}: TlsSkipVerifyToggleProps) {
  const { t } = useTranslation("featuresConnection");
  // Skip-verify is meaningless without encryption, so the control only appears
  // once TLS is enabled. #1649 — the choice is folded into `sslMode`: ticking
  // it selects `require` (skip-verify), unticking returns to `verify-full`.
  if (!sslModeTlsOn(draft.sslMode)) return null;
  const skip = sslModeSkipVerify(draft.sslMode);
  return (
    <div className="space-y-1 pl-6">
      <label className="flex items-center gap-2 text-xs text-secondary-foreground">
        <input
          id="conn-trust-server-certificate"
          type="checkbox"
          className="cursor-pointer"
          checked={skip}
          onChange={(e) =>
            onChange({ sslMode: e.target.checked ? "require" : "verify-full" })
          }
        />
        {t("form.trustServerCert")}
      </label>
      {skip && (
        <p className="text-2xs text-destructive">{t("form.trustWarning")}</p>
      )}
    </div>
  );
}
