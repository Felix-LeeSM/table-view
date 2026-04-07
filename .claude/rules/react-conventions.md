---
paths:
  - "src/**/*.{ts,tsx}"
---

# React/TypeScript 컨벤션

## 컴포넌트
- 함수 컴포넌트만 사용 (class 컴포넌트 금지)
- 파일명: PascalCase (`ConnectionPanel.tsx`)
- 컴포넌트 1개 = 파일 1개
- Props 타입은 `interface`로 정의 후 `export`

```tsx
// Good
interface ConnectionPanelProps {
  connections: Connection[];
  onSelect: (id: string) => void;
}

export function ConnectionPanel({ connections, onSelect }: ConnectionPanelProps) {
  // ...
}
```

## 상태 관리
- 전역 상태: Zustand 스토어 (`stores/` 디렉토리)
- 지역 상태: `useState`, `useReducer`
- Zustand 스토어는 관심사별로 분리 (connection, query, ui 등)
- 스토어 파일명: camelCase (`connectionStore.ts`)

## TypeScript 규칙
- `any` 타입 사용 금지 → `unknown` 사용 후 타입 가드
- strict mode 필수 (`tsconfig.json`)
- 타입 정의는 `src/types/` 또는 컴포넌트 인근
- 유틸리티 타입 적극 활용 (`Pick`, `Omit`, `Partial`)

```tsx
// Good
function handleResult(result: unknown) {
  if (typeof result === 'object' && result !== null && 'data' in result) {
    // 타입 좁히기 완료
  }
}

// Bad
function handleResult(result: any) {
  return result.data;
}
```

## 스타일링
- Tailwind CSS 유틸리티 클래스 사용
- 다크 모드 지원 필수 (`dark:` prefix)
- 반응형: `sm:`, `md:`, `lg:` breakpoint 사용
- 컴포넌트에 국한된 스타일은 같은 파일에 유지

## 파일 구성
- 컴포넌트: `src/components/`
- 커스텀 훅: `src/hooks/`
- Zustand 스토어: `src/stores/`
- 타입 정의: `src/types/`
- 유틸리티: `src/lib/`
- 페이지: `src/pages/`

## 성능
- `React.memo`는 필요시에만 사용
- `useMemo`/`useCallback`은 실제 병목에서만 사용
- 리스트 렌더링 시 고유 `key` 필수
- 컴포넌트 지연 로딩 (`React.lazy`) 적극 활용

## 접근성
- 시맨틱 HTML 사용
- `aria-*` 속성으로 스크린 리더 지원
- 키보드 네비게이션 지원
- 색상 대비 기준 충족

## 테스트
- Vitest + React Testing Library 사용
- 테스트 파일: `*.test.tsx` 또는 `__tests__/`
- 사용자 관점에서 테스트 (요소의 역할, 텍스트로 쿼리)
- 구현 세부사항(상태, ref 등) 테스트 지양
