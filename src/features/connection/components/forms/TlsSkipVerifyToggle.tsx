/**
 * #1063 — shared skip-verify opt-in for the on/off TLS engines
 * (MongoDB / Redis / Valkey / Elasticsearch / OpenSearch). These engines only
 * exposed a plain "Enable TLS" checkbox before, which always meant full
 * certificate verification — leaving self-signed clusters no path but turning
 * TLS off entirely. This renders the explicit, opt-in "trust server certificate"
 * checkbox (only while TLS is on) plus an in-form warning so choosing it is a
 * deliberate act.
 *
 * #1649 — the checkbox now selects between `sslMode` postures rather than
 * setting a separate boolean: checked is `require` (skip-verify), unchecked is
 * the verifying posture. It is controlled by the posture, so the handler cannot
 * read back what preceded the flip — the unchecked branch derives it from the
 * draft's CA anchor (`draftVerifyingSslMode`) instead. A stored `verify-ca`
 * therefore survives a check/uncheck round trip; hard-coding `verify-full` there
 * demoted it and orphaned its `caCertPath` on two clicks.
 */
import { useTranslation } from "react-i18next";
import type { ConnectionDraft } from "../../model";
import { draftSslMode, draftVerifyingSslMode, sslModeTlsOn } from "../../model";

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
  // once TLS is on. Toggling TLS off resets the posture to `prefer` (see the
  // parent forms) so a stale skip-verify choice never lingers.
  const mode = draftSslMode(draft);
  if (!sslModeTlsOn(mode)) return null;
  const trust = mode === "require";
  return (
    <div className="space-y-1 pl-6">
      <label className="flex items-center gap-2 text-xs text-secondary-foreground">
        <input
          id="conn-trust-server-certificate"
          type="checkbox"
          className="cursor-pointer"
          checked={trust}
          onChange={(e) =>
            onChange({
              sslMode: e.target.checked
                ? "require"
                : draftVerifyingSslMode(draft),
            })
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
