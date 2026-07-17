import { useTranslation } from "react-i18next";
import type { ConnectionDraft } from "../../model";
import { fieldValidationProps, type ConnFieldKey } from "./fieldValidation";
import TlsSkipVerifyToggle from "./TlsSkipVerifyToggle";

export interface SearchFormFieldsProps {
  draft: ConnectionDraft;
  onChange: (patch: Partial<ConnectionDraft>) => void;
  passwordInput: string;
  setPasswordInput: (value: string) => void;
  isEditing: boolean;
  hadPassword: boolean;
  clearPassword: boolean;
  setClearPassword: (value: boolean) => void;
  inputClass: string;
  labelClass: string;
  invalidField?: ConnFieldKey | null;
}

export default function SearchFormFields({
  draft,
  onChange,
  passwordInput,
  setPasswordInput,
  isEditing,
  hadPassword,
  clearPassword,
  setClearPassword,
  inputClass,
  labelClass,
  invalidField,
}: SearchFormFieldsProps) {
  const { t } = useTranslation("featuresConnection");
  return (
    <>
      <div className="flex gap-3">
        <div className="flex-1">
          <label htmlFor="conn-host" className={labelClass}>
            {t("form.labelHost")}
          </label>
          <input
            id="conn-host"
            className={inputClass}
            value={draft.host}
            onChange={(e) => onChange({ host: e.target.value })}
            placeholder="localhost"
            {...fieldValidationProps("host", true, invalidField)}
          />
        </div>
        <div className="w-24">
          <label htmlFor="conn-port" className={labelClass}>
            {t("form.labelPort")}
          </label>
          <input
            id="conn-port"
            className={inputClass}
            type="number"
            value={draft.port}
            onChange={(e) =>
              onChange({ port: parseInt(e.target.value, 10) || 0 })
            }
          />
        </div>
      </div>

      <div>
        <label htmlFor="conn-user" className={labelClass}>
          {t("form.labelUsernameOptional")}
        </label>
        <input
          id="conn-user"
          className={inputClass}
          value={draft.user}
          onChange={(e) => onChange({ user: e.target.value })}
          placeholder="elastic"
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="conn-password" className={labelClass}>
            {t("form.labelPasswordOptional")}
          </label>
          {isEditing && (
            <span
              className={`mb-1 rounded px-1.5 py-0.5 text-3xs font-medium ${
                hadPassword
                  ? "bg-success/10 text-success"
                  : "bg-muted text-muted-foreground"
              }`}
              data-testid="password-status-badge"
            >
              {hadPassword ? t("form.passwordSet") : t("form.noPassword")}
            </span>
          )}
        </div>
        <input
          id="conn-password"
          className={inputClass}
          type="password"
          value={passwordInput}
          disabled={isEditing && clearPassword}
          onChange={(e) => setPasswordInput(e.target.value)}
          placeholder={
            isEditing && hadPassword
              ? t("form.placeholderKeepPassword")
              : "••••••••"
          }
        />
        {isEditing && hadPassword && (
          <label className="mt-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
            <input
              type="checkbox"
              className="cursor-pointer"
              checked={clearPassword}
              onChange={(e) => {
                setClearPassword(e.target.checked);
                if (e.target.checked) setPasswordInput("");
              }}
            />
            {t("form.clearPassword")}
          </label>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-secondary-foreground">
        <input
          id="conn-tls-enabled"
          type="checkbox"
          className="cursor-pointer"
          checked={!!draft.tlsEnabled}
          onChange={(e) => {
            const tlsEnabled = e.target.checked;
            onChange({
              tlsEnabled,
              // #1063 — clear a stale skip-verify choice when TLS is turned off.
              ...(tlsEnabled ? {} : { trustServerCertificate: null }),
            });
          }}
        />
        {t("form.enableTlsSearch")}
      </label>
      <TlsSkipVerifyToggle draft={draft} onChange={onChange} />
    </>
  );
}
