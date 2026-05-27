---
title: pre-bash hook anchor bypass — bash -c quoted (sprint-387)
type: lesson
updated: 2026-05-18
task: security, hook, regex
surface: scripts/hooks/check-dangerous-bash.sh
---

# pre-bash hook anchor bypass (bash -c quoted)

**상황**: pre-bash PreToolUse hook 이 `bash -c "git push origin main --force"`
같이 따옴표로 감싼 위험 명령을 차단하지 못함 (sprint-387 사용자 검토 중 발견).

**원인**: ERE 패턴 앞 anchor 가 `(^|[[:space:]])` 라 `git` 앞에 큰따옴표 / 작은
따옴표 / 괄호 등 punctuation 이 오면 토큰 경계로 인식 안 됨. 동시에 한 변형
시도 `(^|[^a-zA-Z0-9_/])` 는 `/usr/bin/git` 같은 절대 경로의 `/` 를 제외 set
에 넣어버려 또 다른 bypass 발생.

**재발 방지**: anchor 를 `(^|[^a-zA-Z0-9_])` 로 통일 (slash 제거). 동시에
hook 의 한계 정직히 명시 — string concat / variable substitution / PATH
override / eval split 같은 의도적 우회는 여전히 차단 불가. hook 은
**부주의 방지** layer 한정, 정책 (`memory/workflow/git-policy/memory.md`) +
commit 메시지 + git log 가 최종 source of truth.

## 차단되는 케이스 (확인됨)

- `git push --force` (평문)
- `bash -c "git push --force"` (따옴표 안)
- `(git push --force)` (괄호 안)
- `/usr/bin/git push --force` (절대 경로)
- `LEFTHOOK=0;git commit` (semicolon 직후)

## 차단 못 하는 케이스 (의도적 우회)

- 변수: `CMD="git push --force"; $CMD`
- 문자열 concat: `python -c "os.system('git ' + 'push --force')"`
- PATH override: `PATH=. fakegit push origin main --force`
- eval split: `eval "git $(printf push) --force"`

## 관련

- `scripts/hooks/check-dangerous-bash.sh` — fix 적용 파일
- `memory/workflow/git-policy/memory.md` — Hook 한계 섹션
