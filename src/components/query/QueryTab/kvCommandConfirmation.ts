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
 * Issue #2513 — that boundary now covers every verb the backend calls
 * `RedisCommandEffect::Destructive`
 * (`src-tauri/table-view-core/src/db/redis/command_parser.rs`), not just `DEL`.
 * `HDEL`, `LREM`, `SREM`, `ZREM`, `XDEL` and `XTRIM` used to be absent below, so
 * a command typed in the console classified as `info`, the Safe Mode matrix
 * returned `allow` for that classification in every tier, and it reached IPC
 * with no dialog — production + `strict` included. Registering them here with
 * `losesData: true` is what closed the console side; that gap predated #2421,
 * which scoped itself to `DEL`. The console was never the only surface those
 * verbs come from — the KV structure editor reaches the same `danger` tier by
 * its own route, from the mutation's `destructive` flag rather than the typed
 * verb (`analyzeKvMutationSafety` in
 * `src/components/workspace/kvMutationCommands.ts`). The two routes are not
 * merged; what holds them together is
 * `src/components/query/QueryTab/kvDestructiveTier.test.ts`, which asserts per
 * verb that both reach `danger` and that both build the same command string.
 * Adding a data-loss verb to one route without the other fails there.
 */
interface KvConfirmCommand {
  /** Confirm-dialog reason copy. */
  readonly reason: string;
  /**
   * Whether running the command destroys data. Required (not defaulted) so a
   * command added to this map has to answer the question: `true` puts it behind
   * the confirm dialog unconditionally and makes `executeKvCommandNow` refuse
   * every unconfirmed dispatch of it,
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
  // #2513 — element removals. The backend comment on their `Destructive` tier
  // notes each can drop the key itself once the last element is gone, because
  // Redis garbage-collects the emptied collection.
  HDEL: {
    reason: "Redis HDEL permanently removes the hash fields",
    losesData: true,
  },
  LREM: {
    reason: "Redis LREM permanently removes the matching list elements",
    losesData: true,
  },
  SREM: {
    reason: "Redis SREM permanently removes the set members",
    losesData: true,
  },
  ZREM: {
    reason: "Redis ZREM permanently removes the sorted-set members",
    losesData: true,
  },
  XDEL: {
    reason: "Redis XDEL permanently removes the stream entries",
    losesData: true,
  },
  XTRIM: {
    reason: "Redis XTRIM permanently discards stream entries past the bound",
    losesData: true,
  },
};

/**
 * Issue #2421 — the reason copy when `command`'s verb is registered above with
 * `losesData: true`, `undefined` otherwise. One predicate drives both halves of
 * the gate so they cannot drift: `executeKvQuery` routes anything it names to
 * the confirm dialog whatever the Safe Mode matrix returned, and
 * `executeKvCommandNow` refuses to dispatch anything it names. Marking a new
 * command `losesData: true` above therefore gets both at once.
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
  // #2513 — the element removals registered above take an operand as well, so
  // they never match this arity, and the backend would not read the key anyway:
  // `require_command_confirmation` skips any command whose
  // `required_confirmation_key()` is `None`, which is all of them but
  // DEL / PERSIST (`src-tauri/table-view-core/src/db/redis/command.rs`).
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
