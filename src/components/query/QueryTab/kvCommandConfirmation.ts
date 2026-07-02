/**
 * Redis commands the backend gates with a `required_confirmation_key`
 * (`src-tauri/src/db/redis/command.rs`): KEYS pattern-confirm + the
 * Destructive/Ttl commands DEL / PERSIST. That backend allowlist is the
 * authoritative safety boundary; this map mirrors its *set* so the frontend
 * routes these commands to the same confirm dialog SQL destructive
 * statements use, instead of letting the backend reject them with a bare
 * error after a silent frontend pass (issue #1120 symptom 3). The value is
 * the confirm-dialog reason copy. Each command's confirm key is its single
 * token argument.
 */
export const KV_CONFIRM_COMMANDS: Readonly<Record<string, string>> = {
  KEYS: "Redis KEYS scans the full keyspace",
  DEL: "Redis DEL permanently removes the key",
  PERSIST: "Redis PERSIST removes the key's expiry",
};

export function kvCommandConfirmationKey(command: string): string | undefined {
  const tokens = tokenizeRedisCommand(command);
  const verb = tokens[0]?.toUpperCase();
  if (verb === undefined || !(verb in KV_CONFIRM_COMMANDS)) return undefined;
  // Confirm key = the single token argument (KEYS pattern / DEL·PERSIST key).
  return tokens.length === 2 ? tokens[1] : undefined;
}

function tokenizeRedisCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index] ?? "";
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && index + 1 < input.length) {
        index += 1;
        current += input[index] ?? "";
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}
