// AC-144-3 — (paradigm, db_type) → completion module resolver.
//
// Throws `CompletionPairingError` when a paradigm is wired to an
// incompatible db_type (e.g. `rdb` × `mongodb`). The TS literal types of
// each module's `dbType` already prevent the mismatch at compile time, but
// the runtime guard exists for defence in depth.

import type { Paradigm, DatabaseType } from "@/types/connection";
import { CompletionPairingError } from "./shared";
import * as pg from "./pg";
import * as mysql from "./mysql";
import * as sqlite from "./sqlite";
import * as mongo from "./mongo";

export { CompletionPairingError };

export interface ResolvedPgModule {
  readonly dbType: "postgresql";
  readonly keywords: readonly string[];
  readonly createSource: typeof pg.createCompletionSource;
}

export interface ResolvedMysqlModule {
  readonly dbType: "mysql";
  readonly keywords: readonly string[];
  readonly createSource: typeof mysql.createCompletionSource;
}

export interface ResolvedSqliteModule {
  readonly dbType: "sqlite";
  readonly keywords: readonly string[];
  readonly createSource: typeof sqlite.createCompletionSource;
}

export interface ResolvedMongoModule {
  readonly dbType: "mongodb";
  readonly keywords: readonly string[];
  readonly createDbMethodSource: typeof mongo.createDbMethodCompletionSource;
  readonly createMongoSource: typeof mongo.createMongoCompletionSource;
}

export type ResolvedCompletionModule =
  | ResolvedPgModule
  | ResolvedMysqlModule
  | ResolvedSqliteModule
  | ResolvedMongoModule;

/**
 * Map a (paradigm, db_type) pair to its completion module. Throws
 * `CompletionPairingError` when the pair is incompatible. Compatible pairs:
 *  - `("rdb", "postgresql")` → pg
 *  - `("rdb", "mysql")` → mysql
 *  - `("rdb", "sqlite")` → sqlite
 *  - `("document", "mongodb")` → mongo
 *
 * Every other combination — `("rdb", "mongodb")`, `("document", "mysql")`,
 * `("kv", *)`, `("search", *)`, etc. — throws. Keyed callers (Redis) and
 * search paradigms have no completion module yet; throwing keeps the
 * invariant explicit.
 */
export function selectCompletionModule(
  paradigm: Paradigm,
  dbType: DatabaseType,
): ResolvedCompletionModule {
  if (paradigm === "rdb") {
    if (dbType === "postgresql") {
      return {
        dbType: "postgresql",
        keywords: pg.keywords,
        createSource: pg.createCompletionSource,
      };
    }
    if (dbType === "mysql") {
      return {
        dbType: "mysql",
        keywords: mysql.keywords,
        createSource: mysql.createCompletionSource,
      };
    }
    if (dbType === "sqlite") {
      return {
        dbType: "sqlite",
        keywords: sqlite.keywords,
        createSource: sqlite.createCompletionSource,
      };
    }
    throw new CompletionPairingError(paradigm, dbType);
  }

  if (paradigm === "document") {
    if (dbType === "mongodb") {
      return {
        dbType: "mongodb",
        keywords: [],
        createDbMethodSource: mongo.createDbMethodCompletionSource,
        createMongoSource: mongo.createMongoCompletionSource,
      };
    }
    throw new CompletionPairingError(paradigm, dbType);
  }

  // No "kv" / "search" completion modules in Sprint 145 — explicit throw.
  throw new CompletionPairingError(paradigm, dbType);
}
