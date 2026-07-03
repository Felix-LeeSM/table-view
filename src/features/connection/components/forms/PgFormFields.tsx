/**
 * Sprint 138 (#4 — DBMS-aware connection form): PostgreSQL-specific form
 * fields. The previous monolithic `ConnectionDialog` rendered host / port /
 * user / password / database / Mongo block all in one column regardless of
 * `dbType`, which (a) leaked the `user="postgres"` default into every other
 * DBMS and (b) showed irrelevant host/port for SQLite. This file owns the
 * PG-only field shape.
 *
 * Note: shared concerns (Name, Group, Color, Environment, Advanced timeout
 * settings, password handling) stay in `ConnectionDialog` — those are
 * paradigm-agnostic. This component only owns the network/auth/database
 * row that varies by DBMS.
 */
import { useTranslation } from "react-i18next";
import type { ConnectionDraft } from "../../model";
import { fieldValidationProps, type ConnFieldKey } from "./fieldValidation";

export interface PgFormFieldsProps {
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
  userPlaceholder?: string;
  databasePlaceholder?: string;
}

export default function PgFormFields({
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
  userPlaceholder = "postgres",
  databasePlaceholder = "postgres",
}: PgFormFieldsProps) {
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
          placeholder={userPlaceholder}
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
          placeholder={databasePlaceholder}
          {...fieldValidationProps("database", true, invalidField)}
        />
      </div>
    </>
  );
}
