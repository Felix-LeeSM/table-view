# Agent Entry: universal

Claude Code 와 Codex, Cursor 는 모두 이 파일을 한 번 읽는다. 본문은 lazy 하게 두고,
작업할 때는 아래 매트릭스만 보고 필요한 방까지 한두 단계만 더 내려간다.

## 작업 체계 선언: 이 repo 의 작업은 노드 워크플로를 따라 진행된다

**모든 작업이 이 체계를 거친다.** 노드는 행동 하나만 끝내고 그 결과를 label 과
GitHub 산출물로 남긴 뒤 종료한다. 다음 노드는 그렇게 남은 상태를 보고 시작한다.

- **interface**: 사용자와 대화하는 top-level 세션이다. 설계 결정을 기록하고 `raw` 를
  `task` 로 승격한다. 계약은 `memory/workflow/interface/memory.md` 가 갖는다.
- **orchestrator**: label 을 보고 다음 노드를 spawn 한다. 저장소에 커밋된 프롬프트
  `.agents/prompts/orchestrator.md` 로 기동한다.
- **구현자 · 리뷰 coordinator · 종결자(pr-finalize)**: 고정부는
  `.agents/prompts/<role>.md` 이고, 계약은 `memory/workflow/` 아래의
  implementation · delivery · review 방이 갖는다.

**역할 preamble 을 받지 못했는데 사용자와 대화하고 있다면 너는 interface 다.**
먼저 `memory/workflow/interface/memory.md` 를 읽어라.

소스 수정은 독립 clone 사본에서만 하고(`memory/runbook/worktree/memory.md`), 모든
변경은 `task` 이슈 → PR → required gate 를 순서대로 거친다. **예외는 없다.** 집행
장치가 없으니 이 규칙을 지키는 주체는 agent 자신이다.

## 작업 type → 먼저 read

| 작업                   | path                                                   |
| ---------------------- | ------------------------------------------------------ |
| 기능 빌드 / 구현 / 코드 작성 | `memory/workflow/implementation/memory.md` (agent 자율성·noise 차단) |
| 버그 / 회귀            | `memory/workflow/bug-fix/memory.md` (Red→Green 순서) + `.agents/skills/diagnosing-bugs/SKILL.md` (원인을 찾는 진단 루프) |
| 리팩토링 / 아키텍처    | `memory/engineering/conventions/refactoring/memory.md` |
| TDD / RED evidence     | `memory/workflow/tdd/memory.md`                        |
| commit / PR            | `memory/workflow/delivery/memory.md`                   |
| PR review              | `memory/workflow/review/memory.md`                     |
| 병렬 작업 / 이슈 발행  | `memory/workflow/orchestration/memory.md` (spawn·리뷰 큐·사이클 정지·이슈 수용기준) + `memory/workflow/interface/memory.md` §2 (누가 언제 여는가: scorecard non-blocking 스윕) |
| subagent spawn / 역할 프롬프트 | `.agents/prompts/` 가 orchestrator·issue-implement·pr-review·pr-subreview·pr-finalize 의 고정부를 갖는다. **자동으로 도달하지 않는다**: spawn 할 때 파일을 그대로 첨부하거나 `.claude/agents/<role>.md` 정의가 첫 행동으로 읽는다 |
| 사용자 대화 / 설계 결정 / raw→task 승격 | `memory/workflow/interface/memory.md` (top-level 세션 전용) |
| 문서화 / PR body       | `memory/workflow/documentation/memory.md`              |
| 한국어 산문 작성       | `.claude/output-styles/fluent-korean.md` 를 읽는다. 조사와 어미, 의미가 있는 문장 성분을 생략하지 않고 완성된 문장으로 끝맺게 하는 문체 기준이다. `.claude/settings.json` 이 이 파일을 기본 output style 로 지정해 두지만, output style 은 main conversation 에만 실리므로 **spawn 된 노드에는 전달되지 않는다.** 노드가 직접 열어야 지침이 도달한다. |
| git / PR / push reject | `memory/workflow/git-policy/memory.md` (금지 목록·계약) + `.agents/skills/recovering-push-rejects/SKILL.md` (4-step 회복·SHA refspec·stale ref) |
| 머지 충돌 해소         | `.agents/skills/resolving-merge-conflicts/SKILL.md`     |
| PR merge 막힘 / BLOCKED | `memory/runbook/pr-merge-gates/memory.md` (required context 목록·계약) + `.agents/skills/diagnosing-merge-gates/SKILL.md` (진단 순서·트리거 함정) |
| 작업 사본 격리 (clone) | `memory/runbook/worktree/memory.md`                    |

코드를 수정하기 전에는 `memory/index/by-surface.md` 에서 해당 surface 의 active
rule 묶음을 읽는다.

