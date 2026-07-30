---
name: pr-review
description: PR 정성 리뷰를 수행할 때 사용. 자동 검증 결과를 입력으로 삼고, test/lint 재실행 없이 profile별 정성 차원(Mock/정합성/Scope/PR body 등)을 평가해 PR comment scorecard와 action items를 작성한다.
---

# PR Review

PR review는 자동 layer와 정성 layer를 분리한다. Hook, lint, typecheck, test,
CI, Required Checks는 자동 layer다. Reviewer는 이 검사를 다시 돌리는 사람이
아니라, 자동 layer가 잡기 어려운 의미 판단을 하는 read-only 평가자다.

## Inputs

1. PR title/body/diff.
2. 대상 sprint가 있으면 `docs/sprints/sprint-<N>/contract.md`.
3. Required Checks가 있으면 `bash scripts/review/run-checks.sh <N>` 출력.
4. 정합성 판단에 필요한 active memory/docs/code.
5. CI 상태가 필요하면 `gh pr checks <N>`.

로컬 절대경로, 임시 파일 경로, worktree 경로를 evidence로 쓰지 않는다. PR comment와
summary에는 repo-relative path 또는 GitHub URL만 남긴다.

## Output Contract

- `pr-reviewer` coordinator는 최종 통합 scorecard를 PR에 직접 comment로 남긴다.
- Subreviewer 결과는 coordinator의 내부 입력이다. Subreviewer는 PR comment를
  남기지 않는다.
- Comment 작성이 도구/권한 문제로 실패하면 최종 응답에 실패 원인과 붙일
  scorecard 본문을 그대로 반환한다.
- 같은 review round에는 통합 comment 1개만 남긴다. follow-up review round는 새
  commit/push 후 별도 comment를 남긴다.

## Boundaries

- Reviewer는 read-only다. commit, push, merge, branch 수정 금지.
- `cargo test`, `pnpm vitest`, `npm run lint` 같은 정량 검사는 재실행하지 않는다.
- 자동 layer 실패는 review 결함으로 보고하되, reviewer가 우회하거나 고치지 않는다.
- 구현 agent의 self-review를 피한다. 가능하면 별도 reviewer agent가 본다.
- External reviewer는 사용자가 명시적으로 요청했을 때만 추가한다.

## Review Pack

`pr-subreviewer`를 spawn하는 것은 `pr-reviewer` coordinator뿐이다. coordinator가
subagent로 떠 있어도 fan-out은 된다 — 중첩 spawn은 막히지 않는다. `pr-subreviewer`는
잎이라 `Agent`를 받지 않는다. 깊이 한도와 이 pack의 깊이 예산은
`.claude/agents/README.md`가 SOT다.

Fan-out은 항상-spawn이 아니라 coordinator의 자율 판단이다. 작은 PR은 단독
평가한다. diff가 대략 800줄 이상, 또는 15파일 이상, 또는 3개 이상 영역
(frontend+backend+ci 등)에 걸치면 전용 read-only `pr-subreviewer`를 관점별로
2-4개 fan-out한 뒤 하나의 scorecard로 합친다. 세 축은 목표치이지 hard gate가
아니고, 경계는 coordinator 재량이다.

`pr-subreviewer` spawn이 실패하면(깊이 한도 초과나 일시적 실패) coordinator는 같은
관점들을 순차 단독 검증으로 강등해 직접 수행하고, scorecard에 "fan-out 불가로
단독 강등" 사실을 명시한다. 강등해도 관점별 발견 수집과 coordinator 단독 판정
규칙은 동일하게 적용한다.

Subreviewer도 이 skill의 Boundaries를 상속한다.
각 subreviewer는 같은 immutable input을 받고, 서로의 결과를 보기 전에 독립
산출물을 반환한다.
Coordinator는 `pr-subreviewer` 외 agent를 subreview 용도로 spawn하지 않는다.
`issue-implement`, `issue-refine`, `codex-reviewer` 같은 write-capable 또는
external reviewer agent는 subreviewer가 아니다.

기본 관점:

- `code-semantics`: runtime/source diff, behavioral regression, edge case.
- `test-quality`: mock 범위, user-facing assertion, RED/contract evidence.
- `sot-scope-docs`: active memory/docs/ADR 정합성, scope, PR body, evidence.
- `security-infra`: credential/destructive/signing/CI/hook/build risk.

선택 규칙:

