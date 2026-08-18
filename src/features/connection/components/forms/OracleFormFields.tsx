import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { useTranslation } from "react-i18next";
import { type ConnectionDraft, usesTnsDescriptor } from "../../model";
import { type ConnFieldKey, fieldValidationProps } from "./fieldValidation";
import type { ConnFormSection } from "./formSection";
import SslModeField from "./SslModeField";

export interface OracleFormFieldsProps {
  draft: ConnectionDraft;
  onChange: (patch: Partial<ConnectionDraft>) => void;
  /** #2436 — segment currently on screen; see `formSection.ts` for the rule. */
  section: ConnFormSection;
  passwordInput: string;
  setPasswordInput: (value: string) => void;
  isEditing: boolean;
  hadPassword: boolean;
  clearPassword: boolean;
  setClearPassword: (value: boolean) => void;
  // #1065 — Oracle wallet password (same 3-state UI as the DB password).
  walletPasswordInput: string;
  setWalletPasswordInput: (value: string) => void;
  hadWalletPassword: boolean;
  clearWalletPassword: boolean;
  setClearWalletPassword: (value: boolean) => void;
  inputClass: string;
  labelClass: string;
  invalidField?: ConnFieldKey | null;
}

export default function OracleFormFields({
  draft,
  onChange,
  section,
  passwordInput,
  setPasswordInput,
  isEditing,
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
}: OracleFormFieldsProps) {
  const { t } = useTranslation("featuresConnection");
  const useSid = draft.oracleUseSid === true;
  // #2154 — a TNS descriptor in the identifier field carries host, port,
  // service and connect method, and the backend dials those. Disabling the
  // inputs it overrides is what keeps the form from showing a host we never
  // dial; `usesTnsDescriptor` is the same rule the dialog's host-required
  // check reads, so the two cannot drift apart.
  const descriptorDial = usesTnsDescriptor(draft);
  if (section === "security") {
    return (
      <>
        {/* #2154 — wallet-less 1-way TLS (TCPS). The wallet below is the mTLS
            path and the two are mutually exclusive; the backend rejects a
            connection that names both. The narrowed posture list (no `require`)
            comes from `sslModeOptionsFor`, which the URL-paste path reads too. */}
        <SslModeField
          draft={draft}
          onChange={onChange}
          inputClass={inputClass}
          labelClass={labelClass}
        />

        {/* #1065 — Oracle wallet (mTLS) for Oracle Cloud ADB. */}
        <div>
          <label htmlFor="conn-wallet-dir" className={labelClass}>
            {t("form.labelWalletDir")}
          </label>
          <input
            id="conn-wallet-dir"
            className={inputClass}
            value={draft.walletPath ?? ""}
            onChange={(e) => onChange({ walletPath: e.target.value })}
            placeholder="/path/to/wallet"
          />
          <p className="mt-1 text-2xs text-muted-foreground">
            {t("form.walletDirHint")}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="conn-wallet-password" className={labelClass}>
              {t("form.labelWalletPassword")}
            </label>
            {isEditing && (
              <span
                className={`mb-1 rounded px-1.5 py-0.5 text-3xs font-medium ${
                  hadWalletPassword
                    ? "bg-success/10 text-success"
                    : "bg-muted text-muted-foreground"
                }`}
                data-testid="wallet-password-status-badge"
              >
                {hadWalletPassword
                  ? t("form.walletPasswordSet")
                  : t("form.noWalletPassword")}
              </span>
            )}
          </div>
          <input
            id="conn-wallet-password"
            className={inputClass}
            type="password"
            value={walletPasswordInput}
            disabled={isEditing && clearWalletPassword}
            onChange={(e) => setWalletPasswordInput(e.target.value)}
            placeholder={
              isEditing && hadWalletPassword
                ? t("form.placeholderKeepWalletPassword")
                : "••••••••"
            }
          />
          {isEditing && hadWalletPassword && (
            <label className="mt-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
              <input
                type="checkbox"
                className="cursor-pointer"
                checked={clearWalletPassword}
                onChange={(e) => {
                  setClearWalletPassword(e.target.checked);
                  if (e.target.checked) setWalletPasswordInput("");
                }}
              />
              {t("form.clearWalletPassword")}
            </label>
          )}
        </div>
      </>
    );
  }
  // The connect-method select decides whether the identifier below is a service
  // name, a SID or a descriptor, so it belongs with it in `basic`.
  if (section !== "basic") return null;
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
            disabled={descriptorDial}
            onChange={(e) => onChange({ host: e.target.value })}
            placeholder="localhost"
            {...fieldValidationProps("host", !descriptorDial, invalidField)}
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
            disabled={descriptorDial}
            onChange={(e) =>
              onChange({ port: parseInt(e.target.value, 10) || 0 })
            }
          />
        </div>
      </div>
      {descriptorDial && (
        <p className="text-2xs text-muted-foreground">
          {t("form.oracleDescriptorOverridesHint")}
        </p>
      )}

      <div>
        <label htmlFor="conn-user" className={labelClass}>
          {t("form.labelUser")}
        </label>
        <input
          id="conn-user"
          className={inputClass}
          value={draft.user}
          onChange={(e) => onChange({ user: e.target.value })}
          placeholder="system"
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

      {/* #1065 — connection method: service name (default) or SID. Both route
          to the same `database` field; the flag selects the driver method.
          #2154 — a descriptor's CONNECT_DATA names the method itself, so the
          toggle stops applying while one is pasted. */}
      <div>
        <label htmlFor="conn-oracle-method" className={labelClass}>
          {t("form.oracleConnectMethod")}
        </label>
        <Select
          value={useSid ? "sid" : "service"}
          disabled={descriptorDial}
          onValueChange={(v) => onChange({ oracleUseSid: v === "sid" })}
        >
          <SelectTrigger
            id="conn-oracle-method"
            className={inputClass}
            aria-label={t("form.oracleConnectMethod")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="service">
              {t("form.oracleMethodService")}
            </SelectItem>
            <SelectItem value="sid">{t("form.oracleMethodSid")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <label htmlFor="conn-database" className={labelClass}>
          {descriptorDial
            ? t("form.labelOracleDescriptor")
            : useSid
              ? t("form.labelSid")
              : t("form.labelServiceName")}
        </label>
        <input
          id="conn-database"
          className={inputClass}
          value={draft.database}
          onChange={(e) => onChange({ database: e.target.value })}
          placeholder={useSid ? "ORCL" : "FREEPDB1"}
          {...fieldValidationProps("database", true, invalidField)}
        />
        <p className="mt-1 text-2xs text-muted-foreground">
          {t("form.oracleServiceFieldHint")}
        </p>
      </div>
    </>
  );
}
