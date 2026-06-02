import { useEffect, useMemo, useState } from "react";
import { parseRedisDatabaseIndex } from "@lib/redis/redisDatabase";
import { scanKvKeys } from "@lib/tauri/kv";
import type { KvKeyMetadata } from "@/types/kv";

export const REDIS_KEY_SUGGESTION_SCAN_LIMIT = 100;

export type RedisKeySuggestionStatus = "idle" | "loading" | "ready" | "error";

export interface UseRedisKeySuggestionsArgs {
  connectionId: string;
  database: string | undefined;
  enabled: boolean;
}

export interface RedisKeySuggestionState {
  keySuggestions: readonly KvKeyMetadata[];
  status: RedisKeySuggestionStatus;
  error: string | null;
}

export function useRedisKeySuggestions({
  connectionId,
  database,
  enabled,
}: UseRedisKeySuggestionsArgs): RedisKeySuggestionState {
  const parsedDatabase = useMemo(() => {
    try {
      return {
        database: parseRedisDatabaseIndex(database),
        error: null as string | null,
      };
    } catch (err) {
      return {
        database: undefined,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [database]);
  const [state, setState] = useState<RedisKeySuggestionState>({
    keySuggestions: [],
    status: enabled ? "loading" : "idle",
    error: null,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ keySuggestions: [], status: "idle", error: null });
      return;
    }
    if (parsedDatabase.error) {
      setState({
        keySuggestions: [],
        status: "error",
        error: parsedDatabase.error,
      });
      return;
    }

    let cancelled = false;
    setState({ keySuggestions: [], status: "loading", error: null });

    void scanKvKeys(connectionId, {
      database: parsedDatabase.database,
      cursor: "0",
      pattern: "*",
      limit: REDIS_KEY_SUGGESTION_SCAN_LIMIT,
    })
      .then((page) => {
        if (cancelled) return;
        setState({
          keySuggestions: page.keys,
          status: "ready",
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          keySuggestions: [],
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [connectionId, enabled, parsedDatabase.database, parsedDatabase.error]);

  return state;
}
