/**
 * Sprint 138 (#4 — DBMS-aware connection form): MongoDB-specific form
 * fields. Distinguishes from PG/MySQL by:
 *
 *   - `user` / `password` are optional (MongoDB allows unauthenticated
 *     connections in dev clusters)
 *   - `database` is the default DB to land on after connect — labelled
 *     "(optional)" because the user can pick a DB later via DbSwitcher
 *   - `auth_source`, `replica_set`, `tls_enabled` are Mongo-specific and
 *     persisted in the existing `ConnectionConfig` extension fields
 *     (see Sprint 65).
 */
import type { ConnectionDraft } from "@/types/connection";

export interface MongoFormFieldsProps {
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

export default function MongoFormFields({
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
}: MongoFormFieldsProps) {
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

      {/* User (optional) */}
      <div>
        <label htmlFor="conn-user" className={labelClass}>
          User (optional)
        </label>
        <input
          id="conn-user"
          className={inputClass}
          value={draft.user}
          onChange={(e) => onChange({ user: e.target.value })}
          placeholder="leave blank for unauthenticated"
        />
      </div>

      {/* Password (optional) */}
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="conn-password" className={labelClass}>
            Password (optional)
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

      {/* Default Database (optional for Mongo — DbSwitcher can swap later) */}
      <div>
        <label htmlFor="conn-database" className={labelClass}>
          Database (optional)
        </label>
        <input
          id="conn-database"
          className={inputClass}
          value={draft.database}
          onChange={(e) => onChange({ database: e.target.value })}
          placeholder="Leave blank to default"
        />
      </div>

      {/* MongoDB-specific extension block (Sprint 65 compatibility) */}
      <div className="space-y-3 rounded border border-border bg-background/40 p-3">
        <div className="text-xs font-semibold text-secondary-foreground">
          MongoDB Options
        </div>
        <div>
          <label htmlFor="conn-auth-source" className={labelClass}>
            Auth Source
          </label>
          <input
            id="conn-auth-source"
            className={inputClass}
            value={draft.auth_source ?? ""}
            onChange={(e) => onChange({ auth_source: e.target.value || null })}
            placeholder="admin"
          />
        </div>
        <div>
          <label htmlFor="conn-replica-set" className={labelClass}>
            Replica Set
          </label>
          <input
            id="conn-replica-set"
            className={inputClass}
            value={draft.replica_set ?? ""}
            onChange={(e) => onChange({ replica_set: e.target.value || null })}
            placeholder="rs0"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-secondary-foreground">
          <input
            id="conn-tls-enabled"
            type="checkbox"
            className="cursor-pointer"
            checked={!!draft.tls_enabled}
            onChange={(e) => onChange({ tls_enabled: e.target.checked })}
          />
          Enable TLS
        </label>
      </div>
    </>
  );
}