- `code`: `code-semantics`, `test-quality`, `sot-scope-docs`.
- `docs`: `sot-scope-docs`.
- `infra`: `security-infra`, `sot-scope-docs`.
- `security`: `security-infra`, `sot-scope-docs`, 필요한 `code-semantics`.
- 관련 diff가 없으면 해당 관점은 생략한다. 같은 관점 중복 spawn은 금지한다.

Subreviewer 출력은 `관점`, `발견`, `확인한 범위`, `확인 못 한 범위`만 포함한다.
발견 하나는 (무엇이 틀렸나 / 어디인가 repo-relative / 근거) 셋으로 쓴다.
Subreviewer는 severity를 붙이지 않는다 — blocking 판정은 coordinator 단독
권한이다. Coordinator는 중복을 합친 뒤 발견마다 Verdict의 원칙 1·2·3을 적용해
단 한 번 판정한다. 관점을 늘려도 blocking이 늘지 않는다.

## Profile 선택

우선순위:

1. Sprint contract frontmatter의 `review-profile`.
2. Contract가 없으면 변경 파일로 추론:
   - runtime/source/test 변경 포함: `code`
   - docs/memory/agent wrapper 중심: `docs`
   - hook, CI, build, release tooling 중심: `infra`
   - auth, secret, destructive action, credential, signing 중심: `security`

## 평가 차원

### Mock 범위 (`code`)

- test diff의 `vi.mock(...)` / module mock을 본다.
- 외부 boundary stub은 허용: Tauri `invoke`, network, filesystem, DB adapter 등.
- own code, store, hook, util 전체 mock은 위반으로 본다.
- 사용자가 보는 behavior를 막는 assertion인지 확인한다.

### 정합성 (공통)

- 새 룰/문서/코드가 active memory, ADR archive, 코드 현실과 충돌하지 않는가?
- 같은 source of truth가 wrapper, memory, skill, docs에 중복 구현되지 않았는가?
- repo-owned skill은 `.agents/skills/<name>/SKILL.md`가 source인지 확인한다.
- 외부/plugin/generated/local 영역을 수정하지 않았는가.
- 다른 sprint scope를 침범하지 않았는가.

### Scope (공통)

- contract의 In Scope가 구현되었는가.
- Out of Scope를 건드리지 않았는가.
- invariant와 acceptance criteria가 실제 diff/검증 결과로 충족되는가.
- scope가 없으면 PR body의 명시 목표를 기준으로 본다.

### PR Body / Documentation Impact (공통)

- `Documentation impact`가 변경 내용과 맞는가.
- `Smoke-Test-Plan:`이 있고, runtime journey 영향 판단이 타당한가.
- user-facing, contract, workflow, safety, ops, architecture, risk 변경이
  기존 SOT에 반영되었는가.
- PR body/comment의 evidence가 GitHub에서 확인 가능한가.

### Security (`security`)

- secret/credential/plaintext boundary가 명확한가.
- destructive action에는 dry-run, confirmation, auditability가 있는가.
- threat model 또는 security handoff가 필요한데 빠지지 않았는가.

### Infra (`infra`)

- platform-neutral한가.
- hook/CI/build script가 read-only gate와 repair step을 섞지 않는가.
- local-only path, env, tool assumption을 repo policy로 고정하지 않았는가.

## Scorecard Format

```markdown
## 자동 layer
- <status> <check or source>

## 관점 입력
- <perspective>: 발견 <n>건 — <short basis>

## 정성 차원 (profile: <name>)
| 차원 | 판정 | 근거 |
|---|---|---|
| 정합성 | blocking | docs/ROADMAP.md:488이 #1804 결정을 반전 (반례: ADR 본문) |
| Scope | pass | — |
| PR body | note | 수치 3건에 재현 명령 없음 → #NNNN |

## Action items
1. ...
```

Profile에 적용되지 않는 차원은 출력하지 않는다. "N/A" 행으로 채우지 않는다.
판정 칸은 `blocking` / `note` / `pass` 셋뿐이고, `blocking`은 Verdict 원칙 1의
세 사유에만 근거한다. 점수는 쓰지 않는다 — 앵커가 없어 "몇 점인가"가 판정을
대신해 왔다. 표를 유지하는 이유는 차원 누락 방지이지 점수가 아니다.

## Verdict

판정은 아래 세 원칙에서 매번 재도출한다. 사례를 규칙으로 열거해 늘리지 않는다.

### 원칙 1 — "이 PR이 main을 나쁘게 만드나"만 판정한다

