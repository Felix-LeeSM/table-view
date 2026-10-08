// biome-ignore-all lint/suspicious/noTemplateCurlyInString: every `${...}` in this file is a CodeMirror snippet placeholder passed to `snippetCompletion`, which defines that syntax. A template literal here would interpolate at module load and destroy the placeholder.

import {
  type CompletionResult,
  type CompletionSource,
  snippetCompletion,
} from "@codemirror/autocomplete";
import {
  getRedisCommandRows,
  type RedisCommandCompletionEffect,
  type RedisCommandCoreRow,
} from "@lib/redis/redisCommandCore";
import type { KvKeyType } from "@/types/kv";

export type { RedisCommandCompletionEffect };

/**
 * Editor-facing view of a vocabulary row. The row SOT is the
 * `redis-command-core` Rust crate; this picks the fields the completion
 * source renders.
 */
export type RedisCommandCompletionSpec = Pick<
  RedisCommandCoreRow,
  "name" | "effect" | "arity" | "arguments" | "snippet" | "summary"
>;

export interface RedisUnsupportedCommandFamily {
  readonly label: string;
  readonly reason: string;
}

export type RedisCommandCompletionTarget = "redis" | "valkey";

export interface RedisKeySuggestion {
  readonly key: string;
  readonly keyType: KvKeyType;
}

export interface RedisCommandCompletionSourceOptions {
  readonly keySuggestions?: readonly RedisKeySuggestion[];
  readonly target?: RedisCommandCompletionTarget;
}

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

/** Rows in SOT order, or an empty list while the WASM vocabulary loads. */
export function getRedisCommandCompletions(): readonly RedisCommandCompletionSpec[] {
  return getRedisCommandRows() ?? [];
}

/** The proven Valkey subset (`valkeyProven` rows of the same SOT). */
export function getValkeyCommandCompletions(): readonly RedisCommandCompletionSpec[] {
  return getRedisCommandRows()?.filter((row) => row.valkeyProven) ?? [];
}

export function createRedisCommandCompletionSource(
  options: RedisCommandCompletionSourceOptions = {},
): CompletionSource {
  const target = options.target ?? "redis";
  return (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const cursorOffset = context.pos - line.from;
    const keyPosition = readKeyPosition(line.text, cursorOffset, target);
    if (keyPosition) {
      const { fromOffset, prefix, row } = keyPosition;
      if (!context.explicit && prefix.length === 0) return null;
      const keyOptions = (options.keySuggestions ?? [])
        .filter((suggestion) => keyMatchesCommand(row, suggestion.keyType))
        .filter((suggestion) => suggestion.key.startsWith(prefix))
        .map((suggestion) => ({
          label: suggestion.key,
          type: "variable",
          detail: suggestion.keyType,
          info: `${targetLabel(target)} ${suggestion.keyType} key`,
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
    const commandOptions = commandCompletionsForTarget(target)
      .filter((command) => command.name.startsWith(upperPrefix))
      .map((command) =>
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
  target: RedisCommandCompletionTarget,
): { fromOffset: number; prefix: string; row: RedisCommandCoreRow } | null {
  const beforeCursor = lineText.slice(0, cursorOffset);
  const match = beforeCursor.match(/^(\s*)([A-Za-z]+)(\s+.*)$/);
  if (!match) return null;

  const command = match[2]!.toUpperCase();
  const row = commandRow(command);
  if (row === null || !targetSupportsCommand(target, row)) return null;

  const argsText = match[3]!;
  const leadingWhitespace = argsText.match(/^\s*/)?.[0] ?? "";
  const args = argsText.slice(leadingWhitespace.length);
  const endsWithWhitespace = args.length === 0 || /\s$/.test(argsText);
  const tokens = args.trim().length === 0 ? [] : args.trim().split(/\s+/);
  const argumentIndex = endsWithWhitespace ? tokens.length : tokens.length - 1;
  const prefix = endsWithWhitespace ? "" : tokens[tokens.length - 1]!;
  if (row.keyArgument === "none") return null;
  const acceptsArgument =
    row.keyArgument === "variadic-any"
      ? argumentIndex >= 0
      : argumentIndex === 0;
  if (!acceptsArgument) return null;

  return {
    row,
    fromOffset: beforeCursor.length - prefix.length,
    prefix,
  };
}

function commandRow(name: string): RedisCommandCoreRow | null {
  const rows = getRedisCommandRows();
  if (rows === null) return null;
  return rows.find((row) => row.name === name) ?? null;
}

function keyMatchesCommand(
  row: RedisCommandCoreRow,
  keyType: KvKeyType,
): boolean {
  if (row.keyArgument === "none") return false;
  if (row.keyArgument === "any" || row.keyArgument === "variadic-any") {
    return true;
  }
  return row.keyTypes.includes(keyType);
}

function commandCompletionsForTarget(
  target: RedisCommandCompletionTarget,
): readonly RedisCommandCompletionSpec[] {
  return target === "valkey"
    ? getValkeyCommandCompletions()
    : getRedisCommandCompletions();
}

function targetSupportsCommand(
  target: RedisCommandCompletionTarget,
  row: RedisCommandCoreRow,
): boolean {
  return target === "valkey" ? row.valkeyProven : true;
}

function targetLabel(target: RedisCommandCompletionTarget): string {
  return target === "valkey" ? "Valkey" : "Redis";
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
