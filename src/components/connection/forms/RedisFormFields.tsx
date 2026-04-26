/**
 * Sprint 138 (#4 — DBMS-aware connection form): Redis-specific form fields.
 * Differences from PG/MySQL:
 *
 *   - `user` is the optional ACL username (Redis 6+); empty means default
 *     `default` user
 *   - `password` is optional (AUTH command)
 *   - `database` is the numeric DB index (`0..15` by default Redis
 *     configuration). Stored as string in `ConnectionDraft.database` for
 *     parity with the existing schema; the input type is `number` and we
 *     clamp to the 0–15 range.
 *   - `tls_enabled` is shared with Mongo's TLS toggle for code reuse —
 *     this sprint only ships the form-side field; backend support is
 *     deferred to Phase 8 (see master spec non-goals).
 */
import type { ConnectionDraft } from "@/types/connection";

export interface RedisFormFieldsProps {
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

const REDIS_DB_MIN = 0;
const REDIS_DB_MAX = 15;

function clampDbIndex(raw: string): string {
  if (raw.trim().length === 0) return "0";
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return "0";
  if (parsed < REDIS_DB_MIN) return String(REDIS_DB_MIN);
  if (parsed > REDIS_DB_MAX) return String(REDIS_DB_MAX);
  return String(parsed);
}

export default function RedisFormFields({
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
}: RedisFormFieldsProps) {
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

      {/* Username (optional ACL) */}
      <div>
        <label htmlFor="conn-user" className={labelClass}>
          Username (optional)
        </label>
        <input
          id="conn-user"
          className={inputClass}
          value={draft.user}
          onChange={(e) => onChange({ user: e.target.value })}
          placeholder="leave blank for default ACL"
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

      {/* Database index (0..15) */}
      <div>
        <label htmlFor="conn-database" className={labelClass}>
          Database Index
        </label>
        <input
          id="conn-database"
          className={inputClass}
          type="number"
          min={REDIS_DB_MIN}
          max={REDIS_DB_MAX}
          value={draft.database}
          onChange={(e) => onChange({ database: clampDbIndex(e.target.value) })}
          aria-label="Redis database index (0-15)"
        />
        <p className="mt-1 text-2xs text-muted-foreground">
          Redis numeric DB index. Default is 0; valid range 0–15.
        </p>
      </div>

      {/* TLS toggle */}
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
    </>
  );
}
