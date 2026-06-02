import {
  snippetCompletion,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { KvKeyType } from "@/types/kv";

export type RedisCommandCompletionEffect =
  | "read"
  | "write"
  | "ttl"
  | "stream"
  | "destructive";

export interface RedisCommandCompletionSpec {
  readonly name: string;
  readonly effect: RedisCommandCompletionEffect;
  readonly arity: string;
  readonly arguments: readonly string[];
  readonly snippet: string;
  readonly summary: string;
}

export interface RedisUnsupportedCommandFamily {
  readonly label: string;
  readonly reason: string;
}

export interface RedisKeySuggestion {
  readonly key: string;
  readonly keyType: KvKeyType;
}

export interface RedisCommandCompletionSourceOptions {
  readonly keySuggestions?: readonly RedisKeySuggestion[];
}

export const REDIS_COMMAND_COMPLETIONS = [
  {
    name: "GET",
    effect: "read",
    arity: "1 key",
    arguments: ["key"],
    snippet: "GET ${key}",
    summary: "Read a string value.",
  },
  {
    name: "HGETALL",
    effect: "read",
    arity: "1 key",
    arguments: ["key"],
    snippet: "HGETALL ${key}",
    summary: "Read every field in a hash.",
  },
  {
    name: "LRANGE",
    effect: "read",
    arity: "key start stop",
    arguments: ["key", "start", "stop"],
    snippet: "LRANGE ${key} 0 99",
    summary: "Read a bounded list range.",
  },
  {
    name: "SMEMBERS",
    effect: "read",
    arity: "1 key",
    arguments: ["key"],
    snippet: "SMEMBERS ${key}",
    summary: "Read members from a set.",
  },
  {
    name: "ZRANGE",
    effect: "read",
    arity: "key start stop [WITHSCORES]",
    arguments: ["key", "start", "stop", "WITHSCORES"],
    snippet: "ZRANGE ${key} 0 99",
    summary: "Read a bounded sorted-set range.",
  },
  {
    name: "XRANGE",
    effect: "stream",
    arity: "key start end [COUNT n]",
    arguments: ["key", "start", "end", "COUNT"],
    snippet: "XRANGE ${key} - + COUNT 100",
    summary: "Read a bounded stream range.",
  },
  {
    name: "TYPE",
    effect: "read",
    arity: "1 key",
    arguments: ["key"],
    snippet: "TYPE ${key}",
    summary: "Inspect a key type.",
  },
  {
    name: "TTL",
    effect: "ttl",
    arity: "1 key",
    arguments: ["key"],
    snippet: "TTL ${key}",
    summary: "Read remaining TTL seconds.",
  },
  {
    name: "EXISTS",
    effect: "read",
    arity: "1+ keys",
    arguments: ["key", "key ..."],
    snippet: "EXISTS ${key}",
    summary: "Check whether one or more keys exist.",
  },
  {
    name: "SET",
    effect: "write",
    arity: "key value [EX seconds]",
    arguments: ["key", "value", "EX"],
    snippet: "SET ${key} ${value}",
    summary: "Write a string value; NX/XX stay in typed controls.",
  },
  {
    name: "HSET",
    effect: "write",
    arity: "key field value",
    arguments: ["key", "field", "value"],
    snippet: "HSET ${key} ${field} ${value}",
    summary: "Set one hash field.",
  },
  {
    name: "LPUSH",
    effect: "write",
    arity: "key value [value ...]",
    arguments: ["key", "value", "value ..."],
    snippet: "LPUSH ${key} ${value}",
    summary: "Push values to the head of a list.",
  },
  {
    name: "RPUSH",
    effect: "write",
    arity: "key value [value ...]",
    arguments: ["key", "value", "value ..."],
    snippet: "RPUSH ${key} ${value}",
    summary: "Push values to the tail of a list.",
  },
  {
    name: "SADD",
    effect: "write",
    arity: "key member [member ...]",
    arguments: ["key", "member", "member ..."],
    snippet: "SADD ${key} ${member}",
    summary: "Add members to a set.",
  },
  {
    name: "ZADD",
    effect: "write",
    arity: "key score member",
    arguments: ["key", "score", "member"],
    snippet: "ZADD ${key} 1 ${member}",
    summary: "Add one sorted-set member.",
  },
  {
    name: "EXPIRE",
    effect: "ttl",
    arity: "key seconds",
    arguments: ["key", "seconds"],
    snippet: "EXPIRE ${key} 60",
    summary: "Set a positive TTL.",
  },
  {
    name: "PERSIST",
    effect: "ttl",
    arity: "1 key + exact confirmKey",
    arguments: ["key"],
    snippet: "PERSIST ${key}",
    summary: "Remove TTL; backend requires exact key confirmation.",
  },
  {
    name: "DEL",
    effect: "destructive",
    arity: "1 key + exact confirmKey",
    arguments: ["key"],
    snippet: "DEL ${key}",
    summary: "Delete one key; backend requires exact key confirmation.",
  },
] as const satisfies readonly RedisCommandCompletionSpec[];

export const REDIS_UNSUPPORTED_COMMAND_FAMILIES = [
  {
    label: "ACL / CLIENT / CONFIG / DEBUG",
    reason: "admin and server-control commands are outside product scope.",
  },
  {
    label: "CLUSTER / PUBSUB / MODULE / FUNCTION",
    reason: "cluster, pub/sub, modules, and functions need separate workflows.",
  },
  {
    label: "EVAL / SCRIPT",
    reason: "arbitrary script execution is not part of the bounded editor.",
  },
  {
    label: "FLUSH* / UNLINK / RENAME",
    reason:
      "broad destructive commands need dedicated safety policy before promotion.",
  },
  {
    label: "XGROUP / XREADGROUP",
    reason: "consumer-group management is a future stream UI slice.",
  },
] as const satisfies readonly RedisUnsupportedCommandFamily[];

const REDIS_KEY_ARGUMENTS = {
  GET: ["string"],
  HGETALL: ["hash"],
  LRANGE: ["list"],
  SMEMBERS: ["set"],
  ZRANGE: ["zSet"],
  XRANGE: ["stream"],
  TYPE: "any",
  TTL: "any",
  EXISTS: "variadic-any",
  SET: ["string"],
  HSET: ["hash"],
  LPUSH: ["list"],
  RPUSH: ["list"],
  SADD: ["set"],
  ZADD: ["zSet"],
  EXPIRE: "any",
  PERSIST: "any",
  DEL: "any",
} as const satisfies Record<
  (typeof REDIS_COMMAND_COMPLETIONS)[number]["name"],
  readonly KvKeyType[] | "any" | "variadic-any"
>;

export function createRedisCommandCompletionSource(
  options: RedisCommandCompletionSourceOptions = {},
): CompletionSource {
  return (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const cursorOffset = context.pos - line.from;
    const keyPosition = readKeyPosition(line.text, cursorOffset);
    if (keyPosition) {
      const { fromOffset, prefix, command } = keyPosition;
      if (!context.explicit && prefix.length === 0) return null;
      const keyOptions = (options.keySuggestions ?? [])
        .filter((suggestion) => keyMatchesCommand(command, suggestion.keyType))
        .filter((suggestion) => suggestion.key.startsWith(prefix))
        .map((suggestion) => ({
          label: suggestion.key,
          type: "variable",
          detail: suggestion.keyType,
          info: `Redis ${suggestion.keyType} key`,
          boost: 5,
        }));

      if (keyOptions.length === 0) return null;
      return {
        from: line.from + fromOffset,
        options: keyOptions,
        validFor: /^[^\s]*$/,
      } satisfies CompletionResult;
    }

    const commandPosition = readCommandPosition(line.text, cursorOffset);
    if (!commandPosition) return null;
    const { fromOffset, prefix } = commandPosition;
    if (!context.explicit && prefix.length === 0) return null;

    const upperPrefix = prefix.toUpperCase();
    const commandOptions = REDIS_COMMAND_COMPLETIONS.filter((command) =>
      command.name.startsWith(upperPrefix),
    ).map((command) =>
      snippetCompletion(command.snippet, {
        label: command.name,
        type: command.effect === "destructive" ? "warning" : "keyword",
        detail: command.arity,
        info: `${command.summary} Args: ${command.arguments.join(", ")}`,
        boost: commandBoost(command.effect),
      }),
    );

    if (commandOptions.length === 0) return null;
    return {
      from: line.from + fromOffset,
      options: commandOptions,
      validFor: /^[A-Za-z]*$/,
    } satisfies CompletionResult;
  };
}

function readCommandPosition(
  lineText: string,
  cursorOffset: number,
): { fromOffset: number; prefix: string } | null {
  const beforeCursor = lineText.slice(0, cursorOffset);
  const match = beforeCursor.match(/^\s*([A-Za-z]*)$/);
  if (!match) return null;
  return {
    fromOffset: beforeCursor.length - match[1]!.length,
    prefix: match[1]!,
  };
}

function readKeyPosition(
  lineText: string,
  cursorOffset: number,
): { fromOffset: number; prefix: string; command: string } | null {
  const beforeCursor = lineText.slice(0, cursorOffset);
  const match = beforeCursor.match(/^(\s*)([A-Za-z]+)(\s+.*)$/);
  if (!match) return null;

  const command = match[2]!.toUpperCase();
  if (!(command in REDIS_KEY_ARGUMENTS)) return null;

  const argsText = match[3]!;
  const leadingWhitespace = argsText.match(/^\s*/)?.[0] ?? "";
  const args = argsText.slice(leadingWhitespace.length);
  const endsWithWhitespace = args.length === 0 || /\s$/.test(argsText);
  const tokens = args.trim().length === 0 ? [] : args.trim().split(/\s+/);
  const argumentIndex = endsWithWhitespace ? tokens.length : tokens.length - 1;
  const prefix = endsWithWhitespace ? "" : tokens[tokens.length - 1]!;
  const keyMode =
    REDIS_KEY_ARGUMENTS[command as keyof typeof REDIS_KEY_ARGUMENTS];
  const acceptsArgument =
    keyMode === "variadic-any" ? argumentIndex >= 0 : argumentIndex === 0;
  if (!acceptsArgument) return null;

  return {
    command,
    fromOffset: beforeCursor.length - prefix.length,
    prefix,
  };
}

function keyMatchesCommand(command: string, keyType: KvKeyType): boolean {
  const keyMode =
    REDIS_KEY_ARGUMENTS[command as keyof typeof REDIS_KEY_ARGUMENTS];
  if (keyMode === "any" || keyMode === "variadic-any") return true;
  return (keyMode as readonly KvKeyType[]).includes(keyType);
}

function commandBoost(effect: RedisCommandCompletionEffect): number {
  switch (effect) {
    case "read":
      return 50;
    case "write":
      return 30;
    case "ttl":
      return 20;
    case "stream":
      return 10;
    case "destructive":
      return -50;
  }
}
