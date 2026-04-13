# Sprint Contract: Sprint 44

## Summary

- Goal: shadcn/ui 기반 설정 및 테마 매핑
- Audience: Generator / Evaluator
- Owner: Harness Orchestrator
- Verification Profile: `command`

## In Scope

- `clsx`, `tailwind-merge`, `class-variance-authority` 의존성 설치
- `src/lib/utils.ts`에 `cn()` 유틸리티 생성
- `components.json` 설정 파일 생성 (Tailwind v4 호환)
- `src/index.css`에 shadcn 테마 CSS 변수 추가 (기존 변수 유지)
- shadcn 기본 프리미티브 추가: Button, Dialog, Input, Select, Checkbox, Tooltip
- `src/components/ui/` 디렉토리에 shadcn 컴포넌트 배치
- shadcn Button 렌더링 테스트 작성

## Out of Scope

- 기존 컴포넌트 수정 (시각적 변화 없음)
- Dialog/Modal 통합 (Sprint 46)
- 공통 유틸리티 추출 (Sprint 45)
- DataGrid/StructurePanel 분해 (Sprint 47-48)
- 기존 CSS 변수(--color-*) 제거 (점진적 전환)

## Invariants

- 기존 666개 테스트 모두 통과
- 기존 컴포넌트 시각적 변화 없음
- Rust 백엔드 변경 없음
- Zustand 스토어 인터페이스 변경 없음
- Tauri IPC 호출 방식 변경 없음
- 라이트/다크 모드 전환 정상 동작
- `pnpm build` 성공

## Acceptance Criteria

- `AC-01`: `components.json`이 프로젝트 루트에 존재하며, `tailwindCSS`가 `src/index.css`를 가리키고 `aliases.components`가 `@/components/ui`를 가리킨다
- `AC-02`: `src/lib/utils.ts`에 `cn()` 함수가 존재하며 `clsx`와 `tailwind-merge`를 사용한다
- `AC-03`: `src/index.css`에 shadcn 테마 변수(`--background`, `--foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`, `--radius`)가 `:root` 및 `.dark` 블록에 정의되며, 기존 Slate/Indigo 색상값과 동일한 값을 가진다
- `AC-04`: `src/components/ui/` 디렉토리에 button.tsx, dialog.tsx, input.tsx, select.tsx, checkbox.tsx, tooltip.tsx가 존재한다
- `AC-05`: `pnpm tsc --noEmit` 통과, `pnpm test` 전부 통과, `pnpm build` 성공, `pnpm lint` 에러 0건
- `AC-06`: shadcn Button 렌더링 단위 테스트가 존재하며 통과한다

## Design Bar / Quality Bar

- shadcn 컴포넌트는 공식 CLI(`npx shadcn@latest add`)로 생성 (수작성 금지)
- Tailwind v4 환경에서 호환되도록 설정
- 기존 `--color-*` 변수를 유지하면서 shadcn 변수를 추가 (기존 변수 제거하지 않음)
- `cn()` 유틸리티는 `clsx` + `tailwind-merge` 조합

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 타입 체크 통과
2. `pnpm vitest run` — 기존 666개 + 신규 테스트 전부 통과
3. `pnpm build` — 프로덕션 빌드 성공
4. `pnpm lint` — ESLint 에러 0건
5. 파일 존재 확인: `components.json`, `src/lib/utils.ts`, `src/components/ui/button.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/input.tsx`, `src/components/ui/select.tsx`

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - checks run and outcomes
  - acceptance criteria coverage with concrete evidence
- Evaluator must cite:
  - concrete evidence for each pass/fail decision
  - any missing or weak evidence as a finding

## Test Requirements

### Unit Tests (필수)
- shadcn Button 렌더링 테스트 최소 1개 (variants, sizes)
- cn() 유틸리티 테스트 최소 1개

### Coverage Target
- 신규 코드: 라인 70% 이상 권장

### Scenario Tests (필수)
- [ ] Happy path: cn() 함수 정상 동작
- [ ] 기존 컴포넌트 회귀 없음 (666 테스트 통과)
- [ ] 빌드 성공

## Test Script / Repro Script

1. `pnpm tsc --noEmit`
2. `pnpm vitest run`
3. `pnpm build`
4. `pnpm lint`
5. `ls src/components/ui/button.tsx src/components/ui/dialog.tsx src/lib/utils.ts components.json`

## Ownership

- Generator: Agent
- Write scope: `components.json`, `src/lib/utils.ts`, `src/index.css`, `src/components/ui/*`, `src/components/ui/button.test.tsx`
- Merge order: Sprint 44 only

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
