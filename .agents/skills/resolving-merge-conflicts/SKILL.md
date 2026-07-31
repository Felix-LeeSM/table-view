---
name: resolving-merge-conflicts
description: 진행 중인 git merge 충돌을 hunk 단위로 해소한다. 병렬 PR 이 base 를 들일 때, 리뷰 큐 앞 PR 이 머지된 뒤 뒤 PR 을 최신 base 로 올릴 때 읽는다.
---

# 머지 충돌 해소

원본: [mattpocock/skills `engineering/resolving-merge-conflicts`](https://github.com/mattpocock/skills/tree/main/skills/engineering/resolving-merge-conflicts).
검증 명령과 이 저장소의 git 제약을 채웠다.

**이 저장소에서 충돌은 예외가 아니라 기본값이다.** 2026-07-25 실측 — 동시
in-flight 8건에서 28쌍 중 18쌍이 파일 교집합을 가졌고 한 파일을 5개 PR 이 동시에
고쳤다 (`memory/workflow/orchestration/memory.md` §1).

## 여기 오는 길

rebase 는 force-push 를 부르므로 금지다. 최신 base 는 merge 로만 들인다
(`memory/workflow/git-policy/memory.md`, `memory/workflow/orchestration/memory.md` §2).
`git pull` 은 모든 변종이 금지다 — fetch 와 merge 를 나눠 쓴다.

```bash
git fetch origin
git merge origin/main
```

## 1. 현재 상태를 본다

```bash
git status
git log --oneline -5 HEAD MERGE_HEAD
git diff --name-only --diff-filter=U
```

어느 커밋 둘이 만난 것인지, 충돌 파일이 무엇인지 먼저 확정한다.

## 2. 양쪽의 1차 출처를 찾는다

각 충돌마다 **왜 그 변경이 들어갔는지**를 원본까지 따라간다. 커밋 메시지, 그
커밋이 속한 PR, PR 이 닫는 이슈를 읽는다.

```bash
git log --merge -p -- <path>          # 양쪽에서 이 파일을 건드린 커밋만
gh pr list --state merged --search "<path>" --json number,title,url
gh issue view <N> --comments
```

의도를 모르면 해소하지 마라. 충돌 표시만 지우고 한쪽을 고르는 것은 해소가 아니라
한쪽 작업을 조용히 버리는 것이다.

## 3. hunk 단위로 해소한다

- **양쪽 의도를 다 보존한다** — 가능한 한.
- 양립 불가면 **이 merge 의 목표에 맞는 쪽**을 고르고, 버린 쪽의 트레이드오프를
  적는다. 그 기록은 merge commit 메시지에 남긴다.
- **새 동작을 발명하지 않는다.** 충돌 해소는 두 변경의 합집합이지 세 번째 설계가
  아니다. 세 번째가 필요해 보이면 그것은 별도 이슈다.
- 문서 충돌은 문장을 이어 붙이지 말고 **어느 주장이 지금 참인지**로 판정한다.
  같은 사실이 여러 문서에 복제돼 있으면 하나만 고쳤을 때 나머지가 자기모순이
  된다 — `git grep` 으로 복제본을 먼저 센다.
- **항상 해소한다. `git merge --abort` 하지 않는다.** abort 는 지금까지 읽은
  의도를 통째로 버리고 다음 사람이 처음부터 다시 하게 만든다.

## 4. 자동 검사를 돌린다

merge 가 깨뜨린 것을 찾는다. 이 저장소의 검사는 넷이다.

```bash
pnpm lint
pnpm test
pnpm build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
```

충돌 파일이 Rust 였으면 `cargo clippy --manifest-path src-tauri/Cargo.toml` 도
돌린다. 파서 코어를 건드렸으면 WASM 을 다시 만든다 (`pnpm build:sql-wasm` /
`pnpm build:mongosh-wasm`) — 소스만 고치고 WASM 산출물을 그대로 두면 런타임에서
갈린다.

실패가 나오면 그것이 해소가 틀렸다는 신호다. 3으로 돌아간다.

## 5. merge 를 끝낸다

```bash
git add -A
git commit          # merge commit 메시지에 트레이드오프를 남긴다
```

merge 로 온 이상 결과 트리가 의도와 같다는 것은 **트리 비교로 증명한다** —
`git diff <merge-commit> <의도한 트리>` 가 비어야 한다. 커밋 목록이나 diff 요약은
증명이 아니다. rebase 로 되돌아가지 마라: push 된 브랜치의 rebase 는 force-push 를
요구하므로 금지다 (위 「여기 오는 길」).

푸시는 `memory/workflow/delivery/memory.md` 의 계약을 따른다. push 가
non-fast-forward 로 튕기면 `git reset --hard` 나 `git pull --rebase` 로 가지 말고
`git-policy` 의 4-step 회복으로 간다. 그래도 안 풀리면 force 를 시도하지 말고
상황을 보고한다.
