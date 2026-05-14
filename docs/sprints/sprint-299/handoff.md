# Sprint 299 — Handoff

## 상태: PASS

번호 재할당: 초기에 sprint-296 으로 시작했으나 sprint-296 (MySQL
testcontainers 통합) / sprint-297 (E2E 재구축) 가 다른 작업으로 이미
점유. 충돌 회피를 위해 299 로 재할당.

## 인도물

- `src/pages/HomePage.tsx` — `home-recent` footer 영역이 collapse 책임을
  보유. `RECENT_COLLAPSE_KEY` / `loadRecentCollapsed` /
  `persistRecentCollapsed` helper, `recentCollapsed` state, header 버튼
  (Chevron + Clock + "Recent" 라벨) 이 토글 역할. theme picker footer 는
  collapse 영향 밖.
- `src/components/connection/RecentConnections.tsx` — 내부 chevron header
  + COLLAPSE_KEY / loadCollapsed / persistCollapsed / collapsed state 모두
  제거. 책임은 HomePage 의 footer wrapper 로 이관. X 삭제는 그대로.
- `src/pages/HomePage.test.tsx` — Sprint 299 (구 296) 회귀 가드 3 it:
  - AC-296-01: Recent 토글은 home-recent 의 단일 헤더에서만 일어남
  - AC-296-02: 토글 후에도 theme picker 그대로 노출
  - AC-296-03: localStorage 키 `table-view-recent-collapsed` 영속
- `src/components/connection/RecentConnections.test.tsx` — Sprint 290
  collapse 관련 3 it 제거 (X 삭제 2 it 는 유지).

## 회귀 가드

- vitest: 3350 passed | 10 skipped
- tsc clean
- eslint clean

## 정책 결정

- localStorage 키 `table-view-recent-collapsed` 는 Sprint 290 의 호환을
  위해 유지 — 기존 사용자의 collapse 선호가 그대로 살아남음.
- footer 에 추가 섹션이 더 생기면 이 collapse 단위가 그 섹션도 함께 흡수.
  지금은 Recent 한 묶음만.
- 테스트 코멘트의 `AC-296-NN` 식별자는 작업 초기 번호로 유지 (코드 검색
  과의 호환). handoff 문서 번호만 sprint-299 로 갱신.

## 사용자 요청 원본 인용

> 야 이게 recent를 접는 게 아래 탭을 하나 더 만들어서 접을 수 있게 만들어
> 버렸네. 맨 밑에 theme을 제외한 footer 자체를 접을 수 있어야 하는데

## 후속

- sprint-300: RecentConnections trailing slot swap (시간 ↔ X) — 호버 시
  시각 점프 제거.
- sprint-301: SchemaTree schema/table 컨텍스트 메뉴 Export wire.
