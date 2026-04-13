# Sprint Execution Brief: Sprint 49

## Objective

- 남은 컴포넌트에 shadcn UI 프리미티브 적용
- 전체 컴포넌트에서 기존 `--color-*` 직접 참조를 shadcn 토큰 기반 Tailwind 클래스로 통일
- 기존 CSS 변수(`--color-*`) 중 사용되지 않는 것 정리
- 전체 일관성 확보 및 최종 검증

## Task Why

- Sprint 44-48에서 shadcn/ui 기반 설정, 유틸리티 추출, Dialog 통합, DataGrid/StructurePanel 분해 완료
- 30개 파일이 여전히 구 `--color-*` CSS 변수를 참조하고 있어 토큰 체인이 이중으로 유지됨
- shadcn 시맨틱 토큰(`bg-background`, `text-foreground` 등)으로 통일하여 유지보수성 향상

## Scope Boundary

- CSS 변수 참조 마이그레이션만 수행 (기능 변경 없음)
- Rust 백엔드 변경 없음
- Zustand 스토어 인터페이스 변경 없음
- Tauri IPC 호출 방식 변경 없음

## Invariants

- 707 테스트 모두 통과
- `pnpm build` 성공
- `pnpm tsc --noEmit` 통과
- `pnpm lint` 에러 0건
- 라이트/다크 모드 전환 정상 동작

## Done Criteria

1. 모든 컴포넌트가 shadcn UI 프리미티브 사용
2. `.tsx` 파일에 `--color-*` 직접 참조가 0건
3. 라이트/다크 모드 전환이 모든 컴포넌트에서 정상 작동
4. `pnpm build` + `pnpm test` 통과
5. 기존 CSS 변수 정리 완료

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm tsc --noEmit` — 타입 체크
  2. `pnpm vitest run` — 전체 테스트 (707개)
  3. `pnpm build` — 빌드 성공
  4. `pnpm lint` — 린트
  5. `grep -r "color-bg-\|color-text-\|color-border\|color-accent\|color-danger\|color-success" src/**/*.tsx` — 잔여 참조 0건

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- Done criteria coverage with evidence
- Token migration mapping used

## References

- Contract: `docs/sprints/sprint-49/contract.md`
- Previous sprints: Sprint 44 (shadcn 기반), Sprint 45 (유틸리티 추출), Sprint 46 (Dialog 통합), Sprint 47 (DataGrid 분해), Sprint 48 (StructurePanel 분해)
- Token mapping: `src/index.css` shadcn 테마 토큰 정의
