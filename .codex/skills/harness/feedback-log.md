# Feedback & Failure Log

이 디렉토리는 evaluator 실패, 사용자 피드백, 놓친 점을 JSON으로 누적 저장합니다.
`feedback-log.json`에 항목이 10개 이상 쌓이면 분석을 실행합니다.

## 사용법

### 항목 추가 (수동 또는 훅)
```bash
# evaluator 실패 기록
node scripts/log-feedback.js --type=eval_failure --sprint=sprint-2 \
  --message="AC-03: Cmd+Return not working in CodeMirror" \
  --severity=P1

# 사용자 피드백 기록
node scripts/log-feedback.js --type=user_feedback --message="로딩 시 깜빡임" --severity=P2
```

### 분석 실행
```bash
# 누적된 피드백 분석
node scripts/analyze-feedback.js
```

## 파일 구조

- `feedback-log.json` — 피드백/실패 항목 배열
- `feedback-analysis.md` — 분석 결과 (마지막 분석 시점)
