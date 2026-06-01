import type { DatabaseType } from "@/types/connection";

export type MysqlScriptingFeature =
  | "DELIMITER"
  | "LOAD DATA"
  | "STORED ROUTINE"
  | "CONTROL FLOW";

export interface MysqlScriptingBoundaryViolation {
  feature: MysqlScriptingFeature;
  statementIndex: number;
  message: string;
}

const MESSAGES: Record<MysqlScriptingFeature, string> = {
  DELIMITER:
    "DELIMITER is a mysql-client directive and is not supported in the query editor. Submit a single server SQL statement without DELIMITER; stored routine body parsing is not implemented.",
  "LOAD DATA":
    "LOAD DATA is not supported in the query editor. Use an external MySQL client or import workflow; this app does not provide an explicit file-import confirmation path yet.",
  "STORED ROUTINE":
    "MySQL stored routine and event bodies are not supported in the query editor. Use a dedicated MySQL client for CREATE PROCEDURE, CREATE FUNCTION, or CREATE EVENT scripts.",
  "CONTROL FLOW":
    "MySQL routine control-flow scripting is not supported in the query editor. Submit a single server SQL statement without IF/LOOP routine-body fragments.",
};

export function isMysqlFamilyDbType(
  dbType: DatabaseType | null | undefined,
): boolean {
  return dbType === "mysql" || dbType === "mariadb";
}

export function findMysqlScriptingBoundaryViolation(
  statements: readonly string[],
  dbType: DatabaseType | null | undefined,
): MysqlScriptingBoundaryViolation | null {
  if (!isMysqlFamilyDbType(dbType)) return null;

  for (const [index, statement] of statements.entries()) {
    const feature = mysqlScriptingFeature(statement);
    if (!feature) continue;
    return {
      feature,
      statementIndex: index,
      message: MESSAGES[feature],
    };
  }

  return null;
}

function mysqlScriptingFeature(sql: string): MysqlScriptingFeature | null {
  const executableCommentFeature = leadingExecutableCommentFeature(sql);
  if (executableCommentFeature) return executableCommentFeature;

  const words = leadingSqlWords(sql, 2);
  if (words[0] === "DELIMITER") return "DELIMITER";
  if (words[0] === "LOAD" && words[1] === "DATA") return "LOAD DATA";
  if (words[0] === "CREATE" && isStoredRoutineCreateTarget(words[1])) {
    return "STORED ROUTINE";
  }
  if (isRoutineControlFlowWord(words[0])) return "CONTROL FLOW";
  return null;
}

function leadingExecutableCommentFeature(
  sql: string,
): MysqlScriptingFeature | null {
  let index = 0;

  while (index < sql.length) {
    while (index < sql.length && /\s/.test(sql[index]!)) {
      index += 1;
    }

    if (sql.startsWith("--", index)) {
      const newline = sql.indexOf("\n", index + 2);
      if (newline === -1) return null;
      index = newline + 1;
      continue;
    }

    if (sql[index] === "#") {
      const newline = sql.indexOf("\n", index + 1);
      if (newline === -1) return null;
      index = newline + 1;
      continue;
    }

    if (sql.startsWith("/*", index)) {
      const close = sql.indexOf("*/", index + 2);
      const executableBodyStart = executableCommentBodyStart(sql, index);
      if (executableBodyStart !== null) {
        let bodyStart = executableBodyStart;
        while (bodyStart < sql.length && /[0-9]/.test(sql[bodyStart]!)) {
          bodyStart += 1;
        }
        const bodyEnd = close === -1 ? sql.length : close;
        const feature = mysqlScriptingFeature(sql.slice(bodyStart, bodyEnd));
        if (feature) return feature;
      }
      if (close === -1) return null;
      index = close + 2;
      continue;
    }

    break;
  }

  return null;
}

function leadingSqlWords(sql: string, limit: number): string[] {
  const words: string[] = [];
  let index = 0;

  while (words.length < limit) {
    index = skipWhitespaceAndComments(sql, index);
    if (index >= sql.length) break;

    const first = sql.charCodeAt(index);
    if (!isWordStart(first)) break;

    const start = index;
    index += 1;
    while (index < sql.length && isWordContinue(sql.charCodeAt(index))) {
      index += 1;
    }
    words.push(sql.slice(start, index).toUpperCase());
  }

  return words;
}

function skipWhitespaceAndComments(sql: string, start: number): number {
  let index = start;

  while (index < sql.length) {
    while (index < sql.length && /\s/.test(sql[index]!)) {
      index += 1;
    }

    if (sql.startsWith("--", index)) {
      const newline = sql.indexOf("\n", index + 2);
      if (newline === -1) return sql.length;
      index = newline + 1;
      continue;
    }

    if (sql[index] === "#") {
      const newline = sql.indexOf("\n", index + 1);
      if (newline === -1) return sql.length;
      index = newline + 1;
      continue;
    }

    if (sql.startsWith("/*", index)) {
      const close = sql.indexOf("*/", index + 2);
      if (close === -1) return sql.length;
      index = close + 2;
      continue;
    }

    break;
  }

  return index;
}

function executableCommentBodyStart(sql: string, index: number): number | null {
  if (sql.startsWith("/*!", index)) return index + 3;
  if (sql.startsWith("/*M!", index) || sql.startsWith("/*m!", index)) {
    return index + 4;
  }
  return null;
}

function isWordStart(charCode: number): boolean {
  return (
    (charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122)
  );
}

function isWordContinue(charCode: number): boolean {
  return (
    isWordStart(charCode) ||
    (charCode >= 48 && charCode <= 57) ||
    charCode === 95
  );
}

function isStoredRoutineCreateTarget(word: string | undefined): boolean {
  return word === "PROCEDURE" || word === "FUNCTION" || word === "EVENT";
}

function isRoutineControlFlowWord(word: string | undefined): boolean {
  return (
    word === "DECLARE" ||
    word === "IF" ||
    word === "ELSEIF" ||
    word === "ELSE" ||
    word === "WHILE" ||
    word === "LOOP" ||
    word === "REPEAT" ||
    word === "CASE" ||
    word === "LEAVE" ||
    word === "ITERATE" ||
    word === "RETURN" ||
    word === "SIGNAL" ||
    word === "RESIGNAL" ||
    word === "END"
  );
}
