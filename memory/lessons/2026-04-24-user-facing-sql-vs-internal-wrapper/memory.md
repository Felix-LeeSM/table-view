---
title: user-facing SQL 필드에 내부 row_to_json 래퍼가 누출된 버그
type: lesson
date: 2026-04-24
---

**상황**: PG 어댑터의 `query_table_data`가 그리드에 반환하는 `executed_query` 필드에 `SELECT row_to_json(q)::text FROM (…) q` 래핑 SQL이 그대로 노출되어 사용자가 내부 구현을 보게 됨.
**원인**: 실행용 `data_sql`과 사용자 표시용 SQL을 동일 변수로 다루고 `data_sql.clone()`으로 `executed_query`에 복사해, 타입 코어션용 래퍼가 그대로 유출됨.
**재발 방지**: inner SELECT를 먼저 별도 변수로 조립해 `executed_query`에 담고, `row_to_json` 래핑은 실행 직전에만 덧씌운다. MySQL/SQLite 어댑터 확장 시 동일 분리 원칙 적용.
