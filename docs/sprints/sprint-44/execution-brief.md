# Sprint Execution Brief: Sprint 44

## Objective

- shadcn/ui를 프로젝트에 설치하고 Tailwind v4 환경에 맞게 설정한다
- 기존 Slate/Indigo 색상 팔레트를 shadcn CSS 변수 네이밍 컨벤션으로 매핑한다
- Button, Dialog, Input, Select, Checkbox, Tooltip shadcn 프리미티브를 설치한다
- `cn()` 유틸리티를 생성한다

## Task Why

- 현재 19개 컴포넌트가 모두 수작성 Tailwind 클래스로 되어 있어 일관성 부족
- shadcn/ui를 기반으로 공통 UI 프리미티브를 확보하여 후속 스프린트(45-49)의 리팩토링 기반 마련
- 이 스프린트는 기반만 구축하고 기존 컴포넌트는 변경하지 않음

## Scope Boundary

- 기존 컴포넌트 파일(`src/components/*.tsx`)은 수정하지 않음
- 기존 CSS 변수(`--color-*`)는 제거하지 않음 (shadcn 변수 추가만)
- Rust 백엔드 변경 없음
- 기존 Zustand 스토어, Tauri IPC 변경 없음

## Invariants

- 기존 666개 테스트 모두 통과
- `pnpm build` 성공
- `pnpm tsc --noEmit` 통과
- `pnpm lint` 에러 0건
- 라이트/다크 모드 전환 정상 동작
- 기존 UI 시각적 변화 없음

## Done Criteria

1. `components.json`이 올바른 설정으로 존재
2. `src/lib/utils.ts`에 `cn()` 함수 존재
3. `src/index.css`에 shadcn 테마 변수가 기존 색상값으로 매핑되어 정의됨
4. 6개 shadcn 프리미티브(button, dialog, input, select, checkbox, tooltip)가 `src/components/ui/`에 존재
5. `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`, `pnpm lint` 모두 통과
6. shadcn Button 렌더링 테스트 존재 및 통과

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm tsc --noEmit` — 타입 체크
  2. `pnpm vitest run` — 전체 테스트
  3. `pnpm build` — 빌드 성공
  4. `pnpm lint` — 린트
- Required evidence:
  - 각 체크의 실행 결과
  - 파일 존재 확인 결과

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- Done criteria coverage with evidence
- Assumptions made during implementation
- Residual risk or verification gaps

## References

- Contract: `docs/sprints/sprint-44/contract.md`
- Relevant files:
  - `src/index.css` — 현재 CSS 변수 정의
  - `package.json` — 현재 의존성
  - `vite.config.ts` — Tailwind v4 설정
  - `tsconfig.json` — 경로 별칭 설정
