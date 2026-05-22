import type { ConnectionDraft, DatabaseType } from "@/types/connection";
import {
  DATABASE_TYPE_LABELS,
  ENVIRONMENT_META,
  ENVIRONMENT_OPTIONS,
  SUPPORTED_DATABASE_TYPES,
  isSupportedDatabaseType,
} from "@/types/connection";
import * as dataSourceProfiles from "@/types/dataSource";
import type { ConnectionKind } from "@/types/dataSource";
import { Button } from "@components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { assertNever } from "@/lib/paradigm";
import { Link, List } from "lucide-react";
import PgFormFields from "../forms/PgFormFields";
import MysqlFormFields from "../forms/MysqlFormFields";
import SqliteFormFields from "../forms/SqliteFormFields";
import MongoFormFields from "../forms/MongoFormFields";
import RedisFormFields from "../forms/RedisFormFields";

// Sprint-112: Radix `<SelectItem>` cannot have an empty value, so we use
// sentinel string `__none__` to represent the "None" environment option.
// The form's `environment` field still stores `null` (canonical empty).
const ENV_NONE_SENTINEL = "__none__";

export interface ConnectionDialogBodyProps {
  isEditing: boolean;
  inputMode: "form" | "url";
  setInputMode: React.Dispatch<React.SetStateAction<"form" | "url">>;
  // URL mode wiring
  urlValue: string;
  setUrlValue: React.Dispatch<React.SetStateAction<string>>;
  urlError: string | null;
  setUrlError: React.Dispatch<React.SetStateAction<string | null>>;
  onParseAndContinue: () => void;
  // Form mode wiring
  form: ConnectionDraft;
  setForm: React.Dispatch<React.SetStateAction<ConnectionDraft>>;
  handleDbTypeChange: (newDbType: DatabaseType) => void;
  handleHostPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  handleHostBlur: (e: React.FocusEvent<HTMLDivElement>) => void;
  detectedScheme: string | null;
  // Shared-auth bundle for DBMS-aware form sub-components
  passwordInput: string;
  setPasswordInput: React.Dispatch<React.SetStateAction<string>>;
  hadPassword: boolean;
  clearPassword: boolean;
  setClearPassword: React.Dispatch<React.SetStateAction<boolean>>;
  inputClass: string;
  labelClass: string;
}

/**
 * Sprint 213 — presentational body of `ConnectionDialog`. Hosts the Form/URL
 * toggle (new connections only), the URL input + Parse & Continue button,
 * and the form-mode field group (Name / Database Type / Environment / DBMS-
 * aware fields / detected affordance / Advanced Settings). Stateless — all
 * state lives in the entry / hooks; this component only renders.
 *
 * The `assertNever` exhaustive switch in `renderDbmsFields` lives here per
 * Sprint 213 contract (entry or body acceptable; body chosen so the entry
 * stays free of DBMS-specific imports).
 */
