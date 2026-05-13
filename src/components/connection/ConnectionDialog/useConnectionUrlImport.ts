import { useState } from "react";
import type { ConnectionDraft, DatabaseType } from "@/types/connection";
import {
  DATABASE_TYPE_LABELS,
  SUPPORTED_DATABASE_TYPES,
  isSupportedDatabaseType,
  parseConnectionUrl,
  parseSqliteFilePath,
} from "@/types/connection";

// Sprint 276 — URL parser 가 인식한 scheme 의 DBMS 가 아직 wire-up 되지
// 않았을 때 사용자에게 보여줄 거부 메시지. `SUPPORTED_DATABASE_TYPES` 와
// 동기 — supported 리스트가 바뀌면 메시지도 자동 반영된다.
const unsupportedDbTypeMessage = (dbType: DatabaseType): string => {
  const supportedLabels = SUPPORTED_DATABASE_TYPES.map(
    (t) => DATABASE_TYPE_LABELS[t],
  ).join(" / ");
  return `${DATABASE_TYPE_LABELS[dbType]} is not yet supported. Currently only ${supportedLabels} can be added.`;
};

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
        "Invalid URL. Use format: postgresql://user:password@host:port/database.",
      );
      return false;
    }
    // Sprint 276 — parser 가 인식한 DBMS 가 아직 wire-up 되지 않았다면
    // 명시적으로 거부. URL 모드는 의도된 사용자 액션이므로 silent 가 아니라
    // urlError 로 알린다 (form-mode paste 는 AC-178-04 에 따라 silent).
    if (parsed.db_type && !isSupportedDatabaseType(parsed.db_type)) {
      setUrlError(unsupportedDbTypeMessage(parsed.db_type));
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
    // Sprint 276 — parser 가 unsupported DBMS scheme 을 인식한 경우. AC-178-04
    // 의 silent 룰을 따라 form 을 건드리지 않고 paste 만 흘려보낸다 (사용자가
    // 직접 host 에 텍스트가 들어가는 걸 보면 인식 자체가 안 됐다고 자연스레
    // 깨닫는다). URL 모드 (Parse & Continue) 에서는 명시 거부.
    if (parsed.db_type && !isSupportedDatabaseType(parsed.db_type)) {
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
