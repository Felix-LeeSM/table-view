# Sprint 386 — Handoff

## Status: PASS

- Contract: `docs/sprints/sprint-386/contract.md`
- Findings: `docs/sprints/sprint-386/findings.md`
- Execution Brief: `docs/sprints/sprint-386/execution-brief.md`
- AC-01 ~ AC-10 모두 통과 (findings 참조)
- 모든 검증 명령 통과 (tsc / lint / vitest / cargo clippy / cargo test)
- Auto-memory 13개 이동 + 삭제 완료
- 신규 방 11 + Index 2 + Agent definition 9 + Hook 1 + Skill 갱신

## 본 sprint 의 효과 측정 — 후속 sprint 입력

다음 시점에 효과 측정 후 deferred work 진입:

| 측정 지표 | 임계 | 의미 |
|---|---|---|
| God file hook trigger 횟수 (PostToolUse 로그 / agent 보고) | 신규 god file ≤ 기존 43개 유지 또는 감소 | hook 인지 layer 가 신규 god file 방지 |
| ESLint max-lines warn 카운트 | 43 → 점진 감소 | 기존 god file 의 자연 정리 |
| Agent definition 사용률 | sub-agent spawn 로그 (가능 시) | 사용자 목표 4/5/6 달성도 |
| 사용자 명시 reframe 빈도 | 본 sprint 결정 14 중 6건 reframe 됐음 | 원본 룰을 사용자 의도에 맞게 일반화하는 패턴이 정착했는지 |
| auto-memory 재오염 여부 | feedback / reference 가 다시 auto-memory 로 떨어지는지 | repo source-of-truth 패턴 유지 |

## Deferred work

### D1 — R2 (인지 layer 전면 자동 derive) 확장

**현 상태**: god file 만 적용. mock-scope / bug-fix Red 룰 / test-documentation / reset-to-default 등 다른 룰은 agent prompt 인용에 의존.

**Trigger 조건**: god file hook 효과 측정 (1-2 sprint) 후 다음 셋 중 하나 만족 시:
- 신규 god file 발생률 감소 명확 (예: 신규 god file 0건 in 2 sprint)
- 다른 룰에서 같은 silent failure 패턴 발견 (mock-scope 회귀 등)
- 사용자가 명시 요청

**범위**:
- `scripts/generate-hooks.sh` — frontmatter `trigger.layer: hook` 룰 → 자동 lefthook entry + scripts/check-*.sh 템플릿 생성
- `scripts/generate-agent-prompts.sh` — frontmatter `trigger.layer: agent-prompt` 룰 → 해당 agent definition system prompt 에 자동 inject
- 각 룰에 `trigger:` 필드 retrofit (점진 — 새 룰 / 만지는 룰 부터)

### D2 — Multi-worktree 자동화

사용자 목표 1. 현재 `.claude/worktrees/` 빈 디렉토리, harness skill `"No worktree assumption"` 명시.

**범위**:
- `.claude/commands/worktree-spawn.md` 신설 — `git worktree add .claude/worktrees/<sprint-N> <branch>` + agent 부팅
- harness skill 에 `isolation: "worktree"` 옵션
- `delivery` agent 가 multi-worktree 의 각 worktree 자율 책임 (subagent 약한 해석 적용)
- 충돌 가드: pre-bash.sh 에 worktree 외부 경로 write 차단

### D3 — Sprint INDEX 자동 생성

**현 상태**: `docs/sprints/` 377 dir, INDEX 없음 → 탐색 비용 큼.

**범위**:
- `scripts/regenerate-sprint-index.sh` — `docs/sprints/*/handoff.md` frontmatter (phase / status / scope) 읽어 `docs/sprints/INDEX.md` 생성
- 각 sprint dir 의 README.md (1줄 frontmatter) 강제
- handoff.md 첫 줄에 `## Status: PASS|FAIL` 표식 (본 sprint 의 패턴)

### D4 — Glossary / domain language

사용자 첫 메시지 갭. CONTEXT.md 부재.

**범위**:
- `memory/glossary/memory.md` — 도메인 용어 (focusedConnId, DbAdapter, envelope, paradigm-aware, SchemaCache, single-instance, state-changed event, per-tab affinity, tri-state null, numeric wire string) 한 줄 정의 + 정의 ADR/lesson cross-link
- 신규 어휘 (Q번호 시리즈, 사용자 결정 lock 시 만들어진 용어) 자동 등록

