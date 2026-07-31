# Agent Entry — universal

Claude Code / Codex / Cursor 모두 본 파일 1번 read. 본문 lazy, 작업 시 매트릭스만 보고 1-2 방 내려간다.

## 작업 체계 선언 — 이 repo 의 작업은 노드 워크플로로 돈다

**모든 작업이 이 체계를 지난다.** 노드는 행동 하나만 끝내고 결과를 label 과
GitHub 산출물로 남긴 뒤 종료한다 — 다음 노드는 그 상태를 보고 뜬다.

- **interface** — 사용자와 대화하는 top-level 세션. 설계 결정 · `raw` → `task`
  승격. 계약 `memory/workflow/interface/memory.md`.
- **orchestrator** — label 을 보고 다음 노드를 spawn. 커밋된 프롬프트
  `.agents/prompts/orchestrator.md` 로 기동.
- **구현자 · 리뷰 coordinator · 종결자(pr-finalize)** — 고정부
  `.agents/prompts/<role>.md`, 계약은 `memory/workflow/` 의
  implementation · delivery · review 방.

**역할 preamble 을 못 받았는데 사용자와 대화 중이면 너는 interface 다** — 먼저
`memory/workflow/interface/memory.md` 를 읽어라.

소스 수정은 독립 clone 사본에서만 하고(`memory/runbook/worktree/memory.md`), 모든
변경은 `task` 이슈 → PR → required gate 를 지난다. **예외 없다** — 집행 장치가
없으니 지키는 것은 agent 자신이다.

## 작업 type → 먼저 read

| 작업                   | path                                                   |
| ---------------------- | ------------------------------------------------------ |
| 기능 빌드 / 구현 / 코드 작성 | `memory/workflow/implementation/memory.md` (agent 자율성·noise 차단) |
| 버그 / 회귀            | `memory/workflow/bug-fix/memory.md` (Red→Green 순서) + `.agents/skills/diagnosing-bugs/SKILL.md` (원인을 찾는 진단 루프) |
| 리팩토링 / 아키텍처    | `memory/engineering/conventions/refactoring/memory.md` |
| TDD / RED evidence     | `memory/workflow/tdd/memory.md`                        |
| commit / PR            | `memory/workflow/delivery/memory.md`                   |
| PR review              | `memory/workflow/review/memory.md`                     |
| 병렬 작업 / 이슈 발행  | `memory/workflow/orchestration/memory.md` (spawn·리뷰 큐·사이클 정지·이슈 수용기준) |
| subagent spawn / 역할 프롬프트 | `.agents/prompts/` — orchestrator·issue-implement·pr-review·pr-finalize 고정부. **자동 도달 아니다**: spawn 시 파일을 그대로 첨부하거나 `.claude/agents/<role>.md` 정의가 첫 행동으로 읽는다 |
| 사용자 대화 / 설계 결정 / raw→task 승격 | `memory/workflow/interface/memory.md` (top-level 세션 전용) |
| 문서화 / PR body       | `memory/workflow/documentation/memory.md`              |
| git / PR / push reject | `memory/workflow/git-policy/memory.md`                 |
| 머지 충돌 해소         | `.agents/skills/resolving-merge-conflicts/SKILL.md`     |
| PR merge 막힘 / BLOCKED | `memory/runbook/pr-merge-gates/memory.md` (required CI green·review-gate·ruleset 게이트 진단) |
| 작업 사본 격리 (clone) | `memory/runbook/worktree/memory.md`                    |

코드 만지기 전: `memory/index/by-surface.md` (해당 active rule 묶음).

**이 인덱스는 찾아가야 온다.** 편집한 파일의 surface rule 을 컨텍스트로 밀어
주는 장치는 없다 — 직접 열어야 한다. 막히면 **에러 문자열을 그대로 `rg`** 해라:
각 방 frontmatter 의 `keywords:` 줄이 정확한 에러 문구·명령 이름·한/영 동의어를
인덱싱한다. 방을 추가/수정하면 keywords 줄도 같이 관리한다.

surface 디렉토리(`src/` 등)의 `AGENTS.md` 는 해당 surface rule 로 가는 3~5줄
포인터만 둔다. 규칙 본문은 `memory/` 에 — 본문을 옮겨 심으면 SOT 가 갈라진다.

**spawn 된 subagent 에 자동으로 닿는 채널은 둘이다.** ① `CLAUDE.md` 와 그것의
`@` import — 범용이라 harness 도 spawn 방식도 안 가린다 (이 파일이 그렇게 온다).
② `.claude/agents/<role>.md` 정의 body — Claude Code 가 `subagent_type` 을 지정해
띄운 subagent 의 system prompt 로 실린다. **②가 ①을 대체하지 않는다**: 역할을
지정하지 않은 spawn 과 다른 harness 에는 여전히 ①뿐이다. **마크다운 링크는 안
따라간다** — 매트릭스의 경로는 agent 가 스스로 읽어야 한다.

`.agents/skills/` 에는 긴 절차를 담은 skill 이 있다. 매트릭스가 가리키는 것이
전부다. **어떤 harness 도 자동으로 읽지 않는다** — Claude Code 가 스캔하는 skill
경로는 `~/.claude/skills/` 와 `.claude/skills/` 둘뿐이라 `/diagnosing-bugs` 같은
슬래시 호출도 안 된다. memory 와 똑같이, 매트릭스에서 경로를 보고 직접 열어야
온다.

## 강제 룰

아래 룰에는 **집행 장치가 없다.** 어기면 아무도 막지 않으므로 agent 가 스스로
지킨다.

- `memory/` 트리: `memory.md` 만, 200줄 / 12,000 chars cap (둘 다).
- workflow memory 는 행동 계약만 둔다. 긴 절차는 `.agents/skills/` 로 내리고
  memory 에는 계약과 그 경로만 남긴다.
- ADR 본문 동결. 결정 뒤집기 = 새 ADR + `Superseded`. 본문은
  `docs/archives/decisions/`.
- git/hook 회피 금지: 대표 예 `--no-verify` / force-push. SOT 는
  `memory/workflow/git-policy/memory.md` 하나이고 차단은 일어나지 않는다.
- primary 는 orchestration-only: `AGENTS.md` / `memory/*` / `.agents/*` 외 편집
  금지, 소스는 독립 clone 사본에서 — `memory/runbook/worktree/memory.md`.

## 더 깊이

- `memory/memory.md` — 팔레스 입구
- `docs/PLAN.md` — roadmap/product 인덱스
- `docs/ROADMAP.md` — 미래 목표와 다음 후보
