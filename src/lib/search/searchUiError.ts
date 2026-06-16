export type SearchErrorScope =
  | "catalog"
  | "indexOverview"
  | "mapping"
  | "settings"
  | "templates"
  | "samples"
  | "fieldStats"
  | "query"
  | "deletePreview";

export interface SearchUiError {
  label: string;
  detail: string;
}

const ERROR_LABELS: Record<SearchErrorScope, string> = {
  catalog: "Search catalog failed",
  indexOverview: "Search index overview failed",
  mapping: "Search mapping failed",
  settings: "Search settings failed",
  templates: "Search templates failed",
  samples: "Search sample documents failed",
  fieldStats: "Search field stats failed",
  query: "Search query failed",
  deletePreview: "Delete-by-query preview failed",
};

const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;
const AUTH_HEADER_RE = /\b(authorization\s*[:=]\s*)(basic|bearer)\s+[^\s,;]+/gi;
const CREDENTIAL_ASSIGNMENT_RE =
  /\b(password|passwd|pwd|token|api[_-]?key|apikey|access[_-]?token|secret)=([^&\s,;)]+)/gi;
const JSON_CREDENTIAL_RE =
  /(["']?(?:password|passwd|pwd|token|api[_-]?key|apikey|access[_-]?token|secret)["']?\s*:\s*)["'][^"']+["']/gi;

export function formatSearchUiError(
  scope: SearchErrorScope,
  error: unknown,
): SearchUiError {
  const detail =
    redactSearchErrorDetail(stringifySearchError(error)) ||
    "Unknown Search error";
  return {
    label: ERROR_LABELS[scope],
    detail,
  };
}

export function redactSearchErrorDetail(message: string): string {
  return message
    .replace(URL_RE, "[redacted-url]")
    .replace(AUTH_HEADER_RE, "$1$2 [redacted]")
    .replace(CREDENTIAL_ASSIGNMENT_RE, "$1=[redacted]")
    .replace(JSON_CREDENTIAL_RE, '$1"[redacted]"')
    .trim();
}

function stringifySearchError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  const rendered = String(error);
  if (rendered !== "[object Object]") return rendered;

  try {
    return JSON.stringify(error);
  } catch {
    return rendered;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
