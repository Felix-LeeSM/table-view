---
id: 0010
title: paradigm-aware UI는 폴더 재조직 먼저, capability adapter는 ES/redis 도입 시 진화
status: Accepted
date: 2026-04-25
supersedes: null
superseded_by: null
---

**결정**: paradigm-aware UI 분기를 지금은 폴더 재조직(`src/components/{rdb,document}/`) + 컴포넌트 leaf 분리로 처리하고, ES/redis viewer 가 mount 되는 sprint 묶음에서 capability adapter 로 진화한다.
**이유**: paradigm 2개 단계의 capability interface 는 *상상의 공통점* 이 될 위험이 크고, paradigm 3-4 개 evidence 위에서 추출하는 편이 안전하다.
**트레이드오프**: + 폴더 재조직은 회귀 risk 거의 0 + capability 모듈 경계와 정렬돼 rename 만으로 진화 가능 / - 11곳 paradigm 분기 임시 잔존 - 진화 시점에 두 번째 마이그레이션 비용.
