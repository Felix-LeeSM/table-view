import { useState } from "react";
import type { ConnectionConfig, DatabaseType } from "../types/connection";
import {
  createEmptyConnection,
  DATABASE_DEFAULTS,
  parseConnectionUrl,
  ENVIRONMENT_META,
  ENVIRONMENT_OPTIONS,
} from "../types/connection";
import { useConnectionStore } from "../stores/connectionStore";
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
} from "./ui/dialog";

interface ConnectionDialogProps {
  connection?: ConnectionConfig;
  onClose: () => void;
}

export default function ConnectionDialog({
  connection,
  onClose,
}: ConnectionDialogProps) {
  const isEditing = !!connection;
  const [inputMode, setInputMode] = useState<"form" | "url">(
    connection ? "form" : "form",
  );
  const [urlValue, setUrlValue] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [form, setForm] = useState<ConnectionConfig>(
    connection ?? createEmptyConnection(),
  );
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
    }));
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const msg = await testConnection(form);
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
      if (isEditing) {
        await updateConnection(form);
      } else {
        await addConnection(form);
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
        className="w-[440px] bg-secondary p-0"
        showCloseButton={false}
      >
        <div className="w-[440px] rounded-lg bg-secondary shadow-xl">
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
            <button
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <X size={16} />
            </button>
          </DialogHeader>

          {/* Form */}
          <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
            {/* Input mode toggle */}
            {!isEditing && (
              <div className="mb-3 flex gap-1 rounded-md border border-border p-0.5">
                <button
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-medium ${
                    inputMode === "form"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-secondary-foreground"
                  }`}
                  onClick={() => setInputMode("form")}
                >
                  <List size={12} />
                  Form
                </button>
                <button
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-medium ${
                    inputMode === "url"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-secondary-foreground"
                  }`}
                  onClick={() => setInputMode("url")}
                >
                  <Link size={12} />
                  URL
                </button>
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
                    className="rounded bg-red-500/10 px-3 py-2 text-sm text-destructive"
                  >
                    {urlError}
                  </div>
                )}
                <button
                  className="w-full rounded bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary/90"
                  onClick={() => {
                    const parsed = parseConnectionUrl(urlValue);
                    if (!parsed) {
                      setUrlError(
                        "Invalid URL. Use format: postgresql://user:password@host:port/database",
                      );
                      return;
                    }
                    setForm((f) => ({
                      ...f,
                      ...parsed,
                      name: f.name || parsed.database || "",
                    }));
                    setInputMode("form");
                  }}
                >
                  Parse & Continue
                </button>
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
                  <label htmlFor="conn-password" className={labelClass}>
                    Password
                  </label>
                  <input
                    id="conn-password"
                    className={inputClass}
                    type="password"
                    value={form.password}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, password: e.target.value }))
                    }
                    placeholder="••••••••"
                  />
                </div>

                {/* Database */}
                <div>
                  <label htmlFor="conn-database" className={labelClass}>
                    Database
                  </label>
                  <input
                    id="conn-database"
                    className={inputClass}
                    value={form.database}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, database: e.target.value }))
                    }
                    placeholder="mydb"
                  />
                </div>

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
                    className={`flex items-center gap-2 rounded px-3 py-2 text-sm ${
                      testResult.success
                        ? "bg-green-500/10 text-emerald-500 dark:text-emerald-400"
                        : "bg-red-500/10 text-destructive"
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
                    className="rounded bg-red-500/10 px-3 py-2 text-sm text-destructive"
                  >
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            <button
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-secondary-foreground hover:bg-muted disabled:opacity-50"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plug size={14} />
              )}
              Test Connection
            </button>
            <button
              className="rounded px-3 py-1.5 text-sm text-secondary-foreground hover:bg-muted"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="rounded bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : isEditing ? "Update" : "Save"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