**이 인덱스는 직접 찾아가야 온다.** 편집한 파일의 surface rule 을 컨텍스트로 넣어
주는 장치는 없으므로 스스로 열어야 한다. 막히면 **에러 문자열을 그대로 `rg`**
해라. 각 방의 frontmatter 에 있는 `keywords:` 줄이 정확한 에러 문구와 명령 이름,
한국어·영어 동의어를 인덱싱해 두었기 때문이다. 방을 추가하거나 수정하면
`keywords:` 줄도 같이 관리한다.

surface 디렉터리(`src/` 등)에 있는 `AGENTS.md` 는 해당 surface rule 로 가는 3~5줄
포인터만 둔다. 규칙 본문은 `memory/` 에 둔다. 본문을 옮겨 적으면 SOT 가 둘로
갈라지기 때문이다.

**spawn 된 subagent 에 자동으로 도달하는 채널은 `CLAUDE.md` 와
`.claude/agents/<role>.md` 둘이다.** `CLAUDE.md` 와 그 파일의 `@` import 는
범용이라서 harness 도 spawn 방식도 가리지 않는다 (이 파일도 그 경로로 전달된다).
`.claude/agents/<role>.md` 정의 body 는 Claude Code 가 `subagent_type` 을 지정해
실행한 subagent 의 system prompt 로 실린다. **역할 정의가 `CLAUDE.md` 를 대체하지
않는다**: 역할을 지정하지 않은 spawn 과 다른 harness 에는 여전히 `CLAUDE.md` 뿐이다.
**마크다운 링크는 자동으로 따라가지 않으므로** 매트릭스에 적힌 경로는 agent 가
스스로 읽어야 한다.

`.agents/skills/` 에는 긴 절차를 담은 skill 이 있고, 매트릭스가 가리키는 것이
전부다. **어떤 harness 도 이 skill 을 자동으로 읽지 않는다.** Claude Code 가
스캔하는 skill 경로는 `~/.claude/skills/` 와 `.claude/skills/` 둘뿐이라서
`/diagnosing-bugs` 같은 슬래시 호출도 되지 않는다. memory 와 똑같이 매트릭스에서
경로를 보고 직접 열어야 도달한다.

## 강제 룰

아래 룰에서 **기계가 검사하는 것은 하나뿐이다.** memory cap 가운데 크기에 해당하는
절반만 CI 가 검사한다(`bash scripts/check-memory-doc-size.sh`, #2128). 나머지는
어겨도 아무도 막지 않으므로 agent 가 스스로 지킨다.

- `memory/` 트리에는 `memory.md` 만 두고, 그 트리의 `memory.md` 는 저마다 270줄과
  14,000 chars 를 둘 다 cap 으로 지킨다. 크기 상한 두 가지는 CI 가 검사하고,
  `memory.md` 만 두라는 쪽은 규율로만 지킨다.
- workflow 와 runbook memory 는 행동 계약만 둔다. 긴 절차는 `.agents/skills/` 로
  옮기고 memory 에는 계약과 그 경로만 남긴다. 무엇이 계약이고 무엇이 절차인지는
  `memory/runbook/memory.md` 「계약 / 절차 경계」가 판정한다. skill 은 어떤
  harness 도 자동으로 읽지 않으므로 **위 매트릭스 행과 memory 에 남는 포인터**가
  유일한 도달 경로다. 절차를 옮기면 그 둘을 같은 커밋에서 함께 고친다.
- ADR 본문은 동결한다. 결정을 뒤집으려면 새 ADR 을 쓰고 원본을 `Superseded` 로
  넘기는데, 두 ADR 의 프론트매터에 무엇을 적고 인덱스에서 원본을 어디로
  옮기는지까지 포함한 절차는 `docs/decisions/memory.md` 「작성 규칙」이 갖는다.
  ADR 본문은 `docs/decisions/` 아래에 있다.
- git 과 hook 을 회피하지 않는다. 대표적인 예가 `--no-verify` 와 force-push 다.
  SOT 는 `memory/workflow/git-policy/memory.md` 하나이고, 실제로 차단해 주는 장치는
  없다.
- primary 체크아웃은 orchestration 전용이다. `AGENTS.md` 와 `memory/*`,
  `.agents/*` 를 뺀 나머지는 편집하지 않고, 소스는 독립 clone 사본에서 고친다
  (`memory/runbook/worktree/memory.md`).

## 더 깊이

- `memory/memory.md`: 팔레스 입구다.
- `docs/PLAN.md`: roadmap 과 product 의 인덱스다.
- `docs/ROADMAP.md`: 미래 목표와 다음 후보를 담는다.
