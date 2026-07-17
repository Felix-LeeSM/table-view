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
import type { ConnectionDraft } from "../../model";

export interface TlsSkipVerifyToggleProps {
  draft: ConnectionDraft;
  onChange: (patch: Partial<ConnectionDraft>) => void;
}

export default function TlsSkipVerifyToggle({
  draft,
  onChange,
}: TlsSkipVerifyToggleProps) {
  const { t } = useTranslation("featuresConnection");
  // Trust is meaningless without encryption, so the control only appears once
  // TLS is enabled. Toggling TLS off resets trust to null (see the parent
  // forms) so a stale skip-verify choice never lingers.
  if (!draft.tlsEnabled) return null;
  const trust = draft.trustServerCertificate === true;
  return (
    <div className="space-y-1 pl-6">
      <label className="flex items-center gap-2 text-xs text-secondary-foreground">
        <input
          id="conn-trust-server-certificate"
          type="checkbox"
          className="cursor-pointer"
          checked={trust}
          onChange={(e) =>
            onChange({ trustServerCertificate: e.target.checked })
          }
        />
        {t("form.trustServerCert")}
      </label>
      {trust && (
        <p className="text-2xs text-destructive">{t("form.trustWarning")}</p>
      )}
    </div>
  );
}
