import { useTranslation } from "react-i18next";
import {
  getMssqlConnectionUnsupportedMessage,
  type ConnectionDraft,
} from "../../model";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import {
  CONNECTION_ERROR_ID,
  fieldValidationProps,
  type ConnFieldKey,
} from "./fieldValidation";

export interface MssqlFormFieldsProps {
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

export default function MssqlFormFields({
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
}: MssqlFormFieldsProps) {
  const { t } = useTranslation("featuresConnection");
  const unsupportedMessage = getMssqlConnectionUnsupportedMessage(draft);
  // Host can be flagged by two independent regions (save-required banner +
  // the inline auth-combo alert); merge both into aria-describedby.
  const hostValidation = fieldValidationProps("host", true, invalidField);
  const hostDescribedBy =
    [
      invalidField === "host" ? CONNECTION_ERROR_ID : null,
      unsupportedMessage ? "mssql-auth-error" : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

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
            {...hostValidation}
            aria-invalid={
              hostValidation["aria-invalid"] || unsupportedMessage
                ? true
                : undefined
            }
            aria-describedby={hostDescribedBy}
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
        <label htmlFor="conn-auth-method" className={labelClass}>
          {t("form.labelAuthMethod")}
        </label>
        <Select value="sql" disabled>
          <SelectTrigger
            id="conn-auth-method"
            className={inputClass}
            aria-label={t("form.labelAuthMethod")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sql">{t("form.authSql")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1 text-2xs text-muted-foreground">
          {t("form.authUnsupported")}
        </p>
      </div>

      <div>
        <label htmlFor="conn-user" className={labelClass}>
          {t("form.labelUser")}
        </label>
        <input
          id="conn-user"
          className={inputClass}
          value={draft.user}
          onChange={(e) => onChange({ user: e.target.value })}
          placeholder="sa"
          aria-describedby={unsupportedMessage ? "mssql-auth-error" : undefined}
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="conn-password" className={labelClass}>
            {t("form.labelPassword")}
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
              : "password"
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

      <div>
        <label htmlFor="conn-database" className={labelClass}>
          {t("form.labelDatabase")}
        </label>
        <input
          id="conn-database"
          className={inputClass}
          value={draft.database}
          onChange={(e) => onChange({ database: e.target.value })}
          placeholder="master"
          {...fieldValidationProps("database", true, invalidField)}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 text-xs text-secondary-foreground sm:grid-cols-2">
        <label className="flex items-center gap-2">
          <input
            id="conn-tls-enabled"
            type="checkbox"
            className="cursor-pointer"
            checked={draft.tlsEnabled ?? true}
            onChange={(e) => {
              const tlsEnabled = e.target.checked;
              onChange({
                tlsEnabled,
                ...(tlsEnabled ? {} : { trustServerCertificate: false }),
              });
            }}
          />
          {t("form.enableTls")}
        </label>
        <label className="flex items-center gap-2">
          <input
            id="conn-trust-server-certificate"
            type="checkbox"
            className="cursor-pointer"
            checked={draft.trustServerCertificate === true}
            disabled={!(draft.tlsEnabled ?? true)}
            onChange={(e) =>
              onChange({ trustServerCertificate: e.target.checked })
            }
          />
          {t("form.trustServerCert")}
        </label>
      </div>

      {unsupportedMessage && (
        <div
          id="mssql-auth-error"
          role="alert"
          className="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {unsupportedMessage}
        </div>
      )}
    </>
  );
}
