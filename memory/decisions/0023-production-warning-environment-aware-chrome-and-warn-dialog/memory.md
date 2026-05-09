---
id: 0023
title: Production Warning — environment-aware chrome + WARN dialog 게이트
status: Accepted
date: 2026-05-09
supersedes: null
superseded_by: null
---

**결정**: ADR 0022 의 destructive-only confirm + dry-run 위에, (a) staging/production 활성 탭일 때 영구 chrome (top stripe + prod-only window border), (b) 모든 환경 + 모든 write 표면의 WARN-tier dialog mount, (c) `severity: "info" | "warn" | "danger"` 3-tier classifier, (d) Execute 버튼의 `severity × env` color + `on <conn>` target 라벨 (verb 추출 X), (e) ConfirmDestructiveDialog 와 SqlPreviewDialog/MqlPreviewModal 별개 유지하되 env token 으로 시각 정렬 — 5 sprint 에 걸쳐 도입 (`docs/sprints/sprint-253/spec.md`).

**이유**: 사용자 발화 "production인데 수정하겠냐 같은 색 담은 메시지가 낫지 띠만으론 의미 없다" + 외부 spec `Table View Design System/PRODUCTION-WARNING.md` 를 13-question grill (`docs/sprints/sprint-253/grill-decisions.md`) 로 검토 → 5-tag display 보존 / 2 chrome surface 만 / verb 추출 거부 / read-only flag·webhook YAGNI 거부 등으로 채택 범위 결정. ADR 0022 의 commit-before 보호가 *destructive 만* 이었던 한계를 *모든 write 표면 + 환경 인식* 으로 확장.

**트레이드오프**: + 환경 혼동 사고 방지 강화 + 두 dialog (STOP/WARN) 의 시각 무게 그라데이션 + Sprint 246-249 자산 (ConfirmDestructiveDialog + DryRunPreview) 보존 / - dev 환경 raw editor 의 ad-hoc DML 도 dialog 마찰 - 5 sprint 분량 (chrome H 의 platform residual risk 포함) - 72-theme syntax palette 큐레이션 분량 ≈ 216 hardcode.
