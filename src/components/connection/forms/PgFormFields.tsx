/**
 * Sprint 138 (#4 — DBMS-aware connection form): PostgreSQL-specific form
 * fields. The previous monolithic `ConnectionDialog` rendered host / port /
 * user / password / database / Mongo block all in one column regardless of
 * `db_type`, which (a) leaked the `user="postgres"` default into every other
 * DBMS and (b) showed irrelevant host/port for SQLite. This file owns the
 * PG-only field shape.
 *
 * Note: shared concerns (Name, Group, Color, Environment, Advanced timeout
 * settings, password handling) stay in `ConnectionDialog` — those are
 * paradigm-agnostic. This component only owns the network/auth/database
 * row that varies by DBMS.
 */
import type { ConnectionDraft } from "@/types/connection";

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
}: PgFormFieldsProps) {
  return (
    <>
      {/* Host & Port */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label htmlFor="conn-host" className={labelClass}>
            Host
          </label>
          <input
            id="conn-host"
            className={inputClass}
            value={draft.host}
            onChange={(e) => onChange({ host: e.target.value })}
            placeholder="localhost"
          />
        </div>
        <div className="w-24">
          <label htmlFor="conn-port" className={labelClass}>
            Port
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
          User
        </label>
        <input
          id="conn-user"
          className={inputClass}
          value={draft.user}
          onChange={(e) => onChange({ user: e.target.value })}
          placeholder="postgres"
        />
      </div>

      {/* Password */}
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="conn-password" className={labelClass}>
            Password
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
              {hadPassword ? "Password set" : "No password"}
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
              ? "Leave blank to keep current password"
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
            Clear stored password on save
          </label>
        )}
      </div>

      {/* Database */}
      <div>
        <label htmlFor="conn-database" className={labelClass}>
          Database
        </label>
        <input
          id="conn-database"
          className={inputClass}
          value={draft.database}
          onChange={(e) => onChange({ database: e.target.value })}
          placeholder="postgres"
        />
      </div>
    </>
  );
}
