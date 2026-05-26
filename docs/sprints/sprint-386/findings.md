# Sprint 386 — Findings

## 변경 요약

| 영역 | 추가 | 수정 | 삭제 |
|---|---|---|---|
| 신규 메모리 방 | 11 (workflow/{memory, bug-fix, grill, grill/security-handoff, implementation, delivery}, ux, runbook/{memory, cold-boot}, conventions/testing-scenarios/mock-scope, conventions/refactoring/god-file) | — | — |
| 기존 메모리 갱신 | — | memory/memory.md (입구 + 30초/5분 path), conventions/memory.md (금지 사항 일반화), conventions/testing-scenarios/memory.md (P7 형식 + 예시), CLAUDE.md (먼저 읽을 곳) | — |
| Auto-memory | — | MEMORY.md 인덱스 갱신 (13 이동 항목 표) | 13 파일 (feedback 12 + reference 1) |
| Agent definition | 9 (`.claude/agents/{caveman-default, grill-planner, tdd-generator, evaluator, bug-fix, research, security-handoff, delivery, codex-reviewer}.md`) | — | — |
| Hook | scripts/check-god-file.sh, .claude/settings.json PostToolUse 2 entry (god-file + regenerate-indexes) | — | — |
| ESLint | — | eslint.config.js max-lines warn (500) | — |
| Skill / 정책 | grill-me/templates/option-comparison.html | .claude/commands/remember.md (type 매트릭스 8 type), .claude/rules/git-policy.md (delivery 책임 주체 cross-ref) | — |
| Index | scripts/regenerate-indexes.sh, memory/index/by-task.md (141 lines), memory/index/by-surface.md (49 lines) | scripts/check-memory-structure.sh (memory/index/* 예외) | — |

## 검증 결과

| Check | 결과 | 비고 |
|---|---|---|
| `bash scripts/check-memory-size.sh` | ✓ 통과 | 신규 방 모두 200줄 이하 (max 142줄 — testing-scenarios) |
| `bash scripts/check-memory-structure.sh` | ✓ 통과 | memory/index/*.md 예외 적용 |
| `pnpm tsc --noEmit` | ✓ 통과 | 코드 변경 0, 영향 없음 |
| `npm run lint` | ✓ 통과 (0 errors) | 43 warnings = god file 식별. `max-lines` 룰 의도 동작 |
| `npx vitest run --silent` | ✓ 통과 | 368 files, 4128 passed, 11 skipped |
| `cargo clippy --all-targets --all-features -- -D warnings` | ✓ 통과 | — |
| `cargo test --lib` | ✓ 통과 | 1217 passed, 2 ignored |
| God file hook smoke (600줄 fixture) | ✓ trigger | stderr 출력 + 룰 path |
| God file hook smoke (499줄 fixture) | ✓ silent | exit 0, no output |
| Agent definition count | ✓ 9 | `.claude/agents/*.md` |
| 신규 방 count | ✓ 11 | workflow / ux / runbook / mock-scope / god-file |
| Index 첫 생성 | ✓ by-task (141 lines), by-surface (49 lines) | yaml string quote 처리에 cosmetic issue — surface 키가 single quote 포함 (`'**/*.test.ts` 등). 후속 polish 대상 |

## Acceptance Criteria 충족

- **AC-01** ✓ 신규 방 11개 (목표 8 이상). 본문 모두 200줄 이하. 입구 형식.
- **AC-02** ✓ memory/memory.md + CLAUDE.md 갱신.
- **AC-03** ✓ 14 결정 모두 reframe 결정대로 이동/미이동. Auto-memory 1-12, 14 삭제 (13개), MEMORY.md 갱신.
- **AC-04** ✓ Agent definition 9개 (caveman-default / grill-planner / tdd-generator / evaluator / bug-fix / research / security-handoff / delivery / codex-reviewer). 사용자가 사후 model 을 sonnet → opus 로 lock.
- **AC-05** ✓ scripts/check-god-file.sh + settings.json PostToolUse + smoke trigger 확인.
- **AC-06** ✓ ESLint max-lines warn (500). Clippy `too_many_lines` 는 *function* 단위라 file 단위 god file 임계 다름 — clippy.toml 미생성, 사유 본 문서 + handoff.
- **AC-07** ✓ remember.md 갱신. 8 type 매트릭스 + 정합성 검증 + reframe / 부분 / 미이동 옵션 + frontmatter trigger 필드.
- **AC-08** ✓ regenerate-indexes.sh + by-task.md / by-surface.md 첫 생성. PostToolUse(`Edit memory/**`) hook 등록.
- **AC-09** → handoff.md 작성 시 충족.
- **AC-10** ✓ tsc / lint / vitest / cargo clippy / cargo test 모두 통과.

## 발견된 부산물 / 우려

1. **기존 god file 43개 식별** (ESLint max-lines warn). 정리 작업 별 sprint 후보. 본 sprint 의 hook + agent prompt + ESLint 가 미래 god file 신규 발생 방지 + 기존도 점진 정리 유도.
2. **Index 의 surface 키 cosmetic issue** — yaml string quote (`'**/*.ts, ...'`) 가 awk 추출 시 키에 단일 인용부호 포함. Link 는 작동, 표시만 어색. regenerate-indexes.sh 의 awk 스크립트에 quote strip 1줄 추가하면 해결. 다음 sprint 의 polish.
3. **사용자 model lock = opus** — 모든 agent definition (caveman-default / grill-planner / tdd-generator / evaluator / bug-fix / research / security-handoff / delivery / codex-reviewer) 의 model 을 사후 opus 로 변경. research 도 haiku → opus. 토큰 비용 vs 품질 trade-off 사용자 명시 결정.
4. **R2 (트리거 layer 전면 자동 derive) 미적용** — god file 만 적용. 나머지 룰 (mock-scope, bug-fix 등) 은 agent prompt 인용에 의존. 효과 측정 후 확장 — handoff deferred 참조.
5. **CLAUDE.md context 의 auto-memory snippet** — 사용자 환경의 system prompt 가 auto-memory MEMORY.md 와 일부 feedback 본문을 잘라 context 로 주입. 본 sprint 가 auto-memory 파일 삭제 → 사용자 다음 세션 시 context 가 재구성됨. 단 stale 한 system prompt cache 에는 일시적 잔존 가능.

## 변경 파일 목록

### Memory (12 신규 / 5 수정)

- `memory/workflow/memory.md` (NEW)
- `memory/workflow/bug-fix/memory.md` (NEW)
- `memory/workflow/grill/memory.md` (NEW)
- `memory/workflow/grill/security-handoff/memory.md` (NEW)
- `memory/workflow/implementation/memory.md` (NEW)
- `memory/workflow/delivery/memory.md` (NEW)
- `memory/ux/memory.md` (NEW)
- `memory/runbook/memory.md` (NEW)
- `memory/runbook/cold-boot/memory.md` (NEW)
- `memory/conventions/testing-scenarios/mock-scope/memory.md` (NEW)
- `memory/conventions/refactoring/god-file/memory.md` (NEW)
- `memory/index/by-task.md` (NEW, generated)
- `memory/index/by-surface.md` (NEW, generated)
- `memory/memory.md` (MODIFIED — 30초/5분 path)
- `memory/conventions/memory.md` (MODIFIED — 금지 사항 일반화)
- `memory/conventions/testing-scenarios/memory.md` (MODIFIED — P7 예시 + 형식)
- `CLAUDE.md` (MODIFIED — 먼저 읽을 곳)

### Agent definitions (9 신규)

- `.claude/agents/caveman-default.md`
- `.claude/agents/grill-planner.md`
- `.claude/agents/tdd-generator.md`
- `.claude/agents/evaluator.md`
- `.claude/agents/bug-fix.md`
- `.claude/agents/research.md`
- `.claude/agents/security-handoff.md`
- `.claude/agents/delivery.md`
- `.claude/agents/codex-reviewer.md`

### Skill / 정책 (3 수정 / 1 신규)

- `.claude/commands/remember.md` (MODIFIED — type 매트릭스)
- `.claude/rules/git-policy.md` (MODIFIED — delivery 책임)
- `.agents/skills/grill-me/templates/option-comparison.html` (NEW)
- `.claude/settings.json` (MODIFIED — PostToolUse 2 entry)

### Scripts (2 신규 / 1 수정)

- `scripts/check-god-file.sh` (NEW)
- `scripts/regenerate-indexes.sh` (NEW)
- `scripts/check-memory-structure.sh` (MODIFIED — memory/index/* 예외)

### ESLint (1 수정)

- `eslint.config.js` (max-lines warn 추가)

### Auto-memory (1 수정 / 13 삭제)

- `~/.claude/projects/.../memory/MEMORY.md` (MODIFIED)
- 13 파일 삭제:
  - feedback_test_scenarios_user_journey, feedback_bug_fix_starts_with_regression_test
  - feedback_test_documentation, feedback_security_rigor
  - feedback_one_decision_at_a_time, feedback_option_decomposition
  - feedback_demo_html_for_grill, feedback_minimal_implementation_logs
  - feedback_reset_to_default_ui, feedback_do_not_commit_diagnostic_logs
  - feedback_git_commit_direct, feedback_sprint_comment_cleanup
  - reference_cold_boot_instrumentation
