# Claude Code Entry

`AGENTS.md` 가 universal source다. Claude Code 는 이 파일을 먼저 읽고, 규칙
본문은 `AGENTS.md` 와 거기에 해당하는 memory·docs SOT 를 찾아가서 읽는다.

## 프로젝트 한 줄 요약

Tauri 2.0 과 React, Rust 로 만드는 TablePlus 계열 로컬 DB 도구이며, 여러 DBMS 를
지원한다.

## 작업 전 read

@AGENTS.md

위 한 줄은 링크가 아니라 import 다. `AGENTS.md` 본문, 즉 작업 type 을 memory
path 로 잇는 매트릭스와 「강제 룰」이 이 컨텍스트에 그대로 실린다. 링크로 적혀
있던 시기에는 그 본문이 spawn 된 subagent 에 전달되지 않았다 (#1865 측정). 이 줄을
지우면 전달이 끊긴다. **모든 harness 와 모든 spawn 에 도달하는 유일한 범용
채널이기 때문이다.** Claude Code 가 `subagent_type` 을 지정해 실행한 노드에는
`.claude/agents/` 에 있는 역할 정의의 body 가 두 번째 자동 채널로 더 실리지만, 그
채널은 역할을 지정한 spawn 에만 전달되므로 이 import 를 대체하지 못한다.

- [`memory/index/by-surface.md`](memory/index/by-surface.md): 코드나 문서를
  수정하기 전에 해당 surface 의 active rule 묶음을 여기에서 확인한다. import 가
  아니라 링크이므로 직접 열어야 한다.
- [`docs/PLAN.md`](docs/PLAN.md): product 와 roadmap, contributor SOT 를 모아 둔
  인덱스다.
- [`docs/README.md`](docs/README.md): docs 인덱스이면서 검색 요령의 SOT 다. 루트
  `.ignore` 가 제외 목록을 지정해 두므로 **기본 `rg` 결과는 저장소 전수가
  아니다.** 전수는 `git grep` 으로 다시 재고, 제외 목록과 그것을 되살리는 방법은
  저 문서에서 읽는다. **`grep` 은 거기에서 또 다르게 동작한다.** 셸 함수라서
  `rg` 보다 **더 많이 보고**(`docs/archives` 와 dot 디렉터리까지 본다), binary 로
  판정된 입력에서는 rc=1 을 내면서 빈 출력을 낸다. 같은 문서의 「이 harness 의
  `grep` 은 `rg` 와 다른 집합을 낸다」 절이 그 근거다.
- git 과 hook 을 회피하지 말라는 금지의 SOT 는
  `memory/workflow/git-policy/memory.md` 다. 위 링크를 스스로 열지 않으면 그
  내용이 아무것도 전달되지 않고, 금지를 어겨도 막아 주는 장치가 없다.

## 강제 룰

- Claude 전용 정책을 이 파일에서 따로 만들지 않는다. 내용이 충돌하면
  [`AGENTS.md`](AGENTS.md) 가 우선한다.
- memory cap 과 ADR 동결, git·hook 회피 금지의 SOT 는 위 import 로 실리는
  `AGENTS.md` 「강제 룰」이다. 그 내용을 여기에 복제하면 두 사본이 서로 어긋난다.
