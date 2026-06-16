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
}: MssqlFormFieldsProps) {
  const unsupportedMessage = getMssqlConnectionUnsupportedMessage(draft);

  return (
    <>
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
            aria-describedby={
              unsupportedMessage ? "mssql-auth-error" : undefined
            }
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

      <div>
        <label htmlFor="conn-auth-method" className={labelClass}>
          Authentication method
        </label>
        <Select value="sql" disabled>
          <SelectTrigger
            id="conn-auth-method"
            className={inputClass}
            aria-label="Authentication method"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sql">SQL authentication</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1 text-2xs text-muted-foreground">
          Windows authentication and Azure AD are unsupported in this connection
          slice.
        </p>
      </div>

      <div>
        <label htmlFor="conn-user" className={labelClass}>
          User
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
            Clear stored password on save
          </label>
        )}
      </div>

      <div>
        <label htmlFor="conn-database" className={labelClass}>
          Database
        </label>
        <input
          id="conn-database"
          className={inputClass}
          value={draft.database}
          onChange={(e) => onChange({ database: e.target.value })}
          placeholder="master"
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
          Enable encryption (TLS)
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
          Trust server certificate
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
