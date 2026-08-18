import { Button } from "@components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import { AlertCircle, Link, List, LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";
import { assertNever } from "@/lib/paradigm";
import type { ConnectionKind } from "@/types/dataSource";
import {
  getConnectionSupportedDatabaseTypes,
  getDataSourceProfile,
  hasConnectionCapability,
  isConnectionSupportedDatabaseType,
} from "@/types/dataSource";
import type { ConnectionDraft, DatabaseType } from "../../model";
import {
  DATABASE_TYPE_LABELS,
  ENVIRONMENT_META,
  ENVIRONMENT_OPTIONS,
} from "../../model";
import {
  type ConnFieldKey,
  fieldValidationProps,
} from "../forms/fieldValidation";
import type { ConnFormSection } from "../forms/formSection";
import MongoFormFields from "../forms/MongoFormFields";
import MssqlFormFields from "../forms/MssqlFormFields";
import MysqlFormFields from "../forms/MysqlFormFields";
import OracleFormFields from "../forms/OracleFormFields";
import PgFormFields from "../forms/PgFormFields";
import RedisFormFields from "../forms/RedisFormFields";
import SearchFormFields from "../forms/SearchFormFields";
import SqliteFormFields from "../forms/SqliteFormFields";

// Sprint-112: Radix `<SelectItem>` cannot have an empty value, so we use
// sentinel string `__none__` to represent the "None" environment option.
// The form's `environment` field still stores `null` (canonical empty).
const ENV_NONE_SENTINEL = "__none__";
const CONNECTION_DIALOG_DATABASE_TYPES = getConnectionSupportedDatabaseTypes();

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
  /** #1063 — dropped TLS URL parameter (`key=value`) to surface, or `null`. */
  tlsNotice: string | null;
  // Shared-auth bundle for DBMS-aware form sub-components
  passwordInput: string;
  setPasswordInput: React.Dispatch<React.SetStateAction<string>>;
  hadPassword: boolean;
  clearPassword: boolean;
  setClearPassword: React.Dispatch<React.SetStateAction<boolean>>;
  // #1065 — Oracle wallet password (consumed only by OracleFormFields).
  walletPasswordInput: string;
  setWalletPasswordInput: React.Dispatch<React.SetStateAction<string>>;
  hadWalletPassword: boolean;
  clearWalletPassword: boolean;
  setClearWalletPassword: React.Dispatch<React.SetStateAction<boolean>>;
  inputClass: string;
  labelClass: string;
  /** Issue #1135 — field flagged by the last failed save, or `null`. */
  invalidField: ConnFieldKey | null;
  /** #2436 — segment on screen. Owned by the entry so validation can move it. */
  segment: ConnFormSection;
  setSegment: React.Dispatch<React.SetStateAction<ConnFormSection>>;
}

/**
 * #2436 — the segment a flagged field is reachable from, or `null` when the
 * field is rendered outside the segment control entirely.
 *
 * The exhaustive switch is the guard: adding a `ConnFieldKey` without deciding
 * where it renders fails the `assertNever` compile-time check rather than
 * silently badging nothing. Every key returning `null` or `"basic"` is what
 * lets `ConnectionDialog` recover a failed save with one `setSegment("basic")`.
 */
function segmentForField(field: ConnFieldKey): ConnFormSection | null {
  switch (field) {
    case "name":
      // Rendered above the segment control, so it is never behind a tab.
      return null;
    case "host":
    case "database":
      return "basic";
    default:
      return assertNever(field);
  }
}

