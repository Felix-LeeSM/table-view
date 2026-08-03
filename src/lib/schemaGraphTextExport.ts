// SchemaGraph → 텍스트 ERD export (issue #1661, ADR 0054 세부 결정 5).
// mermaid `erDiagram` 과 DBML 은 텍스트라 diff 가 되고 문서에 그대로 붙는다.
// SVG / PNG 래스터와 UI 배선은 이 모듈 밖이다 (#1655 캔버스 교체 이후 2차).
//
// 순수 모듈: React / IPC / IO 없음. 관계의 SOT 는 SchemaGraph 의
// `foreign-key-table` edge 하나뿐이라 (`selectSchemaGraphForeignKeys`),
// 컬럼 플래그를 여기서 다시 해석하지 않는다 — 그래야 attribute 의 FK 표시와
// 관계선이 갈라지지 않는다. 가상 FK (#1659) 는 미배송이라 범위 밖이고,
// SQLite 처럼 제약 카탈로그가 없어 컬럼 플래그에서 합성된 FK 는 그래프가 이미
// 실제 edge 로 만들어 두므로 그대로 실린다.
//
// **이 파일에 추측으로 쓴 문법 단정은 없다.** 근거는 두 종류고 어느 쪽인지
// 상수마다 밝혀 뒀다: mermaid attribute 정리는 고정한 `mermaid@11.16.0` 의 렉서
// 규칙을 옮겨 적은 것(`mermaidWord` 위 주석)이고, 나머지 — 따옴표 문자열이
// 거부하는 문자, DBML 의 escape 부재 — 는 파서로 잰 값이다. `mermaid` 와
// `@dbml/core` 가 devDependency 로 들어와 있고 `schemaGraphTextExport.test.ts` 의
// "exporter output parses with the real parsers" 가 이 모듈의 산출물을
// `mermaid.parse()` / `Parser.parse(…, "dbml")` 에 그대로 먹인다. 문자 클래스나
// fallback 을 건드리면 그 왕복·스윕 테스트로 다시 재라 — 추측으로 고친 이스케이프가
// 두 라운드 연속 blocking 이었다 (#2097 라운드 1·2).
import type {
  SchemaGraph,
  SchemaGraphCatalogSnapshot,
  SchemaGraphColumnNode,
  SchemaGraphForeignKeyEndpoint,
  SchemaGraphTableNode,
} from "@/types/schemaGraph";
import { extractSchemaGraph } from "./schemaGraph";
import {
  selectSchemaGraphForeignKeys,
  selectSchemaGraphNodeMaps,
} from "./schemaGraphSelectors";
import type { SchemaGraphForeignKeySelection } from "./schemaGraphSelectorTypes";
import { schemaGraphTableId, sortById } from "./schemaGraphSupport";

export type SchemaGraphTextExportInput =
  | SchemaGraph
  | SchemaGraphCatalogSnapshot;

/**
 * SchemaGraph 를 mermaid `erDiagram` 텍스트로 만든다. 엔티티 이름은
 * `"schema.table"` 로 스키마 수식하고, 컬럼은 `type name PK, FK` 형태로 적는다.
 * 관계선의 부모쪽 기수는 FK 소스 컬럼이 하나라도 nullable 이면 `|o`(0 또는 1),
 * 전부 NOT NULL 이면 `||`(정확히 1) 다 — SQL MATCH SIMPLE 에서 소스 컬럼 중
 * 하나라도 NULL 이면 FK 가 검사되지 않기 때문이다.
 *
 * 컬럼이 아직 안 올라온 테이블은 빈 엔티티 블록으로 남는다 — mermaid 는 빈
 * 블록을 받는다(왕복 테스트 실측). 같은 상황에서 DBML 은 블록을 못 받아
 * `schemaGraphToDbml` 이 다르게 처리한다.
 */
