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
 *
 * 원문을 `<pre>` 로 내는 것은 표시가 아니라 회수 경로다 (#2432). 드래그 선택이
 * 기본으로 꺼져 있고 `src/index.css` 가 요소 단위로 되켜는데 `pre` 가 그 목록에
 * 있다. 이 컴포넌트의 호출 자리 셋 중 둘은 `role="alert"` 안이라 이미 걸렸지만
 * permission-denied 패널(`QueryResultGrid.tsx` 의 `role="status"` 블록)은 안
 * 걸려서, 거기 뜨는 원문 드라이버 에러가 이 저장소에서 꺼낼 방법이 없는 값이
 * 됐다. 요소를 여기서 고치면 호출 자리마다 감싸개를 두지 않아도 셋이 같이 걸린다.
 * `<pre>` 는 raw 에러를 그리는 다른 자리(`src/components/ui/dialog/PreviewDialog.tsx`
 * · `src/components/rdb/DataGrid/SqlPreviewDialog.tsx`)와 같은 mono 표시를 준다.
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
      <pre className="whitespace-pre-wrap text-xs opacity-80">{error}</pre>
    );
  }
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs opacity-70">
        {t("resultGrid.errorDetails")}
      </summary>
      <pre className="mt-1 whitespace-pre-wrap text-xs opacity-80">{error}</pre>
    </details>
  );
}
