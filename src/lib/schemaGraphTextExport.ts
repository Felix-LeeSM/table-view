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
// 두 포맷의 문법 판단은 라운드 1 리뷰가 실제 파서(mermaid@11.16.0 `mermaid.parse`,
// `@dbml/core` `Parser.parse`)로 잰 결과가 근거다. 이 저장소에는 두 파서가 없어
// 여기 테스트는 산출 텍스트를 문자열로만 단언한다.
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
import { sortById } from "./schemaGraphSupport";

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
 * 블록을 받는다(라운드 1 실측). 같은 상황에서 DBML 은 블록을 못 받아
 * `schemaGraphToDbml` 이 다르게 처리한다.
 */
export function schemaGraphToMermaid(
  input: SchemaGraphTextExportInput,
): string {
  const model = toExportModel(input);
  const lines: string[] = ["erDiagram"];

  for (const { node, columns } of model.tables) {
    lines.push(`    ${mermaidEntityName(node)} {`);
    for (const column of columns) {
      const keys: string[] = [];
      if (column.data.is_primary_key) keys.push("PK");
      if (model.foreignKeyColumnIds.has(column.id)) keys.push("FK");
      const suffix = keys.length > 0 ? ` ${keys.join(", ")}` : "";
      lines.push(
        `        ${mermaidWord(column.data.data_type)} ${mermaidWord(
          column.column,
        )}${suffix}`,
      );
    }
    lines.push("    }");
  }

  for (const foreignKey of model.foreignKeys) {
    const source = model.tablesById.get(foreignKey.sourceTableId);
    const target = model.tablesById.get(foreignKey.targetTableId);
    // 양끝 테이블 노드가 다 있을 때만 선을 긋는다. 스냅샷 입력에서는 그래프가
    // 이미 걸러 주지만 `SchemaGraph` 직접 주입은 이 모듈의 공개 입력이다.
    if (!source || !target) continue;
    const parentSide = isOptionalForeignKey(model, foreignKey) ? "|o" : "||";
    lines.push(
      `    ${mermaidEntityName(source)} }o--${parentSide} ${mermaidEntityName(
        target,
      )} : ${mermaidQuoted(foreignKey.relationship.rawMetadata.constraintName)}`,
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
  const exportedTableIds = new Set<string>();

  for (const { node, columns } of model.tables) {
    if (columns.length === 0) {
      blocks.push(dbmlSkipsColumnlessTable(node));
      continue;
    }
    exportedTableIds.add(node.id);
    const body = columns.map((column) => {
      const settings: string[] = [];
      if (column.data.is_primary_key) settings.push("pk");
      if (!column.data.nullable) settings.push("not null");
      const suffix = settings.length > 0 ? ` [${settings.join(", ")}]` : "";
      return `  ${dbmlQuoted(column.column)} ${dbmlType(
        column.data.data_type,
      )}${suffix}`;
    });
    blocks.push([`Table ${dbmlTableName(node)} {`, ...body, "}"].join("\n"));
  }

  const refs = model.foreignKeys
    // 선언되지 않은 테이블을 가리키는 `Ref:` 는 파서가 문서 전체를 거부하게
    // 만든다 — 위에서 생략한 테이블과 그래프에 없는 테이블을 같이 건너뛴다.
    .filter(
      (foreignKey) =>
        exportedTableIds.has(foreignKey.sourceTableId) &&
        exportedTableIds.has(foreignKey.targetTableId),
    )
    .map(
      (foreignKey) =>
        `Ref: ${dbmlEndpoint(foreignKey.relationship.source)} > ${dbmlEndpoint(
          foreignKey.relationship.target,
        )}`,
    );
  if (refs.length > 0) blocks.push(refs.join("\n"));

  return blocks.length > 0 ? `${blocks.join("\n\n")}\n` : "";
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
  // 스냅샷은 여기서 한 번만 그래프로 편다. selector 두 개에 같은 그래프를
  // 넘겨야 `extractSchemaGraph` 가 두 번 돌지 않는다.
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
  return `"${mermaidSafeText(node.schema)}.${mermaidSafeText(node.table)}"`;
}

// mermaid 의 따옴표 문자열 토큰은 `"` · `%` · `\` 와 제어문자를 받지 않고
// (11.x 렉서: `["][^"%\r\n\v\b\\]+["]`), escape 문법도 없다. 라운드 1 이 실제
// 파서로 `"public.we%ird"` 와 `"public.a\b"` 의 Parse error 를 실측했고,
// Postgres 는 따옴표 식별자 안에서 셋 다 허용하므로 사용자 데이터로 도달한다.
// 그래서 denylist 가 아니라 토큰이 거부하는 문자 전체를 `_` 로 내린다.
// ponytail: `a"b` · `a%b` · `a\b` 가 한 이름으로 접힌다. 다이어그램 라벨이라
// 허용하고, 구분이 필요해지면 별칭(`entity["label"]`) 표기로 올린다.
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

// mermaid 의 attribute 는 따옴표를 못 쓰는 단어 토큰이다. 렉서가 실제로 받는
// 문자만 남기는 allowlist — 라운드 1 이 파서로 잰 결과가 근거다: `numeric(10,2)`
// `text[]` `full_name` 통과, `a@b` 와 선행 숫자 `2fa_enabled` 는 Parse error.
// 확인되지 않은 문자(`-` 등)는 뺐다 — 빼면 라벨만 뭉개지고 넣었다 틀리면 다이어그램
// 전체가 파싱 실패다.
// ponytail 천장: 비ASCII 식별자(한글 컬럼명 등)도 전부 `_` 로 내려간다. 렉서의
// 문자 클래스가 ASCII 기준이라 그대로 실으면 산출물이 무효가 된다. mermaid 를
// dev 의존성으로 들여 실측할 수 있게 되면(2차 PR) 클래스를 넓혀라.
const MERMAID_WORD_REJECTS = /[^A-Za-z0-9_()[\],]/g;

function mermaidWord(value: string): string {
  // 공백만 있는 타입/이름은 `_` 로 채우지 말고 placeholder 로 보낸다 —
  // `dbmlType` 의 빈 값 처리와 같은 기준이다.
  const cleaned = value.trim().replace(MERMAID_WORD_REJECTS, "_");
  if (cleaned.length === 0) return "unknown";
  // 토큰은 letter 로 시작해야 한다.
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `x_${cleaned}`;
}

function dbmlTableName(node: SchemaGraphTableNode): string {
  return `${dbmlQuoted(node.schema)}.${dbmlQuoted(node.table)}`;
}

function dbmlEndpoint(endpoint: SchemaGraphForeignKeyEndpoint): string {
  const qualifier = `${dbmlQuoted(endpoint.schema)}.${dbmlQuoted(
    endpoint.table,
  )}`;
  const columns = endpoint.columns.map(dbmlQuoted);
  // 단일 컬럼은 평문 형태, 복합 키만 괄호 목록 — dbdiagram.io 문서의 두 형태다.
  return columns.length === 1
    ? `${qualifier}.${columns[0]}`
    : `${qualifier}.(${columns.join(", ")})`;
}

const DBML_BARE_TYPE = /^[A-Za-z_][A-Za-z0-9_]*(\([A-Za-z0-9_, ]*\))?$/;

function dbmlType(dataType: string): string {
  const trimmed = dataType.trim();
  if (trimmed.length === 0) return dbmlQuoted("unknown");
  return DBML_BARE_TYPE.test(trimmed) ? trimmed : dbmlQuoted(trimmed);
}

// DBML 의 따옴표 식별자는 backslash escape 를 받는다. 줄바꿈은 문자열 안에서
// 못 쓰므로 공백으로 접고, mermaid 쪽과 같은 기준으로 양끝 공백을 턴다.
function dbmlQuoted(value: string): string {
  const escaped = value
    .replace(CONTROL_OR_SPACE, " ")
    .trim()
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
  return `"${escaped}"`;
}
