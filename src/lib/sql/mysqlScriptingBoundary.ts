import type { DatabaseType } from "@/types/connection";

export type MysqlScriptingFeature =
  | "DELIMITER"
  | "LOAD DATA"
  | "STORED ROUTINE"
  | "CONTROL FLOW"
  | "CALL";

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
  CALL: "MySQL-family CALL support is limited to a narrow routine name plus scalar literal, DEFAULT, NULL, boolean, or user-variable arguments. Function calls, expressions, subqueries, system variables, and routine body authoring are not supported in the query editor.",
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
  if (words[0] === "CALL" && !isNarrowCallStatement(sql)) return "CALL";
  return null;
}

function isNarrowCallStatement(sql: string): boolean {
  const keyword = readWord(sql, skipWhitespaceAndComments(sql, 0));
  if (!keyword || keyword.word.toUpperCase() !== "CALL") return true;

  let index = skipWhitespaceAndComments(sql, keyword.end);
  const name = readRoutineName(sql, index);
  if (!name) return false;
  index = skipWhitespaceAndComments(sql, name.end);

  if (sql[index] !== "(") return false;
  const args = readCallArguments(sql, index + 1);
  if (!args) return false;

  index = skipWhitespaceAndComments(sql, args.end);
  if (sql[index] === ";") {
    index = skipWhitespaceAndComments(sql, index + 1);
  }

  return index >= sql.length;
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

    const word = readWord(sql, index);
    if (!word) break;
    index = word.end;
    words.push(word.word.toUpperCase());
  }

  return words;
}

function readWord(
  sql: string,
  start: number,
): { word: string; end: number } | null {
  const first = sql.charCodeAt(start);
  if (!isWordStart(first)) return null;

  let index = start + 1;
  while (index < sql.length && isWordContinue(sql.charCodeAt(index))) {
    index += 1;
  }
  return { word: sql.slice(start, index), end: index };
}

function readRoutineName(sql: string, start: number): { end: number } | null {
  let index = start;
  let segmentCount = 0;

  while (true) {
    const segment = readIdentifierSegment(sql, index);
    if (!segment) return segmentCount > 0 ? { end: index } : null;

    index = skipWhitespaceAndComments(sql, segment.end);
    segmentCount += 1;

    if (sql[index] !== ".") return { end: index };
    index = skipWhitespaceAndComments(sql, index + 1);
  }
}

function readIdentifierSegment(
  sql: string,
  start: number,
): { end: number } | null {
  if (sql[start] === "`") {
    let index = start + 1;
    while (index < sql.length) {
      if (sql[index] === "`") {
        if (sql[index + 1] === "`") {
          index += 2;
          continue;
        }
        return { end: index + 1 };
      }
      index += 1;
    }
    return null;
  }

  const word = readWord(sql, start);
  return word ? { end: word.end } : null;
}

function readCallArguments(sql: string, start: number): { end: number } | null {
  let index = skipWhitespaceAndComments(sql, start);
  if (sql[index] === ")") return { end: index + 1 };

  while (index < sql.length) {
    const argStart = index;
    let quoted = false;

    while (index < sql.length) {
      const char = sql[index]!;
      if (char === "'" || char === '"') {
        index = skipQuotedString(sql, index, char);
        if (index > sql.length) return null;
        quoted = true;
        continue;
      }
      if (char === "`") {
        index = skipBacktickIdentifier(sql, index);
        if (index > sql.length) return null;
        continue;
      }
      if (char === "," || char === ")") break;
      index += 1;
    }

    const arg = sql.slice(argStart, index).trim();
    if (!isNarrowCallArgument(arg, quoted)) return null;

    if (sql[index] === ",") {
      index = skipWhitespaceAndComments(sql, index + 1);
      if (sql[index] === ")") return null;
      continue;
    }
    if (sql[index] === ")") return { end: index + 1 };
    return null;
  }

  return null;
}

function skipQuotedString(sql: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === "\\") {
      index += 2;
      continue;
    }
    if (sql[index] === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return sql.length + 1;
}

function skipBacktickIdentifier(sql: string, start: number): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === "`") {
      if (sql[index + 1] === "`") {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return sql.length + 1;
}

function isNarrowCallArgument(arg: string, quoted: boolean): boolean {
  if (!arg) return false;
  if (quoted) return isSingleQuotedScalar(arg) || isDoubleQuotedScalar(arg);
  if (/^(DEFAULT|NULL|TRUE|FALSE)$/i.test(arg)) return true;
  if (/^@[A-Za-z_][A-Za-z0-9_]*$/.test(arg)) return true;
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(arg);
}

function isSingleQuotedScalar(arg: string): boolean {
  return arg.startsWith("'") && skipQuotedString(arg, 0, "'") === arg.length;
}

function isDoubleQuotedScalar(arg: string): boolean {
  return arg.startsWith('"') && skipQuotedString(arg, 0, '"') === arg.length;
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
