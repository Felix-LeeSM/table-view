// SchemaGraph → 텍스트 ERD export (issue #1661, ADR 0054 세부 결정 5).
// mermaid `erDiagram` 과 DBML 은 텍스트라 diff 가 되고 문서에 그대로 붙는다.
// SVG / PNG 래스터와 UI 배선은 이 모듈 밖이다 (#1655 캔버스 교체 이후 2차).
//
// 순수 모듈: React / IPC / IO 없음. 관계의 SOT 는 SchemaGraph 의
// `foreign-key-table` edge 하나뿐이라 (`selectSchemaGraphIntelligence`),
// 컬럼 플래그를 여기서 다시 해석하지 않는다 — 그래야 attribute 의 FK 표시와
// 관계선이 갈라지지 않는다. 가상 FK (#1659) 는 미배송이라 범위 밖이고,
// SQLite 처럼 제약 카탈로그가 없어 컬럼 플래그에서 합성된 FK 는 그래프가 이미
// 실제 edge 로 만들어 두므로 그대로 실린다.
import type {
  SchemaGraph,
  SchemaGraphCatalogSnapshot,
  SchemaGraphColumnNode,
  SchemaGraphForeignKeyEndpoint,
  SchemaGraphTableNode,
} from "@/types/schemaGraph";
import { selectSchemaGraphIntelligence } from "./schemaGraphSelectors";
import type { SchemaGraphForeignKeySelection } from "./schemaGraphSelectorTypes";
import { compareText } from "./schemaGraphSupport";

export type SchemaGraphTextExportInput =
  | SchemaGraph
  | SchemaGraphCatalogSnapshot;

/**
 * SchemaGraph 를 mermaid `erDiagram` 텍스트로 만든다. 엔티티 이름은
 * `"schema.table"` 로 스키마 수식하고, 컬럼은 `type name PK, FK` 형태로 적는다.
 * 관계선의 부모쪽 기수는 FK 소스 컬럼이 하나라도 nullable 이면 `|o`(0 또는 1),
 * 전부 NOT NULL 이면 `||`(정확히 1) 다 — SQL MATCH SIMPLE 에서 소스 컬럼 중
 * 하나라도 NULL 이면 FK 가 검사되지 않기 때문이다.
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
 */
export function schemaGraphToDbml(input: SchemaGraphTextExportInput): string {
  const model = toExportModel(input);
  const blocks: string[] = [];

  for (const { node, columns } of model.tables) {
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

  const refs = model.foreignKeys.map(
    (foreignKey) =>
      `Ref: ${dbmlEndpoint(foreignKey.relationship.source)} > ${dbmlEndpoint(
        foreignKey.relationship.target,
      )}`,
  );
  if (refs.length > 0) blocks.push(refs.join("\n"));

  return blocks.length > 0 ? `${blocks.join("\n\n")}\n` : "";
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
  const { tablesById, columnsById, columnsByTableId, foreignKeys } =
    selectSchemaGraphIntelligence(input);
  const tables = [...tablesById.values()]
    .sort((left, right) => compareText(left.id, right.id))
    .map((node) => ({
      node,
      // 그래프의 컬럼 맵은 id(퍼센트 인코딩된 이름) 정렬이다. 그래프가 스스로
      // 매기는 컬럼 순서 필드는 `ordinal` 이므로 그쪽을 따른다 — 이름 정렬 결과와
      // 같지만, 인코딩 때문에 이름이 특이한 컬럼이 재배열되지 않는다.
      columns: [...(columnsByTableId.get(node.id) ?? [])].sort(
        (left, right) =>
          left.ordinal - right.ordinal ||
          compareText(left.column, right.column),
      ),
    }));

  return {
    tables,
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
  return foreignKey.sourceColumnIds.some(
    (columnId) => model.columnsById.get(columnId)?.data.nullable ?? true,
  );
}

function mermaidEntityName(node: SchemaGraphTableNode): string {
  return mermaidQuoted(`${node.schema}.${node.table}`);
}

// mermaid 의 따옴표 문자열에는 escape 문법이 없다. 카탈로그 이름은 임의의
// 사용자 데이터라 `"` 를 그대로 실으면 문장이 깨진다 — `'` 로 낮추고 줄바꿈·탭은
// 공백 한 칸으로 접는다.
// ponytail: `a"b` 와 `a'b` 는 같은 이름으로 접힌다. 다이어그램 라벨이라
// 허용하고, 구분이 필요해지면 id 를 별칭으로 붙이는 쪽으로 올린다.
function mermaidQuoted(value: string): string {
  return `"${value.replace(/\s+/g, " ").replaceAll('"', "'").trim()}"`;
}

// mermaid 의 attribute 는 따옴표를 못 쓰는 단어 자리다. 줄 단위 문법을 깨는
// 문자만 `_` 로 바꾼다 — 허용 문자 화이트리스트로 가면 비ASCII 식별자(예: 한글
// 컬럼명)가 전부 같은 문자열로 뭉개진다.
// ponytail: mermaid 자체 단어 문법은 이보다 좁다(선행 숫자 등). 깨지는 사례가
// 실제로 나오면 별칭 표기로 올린다.
function mermaidWord(value: string): string {
  const cleaned = value.replace(/[\s"'`{}:,;|]+/g, "_");
  return cleaned.length > 0 ? cleaned : "unknown";
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
// 못 쓰므로 공백으로 접는다.
function dbmlQuoted(value: string): string {
  const escaped = value
    .replace(/\s+/g, " ")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
  return `"${escaped}"`;
}
