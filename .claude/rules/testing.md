---
paths:
  - "**/*.rs"
  - "**/*.{ts,tsx}"
  - "e2e/**/*"
---

# 테스트 필수 작성 규칙

## 시나리오 설계 원칙 (필독)

새 테스트를 작성·수정하기 전에 시나리오 설계 8원칙을 읽는다:

- 비-E2E (unit / component / store / integration): [`memory/conventions/testing-scenarios/memory.md`](../../memory/conventions/testing-scenarios/memory.md)
- E2E: [`memory/conventions/e2e-scenarios/memory.md`](../../memory/conventions/e2e-scenarios/memory.md)

이 파일은 그 위에서 동작하는 *메커니즘 룰* (위치, 명명, 도구) 을 다룬다.

## 원칙
- 모든 새 기능과 버그 수정에는 테스트 필수
- 테스트 없는 PR은 머지 불가
- 테스트 코드는 프로덕션 코드와 동일한 품질 기준 적용

## Rust 테스트

### 단위 테스트
- 위치: 같은 파일 하단 `#[cfg(test)] mod tests {}`
- 명명: `test_<함수명>_<시나리오>_<기대결과>`
- 모든 공개 함수와 trait 구현체에 테스트 필수

### 통합 테스트
- 위치: `src-tauri/tests/`
- DB 관련 테스트는 실제 DB 대신 mock 사용
- `mockall` crate로 trait mocking

### 커버리지 기준
- DbAdapter 구현체: 80% 이상
- 쿼리 파서/빌더: 90% 이상
- Tauri command 핸들러: 70% 이상

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_connect_valid_config_returns_ok() {
        let adapter = PostgresAdapter::new();
        let config = ConnectionConfig::default();
        let result = adapter.connect(&config).await;
        assert!(result.is_ok());
    }
}
```

## React 테스트

### 컴포넌트 테스트
- Vitest + React Testing Library 사용
- 사용자 관점에서 테스트: 역할, 텍스트, 라벨로 요소 쿼리
- `getByRole`, `getByText` 우선 사용
- `getByTestId`는 최후 수단

### 스토어 테스트
- Zustand 스토어는 독립적으로 테스트
- 초기 상태, 액션 호출 후 상태 변화 검증

### 훅 테스트
- `@testing-library/react-hooks` 또는 `renderHook` 사용

### 파일 위치
- 단위 테스트: 테스트 대상 파일 옆 `*.test.tsx`
- 통합 테스트: `src/__tests__/` 또는 `tests/`

```tsx
// ConnectionPanel.test.tsx
import { render, screen } from '@testing-library/react';
import { ConnectionPanel } from './ConnectionPanel';

describe('ConnectionPanel', () => {
  it('renders connection list', () => {
    const connections = [{ id: '1', name: 'Test DB' }];
    render(<ConnectionPanel connections={connections} onSelect={vi.fn()} />);
    expect(screen.getByText('Test DB')).toBeInTheDocument();
  });
});
```

## E2E 테스트

### Playwright 사용
- 위치: `e2e/`
- 핵심 사용자 플로우 커버:
  1. 연결 생성 및 편집
  2. 쿼리 실행 및 결과 확인
  3. 테이블 스키마 조회
- CI 환경에서 실행 가능해야 함

### 실행 명령
- Rust: `cd src-tauri && cargo test`
- React: `npm run test` (또는 `npx vitest --run`)
- E2E: `npx playwright test`
- 전체: `npm run test:all`

## 테스트 작성 체크리스트
- [ ] Happy path 테스트
- [ ] 에러 케이스 테스트
- [ ] 엣지 케이스 (빈 입력, null, 경계값)
- [ ] 비동기 작업 타임아웃 테스트
- [ ] 기존 테스트 깨지지 않는지 확인
