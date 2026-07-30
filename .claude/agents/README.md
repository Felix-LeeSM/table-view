# `.claude/agents/` — Claude Code agent wrappers

Claude Code 가 `Agent` tool 로 spawn 하는 agent 정의. **여기가 그 agent 의
정본이다** — tools / model / `skills:` / 금지가 여기 있고, 긴 절차는
`skills:` 주입과 `memory/` 방으로 내려간다. `.codex/agents/*.md` 는 이 파일을
`source` 로 가리키는 포인터다.

## 현재 7종

| agent | 역할 | `skills:` |
|---|---|---|
| `issue-refine` | raw → 작업 티켓 승격 | — |
| `issue-implement` | 구현 → 커밋 → 푸시 → PR 생성 | `delivery`, `tdd`, `pr-create` |
| `pr-reviewer` | 판정 coordinator, 관점 fan-out | `pr-review` |
| `pr-subreviewer` | 관점별 read-only 수집 | `pr-review` |
| `research` | 사실 수집 (nesting 으로 호출) | — |
| `codex-reviewer` | 외부 시각 리뷰 (사용자 호출 시만) | — |
| `security-handoff` | 보안 결정 핸드오프 (사용자 호출 시만) | `grill-with-memory` |

## 패턴

```yaml
---
name: <agent-name>
description: <한 줄 — Claude Code 가 spawn 판단에 사용>
tools: [Read, Edit, Write, Bash, ...]
model: opus | sonnet | haiku   # 선택 — 생략하면 부르는 쪽 모델을 물려받는다
skills: [<skill-name>]         # 선택 — 스킬 본문 전문이 주입된다
---

작업 시 read:
1. memory/<source-room>/memory.md (룰)
2. 조건부 read (보안 키워드 / god file 등)
```

## `model:` 은 정의에 못 박지 않는다 (2026-07-30 사용자 결정)

7종 전부 `model:` 을 비워 두고 **부르는 쪽이 필요에 따라 고른다.**

- 단순 탐색 → `haiku`
- 어느 정도 판단이 필요 → `sonnet`
- 꼼꼼해야 함 → `opus`
- **`fable` 은 사용자가 명시적으로 요청했을 때만.** 기본 선택지에서 뺀다

**넷째 줄은 선택 사항이 아니다.** 고정을 풀면서 이걸 안 적으면 하드코딩이 막고
있던 선택을 그대로 되살린다. `model:` 줄 삭제와 이 문단은 같은 커밋에 들어간다.
(하드코딩 8건이 애초에 `fable` 을 막으려던 장치였다는 **가설**이 있으나 확인된
이력은 아니다 — `sprint-386/findings.md:50` 은 "토큰 비용 vs 품질 trade-off" 만
적었고 `fable` 을 언급하지 않는다.)

**생략하면 부르는 쪽 모델을 물려받는다 — 실측이다.** `model` 키 없는 정의를
`Agent` 로 띄우고 `claude -p --output-format json` 의 `modelUsage` 키를 읽었다.
4칸 전부 부모를 따라갔다 (`claude --version` → `2.1.220`):

| 정의 | 부모 `--model` | `modelUsage` |
|---|---|---|
| `--agents` 인라인 | `haiku` | `claude-haiku-4-5-20251001` |
| `--agents` 인라인 | `sonnet` | `claude-sonnet-5` |
| `.claude/agents/research.md` | `haiku` | `claude-haiku-4-5-20251001` |
| `.claude/agents/research.md` | `sonnet` | `claude-sonnet-5` |

고정 기본값이면 네 칸이 같은 이름을 냈을 텐데 부모를 따라 갈렸다.
**안 쟀다**: `opus` 부모, 그리고 `model:` 을 **적은** 정의가 부모와 다를 때.

이 결정이 `docs/sprints/sprint-386/findings.md:50` 의 "사용자 model lock = opus"
를 번복한다. 그 기록은 지우지 않았다 — 무기록 번복이 애초에 #1975 가 이 항목을
찾아낸 이유다.

## 룰

- **cap 은 `wc -l` 이 세는 파일 전체 줄수다. frontmatter 를 포함하고 README.md
  는 제외한다.** `.claude/agents` 와 `.codex/agents` 모두 ≤ 15. 근거는
  `scripts/hooks/policy/check-wrapper-cap.sh` 헤더가 소유한다. 옛 판이 "본문
  9-15줄" 이라고 적어 스크립트(파일 전체 ≤ 15)와 정의가 두 벌이었다 (#1975).
- **절차는 `skills:` 로 주입하고 wrapper 에 옮겨 적지 않는다.** 아래 실측 참조.
- main read (해당 agent 본인 룰) 는 강제, 조건부 read 만 진짜 lazy.
- frontmatter `name` / `description` / `tools` 필수, `model` / `skills` 선택.
  subagent spawn 도구명은 `Agent` (구세대 별칭 `Task` 금지 — drift 소스).
