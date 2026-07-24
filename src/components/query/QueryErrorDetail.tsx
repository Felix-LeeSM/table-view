/**
 * QueryErrorDetail — 원문 드라이버 에러 표시 (#1723).
 *
 * `classifyDriverError` 로 친화적 힌트가 붙은 에러(`collapsible`)는 원문을 네이티브
 * `<details>` 로 접어 primary 를 친화적 메시지에 양보한다 — raw sqlx/드라이버 내부
 * 문자열이 SQL 문제인지 연결/프록시 문제인지 가리던 회귀의 fix. 미분류(fallback)면
 * 원문을 그대로 노출한다. 진단 원문은 어느 쪽이든 DOM 에 보존된다.
 *
 * `<details>` 는 이 코드베이스의 기존 접기 UI 관례(SearchResultView / ExplainViewer
 * 등)를 재사용한다 — 새 collapsible primitive 를 만들지 않는다.
 */

import { useTranslation } from "react-i18next";

export interface QueryErrorDetailProps {
  error: string;
  /** 친화적 힌트가 있어 원문을 접을지. `false` 면 원문을 그대로 노출(fallback). */
  collapsible: boolean;
}

export function QueryErrorDetail({
  error,
  collapsible,
}: QueryErrorDetailProps) {
  const { t } = useTranslation("query");
  if (!collapsible) {
    return (
      <div className="whitespace-pre-wrap text-xs opacity-80">{error}</div>
    );
  }
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs opacity-70">
        {t("resultGrid.errorDetails")}
      </summary>
      <div className="mt-1 whitespace-pre-wrap text-xs opacity-80">{error}</div>
    </details>
  );
}