Blocking은 셋뿐이다.

1. 런타임 동작이 틀리거나 사용자 데이터·보안이 위험하다.
2. 이 PR 귀책의 거짓 문장이 main의 SOT에 들어간다.
3. 자동 layer(required check) 실패.

2의 귀책은 넷으로 가른다 — ① 이 PR이 새로 쓴 문장이 거짓 ② 참을 거짓으로
뒤집음(블록을 옮겨 기존 참조가 깨지는 등) ③ 머지가 거짓으로 만듦 ④ PR 이전부터
거짓. ④는 blocking이 아니라 이슈다. 기존 거짓의 도달 범위를 넓혔으면 ②로 본다.

그 외는 전부 non-blocking이다. reviewer가 `gh issue create`로 배출하고 이슈
번호를 scorecard에 남긴다. "후속" 약속만 남기지 않는다. 이슈 수용 기준은
`memory/workflow/orchestration/memory.md` §4가 SOT다 — 완료 조건은 명령 출력
하나이고, 적히지 않은 것은 범위 밖이다.

**Blocking은 폐쇄 집합이다.** memory, 과거 리뷰, 관행이 무엇을 요구하든 그것으로
blocking을 추가하지 않는다. 거기서 온 요구는 note이거나 이슈다. 리뷰 프롬프트에
"특히 파고들 곳"을 열거하지 않는다 — 열린 집합 주장에서 그것은 finding
생성기다. 검증 항목은 착수 전 저자에게 준다.

### 원칙 2 — 판정은 전함수여야 한다

blocking은 반례, 명령 출력, 자동 게이트 중 하나로 뒷받침된다. 셋 다 없으면
blocking이 아니다. 성립 예: "docs/ROADMAP.md:488이 거짓 — 반례로 #1804 본문이
반대 결정". 불성립 예: "근거가 부족하다", "모든 경우에 참인지 확인되지 않았다".

subreviewer 근거가 판정에 부족하면 note로 강등한다. 단 원칙 1의 1은 coordinator가
read-only로 직접 확인한다.

인용한 N곳 외에 더 있다고 주장하려면 그 유형을 전부 뽑는 명령(전수 명령)을
첨부한다.

1. 기존 열거 기계가 커버하면 그것을 쓴다 — `pnpm docs:links`, `pnpm lint`,
   `scripts/check-memory-paths.ts`, `scripts/static-policy/*`. 출력이 곧 대상 전체이고
   선언 기반이라 정당한 hit이 섞이지 않는다.
2. 커버하지 않으면 `rg`를 쓴다. 이건 갭 신호이므로 이슈 후보로 기록한다. 정당한
   hit은 명령 안에서 제외한다. 산문 예외 목록은 금지한다.
3. 정제할 수 없으면 "더 있다"고 주장하지 않는다. 인용한 곳만 지적하고 나머지는 이슈다.

저자는 그 명령의 출력이 0이 될 때까지 고치고 출력을 증거로 낸다. 명령 출력에
없는 것은 그 라운드 범위 밖이다. 이 명령은 해당 PR 안에서 그 유형을 닫는
용도이고, 영구 가드가 필요하면 별도 이슈다.

### 원칙 3 — 라운드는 단조 감소한다

라운드 2 이상은 이전 라운드 blocking의 해소 여부만 판정한다. 신규 발견은
이슈다. 단 원칙 1의 1은 라운드와 무관하게 blocking이다.

위반이 곧 사이클 신호다 — 라운드 k+1의 blocking 집합이 라운드 k의 진부분집합이
아니면 coordinator는 verdict 대신 사이클을 보고한다. 라운드별 blocking 집합
변화, 재발한 유형과 라운드별 건수, 저자가 시도한 것을 낸다. 정지와
재설계 판단은 coordinator가 하지 않는다 — 사이클 지점은 자동 판단이 이미 실패한
곳이므로 저자에게 되돌리지 않고 orchestrator를 거쳐 사용자에게 올린다.

결함이 있으면 다음 라운드의 구현자가 고치고, 그 push에 reviewer가 다시 붙는다.

## Related

- `memory/workflow/review/memory.md` — review phase 행동 계약
- `memory/workflow/delivery/memory.md` — 리뷰 · 라운드 회고 · 머지 구간의 node 별 계약
- `memory/workflow/documentation/memory.md` — Documentation impact gate
- `scripts/review/run-checks.sh` — sprint Required Checks runner
