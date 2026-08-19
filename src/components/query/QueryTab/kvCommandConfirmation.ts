/**
 * Redis commands the backend gates with a `required_confirmation_key`
 * (`src-tauri/table-view-core/src/db/redis/command.rs`): KEYS pattern-confirm + the
 * Destructive/Ttl commands DEL / PERSIST. This map mirrors that *set* so the
 * frontend routes these commands to the same confirm dialog SQL destructive
 * statements use, instead of letting the backend reject them with a bare
 * error after a silent frontend pass (issue #1120 symptom 3). The value carries
 * the confirm-dialog reason copy and whether running the command loses data.
 *
 * Issue #2421 — that backend gate is NOT an independent safety boundary for
 * commands typed in the editor. `require_confirm_key` only checks that the key
 * on the request equals the key the backend parsed out of the same command
 * string, and the frontend can derive that value from the command text (see
 * `kvCommandConfirmationKey` below). A dispatch that skipped the dialog used to
 * satisfy the gate by itself, so `DEL k` ran with no dialog and no rejection on
 * the shipped default (non-production + Safe Mode `warn`). The boundary that
 * replaced it is the confirm dialog, and enforcing it is
 * `kvQueryExecution.ts`'s job: `executeKvCommandNow` refuses any command
 * `kvDataLossReason` names, and only `executeConfirmedKvCommand` — reachable
 * solely from a cleared dialog — can dispatch one. What the backend allowlist
 * still bounds is *which* commands exist at all; it cannot tell a confirmed
 * request from an unconfirmed one.
 *
 * That boundary covers this map, not everything that loses data. `HDEL`,
 * `LREM`, `SREM`, `ZREM`, `XDEL` and `XTRIM` are
 * `RedisCommandEffect::Destructive` on the backend
 * (`src-tauri/table-view-core/src/db/redis/command_parser.rs`) yet are absent
 * below, so they classify as `info`, the Safe Mode matrix returns `allow` for
 * them in every tier, and they reach IPC with no dialog. Registering one here
 * with `losesData: true` is what closes that; the gap predates #2421, which
 * scoped itself to `DEL`, and is tracked separately
 * (`docs/product/known-limitations-cross-cutting.md`).
 */
interface KvConfirmCommand {
  /** Confirm-dialog reason copy. */
  readonly reason: string;
  /**
   * Whether running the command destroys data. Required (not defaulted) so a
   * command added to this map has to answer the question: `true` puts it behind
   * the confirm dialog unconditionally and blocks every unconfirmed dispatch,
   * `false` means the backend gates it but nothing is lost (KEYS scans the
   * keyspace, PERSIST drops a TTL) so an unconfirmed dispatch may echo the
   * backend's confirm key itself.
   */
  readonly losesData: boolean;
}

export const KV_CONFIRM_COMMANDS: Readonly<Record<string, KvConfirmCommand>> = {
  KEYS: { reason: "Redis KEYS scans the full keyspace", losesData: false },
  DEL: { reason: "Redis DEL permanently removes the key", losesData: true },
  PERSIST: {
    reason: "Redis PERSIST removes the key's expiry",
    losesData: false,
  },
};

/**
 * Issue #2421 — the reason copy when `command` destroys data, `undefined`
 * otherwise. One predicate drives both halves of the gate so they cannot drift:
 * `executeKvQuery` routes anything it names to the confirm dialog whatever the
 * Safe Mode matrix returned, and `executeKvCommandNow` refuses to dispatch
 * anything it names. Marking a new command `losesData: true` above therefore
 * gets both at once.
 */
export function kvDataLossReason(command: string): string | undefined {
  const entry = KV_CONFIRM_COMMANDS[kvCommandVerb(command) ?? ""];
  return entry?.losesData ? entry.reason : undefined;
}

export function kvCommandConfirmationKey(command: string): string | undefined {
  const tokens = tokenizeRedisCommand(command);
  const verb = tokens[0]?.toUpperCase();
  if (verb === undefined || !(verb in KV_CONFIRM_COMMANDS)) return undefined;
  // Confirm key = the single token argument (KEYS pattern / DEL·PERSIST key).
  return tokens.length === 2 ? tokens[1] : undefined;
}

function kvCommandVerb(command: string): string | undefined {
  return tokenizeRedisCommand(command)[0]?.toUpperCase();
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
