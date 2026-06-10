---
title: React / TypeScript 컨벤션 (전체)
type: convention
updated: 2026-06-11
surface: src/**/*.ts, src/**/*.tsx
task: react-impl, refactor, frontend
trigger:
  signal: src/**/*.{ts,tsx} 편집 시
  layer: hook (.claude/rules/react-conventions.md paths frontmatter)
---

# React / TypeScript 컨벤션

`.claude/rules/react-conventions.md` wrapper 가 가리키는 source. 모든 brain 공통.

## 컴포넌트

- 함수 컴포넌트만 (class 금지)
- 파일명: PascalCase (`ConnectionPanel.tsx`)
- 컴포넌트 1개 = 파일 1개
- Props 타입 `interface` + `export`

```tsx
interface ConnectionPanelProps {
  connections: Connection[];
  onSelect: (id: string) => void;
}

export function ConnectionPanel({ connections, onSelect }: ConnectionPanelProps) {
  // ...
}
```

## 상태 관리

- 전역: Zustand 스토어 (`src/stores/`, camelCase 파일명)
- 지역: `useState`, `useReducer`
- 서버: 필요 시 TanStack Query
- Zustand 스토어는 관심사별로 분리 (connection, query, ui 등)

## TypeScript 규칙

- `any` 금지 → `unknown` + 타입 가드로 좁힘
- strict mode 필수
- 타입 정의는 `src/types/` 또는 컴포넌트 인근
- 유틸리티 타입 (`Pick`, `Omit`, `Partial`) 적극 활용

```tsx
function handleResult(result: unknown) {
  if (typeof result === 'object' && result !== null && 'data' in result) {
    // 타입 좁히기 완료
  }
}
```

## 스타일링

- Tailwind 유틸리티 클래스 우선
- 다크 모드 지원 필수 (`dark:` prefix)
- 반응형: `sm:`, `md:`, `lg:`
- 커스텀 CSS 최소화

## 파일 구성

- Frontend consumer imports 는 domain-first: `src/features/<domain>/index.ts`
  public API 를 우선한다.
- 새로 추출하는 feature 내부 구현과 domain-local hook/type/test 는
  `src/features/<domain>/**` 에 둔다.
- 전역 store, shared runtime/IPC wrapper, shared type 은 각각 `src/stores/**`,
  `src/lib/**`, `src/types/**` 에 남길 수 있지만 feature consumer 는 가능한 public
  API facade 를 통해 사용한다.
- Generic UI primitive 는 `src/components/ui/**`, result-grid/datagrid public
  boundary 는 `src/components/datagrid/index.ts` 를 쓴다.
- `src/pages/**`, app/router/layout shell 은 workspace public API 를 거쳐 소비한다.

## 성능

- `React.memo` 필요시만
- `useMemo` / `useCallback` 실제 병목에서만
- 리스트 렌더 시 고유 `key`
- 지연 로딩 (`React.lazy`)

## 접근성

- 시맨틱 HTML
- `aria-*` 속성
- 키보드 네비게이션
- 색상 대비

## 테스트

- Vitest + React Testing Library
- 파일: domain-local `*.test.tsx` 또는 `__tests__/`. 새 feature test 는 기본적으로
  `src/features/<domain>/**` 안에 둔다.
- 사용자 관점 (역할 / 텍스트로 쿼리)
- 구현 세부 (상태 / ref) 단언 지양
- Cross-runtime, fixture, smoke, script 정책 테스트는 runner-owned root 에 남긴다.

## 직접 DOM 조작 금지

- `document.querySelector` 등 직접 조작 금지 (React 트리 통제)
- `innerHTML`, `eval()` 금지 (XSS 위험)

## 관련

- [conventions](../memory.md) — 상위 컨벤션 룸
- [testing-scenarios](../testing-scenarios/memory.md) — 시나리오 원칙
- [refactoring](../refactoring/memory.md) — refactor 4 카테고리
