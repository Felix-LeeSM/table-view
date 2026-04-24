import { useState } from "react";
import type {
  ConnectionConfig,
  ConnectionDraft,
  DatabaseType,
} from "@/types/connection";
import { Button } from "@components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import {
  createEmptyDraft,
  draftFromConnection,
  DATABASE_DEFAULTS,
  parseConnectionUrl,
  paradigmOf,
  ENVIRONMENT_META,
  ENVIRONMENT_OPTIONS,
} from "@/types/connection";
import { useConnectionStore } from "@stores/connectionStore";
import {
  X,
  Loader2,
  CheckCircle,
  AlertCircle,
  Plug,
  Link,
  List,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@components/ui/dialog";

interface ConnectionDialogProps {
  connection?: ConnectionConfig;
  onClose: () => void;
}

export default function ConnectionDialog({
  connection,
  onClose,
}: ConnectionDialogProps) {
  const isEditing = !!connection;
  const hadPassword = !!connection?.has_password;
  const [inputMode, setInputMode] = useState<"form" | "url">("form");
  const [urlValue, setUrlValue] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [form, setForm] = useState<ConnectionDraft>(
    connection ? draftFromConnection(connection) : createEmptyDraft(),
  );
  // The password input is a separate piece of UI state. When editing, it
  // starts empty and is only sent if the user actually types something OR
  // explicitly checks "Clear password".
  const [passwordInput, setPasswordInput] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addConnection = useConnectionStore((s) => s.addConnection);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const testConnection = useConnectionStore((s) => s.testConnection);

  const handleDbTypeChange = (dbType: DatabaseType) => {
    setForm((f) => ({
      ...f,
      db_type: dbType,
      port: DATABASE_DEFAULTS[dbType],
      paradigm: paradigmOf(dbType),
    }));
  };

  const isMongo = form.db_type === "mongodb";

  /** Resolve the password value to send to the backend. */
  const resolvePassword = (): string | null => {
    if (!isEditing) {
      // New connections: the input is the password (empty string is fine).
      return passwordInput;
    }
    if (clearPassword) return "";
    if (passwordInput.length > 0) return passwordInput;
    // Editing + empty input + not clearing → keep existing
    return null;
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const draft: ConnectionDraft = { ...form, password: resolvePassword() };
      const msg = await testConnection(draft, connection?.id ?? null);
      setTestResult({ success: true, message: msg });
    } catch (e) {
      setTestResult({ success: false, message: String(e) });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    if (!form.host.trim()) {
      setError("Host is required");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const draft: ConnectionDraft = { ...form, password: resolvePassword() };
      if (isEditing) {
        await updateConnection(draft);
      } else {
        await addConnection(draft);
        // After a new connection is saved, surface it to the user — Sidebar
        // listens for this and flips to Connections mode if needed.
        window.dispatchEvent(new Event("connection-added"));
      }
      onClose();
    } catch (e) {
      setError(String(e));
    }
    setSaving(false);
  };

  const inputClass =
    "w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary";
  const labelClass = "mb-1 block text-xs font-medium text-secondary-foreground";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="w-dialog-sm bg-secondary p-0"
        showCloseButton={false}
      >
        <div className="w-dialog-sm rounded-lg bg-secondary shadow-xl">
          {/* Header */}
          <DialogHeader className="flex items-center justify-between border-b border-border px-4 py-3">
            <DialogTitle
              id="dialog-title"
              className="text-sm font-semibold text-foreground"
            >
              {isEditing ? "Edit Connection" : "New Connection"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {isEditing
                ? "Edit the connection details"
                : "Create a new database connection"}
            </DialogDescription>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <X />
            </Button>
          </DialogHeader>

          {/* Form */}
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
                  className="w-full"
                  size="sm"
                  onClick={() => {
                    const parsed = parseConnectionUrl(urlValue);
                    if (!parsed) {
                      setUrlError(
                        "Invalid URL. Use format: postgresql://user:password@host:port/database",
                      );
                      return;
                    }
                    const { password, ...rest } = parsed;
                    setForm((f) => ({
                      ...f,
                      ...rest,
                      name: f.name || parsed.database || "",
                    }));
                    if (typeof password === "string") {
                      setPasswordInput(password);
                    }
                    setInputMode("form");
                  }}
                >
                  Parse & Continue
                </Button>
              </div>
            )}

            {/* Form fields */}
            {inputMode === "form" && (
              <div className="space-y-3">
                {/* Name */}
                <div>
                  <label htmlFor="conn-name" className={labelClass}>
                    Name
                  </label>
                  <input
                    id="conn-name"
                    className={inputClass}
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="My Database"
                    autoFocus
                  />
                </div>

                {/* Database Type */}
                <div>
                  <label htmlFor="conn-db-type" className={labelClass}>
                    Database Type
                  </label>
                  <select
                    id="conn-db-type"
                    className={inputClass}
                    value={form.db_type}
                    onChange={(e) =>
                      handleDbTypeChange(e.target.value as DatabaseType)
                    }
                  >
                    <option value="postgresql">PostgreSQL</option>
                    <option value="mysql">MySQL</option>
                    <option value="sqlite">SQLite</option>
                    <option value="mongodb">MongoDB</option>
                    <option value="redis">Redis</option>
                  </select>
                </div>

                {/* Environment */}
                <div>
                  <label htmlFor="conn-environment" className={labelClass}>
                    Environment
                  </label>
                  <select
                    id="conn-environment"
                    className={inputClass}
                    value={form.environment ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        environment: e.target.value || null,
                      }))
                    }
                  >
                    <option value="">None</option>
                    {ENVIRONMENT_OPTIONS.map((env) => (
                      <option key={env} value={env}>
                        {ENVIRONMENT_META[env].label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Host & Port */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label htmlFor="conn-host" className={labelClass}>
                      Host
                    </label>
                    <input
                      id="conn-host"
                      className={inputClass}
                      value={form.host}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, host: e.target.value }))
                      }
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
                      value={form.port}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          port: parseInt(e.target.value, 10) || 0,
                        }))
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
                    value={form.user}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, user: e.target.value }))
                    }
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
                    Database{isMongo ? " (optional)" : ""}
                  </label>
                  <input
                    id="conn-database"
                    className={inputClass}
                    value={form.database}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, database: e.target.value }))
                    }
                    placeholder={isMongo ? "Leave blank to default" : "mydb"}
                  />
                </div>

                {/* MongoDB-specific fields (Sprint 65). Only rendered when
                    the selected db_type is mongodb. Auth source + replica
                    set are optional strings; TLS is a boolean toggle. */}
                {isMongo && (
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
                        value={form.auth_source ?? ""}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            auth_source: e.target.value || null,
                          }))
                        }
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
                        value={form.replica_set ?? ""}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            replica_set: e.target.value || null,
                          }))
                        }
                        placeholder="rs0"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-secondary-foreground">
                      <input
                        id="conn-tls-enabled"
                        type="checkbox"
                        className="cursor-pointer"
                        checked={!!form.tls_enabled}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            tls_enabled: e.target.checked,
                          }))
                        }
                      />
                      Enable TLS
                    </label>
                  </div>
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
                          value={form.connection_timeout ?? 300}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              connection_timeout:
                                parseInt(e.target.value, 10) || 300,
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
                          value={form.keep_alive_interval ?? 30}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              keep_alive_interval:
                                parseInt(e.target.value, 10) || 30,
                            }))
                          }
                          placeholder="30"
                        />
                      </div>
                    </div>
                  </details>
                </div>

                {/* Test Result */}
                {testResult && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className={`flex items-center gap-2 rounded px-3 py-2 text-sm ${
                      testResult.success
                        ? "bg-success/10 text-success"
                        : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {testResult.success ? (
                      <CheckCircle size={16} />
                    ) : (
                      <AlertCircle size={16} />
                    )}
                    {testResult.message}
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div
                    role="alert"
                    className="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? (
                  <Loader2 className="animate-spin size-3.5" />
                ) : (
                  <Plug />
                )}
                Test Connection
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : isEditing ? "Update" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
