---
title: D. lib vs hook 경계
type: memory
updated: 2026-05-02
---

# D. lib vs hook 경계

상위: [refactoring](../memory.md). 카테고리 D — `lib/` (순수) /
`hooks/` (React state) / `components/` (JSX) 3 layer 분리 룰.

## D-1. 3 layer 분리 기준

- **lib** (`src/lib/`): React 의존 0 (no `useState` / `useEffect` / JSX /
  hooks). 순수 `(input) → output` 함수 + 작은 자료형. 모범:
  `analyzeStatement`, `analyzeMongoPipeline`, `format`, `sqlTokenize`.
- **hooks** (`src/hooks/`): React state/effect 가 있고 JSX 반환 안 함.
  `use` prefix.
- **components** (`src/components/`): JSX 반환.
- **검증**: lib 파일 import 에 `react` / `@stores/` / `@hooks/` 등장 0
  (자동 grep audit).

## D-2. Import direction

- **허용**: `components → hooks → lib`. 같은 layer 안 import OK.
- **금지**: 역방향 (lib → hook, hook → component). lib → store 도 금지.

## D-3. Pure 추출 강도 — 강한 룰

- hook 안에서 식별 가능한 pure 부분 (input → output, side-effect 0) 이
  있으면 **lib 으로 추출**. hook 은 wiring (store read + 호출 + state
  setter) 만 남긴다.
- **예외**: trivial (1~2 라인, 삼항/조건 1개) 은 hook 안에 둬도 OK.
- **이득**: pure 단위 테스트 가벼움 (`renderHook` 불필요), hook 외부 재사용
  가능.

## D-4. 즉각 적용 — `useSafeModeGate` 정리

- 현재 hook 안의 `decide(analysis)` decision matrix → `src/lib/safeMode.ts`
  의 `decideSafeModeAction(mode, environment, analysis): SafeModeDecision`
  pure function 으로 추출.
- hook 은 store read + `decideSafeModeAction(...)` 호출만.
- **적용 시점**: Sprint 189 drive-by commit.

## D-5. 명명 규칙

- **lib 함수**: 명령형 동사 — `analyze*`, `decide*`, `parse*`, `format*`,
  `sanitize*`, `tokenize*`.
- **hook**: `use*` prefix.
- **lib 파일명**: 도메인 또는 동사 — `sqlSafety.ts`, `format.ts`. 명사
  단수 권장.

## D-6. lib sub-grouping — 도메인별 정리

- 현재 mix 상태 (Mongo 4개 flat + `mongo/` sub-folder, SQL 다수 flat).
- **결정**: Sprint 189 의 drive-by 로
  - (a) `src/lib/mongo/` 통합 (`mongoSafety`, `mongoAutocomplete`,
    `mongoTokenize` + 기존 `mongo/*`),
  - (b) `src/lib/sql/` 통합 (`sqlSafety`, `sqlDialect*`, `sqlTokenize`,
    `sqlUtils`, `rawQuerySqlBuilder`, `queryAnalyzer`),
  - (c) 새 항목 `src/lib/safeMode.ts` 신설.
- git mv + import 경로 갱신. 행동 변경 0.
