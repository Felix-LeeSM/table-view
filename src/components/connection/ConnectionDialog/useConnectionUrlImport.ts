import { useState } from "react";
import type { ConnectionDraft, DatabaseType } from "@/types/connection";
import { parseConnectionUrl, parseSqliteFilePath } from "@/types/connection";

/**
 * Sprint 213 (post-209 P6) — URL parse + form-mode host-paste detection +
 * host:port blur split extracted from `ConnectionDialog.tsx`. Owns:
 *
 *   - `urlValue` / `urlError` (URL-mode input + parse failure message).
 *   - `detectedScheme` (Sprint 178 form-mode advisory affordance).
 *   - `parseAndApply` — URL-mode `Parse & Continue` orchestration: try
 *     `parseConnectionUrl`, fall back to `parseSqliteFilePath` when the
 *     currently-selected DBMS is sqlite. Sets `urlError` on failure.
 *   - `handleHostPaste` — Sprint 178 AC-178-01: detect a recognised URL
 *     scheme pasted into `#conn-host`, parse, prevent the literal paste
 *     from landing in the field, and merge the parsed result via the
 *     draft hook's `applyParsedConnection`. Malformed URLs fail silently
 *     per AC-178-04.
 *   - `handleHostBlur` — Sprint 178 AC-178-03: split a single-`:`-then-
 *     digits suffix into the port. Bracketed IPv6 / multi-colon IPv6 /
 *     non-digit ports all unchanged.
 *
 * No behaviour change vs. pre-split. The hook does not own form/URL
 * mode toggle — that stays as entry-local state (the hook never needs
 * to know which mode the dialog is in).
 */

const RECOGNISED_SCHEMES = [
  "postgres",
  "postgresql",
  "mysql",
  "mariadb",
  "mongodb",
  "mongodb+srv",
  "redis",
  "sqlite",
] as const;

const looksLikeRecognisedUrl = (text: string): boolean => {
  const trimmed = text.trim();
  return RECOGNISED_SCHEMES.some(
    (scheme) =>
      trimmed.startsWith(`${scheme}://`) ||
      // sqlite uses `sqlite:/path` (single slash), so accept that too.
      (scheme === "sqlite" && trimmed.startsWith("sqlite:")),
  );
};

// AC-178-03: on blur of the host field, split a single-`:`-then-digits
// suffix into the port. The regex `^([^\[:][^:]*):(\d+)$` rejects
// bracket-form IPv6 (`[::1]:5432` — first char `[`), multi-colon IPv6
// (`::1:5432` — first char `:`, second `:` violates the no-colon
// segment), and non-digit ports (`db.example.com:abcd`).
const HOST_PORT_RE = /^([^[:][^:]*):(\d+)$/;

export interface UseConnectionUrlImportArgs {
  dbType: DatabaseType;
  applyParsedConnection: (
    parsed: Partial<ConnectionDraft>,
    mode: "url" | "paste",
  ) => void;
  setHostPort: (host: string, port: number) => void;
}

export interface UseConnectionUrlImportReturn {
  urlValue: string;
  setUrlValue: React.Dispatch<React.SetStateAction<string>>;
  urlError: string | null;
  setUrlError: React.Dispatch<React.SetStateAction<string | null>>;
  detectedScheme: string | null;
  setDetectedScheme: React.Dispatch<React.SetStateAction<string | null>>;
  /**
   * URL-mode `Parse & Continue` handler. Returns `true` on success
   * (caller should switch `inputMode` to `"form"`) and `false` on
   * failure (`urlError` is already populated).
   */
  parseAndApply: () => boolean;
  handleHostPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  handleHostBlur: (e: React.FocusEvent<HTMLDivElement>) => void;
}

export function useConnectionUrlImport({
  dbType,
  applyParsedConnection,
  setHostPort,
}: UseConnectionUrlImportArgs): UseConnectionUrlImportReturn {
  const [urlValue, setUrlValue] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  // Sprint 178 (Postel's Law): when the form-mode host paste is recognised
  // as a connection URL, we render a calm inline note next to the host
  // field announcing what was detected. The note is non-modal, advisory,
  // never role="alert"/"status" — that contract is enforced by AC-178-04
  // (silent on malformed pastes) and AC-178-05 (no password leak via
  // alert regions).
  const [detectedScheme, setDetectedScheme] = useState<string | null>(null);

  const parseAndApply = (): boolean => {
    // Sprint 138 — try URL parse first; if SQLite is the currently-selected
    // DBMS or the URL doesn't look like a recognised scheme, fall back to
    // treating the input as a SQLite file path.
    const parsed =
      parseConnectionUrl(urlValue) ??
      (dbType === "sqlite" ? parseSqliteFilePath(urlValue) : null);
    if (!parsed) {
      setUrlError(
        "Invalid URL. Use format: postgresql://user:password@host:port/database (or paste a SQLite file path while SQLite is selected).",
      );
      return false;
    }
    applyParsedConnection(parsed, "url");
    return true;
  };

  const handleHostPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.id !== "conn-host") return;
    const pasted = e.clipboardData?.getData("text") ?? "";
    if (!pasted) return;
    if (!looksLikeRecognisedUrl(pasted)) return;
    // Try the URL parser first. SQLite URLs land in the same parser
    // branch (`sqlite:/path` is supported by `parseConnectionUrl`). A
    // falsy result means malformed (e.g. `postgres://`); per AC-178-04
    // we silently leave the host field unchanged — no toast, no alert.
    const parsed = parseConnectionUrl(pasted.trim());
    if (!parsed) {
      // Malformed URL paste — silent best-effort, do nothing. The user's
      // pasted text continues into the host field via the default paste
      // behaviour. No alert region added.
      return;
    }
    // Successful parse: prevent the literal URL from also landing in the
    // host field (which would create a fight between `parsed.host` and
    // the raw paste). Then merge the parsed fields into the draft and
    // populate the password input separately.
    e.preventDefault();
    applyParsedConnection(parsed, "paste");
    setDetectedScheme(parsed.db_type ?? null);
  };

  const handleHostBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.id !== "conn-host") return;
    const value = (target as HTMLInputElement).value;
    const match = value.match(HOST_PORT_RE);
    if (!match) return;
    const hostPart = match[1];
    const portPart = match[2];
    if (typeof hostPart !== "string" || typeof portPart !== "string") return;
    const port = parseInt(portPart, 10);
    if (Number.isNaN(port)) return;
    setHostPort(hostPart, port);
  };

  return {
    urlValue,
    setUrlValue,
    urlError,
    setUrlError,
    detectedScheme,
    setDetectedScheme,
    parseAndApply,
    handleHostPaste,
    handleHostBlur,
  };
}