export default function ConnectionDialogBody({
  isEditing,
  inputMode,
  setInputMode,
  urlValue,
  setUrlValue,
  urlError,
  setUrlError,
  onParseAndContinue,
  form,
  setForm,
  handleDbTypeChange,
  handleHostPaste,
  handleHostBlur,
  detectedScheme,
  passwordInput,
  setPasswordInput,
  hadPassword,
  clearPassword,
  setClearPassword,
  inputClass,
  labelClass,
}: ConnectionDialogBodyProps) {
  /**
   * Sprint 138 — exhaustive switch on `dbType`. Adding a new
   * `DatabaseType` variant without updating this switch fails the
   * `assertNever` compile-time check.
   */
  const renderDbmsFields = () => {
    const sharedAuth = {
      passwordInput,
      setPasswordInput,
      isEditing,
      hadPassword,
      clearPassword,
      setClearPassword,
      inputClass,
      labelClass,
    };
    const onChange = (patch: Partial<ConnectionDraft>) =>
      setForm((f) => ({ ...f, ...patch }));

    const profile = dataSourceProfiles.getDataSourceProfile(form.dbType);

    switch (profile.connectionKind) {
      case "server":
        switch (form.dbType) {
          case "postgresql":
            return (
              <PgFormFields draft={form} onChange={onChange} {...sharedAuth} />
            );
          case "mysql":
          case "mariadb":
            return (
              <MysqlFormFields
                draft={form}
                onChange={onChange}
                {...sharedAuth}
              />
            );
          case "mssql":
          case "oracle":
            return (
              <PgFormFields draft={form} onChange={onChange} {...sharedAuth} />
            );
          case "mongodb":
            return (
              <MongoFormFields
                draft={form}
                onChange={onChange}
                {...sharedAuth}
              />
            );
          case "redis":
            return (
              <RedisFormFields
                draft={form}
                onChange={onChange}
                {...sharedAuth}
              />
            );
          case "sqlite":
            throw unsupportedConnectionKindForForm(
              form.dbType,
              profile.connectionKind,
            );
          default:
            return assertNever(form.dbType);
        }
      case "file":
        switch (form.dbType) {
          case "sqlite":
            return (
              <SqliteFormFields
                draft={form}
                onChange={onChange}
                inputClass={inputClass}
                labelClass={labelClass}
              />
            );
          case "postgresql":
          case "mysql":
          case "mariadb":
          case "mssql":
          case "oracle":
          case "mongodb":
          case "redis":
            throw unsupportedConnectionKindForForm(
              form.dbType,
              profile.connectionKind,
            );
          default:
            return assertNever(form.dbType);
        }
      case "url":
      case "cloud-api":
      case "cluster":
        throw unsupportedConnectionKindForForm(
          form.dbType,
          profile.connectionKind,
        );
      default:
        return assertNeverConnectionKind(profile.connectionKind);
    }
  };

  return (
    <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
      {/* Input mode toggle */}
      {!isEditing && (
        <div className="mb-3">
          <ToggleGroup
            type="single"
            value={inputMode}
            onValueChange={(v) => v && setInputMode(v as "form" | "url")}
            className="w-full"
          >
            <ToggleGroupItem value="form" className="flex-1">
              <List />
              Form
            </ToggleGroupItem>
            <ToggleGroupItem value="url" className="flex-1">
              <Link />
              URL
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      {/* URL input */}
      {inputMode === "url" && !isEditing && (
        <div className="space-y-3">
          <div>
            <label htmlFor="conn-url" className={labelClass}>
              Connection URL
            </label>
            <input
              id="conn-url"
              className={inputClass}
              value={urlValue}
              onChange={(e) => {
                setUrlValue(e.target.value);
                setUrlError(null);
              }}
              placeholder="postgresql://user:password@host:5432/database"
              autoFocus
            />
            <p className="mt-1 text-2xs text-muted-foreground">
              For SQLite, paste an absolute file path (e.g.{" "}
              <code>/data/app.sqlite</code>).
            </p>
          </div>
          {urlError && (
            <div
              role="alert"
              className="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {urlError}
            </div>
          )}
          <Button className="w-full" size="sm" onClick={onParseAndContinue}>
            Parse & Continue
          </Button>
        </div>
      )}

      {/* Form fields */}
      {inputMode === "form" && (
        // Sprint 178 (AC-178-01 / AC-178-03): paste-detect + blur-split
        // are wired via React's bubbled synthetic events on the form
        // wrapper. Both handlers short-circuit on any target other
        // than `#conn-host` (the input rendered by the DBMS-specific
        // form field). This avoids prop-drilling new handler props
        // through every form sub-component.
        <div
          className="space-y-3"
          onPaste={handleHostPaste}
          onBlur={handleHostBlur}
        >
          {/* Name */}
          <div>
            <label htmlFor="conn-name" className={labelClass}>
              Name
            </label>
            <input
              id="conn-name"
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="My Database"
              autoFocus
            />
          </div>

          {/* Database Type */}
          <div>
            <label htmlFor="conn-db-type" className={labelClass}>
              Database Type
            </label>
            <Select
              value={form.dbType}
              onValueChange={(v) => handleDbTypeChange(v as DatabaseType)}
            >
              <SelectTrigger
                id="conn-db-type"
                className={inputClass}
                aria-label="Database Type"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* 새 connection 생성 시엔 백엔드 어댑터가 wire-up 된 DBMS
                    만 노출. 편집 모드에서 기존 connection 의 dbType 이
                    unsupported 라면 그 항목도 예외적으로 추가해 Select 가
                    빈값으로 보이지 않게 한다. */}
                {SUPPORTED_DATABASE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {DATABASE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
                {isEditing && !isSupportedDatabaseType(form.dbType) && (
                  <SelectItem value={form.dbType}>
                    {DATABASE_TYPE_LABELS[form.dbType]}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Environment */}
          <div>
            <label htmlFor="conn-environment" className={labelClass}>
              Environment
            </label>
            <Select
              value={form.environment ?? ENV_NONE_SENTINEL}
              onValueChange={(v) =>
                setForm((f) => ({
                  ...f,
                  environment: v === ENV_NONE_SENTINEL ? null : v,
                }))
              }
            >
              <SelectTrigger
                id="conn-environment"
                className={inputClass}
                aria-label="Environment"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ENV_NONE_SENTINEL}>None</SelectItem>
                {ENVIRONMENT_OPTIONS.map((env) => (
                  <SelectItem key={env} value={env}>
                    {ENVIRONMENT_META[env].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* DBMS-aware fields (Sprint 138) */}
          {renderDbmsFields()}

          {/* Sprint 178 (AC-178-01) — non-modal "detected" affordance.
              This is a calm, advisory inline note shown after a
              successful URL paste into the host field. It deliberately
              does NOT carry `role="alert"` or `role="status"` so it
              cannot be confused with an error region (AC-178-04
              silence on malformed pastes) and the AC-178-05 password
              leak guard does not need to walk this region (it never
              contains password text either way). The copy is
              declarative ("Detected … URL — fields populated") and
              matches the muted-foreground tone of the URL-mode help
              text. */}
          {detectedScheme && (
            <p
              className="text-2xs text-muted-foreground"
              data-testid="connection-url-detected"
            >
              Detected {detectedScheme} URL — fields populated.
            </p>
          )}

          {/* Advanced Settings */}
          <div className="border-t border-border pt-3">
            <details>
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-secondary-foreground">
                Advanced Settings
              </summary>
              <div className="mt-2 space-y-3">
                <div>
                  <label htmlFor="conn-timeout" className={labelClass}>
                    Connection Timeout (seconds)
                  </label>
                  <input
                    id="conn-timeout"
                    className={inputClass}
                    type="number"
                    min={5}
                    max={600}
                    value={form.connectionTimeout ?? 300}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        connectionTimeout: parseInt(e.target.value, 10) || 300,
                      }))
                    }
                    placeholder="300"
                  />
                </div>
                <div>
                  <label htmlFor="conn-keepalive" className={labelClass}>
                    Keep-Alive Interval (seconds)
                  </label>
                  <input
                    id="conn-keepalive"
                    className={inputClass}
                    type="number"
                    min={5}
                    max={300}
                    value={form.keepAliveInterval ?? 30}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        keepAliveInterval: parseInt(e.target.value, 10) || 30,
                      }))
                    }
                    placeholder="30"
                  />
                </div>
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}

function unsupportedConnectionKindForForm(
  dbType: DatabaseType,
  connectionKind: ConnectionKind,
): Error {
  return new Error(
    `Unsupported connection kind "${connectionKind}" for ${dbType} connection form`,
  );
}

function assertNeverConnectionKind(connectionKind: never): never {
  throw new Error(
    `Unsupported connection kind ${JSON.stringify(connectionKind)} for connection form`,
  );
}
