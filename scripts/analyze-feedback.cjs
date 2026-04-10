#!/usr/bin/env node

/**
 * 누적된 피드백/실패 항목을 분석하여 패턴, 반복 문제, 해결 방안을 탐색.
 *
 * 사용법:
 *   node scripts/analyze-feedback.js
 *
 * 결과:
 *   .claude/skills/harness/feedback-analysis.md 생성
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
const OUTPUT_PATH = path.join(
  __dirname,
  "..",
  ".claude",
  "skills",
  "harness",
  "feedback-analysis.md",
);

function main() {
  if (!fs.existsSync(LOG_PATH)) {
    console.log("No feedback log found. Nothing to analyze.");
    return;
  }

  const log = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
  const open = log.filter((e) => e.status === "open");
  const resolved = log.filter((e) => e.status === "resolved");

  if (open.length === 0) {
    console.log("No open feedback items to analyze.");
    return;
  }

  // 분석: 타입별 그룹
  const byType = {};
  for (const entry of open) {
    byType[entry.type] = (byType[entry.type] || 0) + 1;
  }

  // 분석: 심각도별 그룹
  const bySeverity = {};
  for (const entry of open) {
    bySeverity[entry.severity] = (bySeverity[entry.severity] || 0) + 1;
  }

  // 분석: 스프린트별 그룹
  const bySprint = {};
  for (const entry of open) {
    const key = entry.sprint || "unspecified";
    bySprint[key] = (bySprint[key] || 0) + 1;
  }

  // 분석: 반복 패턴 감지 (간단한 키워드 매칭)
  const keywords = {};
  for (const entry of open) {
    const words = entry.message.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.length < 3) continue;
      keywords[word] = (keywords[word] || 0) + 1;
    }
  }
  const repeatedKeywords = Object.entries(keywords)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // 보고서 생성
  const report = [
    `# Feedback Analysis Report`,
    ``,
    `> Generated: ${new Date().toISOString()}`,
    `> Total items: ${log.length} (Open: ${open.length}, Resolved: ${resolved.length})`,
    ``,
    `## Summary`,
    ``,
    `| Category | Count |`,
    `|----------|-------|`,
    ...Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `| ${type} | ${count} |`),
    ``,
    `## Severity Distribution`,
    ``,
    `| Severity | Open |`,
    `|----------|------|`,
    ...Object.entries(bySeverity)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([sev, count]) => `| ${sev} | ${count} |`),
    ``,
    `## By Sprint`,
    ``,
    `| Sprint | Open Items |`,
    `|--------|-----------|`,
    ...Object.entries(bySprint)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([sprint, count]) => `| ${sprint} | ${count} |`),
    ``,
    `## Repeated Keywords (possible patterns)`,
    ``,
    repeatedKeywords.length > 0
      ? repeatedKeywords.map(([word, count]) => `- **${word}**: ${count}회`).join("\n")
      : "_No repeated patterns detected_",
    ``,
    `## Open Items Detail`,
    ``,
    ...open.map(
      (entry) =>
        `- **#${entry.id}** [${entry.severity}] (${entry.type}${entry.sprint ? `, ${entry.sprint}` : ""}): ${entry.message}`,
    ),
    ``,
    `## Recommended Actions`,
    ``,
    bySeverity["P0"] > 0 ? "- **URGENT**: P0 항목이 있습니다. 즉시 해결이 필요합니다." : "",
    byType["missed_coverage"]
      ? "- **커버리지**: 테스트 커버리지 누락 항목이 반복되고 있습니다. harness contract에 테스트 요구사항을 강화하세요."
      : "",
    byType["eval_failure"]
      ? "- **평가 실패**: evaluator가 반복적으로 같은 항목을 지적합니다. AC 정의를 더 구체적으로 개선하세요."
      : "",
    byType["regression"]
      ? "- **회귀**: 기존 기능 회귀가 감지되었습니다. pre-push 테스트 범위를 점검하세요."
      : "",
    ``,
    `## Resolved Items`,
    ``,
    resolved.length > 0
      ? resolved.map((e) => `- #${e.id}: ${e.message} ✓`).join("\n")
      : "_None yet_",
    ``,
  ]
    .filter(Boolean)
    .join("\n");

  fs.writeFileSync(OUTPUT_PATH, report);
  console.log(`Analysis written to ${OUTPUT_PATH}`);
  console.log(`Open: ${open.length}, Resolved: ${resolved.length}`);

  if (open.length > 0) {
    console.log(`\nTop issues:`);
    open
      .slice(0, 5)
      .forEach((e) => console.log(`  #${e.id} [${e.severity}] ${e.message}`));
  }
}

main();