### D5 — Index polish

**현 상태**: by-surface 의 yaml string quote (`'**/*.ts, ...'`) 가 awk 추출 시 키에 단일 인용부호 포함. Link 작동, 표시만 어색.

**범위**:
- `scripts/regenerate-indexes.sh` 의 awk 에 `gsub(/^['\''"]/, "", k); gsub(/['\''"]$/, "", k);` 1줄 추가

### D6 — 기존 god file 정리 (43개)

**현 상태**: ESLint max-lines warn 으로 식별. 우선순위 표:

| 영역 | 파일 수 (대략) | 우선순위 |
|---|---|---|
| `src/lib/mongo/**` (parser, autocomplete) | 5+ | 중 — feature dev 활발 영역 |
| `src/stores/**` (workspace, connection) | 3+ | 고 — refactoring sub-room 룰 적용 직접 후보 |
| `src/hooks/*.test.ts` (useSqlAutocomplete) | 1 | 저 — test 파일 (메타 보존 우선) |
| `src/lib/sql/cteColumnCompletion.ts` | 1 | 중 |
| `src-tauri/src/db/postgres/**`, `db/mongodb/**` | (별 sprint 누적) | 중 |

각 god file 의 시퀀스: 주석 단순화 → memory 이관 → 그래도 크면 5+ commit 리팩토링 (`memory/conventions/refactoring/god-file/memory.md`).

### D7 — Frontmatter retrofit

**현 상태**: 신규 11 메모리 방만 task / surface 필드. 기존 메모리 (ADR 43 + lesson 다수 + conventions / roadmap) 는 미적용 → index 에 빠짐.

**범위**:
- 점진 — `/remember` 호출 / 기존 메모리 갱신 시점에 task / surface 추가
- 일괄 retrofit 은 별 sprint (D4 와 묶임 가능)

### D8 — Codex-reviewer 자동 호출 안 함

본 sprint 의 13번 결정 — codex 사용은 사용자 명시 호출 시만. 자동 호출 금지. `codex-reviewer` agent definition 에 명시. 단 *사용자에게 옵션 제시* 는 가능 — delivery 의 review step 에서 "외부 리뷰 받을까?" 옵션. 후속 sprint 에 사용 빈도 모니터.

## Commit / push

본 sprint 의 산출물은 메모리 / 정책 / agent / hook / skill 변경 묶음. 코드 0 변경.

- **Commit**: `delivery` agent 룰 적용 — assistant 직접 commit. 메시지 형식 `chore(memory): sprint-386 — memory palace + agent harness 인프라 개선`.
- **Push**: pre-push hook 통과 후 자동. 본 sprint 가 코드 미변경이라 e2e 게이트 통과 비용 낮음.
- **PR**: `gh pr create` — title "Sprint 386: memory palace + agent harness 인프라". body 에 본 handoff link.
- **Review**: 사용자에게 "외부 codex 리뷰 받을까?" 옵션 제시 가능 (codex-reviewer agent — 단 사용자 호출 시만).
- **Merge**: 사용자 정책 확인.

## 사용자 다음 세션 시 진입 path

1. `memory/memory.md` 의 30초 path — 작업 type 식별.
2. 작업이 *bug-fix* / *grill* / *implementation* / *delivery* / *refactor* / *측정* 중 하나면 `memory/workflow/<phase>/memory.md` 또는 `memory/runbook/<topic>/memory.md` 진입.
3. agent spawn 시 `.claude/agents/<name>.md` 의 시스템 prompt 가 자동 적용 — caveman 모드 + 본 sprint 의 룰 인용.
4. god file 작업 시 PostToolUse hook 이 자동 stderr 경고.

## 관련

- 사용자 6 목표 진전: 2 (인덱싱) / 3 (hook 강제) / 4 (TDD harness) / 5 (grill html) / 6 (caveman 자동) — 직접 달성. 1 (multi-worktree) 는 D2 deferred.
- 14 결정 lock 의 reframe 6건 = 본 sprint 의 grill 패턴 자체가 *옵션 분해 두 축 + 사용자 reframe* 룰을 self-bootstrap.