- **중첩 spawn 은 된다 — 한도는 깊이다.** subagent 도 `Agent` 로 또 다른 subagent 를
  spawn 한다. 기본 한도는 main 대화 아래 **3층**이고, 한도에 닿은 층부터 Claude
  Code 가 subagent 에게서 `Agent` 를 회수한다 (fork 만 예외).
  `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` 로 한도를 바꾸고 `1` 이면 중첩이 꺼진다
  (공식 문서 "Let subagents spawn their own subagents", `claude --version` →
  `2.1.220`). **이 저장소의 깊이 예산은 2다** — `orchestrator`(main) →
  `pr-reviewer`(1층) → `pr-subreviewer`(2층), 한 층 남는다. `pr-subreviewer` 가
  `tools` 에서 `Agent` 를 안 받는 것은 한도 때문이 아니라 잎으로 두려는 선택이다.
  spawn 이 실패하면 (깊이 한도 초과, 일시적 실패) fan-out coordinator
  (`pr-reviewer`) 는 관점-순차 단독 검증으로 강등한다 — 기준·fallback SOT 는
  `.agents/skills/pr-review/SKILL.md` Review Pack.
- **플랫폼 제약을 적을 때는 측정 인용을 같이 적는다.** "하네스가 X 를 막는다" 류
  문장에는 잰 명령과 버전, 또는 공식 문서 인용을 붙인다 (`claude --version` →
  `2.1.220`, `(#1931 프로브)` 처럼). 증상 하나를 보고 제약을 추론해 적지 않는다 —
  #1023 이 구식 도구명 `Task` 하나에서 "중첩 spawn 불가" 로 건너뛰었고, 그 거짓이
  3 SOT 에 3주 넘게 살아남아 설계 전제로까지 들어갔다 (#1930). 같은 파일의
  `tools` 에 `Agent` 가 이미 들어 있었는데도 아무도 몰랐다.
- 공통 규칙을 한 wrapper 에만 적어 두지 않는다. agent 정의 파일 간 상속
  메커니즘이 없어 나머지 agent 에는 전달되지 않는다 — 아래 "subagent 가 보는 것"
  참조.

## subagent 가 보는 것 (상속 두 가지를 구분)

**agent 정의 파일끼리는 상속이 없다.** `.claude/agents/*.md` 는 각각 독립
프롬프트다. 한 wrapper 가 다른 wrapper 의 본문을 물려받는 경로는 없다.

**subagent 는 `CLAUDE.md` 를 물려받는다.** 도구 사용 0회 프로브(#1864 측정 1)로
확인 — subagent 컨텍스트에 repo `CLAUDE.md`, 그리고 `~/.claude/CLAUDE.md` 가
`@` import 한 `~/.agents/AGENTS.md` 본문이 있었다. 반면 repo 루트 `AGENTS.md`
본문은 없었다 — 그때 `CLAUDE.md` 가 마크다운 링크로만 가리켰기 때문이다. 즉
**`@` import 는 따라가고 마크다운 링크는 안 따라간다.** #1865 가 그 링크를
`@AGENTS.md` 로 바꿔 지금은 도달한다. 여전히 링크로만 걸린 문서
(`memory/index/by-surface.md`, `docs/PLAN.md`)는 spawn prompt 에 경로를 직접
적어야 subagent 가 읽는다.

**`.claude/rules/` 는 링크와 무관한 별도 채널이고, 규칙은 하나다** —
**`paths` 선택자가 없거나 매치하면 붙고, 선언했는데 안 매치하면 안 붙는다.**
`frontmatter 없음`(`README.md`)과 `paths: ["**"]`(`git-policy.md`)는 두 개의
특례가 아니라 같은 상태의 두 표기다: `git-policy.md` 의 frontmatter 를 통째로
지워도 도달이 그대로였다. 나머지 넷은 자기 glob 에 매치할 때만 붙는다. 그래서
`CLAUDE.md` 의 링크 셋 중 `git-policy.md` 만 도달하는데, 그것도 링크가 아니라
선택자 때문이다 — 링크를 지운 칸도 도달했고, 선택자를 좁힌 칸은 링크가 있어도
도달하지 않았다 (#1978 프로브, `claude 2.1.220` / haiku, 6칸, `tool_uses: 0`).
공통 룰을 좁은 glob wrapper 에 두면 그 확장자를 안 건드리는 subagent 는 못 본다.
**아직 안 쟀다**: 좁은 glob 이 실제로 매치하는 파일을 편집할 때 붙는지 — 6칸은
"매치할 작업이 없는" 음성 조건만 쟀다.

**frontmatter `skills:` 는 스킬 본문 전문을 spawn 된 subagent 에 주입한다.** 도구
사용 0회 프로브(#1931, `claude 2.1.220` / haiku)로 확인 — `skills:` 를 단 정의로
spawn 한 subagent 는 저장소에 없는 표식을 그대로 인용했고, 그 필드 하나만 뺀
대조군은 `tool_uses: 0` 에서 못 했다. 들어간 것은 스킬 파일 **본문 + base
directory 한 줄**이고 frontmatter `description` 은 안 들어갔다. **심링크도
주입된다** — 이 저장소가 쓰는 리포 내부 상대 심링크
(`.claude/skills/remember → ../../.agents/skills/remember`)와 저장소 밖 절대
심링크 둘 다 본문이 들어왔고 토큰 차 +3003 이 본문 두 개 분량과 맞았다 (#1978 이
#1944 를 같은 틀로 닫았다). 주입되는 base directory 는 resolve 된 실경로가 아니라
심링크 경로 그대로다. 도달 표면은 둘만 쟀다:
`Agent` tool 로 spawn 하면 오고, 같은 정의를 `claude --agent <name>` 으로 세션
본체에 걸면 안 온다. 정의를 새로 쓰거나 고쳐도 **즉시 반영되지 않는다** — 파일을
쓴 직후 spawn 은 `Agent type '<name>' not found` 로 실패했고 같은 세션
뒤쪽에서는 성공했다. 갱신 트리거와 지연은 안 쟀으니 반영 확인은 새 세션에서
해라. 스킬 파일은 반대로 쓴 직후 목록에 붙는다.

**같은 프로브로 잰 나머지 frontmatter 필드.** `memory: project` 는
`<project>/.claude/agent-memory/<agent-name>/` 를 만들고 그 경로를 주입한다
(`user` / `local` 은 안 쟀다). `isolation: worktree` 는
`.claude/worktrees/agent-<id>` 에서 돌고, 변경이 없으면 자동 정리된다.
`maxTurns` 는 걸리는데 한도에 걸린 subagent 는 **반환값을 통째로 잃는다** —
인계를 반환에 싣는 노드에는 걸지 마라. `hooks:` 는 `PreToolUse` 가 발화했고
`SessionStart` / `SubagentStart` 는 발화하지 않았다. `PostToolUse` 등 나머지
이벤트는 안 쟀다. **여기서 잰 표면은 frontmatter 뿐이다.** `settings.json` 은
다른 표면이고 거기 걸린 `SubagentStart` 는 지금 실제로 돈다 — 아래 ponytail 주입
문단이 그 반례다. 그러니 "시작 지점 강제가 불가능" 이 아니라 **frontmatter 에
시작 이벤트가 없을 뿐**이다. `settings.json` 레벨은 #1943 이 잰다. frontmatter
YAML 이 깨지면 그 정의는 **에러 없이 목록에서 사라진다** — stderr 에도
`-p --debug` 파이프에도 안 뜬다. 진단은 파일에 남는다:
`grep -rh "Failed to parse YAML frontmatter" ~/.claude/debug/`. 따옴표 없는
스칼라에 `: ` 를 넣지 마라. 명령·출력 전문과 재현 절차는 #1931 코멘트.

`CLAUDE.md` / `AGENTS.md` 는 세션 시작 시 스냅샷으로 잡힌다. 고쳐도 진행 중인
세션에는 안 먹으므로 반영 확인은 새 세션에서 한다(#1864 측정 2). 단 스냅샷이
세션당 하나는 아니다 — 다른 checkout 의 파일을 건드리면 그쪽 `CLAUDE.md` 가
중간에 추가로 주입된다. worktree 를 오가는 세션은 두 버전을 다 보게 된다. 훅은
subagent spawn 마다 다시 실행되므로 즉시 반영된다.

ponytail(lazy 구현) 을 모든 subagent 에 거는 주입은 **userspace**
`~/.claude/settings.json` 의 `SubagentStart` 훅
(`~/.agents/hooks/subagent-rules.js`, repo 밖) 이 런타임에 수행한다. 같이 걸려
있던 출력 압축 모드 주입은 2026-07-29 에 제거했다(#1864).

주입 훅을 repo (`scripts/hooks/`) 로 이관해 `.claude/settings.json` 에 등록하는
방안(#1022)은 런타임/userspace 를 건드리므로 사람 결정 대기 — 본 문서는 정정만.

## Multi-brain 호환

각 brain 별 디렉토리 (`.codex/agents/`, `.cursor/agents/`) 는 **이 디렉토리의
같은 이름 파일을 `source` 로 가리키는 포인터**다. 룰 prose 를 그쪽에 복제하지
않는다 — 복제했더니 9쌍 중 8쌍이 본문 drift 였고, 그중엔 역할이 정반대인 쌍도
있었다 (#1975). 협업/코드 룰의 SOT 는 계속 `memory/`, skill 본문은
`.agents/skills/` 다.

## 관련

- `AGENTS.md` — universal entry (work-type → memory 매트릭스)
- `memory/memory.md` — 팔레스 입구
- `memory/workflow/memory.md` — 협업 phase 룰
- `memory/engineering/conventions/memory.md` — 코드 룰
- `.claude/rules/README.md` — auto-load rule wrapper 정책
- `.agents/skills/remember/SKILL.md`, `.agents/skills/split-memory/SKILL.md` — agent skill source