export function schemaGraphToMermaid(
  input: SchemaGraphTextExportInput,
): string {
  const model = toExportModel(input);
  const lines: string[] = ["erDiagram"];
  // 정리를 거치면 서로 다른 원본이 같은 문자열이 될 수 있다(`a@b` 와 `a$b` 는 둘 다
  // `a_b`). mermaid 는 중복 엔티티·attribute 를 파싱은 하지만, 그러면 두 테이블이 한
  // 엔티티로 합쳐지고 컬럼 둘이 한 줄로 보인다 — DBML 쪽과 같은 규칙으로 가른다.
  const takenEntityNames = new Set<string>();
  const entityNameByTableId = new Map<string, string>();

  for (const { node, columns } of model.tables) {
    const entity = takeUniqueName(takenEntityNames, mermaidEntityName(node));
    entityNameByTableId.set(node.id, entity);
    lines.push(`    "${entity}" {`);

    const takenColumnNames = new Set<string>();
    for (const column of columns) {
      const keys: string[] = [];
      if (column.data.is_primary_key) keys.push("PK");
      if (model.foreignKeyColumnIds.has(column.id)) keys.push("FK");
      const suffix = keys.length > 0 ? ` ${keys.join(", ")}` : "";
      const name = takeUniqueName(takenColumnNames, mermaidWord(column.column));
      lines.push(
        `        ${mermaidWord(column.data.data_type)} ${name}${suffix}`,
      );
    }
    lines.push("    }");
  }

  for (const foreignKey of model.foreignKeys) {
    const source = entityNameByTableId.get(foreignKey.sourceTableId);
    const target = entityNameByTableId.get(foreignKey.targetTableId);
    // 양끝 테이블이 실제로 인쇄됐을 때만 선을 긋는다. 스냅샷 입력에서는 그래프가
    // 이미 걸러 주지만 `SchemaGraph` 직접 주입은 이 모듈의 공개 입력이다.
    if (!source || !target) continue;
    const parentSide = isOptionalForeignKey(model, foreignKey) ? "|o" : "||";
    lines.push(
      `    "${source}" }o--${parentSide} "${target}" : ${mermaidQuoted(
        foreignKey.relationship.rawMetadata.constraintName,
      )}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

/**
 * SchemaGraph 를 DBML 텍스트로 만든다. 테이블 블록을 먼저, `Ref:` 줄을 뒤에
 * 모아 적는다 — dbdiagram.io 가 참조 대상 테이블을 앞에서 요구하지 않으므로
 * 순서는 diff 가독성 기준으로 고정한다. 그래프가 비면 빈 문자열이다.
 *
 * 컬럼이 하나도 없는 테이블은 블록 대신 `//` 주석 한 줄로 남기고, 그 테이블에
 * 걸린 `Ref:` 도 함께 뺀다. 근거는 `dbmlSkipsColumnlessTable` 주석에 있다.
 */
export function schemaGraphToDbml(input: SchemaGraphTextExportInput): string {
  const model = toExportModel(input);
  const blocks: string[] = [];
  const declared = new Map<string, DeclaredDbmlTable>();
  const tableNamesBySchema = new Map<string, Set<string>>();

  for (const { node, columns } of model.tables) {
    if (columns.length === 0) {
      blocks.push(dbmlSkipsColumnlessTable(node));
      continue;
    }
    const schema = dbmlIdentifier(node.schema);
    const takenTables = tableNamesBySchema.get(schema) ?? new Set<string>();
    tableNamesBySchema.set(schema, takenTables);
    const table = takeUniqueName(takenTables, dbmlIdentifier(node.table));
    const takenColumns = new Set<string>();
    const columnNames = new Map<string, string>();

    const body = columns.map((column) => {
      const name = takeUniqueName(takenColumns, dbmlIdentifier(column.column));
      columnNames.set(column.column, name);
      const settings: string[] = [];
      if (column.data.is_primary_key) settings.push("pk");
      if (!column.data.nullable) settings.push("not null");
      const suffix = settings.length > 0 ? ` [${settings.join(", ")}]` : "";
      return `  "${name}" ${dbmlType(column.data.data_type)}${suffix}`;
    });

    declared.set(node.id, { schema, table, columnNames });
    blocks.push([`Table "${schema}"."${table}" {`, ...body, "}"].join("\n"));
  }

  // 선언되지 않은 테이블·컬럼을 가리키는 `Ref:` 는 파서가 문서 전체를 거부한다
  // (실측: `Can't find field "x" in table "t"`). 위에서 실제로 인쇄한 이름만
  // 통과시키므로, 생략된 테이블 · 그래프에 없는 테이블 · 카탈로그가 안 준 컬럼이
  // 한 판정으로 걸린다.
  const refLines = model.foreignKeys.map((foreignKey) =>
    dbmlRefLine(declared, foreignKey),
  );
  // 완전히 같은 `Ref:` 두 줄도 파서가 거부한다(실측). 같은 컬럼쌍에 이름만 다른
  // FK 제약이 둘 있으면 이 모듈은 제약 이름을 안 실으므로 두 줄이 바이트 단위로
  // 같아진다 — 중복을 접는다.
  const refs = [...new Set(refLines.filter((line) => line !== null))];
  if (refs.length > 0) blocks.push(refs.join("\n"));

  const omitted = refLines.filter((line) => line === null).length;
  if (omitted > 0) {
    // 생략된 테이블 주석은 테이블만 알린다 — 같이 사라진 관계도 세어 둔다.
    blocks.push(
      `// omitted ${omitted} reference(s) to tables or columns that are not declared above`,
    );
  }

  return blocks.length > 0 ? `${blocks.join("\n\n")}\n` : "";
}

interface DeclaredDbmlTable {
  readonly schema: string;
  readonly table: string;
  /** 카탈로그 원본 컬럼명 → 실제로 인쇄한 이름. `Ref:` 가 이 표를 통해서만 쓴다. */
  readonly columnNames: ReadonlyMap<string, string>;
}

// 한 스코프 안에서 이름이 겹치면 파서가 문서를 통째로 거부한다 — 실측:
// `Field "a" existed in table "t"`, `Table "t" existed`. 정리 과정에서 서로 다른
// 원본이 같은 문자열로 접힐 수 있으므로(예: `a"b` 와 `a_b`) 접미사로 가른다.
function takeUniqueName(taken: Set<string>, candidate: string): string {
  let name = candidate;
  for (let suffix = 2; taken.has(name); suffix += 1) {
    name = `${candidate}_${suffix}`;
  }
  taken.add(name);
  return name;
}

function dbmlRefLine(
  declared: ReadonlyMap<string, DeclaredDbmlTable>,
  foreignKey: SchemaGraphForeignKeySelection,
): string | null {
  const source = dbmlEndpoint(declared, foreignKey.relationship.source);
  const target = dbmlEndpoint(declared, foreignKey.relationship.target);
  return source && target ? `Ref: ${source} > ${target}` : null;
}

// DBML 은 본문 없는 `Table` 블록을 파싱하지 못한다 — `@dbml/core` 가
// `Expected comment, valid name, or whitespace but "}" found` 로 거부하고,
// DBML 은 블록 하나가 깨지면 문서 전체가 무효라 테이블 하나 때문에 export 결과가
// 통째로 못 쓰게 된다 (라운드 1 blocking ①).
//
// 컬럼 0개는 예외 상태가 아니다. 카탈로그는 테이블 목록을 먼저 싣고 컬럼을 마운트
// 뒤 비동기로 채우므로(`schemaGraphCatalog.ts` 의 `?? []`), 로딩 중 export 는
// 흔한 경로다. 컬럼을 지어내지 않고 생략 사실만 주석으로 남긴다 — 주석은 DBML 이
// 최상위에서 받는 문법이다. Postgres 처럼 컬럼 0개 테이블을 실제로 허용하는
// 엔진도 있어 문구는 원인을 단정하지 않는다.
function dbmlSkipsColumnlessTable(node: SchemaGraphTableNode): string {
  return `// skipped table ${dbmlTableName(node)}: no columns available`;
}

interface ExportTable {
  readonly node: SchemaGraphTableNode;
  readonly columns: readonly SchemaGraphColumnNode[];
}

interface ExportModel {
  readonly tables: readonly ExportTable[];
  readonly tablesById: ReadonlyMap<string, SchemaGraphTableNode>;
  readonly columnsById: ReadonlyMap<string, SchemaGraphColumnNode>;
  readonly foreignKeys: readonly SchemaGraphForeignKeySelection[];
  readonly foreignKeyColumnIds: ReadonlySet<string>;
}

function toExportModel(input: SchemaGraphTextExportInput): ExportModel {
  // 무거운 `selectSchemaGraphIntelligence` 대신 필요한 selector 둘만 부른다 —
  // 그쪽도 그래프를 한 번만 펴지만, 이 모듈이 안 읽는 diagnostics 색인과 테이블별
  // metadata readiness 두 패스를 더 돈다.
  // ponytail: `"nodes" in input` 은 `schemaGraphSelectors` 의 비공개
  // `isCatalogSnapshot` 을 반대 키로 다시 판별하는 것이다 — 셋째 선언이 나온
  // 지금(같은 union 이 selectors · diff · 여기) 판별과 타입을 한쪽에서 export 해
  // 모으는 편이 낫고, 그건 이 PR 밖 파일을 건드린다.
  const graph: SchemaGraph =
    "nodes" in input ? input : extractSchemaGraph(input);
  const nodeMaps = selectSchemaGraphNodeMaps(graph);
  const { tablesById, columnsById, columnsByTableId } = nodeMaps;
  const { foreignKeys } = selectSchemaGraphForeignKeys(graph, nodeMaps);

  return {
    tables: sortById([...tablesById.values()]).map((node) => ({
      node,
      // 그래프의 컬럼 맵은 id(퍼센트 인코딩된 이름) 정렬이라 특이한 이름이
      // 재배열된다. 그래프가 스스로 매기는 `ordinal` 을 따른다 — 그 값이
      // `sortByName` **뒤**의 인덱스라(`schemaGraph.ts`) 결과는 DDL 물리 순서가
      // 아니라 컬럼 이름 알파벳순이다. 이 계층이 물리 순서를 복원할 방법은 없다.
      columns: [...(columnsByTableId.get(node.id) ?? [])].sort(
        (left, right) => left.ordinal - right.ordinal,
      ),
    })),
    tablesById,
    columnsById,
    foreignKeys,
    foreignKeyColumnIds: new Set(
      foreignKeys.flatMap((foreignKey) => foreignKey.sourceColumnIds),
    ),
  };
}

function isOptionalForeignKey(
  model: ExportModel,
  foreignKey: SchemaGraphForeignKeySelection,
): boolean {
  // 컬럼 노드를 못 찾으면 optional 로 본다 — nullability 를 모르는 상태에서
  // `||`(정확히 1) 는 없는 제약을 있다고 그리는 쪽이라 더 나쁜 거짓말이다.
  return foreignKey.sourceColumnIds.some(
    (columnId) => model.columnsById.get(columnId)?.data.nullable ?? true,
  );
}

function mermaidEntityName(node: SchemaGraphTableNode): string {
  // 스키마와 테이블을 각각 정리한 뒤 잇는다 — 이어 붙인 뒤 다듬으면 `public. tbl`
  // 처럼 안쪽 공백이 그대로 남는다.
  return `${mermaidSafeText(node.schema)}.${mermaidSafeText(node.table)}`;
}

// 엔티티 이름과 관계선 라벨은 따옴표 문자열 토큰이라 attribute 와 사정이 다르다.
// 렉서 규칙이 `/^(?:"[^"]*")/i` — 구분자 `"` 하나만 토큰을 끝내고 그 안은 무엇이든
// 받는다. 그래서 여기는 "위험 문자가 몇 개나 더 있나"(attribute 를 네 라운드 돌린
// 열린 질문)가 아니라 **구분자 하나 + 렉싱 전에 도는 전처리**로 닫힌다:
// `%` 는 주석(`%%`), `\` 는 전처리에서 걸리고 제어문자는 줄을 끊는다 — 셋 다 파서로
// 잰 값이고 스윕이 다섯 자리에서 매 실행 다시 잰다. Postgres 는 따옴표 식별자 안에서
// 셋 다 허용하므로 사용자 데이터로 도달한다.
// ponytail: 그래서 라벨은 `numeric(10,2)` 같은 원문을 그대로 유지한다 — attribute
// 처럼 문법 부분집합으로 좁힐 이유가 없다. `a"b` · `a%b` · `a\b` 만 한 이름으로
// 접히고, 구분이 필요해지면 별칭(`entity["label"]`) 표기로 올린다.
const MERMAID_STRING_REJECTS = /["%\\]/g;
const CONTROL_OR_SPACE = /[\p{Cc}\p{Cf}\s]+/gu;

function mermaidQuoted(value: string): string {
  return `"${mermaidSafeText(value)}"`;
}

function mermaidSafeText(value: string): string {
  const safe = value
    .replace(CONTROL_OR_SPACE, " ")
    .replace(MERMAID_STRING_REJECTS, "_")
    .trim();
  // 토큰은 최소 1자를 요구한다 — 빈 따옴표는 Parse error 다.
  return safe.length > 0 ? safe : "unnamed";
}

// mermaid 의 attribute 는 따옴표를 못 쓰는 단어 토큰이다. 아래 셋은 이 PR 이
// 고정한 `mermaid@11.16.0` 의 erDiagram 렉서 규칙을 **그대로 옮긴 것**이지
// 실측으로 고른 목록이 아니다. 원본은 그 패키지의
// `dist/chunks/mermaid.esm/erDiagram-*.mjs` 안 lexer `rules` 배열이고, attribute
// 자리에서 우리 산출물에 닿을 수 있는 규칙은 둘뿐이다:
//
//   ATTRIBUTE_KEY   /^(?:\b((?:PK)|(?:FK)|(?:UK))\b)/i
//   ATTRIBUTE_WORD  /^(?:([*A-Za-z_\u00C0-\uFFFF][A-Za-z0-9\-_[\]().,\u00C0-\uFFFF*]*))/i
//
// (그 사이의 `([^\s]*)[~].*[~]([^\s]*)` 는 `~` 를 요구하는데 `~` 는 아래에서
// 내려가므로 절대 안 맞는다.)
//
// **위험 문자를 열거해 빼는 방식은 폐기했다.** 그 구조는 반례가 나올 때마다
// 목록에 한 줄을 더하는 열린 집합이라 #2097 에서 네 라운드 연속 반례가 나왔다.
// 대신 산출 토큰을 위 두 규칙이 받는 언어의 부분집합으로 **구성으로** 가둔다 —
// 남는 질문이 "이 문자가 위험한가"(끝이 없다)에서 "문법 클래스를 옮겨 적었나"
// (파일 하나를 보면 끝난다)로 바뀐다.
//
// ponytail: 라벨은 뭉개진다 — `numeric(10,2)` 가 `numeric_10_2_`, `a@b` 와 `a$b`
// 가 둘 다 `a_b` 다. 산출물이 무효가 되느니 라벨을 잃는 쪽을 택한 오너 결정이고
// (2026-08-02, PR #2097), 원문 보존은 본가의 backtick 표기
// (mermaid-js/mermaid#5138)가 머지되면 다시 연다.

// ATTRIBUTE_WORD 의 tail 클래스에서 구분자(`- . , ( ) [ ] *`)를 뺀 나머지.
// 구분자는 문법상 합법이지만 렉서가 ATTRIBUTE_KEY 를 먼저 시도하므로 `pk-a` 처럼
// 앞머리가 예약어면 토큰이 쪼개져 문서 전체가 깨진다 (라운드 4 blocking ⑥).
// `u` 플래그를 일부러 안 붙인다 — 문법이 코드유닛 범위(`\u00C0-\uFFFF`)로 쓰여
// 있어서, 그래야 astral 문자를 surrogate 쌍째로 렉서와 똑같이 통과시킨다.
const MERMAID_WORD_REJECTS = /[^A-Za-z0-9_\u00C0-\uFFFF]/g;
// ATTRIBUTE_WORD 의 head 클래스에서 `*`(위에서 이미 내려감)를 뺀 것. 위 치환을
// 거친 토큰 중 여기 안 걸리는 것은 숫자로 시작하는 토큰뿐이다.
const MERMAID_WORD_HEAD = /^[A-Za-z_\u00C0-\uFFFF]/;
// ATTRIBUTE_KEY 규칙 그대로. `\b` 는 ASCII 단어 경계라 토큰이 그 낱말**로 시작만
// 해도** 뒤 문자가 `[A-Za-z0-9_]` 가 아니면 키 표시자로 떨어져 나간다 —
// `pk`(단독)·`pk이름`·`pḱ` 전부 여기 걸리고, `pka`·`pk_`·`pk1` 은 안 걸린다.
// 완전 일치(`^(pk|fk|uk)$`)로 보던 라운드 4 코드가 앞의 둘을 통과시켰다.
const MERMAID_RESERVED_WORDS = /^(?:PK|FK|UK)\b/i;

function mermaidWord(value: string): string {
  // 공백만 있는 타입/이름은 `_` 로 채우지 말고 placeholder 로 보낸다 —
  // `dbmlType` 의 빈 값 처리와 같은 기준이다.
  const cleaned = value.trim().replace(MERMAID_WORD_REJECTS, "_");
  if (cleaned.length === 0) return "unknown";
  // 선두 `_` 하나가 두 보정을 동시에 끝낸다: ATTRIBUTE_KEY 의 `\b(PK|FK|UK)\b` 가
  // 더 이상 안 맞고, `_` 자체가 head 클래스 안이다.
  if (MERMAID_RESERVED_WORDS.test(cleaned)) return `_${cleaned}`;
  return MERMAID_WORD_HEAD.test(cleaned) ? cleaned : `_${cleaned}`;
}

function dbmlTableName(node: SchemaGraphTableNode): string {
  return `${dbmlQuoted(node.schema)}.${dbmlQuoted(node.table)}`;
}

function endpointTableId(endpoint: SchemaGraphForeignKeyEndpoint): string {
  return schemaGraphTableId(endpoint.schema, endpoint.table);
}

function dbmlEndpoint(
  declared: ReadonlyMap<string, DeclaredDbmlTable>,
  endpoint: SchemaGraphForeignKeyEndpoint,
): string | null {
  const table = declared.get(endpointTableId(endpoint));
  if (!table) return null;
  const columns = endpoint.columns.map((column) =>
    table.columnNames.get(column),
  );
  if (columns.some((column) => column === undefined)) return null;

  const qualifier = `"${table.schema}"."${table.table}"`;
  const quoted = columns.map((column) => `"${column}"`);
  // 단일 컬럼은 평문 형태, 복합 키만 괄호 목록 — dbdiagram.io 문서의 두 형태다.
  return quoted.length === 1
    ? `${qualifier}.${quoted[0]}`
    : `${qualifier}.(${quoted.join(", ")})`;
}

const DBML_BARE_TYPE = /^[A-Za-z_][A-Za-z0-9_]*(\([A-Za-z0-9_, ]*\))?$/;

function dbmlType(dataType: string): string {
  const trimmed = dataType.trim();
  if (trimmed.length === 0) return dbmlQuoted("unknown");
  return DBML_BARE_TYPE.test(trimmed) ? trimmed : dbmlQuoted(trimmed);
}

// DBML 의 따옴표 식별자에는 **escape 문법이 없다** — 실측: `"a\"b"` 도 `"a""b"` 도
// `@dbml/core` 가 거부하고, `\` 는 escape 가 아니라 그냥 문자라 `"a\b"` 는 이름이
// `a\b` 인 채로 통과한다. 그래서 backslash 는 그대로 두고 `"` 만 mermaid 와 같은
// 기준으로 `_` 로 내린다.
//
// 빈 식별자(`""`)와 줄바꿈은 파서가 거부하므로, 줄바꿈·제어문자는 공백으로 접고
// 양끝을 턴 뒤 비면 placeholder 를 쓴다 — `mermaidSafeText` 와 같은 낱말이다.
function dbmlQuoted(value: string): string {
  return `"${dbmlIdentifier(value)}"`;
}

function dbmlIdentifier(value: string): string {
  const safe = value.replace(CONTROL_OR_SPACE, " ").replaceAll('"', "_").trim();
  return safe.length > 0 ? safe : "unnamed";
}
