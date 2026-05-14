# Sprint 300 — Handoff

## 상태: PASS

## 인도물

- `src/components/connection/RecentConnections.tsx` — trailing slot 을
  grid stack 으로 재구성. 평소엔 [Clock + relative time], 호버 시 같은
  cell 에 X 버튼. `col-start-1 row-start-1` 가 두 element 를 같은 grid
  cell 에 stack 해 슬롯 width 가 시간 텍스트 기준으로 안정 → X 등장 시
  시각 점프 없음. 시간 정보는 row 의 aria-label 에 그대로 보존 (호버
  의존 없음).
- `src/components/connection/RecentConnections.test.tsx` — Sprint 297(현
  300) 회귀 가드 2 it:
  - row 의 aria-label 에 relative time 포함 (정보 손실 가드)
  - X 버튼이 호버 무관하게 DOM 에 늘 존재 (opacity-only swap; 키보드
    focus 도달성)

## 회귀 가드

- vitest target: 18 passed (RecentConnections) + 22 passed (HomePage)
- tsc clean
- eslint clean

## 정책 결정

- 시각적 swap 자체 (호버 시 시간 ↔ X 슬롯 교체) 는 RTL 의 동작 단언으로
  의미있게 검증되지 않아 unit 가드는 invariant 만 보호: (1) 시간 정보
  손실 없음, (2) X DOM 보존. 시각 swap 의 실측 확인은 사용자 / e2e 영역.
- grid stack 채택 이유: width 명시 hardcode 보다 자연스럽게 적응 (시간
  텍스트 폭 기반). "5m ago" → "3d ago" 변화에도 슬롯 width 안정.

## 사용자 요청 원본 인용

> 흠... x 버튼 때문에 시간이 왼쪽으로 뜨는 게 좀 불편한데... UI를 개선할
> 수 있는 방법이 있을까? 어떤 패턴들이 있을까?

(패턴 A: swap 선택)

## 후속

- sprint-301: SchemaTree schema/table 컨텍스트 메뉴 Export wire.
