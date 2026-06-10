export interface DbMismatchInfo {
  expected: string;
  actual: string;
}

export type CancelError =
  | { type: "AlreadyCompleted" }
  | { type: "PermissionDenied"; message: string }
  | { type: "NetworkError"; message: string };

export interface TauriErrorEnvelope {
  type: string;
  message?: string;
  payload?: unknown;
}

export interface NormalizedTauriError {
  type: string;
  message: string;
  payload?: unknown;
  raw: unknown;
}

const UNKNOWN_ERROR_TYPE = "Unknown";
const DB_MISMATCH_RE =
  /^Database mismatch: expected '([^']*)', backend pool has '([^']*)'$/;

export function normalizeTauriError(err: unknown): NormalizedTauriError {
  const direct = parseEnvelope(err);
  if (direct) return normalizeEnvelope(direct, err);

  const message = getMessageField(err);
  const fromMessage = message === undefined ? null : parseEnvelope(message);
  if (fromMessage) return normalizeEnvelope(fromMessage, err);

  return {
    type: UNKNOWN_ERROR_TYPE,
    message: stringifyUnknownError(err),
    raw: err,
  };
}

export function getTauriErrorMessage(err: unknown): string {
  return normalizeTauriError(err).message;
}

export function getDbMismatchInfo(err: unknown): DbMismatchInfo | null {
  const normalized = normalizeTauriError(err);
  if (normalized.type === "DbMismatch") {
    const payloadInfo = parseDbMismatchPayload(normalized.payload);
    if (payloadInfo) return payloadInfo;
  }

  const m = DB_MISMATCH_RE.exec(normalized.message);
  if (!m) return null;
  return { expected: m[1]!, actual: m[2]! };
}

function normalizeEnvelope(
  envelope: TauriErrorEnvelope,
  raw: unknown,
): NormalizedTauriError {
  const message =
    typeof envelope.message === "string"
      ? envelope.message
      : (messageFromEnvelope(envelope) ?? stringifyUnknownError(raw));
  return {
    type: envelope.type,
    message,
    payload: envelope.payload,
    raw,
  };
}

function messageFromEnvelope(envelope: TauriErrorEnvelope): string | null {
  if (envelope.type === "DbMismatch") {
    const info = parseDbMismatchPayload(envelope.payload);
    if (!info) return null;
    return formatDbMismatchMessage(info);
  }
  if (envelope.type === "Cancel") {
    const cancel = parseCancelPayload(envelope.payload);
    if (!cancel) return null;
    return formatCancelMessage(cancel);
  }
  if (typeof envelope.payload === "string") return envelope.payload;
  return null;
}

function parseEnvelope(value: unknown): TauriErrorEnvelope | null {
  const parsed = parseMaybeJson(value);
  if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
  return {
    type: parsed.type,
    message: typeof parsed.message === "string" ? parsed.message : undefined,
    payload: parsed.payload,
  };
}

function parseDbMismatchPayload(payload: unknown): DbMismatchInfo | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.expected !== "string") return null;
  if (typeof payload.actual !== "string") return null;
  return { expected: payload.expected, actual: payload.actual };
}

function parseCancelPayload(payload: unknown): CancelError | null {
  if (!isRecord(payload) || typeof payload.type !== "string") return null;
  if (payload.type === "AlreadyCompleted") return { type: "AlreadyCompleted" };
  if (payload.type === "PermissionDenied") {
    return {
      type: "PermissionDenied",
      message: typeof payload.message === "string" ? payload.message : "",
    };
  }
  if (payload.type === "NetworkError") {
    return {
      type: "NetworkError",
      message: typeof payload.message === "string" ? payload.message : "",
    };
  }
  return null;
}

function formatDbMismatchMessage(info: DbMismatchInfo): string {
  return `Database mismatch: expected '${info.expected}', backend pool has '${info.actual}'`;
}

function formatCancelMessage(error: CancelError): string {
  if (error.type === "AlreadyCompleted")
    return "Cancel: query already completed";
  if (error.type === "PermissionDenied") {
    return `Cancel: permission denied (${error.message})`;
  }
  return `Cancel: network error (${error.message})`;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function getMessageField(value: unknown): string | undefined {
  if (value instanceof Error) return value.message;
  if (isRecord(value) && typeof value.message === "string") {
    return value.message;
  }
  return undefined;
}

function stringifyUnknownError(value: unknown): string {
  if (typeof value === "string") return value;
  const message = getMessageField(value);
  if (message !== undefined) return message;
  if (isRecord(value) && typeof value.payload === "string") {
    return value.payload;
  }

  const rendered = String(value);
  if (rendered !== "[object Object]") return rendered;

  try {
    return JSON.stringify(value);
  } catch {
    return rendered;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
