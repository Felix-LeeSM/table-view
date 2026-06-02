export type KvKeyType =
  | "string"
  | "list"
  | "set"
  | "zSet"
  | "hash"
  | "stream"
  | "json"
  | "unknown";

export type KvTtlState = "missing" | "persistent" | "expires";

export interface KvTtl {
  state: KvTtlState;
  seconds?: number;
}

export interface KvDatabaseInfo {
  name: string;
  index: number;
  keyCount?: number;
}

export interface KvKeyMetadata {
  key: string;
  keyType: KvKeyType;
  ttl: KvTtl;
  length?: number;
  memoryBytes?: number;
}

export interface KvKeyScanRequest {
  database?: number;
  cursor?: string;
  pattern?: string;
  limit?: number;
}

export interface KvKeyScanPage {
  database: number;
  cursor: string;
  nextCursor: string;
  done: boolean;
  limit: number;
  keys: KvKeyMetadata[];
}

export interface KvValueReadRequest {
  key: string;
  database?: number;
  limit?: number;
  cursor?: string;
}

export interface KvCommandRequest {
  command: string;
  database?: number;
}

export interface KvStringValue {
  type: "string";
  encoding: "utf8" | "binary";
  text?: string;
  hex?: string;
  byteLength: number;
}

export interface KvIndexedValue {
  index: number;
  value: string;
}

export interface KvListValue {
  type: "list";
  entries: KvIndexedValue[];
  total: number;
}

export interface KvSetValue {
  type: "set";
  members: string[];
  cursor: string;
  nextCursor: string;
  done: boolean;
  total: number;
}

export interface KvScoredValue {
  member: string;
  score: number;
}

export interface KvZSetValue {
  type: "zSet";
  entries: KvScoredValue[];
  total: number;
}

export interface KvHashField {
  field: string;
  value: string;
}

export interface KvHashValue {
  type: "hash";
  fields: KvHashField[];
  cursor: string;
  nextCursor: string;
  done: boolean;
  total: number;
}

export interface KvStreamEntry {
  id: string;
  fields: KvHashField[];
}

export interface KvStreamReadRequest {
  key: string;
  database?: number;
  start?: string;
  end?: string;
  limit?: number;
}

export interface KvStreamReadResult {
  type?: "stream";
  key: string;
  entries: KvStreamEntry[];
  start: string;
  end: string;
  limit: number;
}

export interface KvJsonValue {
  type: "json";
  value: unknown;
}

export interface KvUnsupportedValue {
  type: "unsupported";
  message: string;
}

export interface KvMissingValue {
  type: "missing";
}

export type KvValue =
  | KvStringValue
  | KvListValue
  | KvSetValue
  | KvZSetValue
  | KvHashValue
  | (KvStreamReadResult & { type: "stream" })
  | KvJsonValue
  | KvUnsupportedValue
  | KvMissingValue;

export interface KvValueEnvelope {
  key: string;
  metadata: KvKeyMetadata;
  value: KvValue;
}

export type KvWriteSafety = "rejectOverwrite" | "allowOverwrite";

export interface KvSetStringRequest {
  key: string;
  value: string;
  database?: number;
  ttlSeconds?: number;
  safety?: KvWriteSafety;
}

export interface KvDeleteRequest {
  key: string;
  database?: number;
  confirmKey: string;
}

export type KvTtlUpdate =
  | { mode: "expire"; seconds: number }
  | { mode: "persist"; confirmKey: string };

export interface KvTtlUpdateRequest {
  key: string;
  database?: number;
  update: KvTtlUpdate;
}

export interface KvMutationResult {
  key: string;
  changed: boolean;
  ttl?: KvTtl;
}

export function formatKvTtl(ttl: KvTtl): string {
  if (ttl.state === "missing") return "missing";
  if (ttl.state === "persistent") return "persistent";
  return `${ttl.seconds ?? 0}s`;
}
