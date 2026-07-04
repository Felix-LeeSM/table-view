---
id: 0022
title: Safe Mode — destructive 만 confirm + dry-run preview, safe write 는 Cmd+Z 보호
status: Superseded
date: 2026-05-09
supersedes: null
superseded_by: "0048"
---

**결정**: Safe Mode 를 "production+strict = read-only" 가 아닌 "destructive (DROP / TRUNCATE / ALTER DROP / WHERE-less DELETE·UPDATE) 만 confirm dialog + dry-run preview" 정책으로 통일 — production 은 mode 무관 destructive 에 dialog, non-prod 는 strict 일 때만 destructive 에 dialog, safe write (INSERT / UPDATE WHERE / DELETE WHERE / CREATE / ALTER additive) 는 모든 mode 에서 dialog 없이 통과 + Cmd+Z (pending undo) 안전망. dialog 는 "PRODUCTION DATABASE" 헤더 + dry-run preview (D.1: `BEGIN; <stmt>; ROLLBACK` 후 별도 tx 로 commit) + 단순 Yes/No. mode 3-tier 는 의미만 재정의 — strict=all-env, warn=prod-only, off=prod-auto.
**이유**: Sprint 244 의 read-only 정책은 production INSERT / UPDATE WHERE 같은 일상 작업까지 차단해 friction 이 컸고, dialog 미통일 (block / confirm / read-only 게이트 3 종) 로 mental model 이 분기됐음. dry-run preview 로 destructive 결과를 commit 전 보여주고 safe write 는 Cmd+Z 로 보호하는 게 TablePlus / DBeaver 등 업계 표준 패턴과도 정합. mode toggle 은 dev / shared-staging 에서 destructive dialog 띄울지를 사용자가 즉시 전환할 수 있는 dial 로 활용.
**트레이드오프**: + dialog 단일 진입점, mental model 단순화, production 일상 작업 friction 제거, non-prod strict 옵션으로 학습·shared-staging 커버, store / toolbar UI 변경 0 / - raw editor commit 후 실수 unrecoverable (Cmd+Z 가 commit 후 DML reverse 안 함, 업계 표준 인정), dry-run race (NOW() 등 시간 의존 statement 는 commit-time 결과가 preview 와 다를 수 있어 disclaimer 필요), Sprint 243 useSafeModeReadOnly + Sprint 244 lib read-only 정책 코드 원복 (5 phase / 수십 테스트 invert), Mongo single-node 는 dry-run 미지원 (dialog 만 fallback).
