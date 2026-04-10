#!/usr/bin/env node

/**
 * 피드백/실패 항목을 feedback-log.json에 추가하는 스크립트.
 *
 * 사용법:
 *   node scripts/log-feedback.js --type=eval_failure --sprint=sprint-2 \
 *     --message="AC-03 실패" --severity=P1
 *   node scripts/log-feedback.js --type=user_feedback \
 *     --message="로딩 시 깜빡임" --severity=P2
 *   node scripts/log-feedback.js --type=missed_coverage \
 *     --message="QueryEditor 0% 커버리지" --severity=P2
 *
 * 분석 임계값(10개)에 도달하면 경고를 출력합니다.
 */

const fs = require("fs");
const path = require("path");

const LOG_PATH = path.join(
  __dirname,
  "..",
  ".claude",
  "skills",
  "harness",
  "feedback-log.json",
);
const THRESHOLD = 10;

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    args[key] = rest.join("=") || true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);

  const type = args.type || "unknown";
  const message = args.message || args._.join(" ") || "";
  const sprint = args.sprint || null;
  const severity = args.severity || "P2";

  if (!message) {
    console.error("Error: --message is required");
    process.exit(1);
  }

  // 기존 로드 읽기 (없으면 빈 배열)
  let log = [];
  if (fs.existsSync(LOG_PATH)) {
    try {
      log = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
    } catch {
      log = [];
    }
  }

  const entry = {
    id: log.length + 1,
    type, // eval_failure | user_feedback | missed_coverage | regression
    severity, // P0 | P1 | P2 | P3
    sprint,
    message,
    timestamp: new Date().toISOString(),
    status: "open", // open | resolved | wontfix
  };

  log.push(entry);
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2) + "\n");

  console.log(`Logged #${entry.id}: [${entry.severity}] ${entry.message}`);

  if (log.filter((e) => e.status === "open").length >= THRESHOLD) {
    console.warn(
      `\n⚠ ${THRESHOLD}개 이상의 open 항목이 쌓였습니다. 분석을 실행하세요:`,
    );
    console.warn("  node scripts/analyze-feedback.js");
  }
}

main();
