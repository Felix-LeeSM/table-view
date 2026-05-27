---
id: 0024
title: 통합 테스트 컨테이너 cleanup — owner-pid 라벨 + 시작 시 dead-owner sweep
status: Accepted
date: 2026-05-11
supersedes: null
superseded_by: null
---

**결정**: testcontainers-rs 0.27 의 Drop / `reusable-containers` 둘 다 신뢰 불가하므로, 통합 테스트가 띄우는 PG/Mongo 컨테이너에 `table-view.tests.owner-pid` 라벨을 박고 각 binary 시작 시 dead-PID 컨테이너만 `docker rm -f` 로 정리한다 (lazy GC).
**이유**: (1) testcontainers-rs 는 Ryuk 미지원 + ContainerAsync Drop 이 tokio runtime shutdown 타이밍 때문에 정상 종료에서도 leak (측정: 매 run PG 2 + Mongo 1 누적). (2) `reusable-containers = Always` 는 spec hash 라벨을 박지 않고 `managed-by` 라벨 만으로 매칭해서 PG 가 Mongo 컨테이너에 잘못 attach → silent SKIP false-green. PID 라벨 sweep 은 Drop 의존을 끊고 race-safe (자기 PID 컨테이너만 보호).
**트레이드오프**: + leak 누적 0, 동시 실행 race-safe, testcontainers crate 외 의존 0 / - 매 run PG 부팅 비용 ~13초 그대로 (reuse 의 두 번째 가치인 "부팅 비용 회피"는 미해결), 컨테이너가 다음 run 시작 직전까지 idle 로 살아있음.
