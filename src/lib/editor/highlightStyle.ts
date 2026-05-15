import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * View-Table 공유 HighlightStyle.
 *
 * `defaultHighlightStyle` 는 keyword·type·string·function 을 거의 같은
 * monochrome tone 으로 렌더 — `CREATE TABLE foo (id BIGSERIAL PRIMARY KEY)`
 * 같은 DDL 도 색 차이로 보이지 않아 "highlight 없음" 으로 인식된다.
 *
 * 2026-05-15 (ADR 0031) — 12 syntax 토큰 모두 wire. atom/builtin/punct/error
 * 추가. `:root[data-mode]` fallback 이 index.css 에 박혀 있어 토큰 정의
 * 누락이 cascade 로 slate 값 발동 → 옛 fallback chain (`var(--tv-syntax-X,
 * var(--tv-Y))`) 은 redundant 하지만 ESLint rule 도입 전 defensive 로 유지.
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
    color: "var(--tv-syntax-type)",
    fontWeight: "500",
  },
  {
    tag: [t.string, t.special(t.string), t.regexp],
    color: "var(--tv-syntax-string)",
  },
  {
    tag: [t.number, t.integer, t.float],
    color: "var(--tv-syntax-number)",
  },
  {
    tag: [t.bool, t.null, t.atom],
    color: "var(--tv-syntax-atom)",
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "var(--tv-syntax-function)",
  },
  {
    tag: [t.standard(t.variableName), t.standard(t.name)],
    color: "var(--tv-syntax-builtin)",
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: "var(--tv-syntax-comment)",
    fontStyle: "italic",
  },
  {
    tag: [t.operator, t.compareOperator, t.arithmeticOperator, t.logicOperator],
    color: "var(--tv-syntax-operator)",
  },
  {
    tag: [t.propertyName, t.attributeName],
    color: "var(--tv-syntax-property)",
    fontWeight: "500",
  },
  {
    tag: [t.variableName, t.name],
    color: "var(--tv-foreground)",
  },
  {
    tag: [
      t.bracket,
      t.paren,
      t.brace,
      t.squareBracket,
      t.angleBracket,
      t.punctuation,
      t.separator,
    ],
    color: "var(--tv-syntax-punct)",
  },
  {
    tag: [t.invalid],
    color: "var(--tv-syntax-error)",
  },
]);
