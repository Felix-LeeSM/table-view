---
title: 다중-sprint chain — 이전 sprint 산출물은 contract 의 git diff empty check 로 강제한다
type: lesson
date: 2026-04-25
---

**상황**: Phase 6 plan F 를 sprint 80 (backend mutate) → sprint 86 (frontend mqlGenerator + dispatch) → sprint 87 (UI) 3-layer 체인으로 분해 진행. 후속 sprint generator 가 "consume only" 경계를 텍스트 지시만으로 받으면 보조 코드 수정 중 이전 layer 산출물을 무심코 변경할 위험이 있었다.
**원인**: Hard stop 영역을 contract 본문에 나열만 하면 generator 가 의도치 않게 touch 해도 evaluator 가 발견하기 전까지는 detect 불가. Sprint 86 의 useDataGridEdit.ts paradigm 분기, sprint 80 의 src-tauri/ commands 처럼 layer 사이의 invariant 가 강해질수록 노출 비용이 큼.
**재발 방지**: Sprint contract 의 verification plan 에 `git diff --stat HEAD -- <previous-sprint-protected-paths>` → empty 를 required check 로 박는다. Sprint 80/86/87 모두 통과로 검증됨 — 향후 phase 7/8 같은 multi-layer 체인에 그대로 재사용.
