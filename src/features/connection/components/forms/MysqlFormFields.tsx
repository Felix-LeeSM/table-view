/**
 * Sprint 138 (#4 — DBMS-aware connection form): MySQL-specific form fields.
 * Shape parity with PG (host/port/user/password/database) but defaults to
 * `root` user and port `3306`, and database starts empty (MySQL has no
 * convention of a `mysql` super-database the user actually wants to land
 * on). SSL toggle is reserved for a future extension; the contract for
 * Sprint 138 only requires the field shape, not active SSL semantics in
 * the connection_test command.
 */
import { useTranslation } from "react-i18next";
import type { ConnectionDraft } from "../../model";
import { fieldValidationProps, type ConnFieldKey } from "./fieldValidation";

export interface MysqlFormFieldsProps {
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

export default function MysqlFormFields({
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
}: MysqlFormFieldsProps) {
  const { t } = useTranslation("featuresConnection");
  return (
    <>
      {/* Host & Port */}
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

      {/* User */}
      <div>
        <label htmlFor="conn-user" className={labelClass}>
          {t("form.labelUser")}
        </label>
        <input
          id="conn-user"
          className={inputClass}
          value={draft.user}
          onChange={(e) => onChange({ user: e.target.value })}
          placeholder="root"
        />
      </div>

      {/* Password */}
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

      {/* Database */}
      <div>
        <label htmlFor="conn-database" className={labelClass}>
          {t("form.labelDatabase")}
        </label>
        <input
          id="conn-database"
          className={inputClass}
          value={draft.database}
          onChange={(e) => onChange({ database: e.target.value })}
          placeholder="myapp"
          {...fieldValidationProps("database", true, invalidField)}
        />
      </div>
    </>
  );
}