/**
 * Sprint 213 — presentational body of `ConnectionDialog`. Hosts the Form/URL
 * toggle (new connections only), the URL input + Parse & Continue button, and
 * the form-mode fields. Stateless — all state lives in the entry / hooks; this
 * component only renders.
 *
 * #2436 — form mode is now an always-visible identity block (Name / Database
 * Type / Environment) above a Basic / Advanced / SSH-SSL segment control. Which
 * control belongs to which segment is a rule, not a list, and `forms/formSection.ts`
 * owns it; each DBMS form component is handed the segment being rendered and
 * emits only its share.
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
  tlsNotice,
  passwordInput,
  setPasswordInput,
  hadPassword,
  clearPassword,
  setClearPassword,
  walletPasswordInput,
  setWalletPasswordInput,
  hadWalletPassword,
  clearWalletPassword,
  setClearWalletPassword,
  inputClass,
  labelClass,
  invalidField,
  segment,
  setSegment,
}: ConnectionDialogBodyProps) {
  const { t } = useTranslation("featuresConnection");
  /**
   * Sprint 138 — exhaustive switch on `dbType`. Adding a new
   * `DatabaseType` variant without updating this switch fails the
   * `assertNever` compile-time check.
   *
   * #2436 — called once per segment; each form component renders only the
   * controls that belong to the segment it is handed.
   */
  const renderDbmsFields = (section: ConnFormSection) => {
    const sharedAuth = {
      section,
      passwordInput,
      setPasswordInput,
      isEditing,
      hadPassword,
      clearPassword,
      setClearPassword,
      inputClass,
      labelClass,
      invalidField,
    };
    const onChange = (patch: Partial<ConnectionDraft>) =>
      setForm((f) => ({ ...f, ...patch }));

    const profile = getDataSourceProfile(form.dbType);

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
            return (
              <MssqlFormFields
                draft={form}
                onChange={onChange}
                {...sharedAuth}
              />
            );
          case "oracle":
            return (
              <OracleFormFields
                draft={form}
                onChange={onChange}
                {...sharedAuth}
                walletPasswordInput={walletPasswordInput}
                setWalletPasswordInput={setWalletPasswordInput}
                hadWalletPassword={hadWalletPassword}
                clearWalletPassword={clearWalletPassword}
                setClearWalletPassword={setClearWalletPassword}
              />
            );
          case "elasticsearch":
          case "opensearch":
            return (
              <SearchFormFields
                draft={form}
                onChange={onChange}
                {...sharedAuth}
              />
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
          case "valkey":
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
          case "duckdb":
            throw unsupportedConnectionKindForForm(
              form.dbType,
              profile.connectionKind,
            );
          default:
            return assertNever(form.dbType);
        }
      case "file":
        // #2436 — `SqliteFormFields` emits its whole form, read-only toggle
        // included, in the basic segment.
        if (section !== "basic") return null;
        switch (form.dbType) {
          case "sqlite":
            return (
              <SqliteFormFields
                draft={form}
                onChange={onChange}
                filePickerEnabled={hasConnectionCapability(
                  form.dbType,
                  "filePicker",
                )}
                readOnlyEnabled={hasConnectionCapability(
                  form.dbType,
                  "readOnly",
                )}
                inputClass={inputClass}
                labelClass={labelClass}
                invalidField={invalidField}
              />
            );
          case "duckdb":
            return (
              <SqliteFormFields
                draft={form}
                onChange={onChange}
                filePickerEnabled={hasConnectionCapability(
                  form.dbType,
                  "filePicker",
                )}
                readOnlyEnabled={hasConnectionCapability(
                  form.dbType,
                  "readOnly",
                )}
                inputClass={inputClass}
                labelClass={labelClass}
                invalidField={invalidField}
                databaseLabel="DuckDB"
                defaultPath="database.duckdb"
                fileExtensions={["duckdb"]}
                createEnabled={false}
              />
            );
          case "postgresql":
          case "mysql":
          case "mariadb":
          case "mssql":
          case "oracle":
          case "mongodb":
          case "redis":
          case "valkey":
          case "elasticsearch":
          case "opensearch":
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

  // #2436 — a file connection dials nothing, so it has no transport to secure.
  // Offering an empty SSH/SSL tab would be a dead affordance.
  const hasSecuritySegment =
    getDataSourceProfile(form.dbType).connectionKind !== "file";
  // Switching to SQLite while standing on SSH/SSL would otherwise select a tab
  // that no longer exists and render an empty panel. The stored segment is left
  // alone so switching back to a server DBMS returns the user where they were.
  const activeSegment =
    segment === "security" && !hasSecuritySegment ? "basic" : segment;
  const flaggedSegment = invalidField ? segmentForField(invalidField) : null;

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
              {t("body.modeForm")}
            </ToggleGroupItem>
            <ToggleGroupItem value="url" className="flex-1">
              <Link />
              {t("body.modeUrl")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      {/* URL input */}
      {inputMode === "url" && !isEditing && (
        <div className="space-y-3">
          <div>
            <label htmlFor="conn-url" className={labelClass}>
              {t("body.urlLabel")}
            </label>
            <input
              id="conn-url"
              className={inputClass}
              value={urlValue}
              onChange={(e) => {
                setUrlValue(e.target.value);
                setUrlError(null);
              }}
              placeholder={t("body.urlPlaceholder")}
              autoFocus
            />
            <p className="mt-1 text-2xs text-muted-foreground">
              {t("body.urlHint")}
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
          <Button
            type="button"
            className="w-full"
            size="sm"
            onClick={onParseAndContinue}
          >
            {t("body.parseAndContinue")}
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
              {t("body.labelName")}
            </label>
            <input
              id="conn-name"
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t("body.placeholderName")}
              autoFocus
              {...fieldValidationProps("name", true, invalidField)}
            />
          </div>

          {/* Database Type */}
          <div>
            <label htmlFor="conn-db-type" className={labelClass}>
              {t("body.labelDatabaseType")}
            </label>
            <Select
              value={form.dbType}
              onValueChange={(v) => handleDbTypeChange(v as DatabaseType)}
            >
              <SelectTrigger
                id="conn-db-type"
                className={inputClass}
                aria-label={t("body.ariaDatabaseType")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* 새 connection 생성 시엔 백엔드 어댑터가 wire-up 된 DBMS
                    만 노출. 편집 모드에서 기존 connection 의 dbType 이
                    unsupported 라면 그 항목도 예외적으로 추가해 Select 가
                    빈값으로 보이지 않게 한다. */}
                {CONNECTION_DIALOG_DATABASE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {DATABASE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
                {isEditing &&
                  !isConnectionSupportedDatabaseType(form.dbType) && (
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
              {t("body.labelEnvironment")}
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
                aria-label={t("body.ariaEnvironment")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ENV_NONE_SENTINEL}>
                  {t("body.envNone")}
                </SelectItem>
                {ENVIRONMENT_OPTIONS.map((env) => (
                  <SelectItem key={env} value={env}>
                    {ENVIRONMENT_META[env].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* #2436 — segments. Name / Database Type / Environment stay above
              this control: the type reshapes every segment so it cannot live
              inside one, and keeping Name always on screen means its `autoFocus`
              does not re-fire whenever a segment is switched back in. */}
          <Tabs
            value={activeSegment}
            onValueChange={(v) => setSegment(v as ConnFormSection)}
          >
            {/* The `data-testid`s are the e2e handle on a segment. Radix emits
                no attribute carrying a trigger's `value`, and overriding `id`
                would strand the panel's `aria-labelledby`; matching the visible
                label instead would tie `e2e/smoke/_helpers.ts` to the UI
                language. `e2e-scenarios` P7 is the standing allowance. */}
            <TabsList className="gap-1 border-b border-border">
              <TabsTrigger value="basic" data-testid="conn-segment-basic">
                {t("body.segmentBasic")}
                {flaggedSegment === "basic" && <SegmentErrorMark />}
              </TabsTrigger>
              <TabsTrigger value="advanced" data-testid="conn-segment-advanced">
                {t("body.segmentAdvanced")}
                {flaggedSegment === "advanced" && <SegmentErrorMark />}
              </TabsTrigger>
              {hasSecuritySegment && (
                <TabsTrigger
                  value="security"
                  data-testid="conn-segment-security"
                >
                  {t("body.segmentSecurity")}
                  {flaggedSegment === "security" && <SegmentErrorMark />}
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="basic" className="space-y-3 pt-3">
              {/* DBMS-aware fields (Sprint 138) */}
              {renderDbmsFields("basic")}

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
                  text. It sits with the host field the paste landed in. */}
              {detectedScheme && (
                <p
                  className="text-2xs text-muted-foreground"
                  data-testid="connection-url-detected"
                >
                  {t("body.detectedScheme", { scheme: detectedScheme })}
                </p>
              )}

              {/* #1063 — a TLS parameter in the pasted URL could not be mapped
                  (e.g. `sslmode=verify-ca`). Advisory, role="alert" so it is
                  announced but non-blocking; the user sets the posture manually
                  in the SSH/SSL segment. */}
              {tlsNotice && (
                <p
                  role="alert"
                  className="text-2xs text-destructive"
                  data-testid="connection-url-tls-notice"
                >
                  {t("body.tlsParamNotice", { param: tlsNotice })}
                </p>
              )}
            </TabsContent>

            <TabsContent value="advanced" className="space-y-3 pt-3">
              {renderDbmsFields("advanced")}

              {/* Issue #1529 — read-only toggle for server RDB connections. File
                  forms (sqlite/duckdb) render their own driver-level toggle
                  inside SqliteFormFields, so this is gated to server connections
                  that declare the `connection.readOnly` capability. The backend
                  `enforce_read_only` chokepoint is what actually blocks writes. */}
              {getDataSourceProfile(form.dbType).connectionKind === "server" &&
                hasConnectionCapability(form.dbType, "readOnly") && (
                  <div>
                    <label className="flex items-center gap-2 text-xs text-secondary-foreground">
                      <input
                        type="checkbox"
                        checked={form.readOnly === true}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, readOnly: e.target.checked }))
                        }
                        className="h-3.5 w-3.5 rounded border-border"
                      />
                      <LockKeyhole
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      {t("body.readOnlyConnection")}
                    </label>
                    <p className="mt-1 text-2xs text-muted-foreground">
                      {t("body.readOnlyConnectionHint")}
                    </p>
                  </div>
                )}

              <div>
                <label htmlFor="conn-timeout" className={labelClass}>
                  {t("body.labelConnectionTimeout")}
                </label>
                {/* #2429 — 10 mirrors `CONNECT_TIMEOUT_DEFAULT_SECS` in
                    src-tauri/table-view-core/src/models/connection.rs, which
                    is what an unset field actually gets. The old 300 named a
                    per-adapter fallback that every adapter then clamped
                    away. */}
                <input
                  id="conn-timeout"
                  className={inputClass}
                  type="number"
                  min={5}
                  max={600}
                  value={form.connectionTimeout ?? 10}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      connectionTimeout: parseInt(e.target.value, 10) || 10,
                    }))
                  }
                  placeholder="10"
                />
              </div>
              <div>
                <label htmlFor="conn-keepalive" className={labelClass}>
                  {t("body.labelKeepAliveInterval")}
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
            </TabsContent>

            {hasSecuritySegment && (
              <TabsContent value="security" className="space-y-3 pt-3">
                {renderDbmsFields("security")}
              </TabsContent>
            )}
          </Tabs>
        </div>
      )}
    </div>
  );
}

/**
 * #2436 — marks the segment trigger whose panel holds the field the last failed
 * save flagged. Without it a user standing on another segment sees the save
 * blocked with no clue where the offending input is.
 *
 * The icon is decorative; the `sr-only` phrase is what puts the state into the
 * tab's accessible name, so the marker survives a monochrome read and a screen
 * reader alike (WCAG 1.4.1 — colour is not the only channel).
 */
function SegmentErrorMark() {
  const { t } = useTranslation("featuresConnection");
  return (
    <>
      <AlertCircle
        className="ml-1 size-3 text-destructive"
        aria-hidden="true"
      />
      <span className="sr-only">{t("body.segmentError")}</span>
    </>
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
