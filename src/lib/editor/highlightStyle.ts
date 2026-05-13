import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * View-Table 공유 HighlightStyle.
 *
 * `defaultHighlightStyle` 는 keyword·type·string·function 을 거의 같은
 * monochrome tone 으로 렌더 — `CREATE TABLE foo (id BIGSERIAL PRIMARY KEY)`
 * 같은 DDL 도 색 차이로 보이지 않아 "highlight 없음" 으로 인식된다.
 *
 * 우리 design-token 의 `--tv-syntax-*` 를 우선 참조하고, 누락된 카테고리는
 * 의미가 인접한 다른 design token 으로 fallback. 테마별 override 는 점진적.
 *
 * SqlQueryEditor / MongoQueryEditor 가 같은 style 을 mount → JSON property /
 * SQL identifier 가 같은 시각 톤을 공유.
 */
export const viewTableHighlightStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword],
    color: "var(--tv-syntax-keyword)",
    fontWeight: "600",
  },
  {
    tag: [t.typeName, t.standard(t.tagName), t.namespace],
    color: "var(--tv-syntax-type, var(--tv-primary))",
    fontWeight: "500",
  },
  {
    tag: [t.string, t.special(t.string), t.regexp],
    color: "var(--tv-syntax-string)",
  },
  {
    tag: [t.number, t.integer, t.float, t.bool, t.null],
    color: "var(--tv-syntax-number)",
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "var(--tv-syntax-function, var(--tv-status-connecting))",
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: "var(--tv-syntax-comment, var(--tv-muted-foreground))",
    fontStyle: "italic",
  },
  {
    tag: [t.operator, t.compareOperator, t.arithmeticOperator, t.logicOperator],
    color: "var(--tv-syntax-operator, var(--tv-syntax-keyword))",
  },
  {
    tag: [t.propertyName, t.attributeName],
    color: "var(--tv-syntax-property, var(--tv-foreground))",
    fontWeight: "500",
  },
  {
    tag: [t.variableName, t.name],
    color: "var(--tv-foreground)",
  },
  {
    tag: [t.bracket, t.paren, t.brace, t.squareBracket, t.angleBracket],
    color: "var(--tv-muted-foreground)",
  },
  {
    tag: [t.punctuation, t.separator],
    color: "var(--tv-muted-foreground)",
  },
  {
    tag: [t.invalid],
    color: "var(--tv-status-error)",
  },
]);
