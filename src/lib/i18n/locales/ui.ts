/**
 * `ui` 네임스페이스 — `src/components/ui/` surface 공용 UI 문자열.
 *
 * en 값은 마이그레이션 이전 하드코딩 영어 리터럴을 바이트 그대로 미러한다.
 */

export const en = {
  close: "Close",
  cancel: "Cancel",
  save: "Save",
  confirm: "Confirm",
  loading: "Loading...",
  processing: "Processing...",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Copy failed",
  execute: "Execute",
  executing: "Executing...",
  executeOn: "Execute on {{connectionLabel}}",
  notifications: "Notifications",
  dismissNotification: "Dismiss notification",
  commitError: {
    summary:
      "executed: {{statementIndex}}, failed at: {{failedAt}} of {{statementCount}}",
  },
} as const;

export const ko = {
  close: "닫기",
  cancel: "취소",
  save: "저장",
  confirm: "확인",
  loading: "로딩 중...",
  processing: "처리 중...",
  copy: "복사",
  copied: "복사됨",
  copyFailed: "복사 실패",
  execute: "실행",
  executing: "실행 중...",
  executeOn: "{{connectionLabel}}에서 실행",
  notifications: "알림",
  dismissNotification: "알림 닫기",
  commitError: {
    summary:
      "실행됨: {{statementIndex}}, 실패 위치: {{failedAt}} / {{statementCount}}",
  },
} as const;
