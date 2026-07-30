#!/usr/bin/env node
// handoff — 인계를 쓰고, 읽고, 다음 상태를 라우팅하는 단 하나의 지점.
//
// 설계 SOT: issue #1918 (§7 스키마 · §8 3연산 · §6 라우팅 표) 와 #1922 (라우팅 표).
// 각 역할이 `gh issue comment` 를 손으로 치면 인계 형식이 갈린다. 이 저장소가 이미
// 겪는 실패라서 한 곳에만 구현한다.
//
//   handoff write --stage <역할> --issue N [--pr M] [--add-label L] [--remove-label L]
//   handoff read  --stage <역할> --issue N
//   handoff state --issue N
//
// exit 코드는 호출자가 재시도할지 사람에게 올릴지를 가른다 (#1918 §10 — 실패는
// 종류마다 다르게 처리한다):
//   0 통과 · 1 거부(스키마/사용법) · 2 외부 명령 실패 · 3 RETRY(리뷰 재시도) · 4 사용자

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const EXIT_REJECT = 1;
const EXIT_OPERATIONAL = 2;
const EXIT_RETRY = 3;
const EXIT_USER = 4;

class Halt extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const reject = (message) => {
  throw new Halt(EXIT_REJECT, message);
};
const operational = (message) => {
  throw new Halt(EXIT_OPERATIONAL, message);
};
const retry = (message) => {
  throw new Halt(EXIT_RETRY, `RETRY: ${message}`);
};
const toUser = (message) => {
  throw new Halt(EXIT_USER, `USER: ${message}`);
};

// 실패를 삼키지 않는다. 외부 명령이 죽었는데 빈 출력을 정상값으로 읽으면 라우팅이
// 조용히 틀린다 — 이 저장소가 `git ls-files` fail-open 으로 이미 겪은 유형이다.
function run(cmd, args, input) {
  const result = spawnSync(cmd, args, { input, encoding: "utf8" });
  if (result.error) operational(`${cmd} 실행 실패: ${result.error.message}`);
  if (result.status !== 0) {
    operational(`${cmd} ${args.join(" ")} → exit ${result.status}\n${(result.stderr || "").trim()}`);
  }
  return result.stdout;
}

const gh = (...args) => run("gh", args);
const ghJson = (...args) => JSON.parse(gh(...args));

// 저장소 루트는 cwd 에서, 모듈은 이 스크립트 위치에서 찾는다. 둘을 한 base 로
// 묶으면 안 된다 — `--no-deps` 로 띄운 linked worktree 엔 node_modules 가 없고,
// 거기서 도는 node 는 자기 위(=primary checkout)의 것을 쓴다.
let repoRootCache = null;
const repoRoot = () => (repoRootCache ??= run("git", ["rev-parse", "--show-toplevel"]).trim());

let yamlCache = null;
function yaml() {
  if (yamlCache !== null) return yamlCache;
  try {
    yamlCache = createRequire(import.meta.url)("yaml");
  } catch {
    operational("`yaml` 모듈이 없다 — 저장소에서 `npm install` 후 다시 실행해라.");
  }
  return yamlCache;
}

// node 이름은 `wip:<node>` label 어휘와 같다 (gh label list). `user` 는 node 가
// 아니라 orchestrator 가 사용자 결정을 전사하는 자리라서 (#1918 §12) wip label 이
// 없다. #1918 이 역할을 한국어로 적으므로 그 표기도 받는다 — SOT 에서 복사한 값이
// 스킬에서 튕기면 그게 형식이 갈리는 첫 걸음이다.
const NODES = ["issue-refine", "issue-implement", "pr-reviewer", "round-reflect", "pr-finalize"];
const ALIASES = {
  명세작성자: "issue-refine",
  구현자: "issue-implement",
  리뷰어: "pr-reviewer",
  회고자: "round-reflect",
  종결자: "pr-finalize",
  사용자: "user",
};

const normalizeRole = (raw) => {
  const key = String(raw ?? "").replace(/\s+/g, "");
  return ALIASES[key] ?? key;
};

function role(raw, field) {
  const name = normalizeRole(raw);
  if (name !== "user" && !NODES.includes(name)) {
    reject(`${field}: 모르는 역할 '${raw}'. 하나여야 한다 — ${[...NODES, "user"].join(" / ")}`);
  }
  return name;
}

const wipLabelFor = (stage) => (stage === "user" ? null : `wip:${stage}`);

// ---------------------------------------------------------------- 스키마 검증

const FULL_OID = /^[0-9a-f]{40}$/;
const SUBJECT = /^(pr|issue)\/(\d+)$/;

// #1918 §7. `at` 은 full OID 40자다 — short OID 는 저장소가 커지면 접두사가 충돌하고
// 8자는 이미 다른 개체와 겹칠 수 있다. `base_oid` 는 기록만 하고 무효화 트리거로는
// 쓰지 않는다 (머지 60건 중 34건이 base 가 움직였다 — 트리거로 쓰면 57%가 재리뷰다).
function inspect(doc, { pr } = {}) {
  const missing = [];
  const malformed = [];

  const need = (obj, key, prefix) => {
    const value = obj?.[key];
    if (value === undefined || value === null || String(value).trim() === "") {
      missing.push(`${prefix}${key}`);
      return null;
    }
    return value;
  };

  const h = doc?.handoff;
  if (!h || typeof h !== "object" || Array.isArray(h)) {
    return { handoff: null, missing: ["handoff"], malformed: [], prScoped: false, prNumber: null };
  }

  if (need(h, "v", "handoff.") !== null && Number(h.v) !== 1) {
    malformed.push(`handoff.v: 1 이어야 한다 (받은 값 '${h.v}')`);
  }
  need(h, "from", "handoff.");
  need(h, "to", "handoff.");
  need(h, "run_id", "handoff.");

  const subject = need(h, "subject", "handoff.");
  const parsed = SUBJECT.exec(String(subject ?? ""));
  if (subject !== null && !parsed) {
    malformed.push(`handoff.subject: 'pr/<번호>' 또는 'issue/<번호>' 여야 한다 (받은 값 '${subject}')`);
  }
  if (pr !== null && pr !== undefined && subject !== null && String(subject) !== `pr/${pr}`) {
    malformed.push(`handoff.subject: --pr ${pr} 과 다르다 (받은 값 '${subject}')`);
  }

  // PR 이 없는 티켓 단계는 `at` 이 필요 없다 (#1918 §9) — 티켓의 신선도는 티켓이
  // 이미 갖고 있는 전수 명령을 다시 돌리면 드러난다.
  const prScoped = parsed?.[1] === "pr";
  if (prScoped) {
    for (const key of ["at", "base_oid"]) {
      const value = need(h, key, "handoff.");
      if (value !== null && !FULL_OID.test(String(value))) {
        malformed.push(
          `handoff.${key}: full OID 40자 소문자 hex 여야 한다 (받은 값 '${value}', ${String(value).length}자)`,
        );
      }
    }
  }

  if (h.findings !== undefined && h.findings !== null) {
    if (!Array.isArray(h.findings)) {
      malformed.push("handoff.findings: 목록이어야 한다");
    } else {
      const verdict = need(h, "verdict", "handoff.");
      if (verdict !== null && !["green", "red"].includes(String(verdict))) {
        malformed.push(`handoff.verdict: green|red 여야 한다 (받은 값 '${verdict}')`);
      }
      h.findings.forEach((finding, index) => {
        const prefix = `handoff.findings[${index}].`;
        need(finding, "id", prefix);
        need(finding, "where", prefix);
        const severity = need(finding, "severity", prefix);
        if (severity !== null && !["blocking", "note"].includes(String(severity))) {
          malformed.push(`${prefix}severity: blocking|note 여야 한다 (받은 값 '${severity}')`);
        }
        // evidence 의 cmd/got/want 가 필수라서 재현 명령 없는 수치가 구조적으로
        // 불가능해진다 (#1918 §7).
        for (const key of ["cmd", "got", "want"]) need(finding?.evidence, key, `${prefix}evidence.`);
        // control 은 전수 주장일 때만 붙는다. 붙었으면 got 과 대조할 수 있어야
        // 의미가 있다 — 필터가 0건 거르는 것을 잡는 자리다.
        if (finding?.evidence?.control !== undefined && finding?.evidence?.control !== null) {
          for (const key of ["cmd", "got"]) need(finding.evidence.control, key, `${prefix}evidence.control.`);
        }
        const type = need(finding?.action, "type", `${prefix}action.`);
        if (type !== null && !["sweep", "fix", "fixture", "none"].includes(String(type))) {
          malformed.push(`${prefix}action.type: sweep|fix|fixture|none 이어야 한다 (받은 값 '${type}')`);
        }
      });
    }
  }

  return { handoff: h, missing, malformed, prScoped, prNumber: parsed?.[2] ?? null };
}

function checkSchema(doc, options, onFail) {
  const result = inspect(doc, options);
  const lines = [
    ...result.missing.map((field) => `누락: ${field}`),
    ...result.malformed.map((note) => `형식: ${note}`),
  ];
  if (lines.length > 0) {
    onFail(`인계 스키마 위반 ${lines.length}건\n  ${lines.join("\n  ")}`);
  }
  return result;
}

// ------------------------------------------------------------ 코멘트 안의 인계

// 코드펜스 길이를 역참조로 닫는다. `fixture:` 블록 스칼라에 백틱 3개짜리 펜스가
// 들어와도 인계 블록이 거기서 끊기지 않는다 — 리뷰어가 뚫은 입력은 마크다운인
// 경우가 흔하다.
//
// GitHub 이 똑같이 렌더하는 변종을 다 받는다 — 펜스 앞 공백 0-3칸(CommonMark),
// `~~~`, info string 뒤의 말(` ```yaml title=x `), 닫는 펜스 뒤 공백. 좁게 잡으면
// `read` 는 fail-closed("인계 없다")로 끝나지만 `write` 의 중복 스캔은 fail-open
// 이라 같은 인계를 두 번 올린다.
const FENCE =
  /(?:^|\n)[ ]{0,3}(`{3,}|~{3,})[ \t]*yaml\b[^\n]*\r?\n([\s\S]*?)\r?\n[ ]{0,3}\1[ \t]*(?=\r?\n|$)/g;

function fence(body) {
  let length = 3;
  for (const line of body.split("\n")) {
    const run_ = /^(`{3,})/.exec(line);
    if (run_ && run_[1].length >= length) length = run_[1].length + 1;
  }
  return "`".repeat(length);
}

function handoffsIn(body) {
  const found = [];
  for (const match of String(body ?? "").matchAll(FENCE)) {
    let doc;
    try {
      doc = yaml().parse(match[2]);
    } catch {
      continue; // 인계가 아닌 yaml 블록
    }
    if (doc && typeof doc === "object" && doc.handoff) found.push({ doc, text: match[2] });
  }
  return found;
}

// 이 저장소는 PUBLIC 이다 (`gh repo view --json visibility` → PUBLIC). 아무나 이슈에
// 코멘트를 달 수 있고, 인계는 받는 node 가 돌릴 명령(`action.cmd`)과 저장할 픽스처를
// 실어 나른다. 그래서 신뢰 경계는 저장소 권한이다 — 응답이 이미 주는
// `authorAssociation` 을 본다. `subject: issue/N` 으로 쓰면 `at` 대조도 안 걸리므로
// 이 검사가 없으면 위조 비용이 0 이다.
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

function trustedHandoffs(comments) {
  const found = [];
  for (const comment of comments ?? []) {
    const entries = handoffsIn(comment.body);
    if (entries.length === 0) continue;
    const association = String(comment.authorAssociation ?? "");
    if (!TRUSTED_ASSOCIATIONS.has(association)) {
      // 조용히 버리면 "인계가 없다" 와 "거부했다" 가 관측상 같아진다.
      process.stderr.write(
        `거부: ${comment.author?.login ?? "?"} 의 인계 블록 ${entries.length}건 — ` +
          `authorAssociation=${association || "없음"} 은 신뢰 경계 밖이다 ` +
          `(${[...TRUSTED_ASSOCIATIONS].join("/")} 만).\n`,
      );
      continue;
    }
    found.push(...entries);
  }
  return found;
}

// 멱등 키는 `run_id` 단독이 아니라 `(from, to, subject, run_id)` 다. 단독이면 서로
// 다른 역할이 같은 라운드 이름을 쓸 때 뒤에 쓰는 인계가 통째로 삼켜진다.
const identityOf = (h) =>
  JSON.stringify([normalizeRole(h.from), normalizeRole(h.to), String(h.subject), String(h.run_id)]);

const canonical = (doc) => yaml().stringify(doc);

// ------------------------------------------------------------------- 연산 셋

function cmdWrite(options) {
  const stage = role(options.stage, "--stage");
  const raw = fs.readFileSync(0, "utf8");
  let doc;
  try {
    doc = yaml().parse(raw);
  } catch (error) {
    reject(`표준입력 YAML 파싱 실패: ${error.message}`);
  }

  const { handoff } = checkSchema(doc, { pr: options.pr }, reject);
  if (role(handoff.from, "handoff.from") !== stage) {
    reject(`handoff.from '${handoff.from}' 이 --stage ${stage} 와 다르다 — 남의 인계를 대신 쓰지 않는다.`);
  }
  role(handoff.to, "handoff.to");

  const issue = ghJson("issue", "view", String(options.issue), "--json", "labels,comments");
  const labels = new Set((issue.labels ?? []).map((label) => label.name));

  // 검증한 문자열과 올리는 문자열이 다르면 `write` 는 exit 0 인데 `read` 가
  // "인계가 없다" 를 준다 — 받는 쪽이 받는 진단이 틀린다. 앞 공백을 벗기면 들여쓴
  // YAML 의 첫 줄만 col 0 으로 내려가 구조가 깨지므로 뒤만 다듬는다.
  const payload = raw.trimEnd();
  const mark = fence(payload);
  const body = `${mark}yaml\n${payload}\n${mark}\n`;

  // 올릴 본문을 **읽는 쪽 파서로 되읽어** 같은 문서가 나오는지 본다. 펜스든
  // 들여쓰기든 조립이 인계를 가리면 여기서 멈춘다 — 인계를 안 남겼으면 exit 0 을
  // 주면 안 된다.
  const readBack = handoffsIn(body);
  if (readBack.length !== 1 || canonical(readBack[0].doc) !== canonical(doc)) {
    reject(
      `올릴 본문을 되읽지 못했다 (블록 ${readBack.length}건) — 코드펜스나 들여쓰기가 인계를 가린다. ` +
        `아무것도 올리지 않았고 wip 도 그대로다.`,
    );
  }

  // run_id 는 외부 쓰기 3곳의 멱등 키다 (#1918 §7). 그중 이 스킬이 소유하는 자리는
  // `gh issue comment` 하나이고, 값은 코멘트 본문 YAML 안에 실려 다음 시도가 그걸
  // 본다. label add/remove 에는 안 붙인다 — GitHub API 가 이미 멱등이다.
  //
  // 같은 키로 **다른 내용**이 이미 있으면 SKIP 이 아니라 거부다. 스킵하면 새 판정이
  // 조용히 버려지고, 그 상태로 wip 까지 풀리면 다음 node 가 사망 탐지도 못 한다.
  const sameKey = trustedHandoffs(issue.comments).filter(
    (entry) => identityOf(entry.doc.handoff) === identityOf(handoff),
  );
  const already = sameKey.find((entry) => canonical(entry.doc) === canonical(doc));
  if (sameKey.length > 0 && !already) {
    reject(
      `같은 (from,to,subject,run_id) 로 다른 내용이 이미 #${options.issue} 에 있다 — ` +
        `run_id 는 라운드가 아니라 시도 단위여야 한다. 새 run_id 로 다시 써라. ` +
        `아무것도 올리지 않았고 wip 도 그대로다.`,
    );
  }

  if (already) {
    process.stdout.write(`SKIP issue/${options.issue} run_id=${handoff.run_id} (같은 내용이 이미 기록됨)\n`);
  } else {
    run("gh", ["issue", "comment", String(options.issue), "--body-file", "-"], body);
    process.stdout.write(`WROTE issue/${options.issue} run_id=${handoff.run_id}\n`);
  }

  // 코멘트가 먼저, label 해제가 나중이다. 사이에서 죽으면 wip 이 남아 다음 node 가
  // "앞 시도가 죽었다" 로 읽는다 (#1918 §10) — 인계 없이 label 만 풀리는 것보다
  // 안전한 실패다.
  const wip = wipLabelFor(stage);
  if (wip && labels.has(wip)) gh("issue", "edit", String(options.issue), "--remove-label", wip);

  // 명시 label 갱신은 **이슈에만** 한다. PR verdict label 은 이 스킬이 안 건드린다 —
  // `review-gate` 가 `pull_request` label 이벤트마다 돌고 `cancel-in-progress` 라,
  // 같은 초에 이벤트가 둘 나면 run 하나가 죽고 죽은 run 이 rollup 에 non-success 로
  // 남아 BLOCKED 가 고착된다 (#1879 실측). 그래서 verdict 전환은 "먼저 떼고 30초 이상
  // 기다렸다가 붙인다" 는 절차가 필요하고, 그 절차는 리뷰어가 소유한다
  // (`memory/workflow/review/memory.md`). 이슈 label 에는 그 게이트가 없다.
  if (options.addLabel.length > 0 || options.removeLabel.length > 0) {
    // 뗄 것을 먼저 뗀다. 같은 label 을 add/remove 로 동시에 넘겨도 결과가 정해진다.
    const remove = options.removeLabel.filter((label) => labels.has(label));
    const add = options.addLabel.filter((label) => !labels.has(label));
    if (remove.length > 0) gh("issue", "edit", String(options.issue), "--remove-label", remove.join(","));
    if (add.length > 0) gh("issue", "edit", String(options.issue), "--add-label", add.join(","));
  }
}

function cmdRead(options) {
  const stage = role(options.stage, "--stage");
  const wip = wipLabelFor(stage);
  const issue = ghJson("issue", "view", String(options.issue), "--json", "labels,comments");
  const labels = new Set((issue.labels ?? []).map((label) => label.name));

  // 가장 자주 일어나고 유일하게 무한 루프가 되는 실패는 "node 가 인계를 쓰기 전에
  // 죽는 것"이다. 카운터는 컨텍스트에 살아서 압축되면 사라지므로 label 유무로
  // 판정한다 (#1918 §10).
  if (wip && labels.has(wip)) {
    toUser(`${wip} 이 이미 붙어 있다 — 앞 시도가 인계를 쓰기 전에 죽었다. 재시도로 안 고쳐진다.`);
  }

  const mine = trustedHandoffs(issue.comments).filter(
    (entry) => normalizeRole(entry.doc.handoff.to) === stage,
  );
  const latest = mine.at(-1);
  if (!latest) toUser(`#${options.issue} 에 ${stage} 앞으로 온 인계가 없다. 앞 node 가 아예 안 돌았다.`);

  // 필드 누락 상한은 0 이다 — `write` 가 이미 검증하므로 읽을 때 누락이면 스킬
  // 우회 / 스키마 버전 불일치 / 스킬 버그 셋 중 하나이고 재시도로 안 고쳐진다.
  const { handoff, prScoped, prNumber } = checkSchema(latest.doc, {}, toUser);

  if (prScoped) {
    // 로컬 HEAD 가 아니라 PR head 와 비교한다 (#1918 §9). 판정이 낡는 조건은 PR
    // head 가 움직였다는 것이고, 구현자의 미푸시 커밋은 그 판정에 대한 응답이라
    // 판정을 낡게 만들지 않는다. 로컬로 비교하면 구현자가 죽었을 때 다음 구현자가
    // 이어받지 못한다.
    const head = ghJson("pr", "view", prNumber, "--json", "headRefOid").headRefOid;
    if (String(handoff.at) !== String(head)) {
      const status = gh("api", `repos/{owner}/{repo}/compare/${handoff.at}...${head}`, "--jq", ".status").trim();
      if (status === "ahead") {
        retry(`판정 대상 ${handoff.at} 이 PR head ${head} 의 조상이다 — 리뷰를 다시 돌아라.`);
      }
      toUser(
        `판정 대상 ${handoff.at} 이 PR head ${head} 의 조상이 아니다 (compare=${status}). 히스토리 재작성이다.`,
      );
    }
  }

  // 검사를 다 통과한 뒤에 붙인다. 반송된 read 가 wip 을 남기면 다음 시도가 원인을
  // "앞 node 가 죽었다" 로 잘못 읽는다.
  if (wip) gh("issue", "edit", String(options.issue), "--add-label", wip);
  process.stdout.write(`${latest.text}\n`);
}

// 라운드 임계는 게이트가 소유한다. 여기서 숫자를 다시 적으면 세 번째 사본이 되고,
// 그게 이 저장소가 반복해서 겪은 실패다 — 워크플로에서 읽는다
// (scripts/hooks/policy/test-review-gate-round.sh 가 같은 값을 같은 방식으로 읽는다).
function roundCap() {
  const workflow = path.join(repoRoot(), ".github/workflows/review-gate.yml");
  if (!fs.existsSync(workflow)) operational(`라운드 임계를 읽을 ${workflow} 가 없다.`);
  const cap = /pull_request\.comments >= (\d+)/.exec(fs.readFileSync(workflow, "utf8"))?.[1];
  if (!cap) operational("review-gate.yml 에서 라운드 임계를 못 읽었다.");
  return Number(cap);
}

// 하나라도 안 끝났으면 pending 이 실패를 이긴다. `labeled` 트리거의 재실행 창이
// 실재해서다 — `review:approved` 를 붙이는 순간 옛 review-gate 실패가 rollup 에
// 남아 있고 새 run 은 아직 큐에 있다. 거기서 failed 로 단정하면 정상 전이가 매번
// BROKEN 으로 올라간다.
function checkState(rollup) {
  // 체크가 아직 하나도 안 생긴 PR 을 green 으로 읽으면 검증 0인 채 머지 줄로 간다.
  if (!Array.isArray(rollup) || rollup.length === 0) return "pending";
  let pending = false;
  let failed = false;
  for (const check of rollup) {
    const status = String(check.status ?? "");
    const conclusion = String(check.conclusion ?? check.state ?? "");
    if (status !== "" && status !== "COMPLETED") {
      pending = true;
    } else if (conclusion === "" || conclusion === "PENDING" || conclusion === "EXPECTED") {
      pending = true;
    } else if (!["SUCCESS", "NEUTRAL", "SKIPPED"].includes(conclusion)) {
      failed = true;
    }
  }
  if (pending) return "pending";
  return failed ? "failed" : "green";
}

// #1918 §6 / #1922 의 라우팅 표. **이 함수가 그 표의 유일한 사본이다** — 산문에
// 두면 구현과 갈리고, orchestrator 에게 도달시킬 방법도 마땅치 않다. 위에서부터
// 첫 줄이 이기고, 그 순서 자체가 실측된 동시 매치 넷의 처방이다.
//
//   needs:user 최상단        — 종결보다 아래면 사용자 차단을 무시하고 머지로 간다
//   회고는 차단기            — needs:user 바로 다음 (아래 설명)
//   approved & checks 미완   — 승인에서 마지막 required check 까지 7분26초 (#1938)
//
// **회고 줄은 종결의 하위 대안이 아니라 차단기다.** `review-gate.yml` 의
// "Stop at review round 3" 은 verdict 를 안 보고 `comments >= cap && !reflect:done`
// 이면 `exit 1` 한다. 그 실패가 `statusCheckRollup` 에 들어오고, `checkState()` 는
// **rollup 전체**를 봐서 하나라도 실패면 `"failed"` 를 준다 — 다른 검사가 전부
// 통과해도 green 이 안 된다. 그래서 라운드 임계를 넘고 `reflect:done` 이 없는
// 동안 아래 종결 줄은 도달 불가고, 두 줄은 배타적이다: green ⟹ 게이트 통과 ⟹
// (임계 미만 또는 `reflect:done`) ⟹ 회고 줄 불성립. #1922 가 "라운드 3에서 green
// 이면 종결" 이라 적은 상태는 `reflect:done` 이 붙은 뒤이고, 그때는 회고 줄이 안
// 걸리므로 이 순서가 그 처방을 그대로 지킨다.
//
// (`review-gate` 는 required 지만 유일하지 않다 — classic protection 이 그 하나를,
// ruleset `pr_to_main` 이 여덟을 더 요구해서 합쳐서 9다. 두 겹을 다 보는 명령은
// `gh api graphql` 의 `isRequired(pullRequestNumber:)` 뿐이고,
// `.../branches/main/protection` 은 classic 한 겹만 읽어 그 주장을 증명하지
// 못한다. 어차피 위 논증은 required 여부가 아니라 rollup 전체를 본다는 사실에만
// 기댄다.)
//
// 회고 줄이 `review:changes-requested` **아래** 있으면 라운드 3 red 가 구현자로
// 간다 — 같은 게이트가 "red 면 같은 유형에 fix 를 더 쌓지 말고 사용자에게 올려라"
// 라고 막는 바로 그 행동이다. #1918 §11 은 그 상태를 `needs:user` 로 보내라고
// 적었지만 그 label 을 붙일 주체가 없다 (리뷰어는 `review:changes-requested` 를
// 붙인다). 회고가 가장 필요한 자리에서 회고자가 영영 안 뜬다.
//
// 표의 "사용자가 raw 를 지목 → RUN issue-refine" 줄은 여기 없다. 그 계기는 label 이
// 아니라 사용자의 말이고 (승격은 자동화하지 않는다 — #1918 §5), 어휘를 현행 유지하기로
// 해서 담을 label 도 없다. 그 자리는 아래 `BLOCKED raw-promotion` 이 사용자에게
// 올리고, 사용자가 승격하면 orchestrator 가 그 턴에 issue-refine 을 띄운다.
function route(context) {
  if (context.issueLabels.has("needs:user") || context.prLabels.has("needs:user")) {
    return "BLOCKED needs:user";
  }
  if (context.issueClosed) return "DONE";
  if (!context.issueLabels.has("task")) return "BLOCKED raw-promotion";
  if (!context.hasPr) return "RUN issue-implement";
  if (context.rounds >= context.cap && !context.prLabels.has("reflect:done")) return "RUN round-reflect";
  if (context.prLabels.has("review:changes-requested")) return "RUN issue-implement";
  if (!context.prLabels.has("review:approved")) return "RUN pr-reviewer";
  if (context.checks === "pending") return "WAIT checks";
  if (context.checks === "green") return "RUN pr-finalize";
  return "BROKEN";
}

function cmdState(options) {
  const issue = ghJson(
    "issue",
    "view",
    String(options.issue),
    "--json",
    "state,labels,closedByPullRequestsReferences",
  );

  // 참조는 번호만 주고 상태를 안 준다. 열린 PR 만 "이번 시도" 이고, 여럿이면 가장
  // 최근 것이다. URL 로 조회해 다른 저장소의 PR 을 이 저장소 번호로 읽지 않는다.
  let pr = null;
  for (const ref of issue.closedByPullRequestsReferences ?? []) {
    const view = ghJson("pr", "view", ref.url, "--json", "number,state,labels,comments,statusCheckRollup");
    if (view.state === "OPEN" && (pr === null || view.number > pr.number)) pr = view;
  }

  const checks = pr ? checkState(pr.statusCheckRollup) : "none";
  const prLabels = new Set((pr?.labels ?? []).map((label) => label.name));
  const rounds = pr ? (pr.comments ?? []).length : 0;
  const verdict = route({
    issueLabels: new Set((issue.labels ?? []).map((label) => label.name)),
    issueClosed: String(issue.state).toUpperCase() === "CLOSED",
    hasPr: pr !== null,
    prLabels,
    checks,
    rounds,
    cap: roundCap(),
  });

  process.stdout.write(`${verdict}\n`);
  // 진단용 한 줄. BROKEN 이 왜 났는지는 관측된 상태를 봐야 알 수 있고, stdout 은
  // 기계가 읽으므로 stderr 로 나간다.
  process.stderr.write(
    `issue/${options.issue} ${issue.state} ` +
      (pr ? `pr/${pr.number} checks=${checks} rounds=${rounds} ` : "pr=none ") +
      `labels=[${[...(issue.labels ?? []).map((l) => l.name), ...prLabels].join(" ")}]\n`,
  );
}

// ---------------------------------------------------------------------- CLI

const USAGE = `handoff — 인계 write / read / state (설계 SOT: #1918 §7 §8, #1922)

  node scripts/handoff.mjs write --stage <역할> --issue N [--pr M] \\
      [--add-label L]... [--remove-label L]...     # 인계 YAML 은 표준입력
  node scripts/handoff.mjs read  --stage <역할> --issue N
  node scripts/handoff.mjs state --issue N

역할: ${[...NODES, "user"].join(" / ")}
exit: 0 통과 · 1 거부 · 2 외부 명령 실패 · 3 RETRY · 4 사용자`;

function parseArgs(argv) {
  const options = { command: argv[0], stage: null, issue: null, pr: null, addLabel: [], removeLabel: [] };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (!arg.startsWith("--")) reject(`모르는 인자 '${arg}'\n\n${USAGE}`);
    if (value === undefined) reject(`${arg} 의 값이 없다\n\n${USAGE}`);
    i += 1;
    switch (arg) {
      case "--stage":
        options.stage = value;
        break;
      case "--issue":
        options.issue = value;
        break;
      case "--pr":
        options.pr = value;
        break;
      case "--add-label":
        options.addLabel.push(value);
        break;
      case "--remove-label":
        options.removeLabel.push(value);
        break;
      default:
        reject(`모르는 인자 '${arg}'\n\n${USAGE}`);
    }
  }
  if (!/^\d+$/.test(String(options.issue ?? ""))) reject(`--issue <번호> 가 필요하다\n\n${USAGE}`);
  if (options.pr !== null && !/^\d+$/.test(String(options.pr))) reject(`--pr 은 번호여야 한다\n\n${USAGE}`);
  return options;
}

function main(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const options = parseArgs(argv);
  switch (options.command) {
    case "write":
      cmdWrite(options);
      return 0;
    case "read":
      cmdRead(options);
      return 0;
    case "state":
      cmdState(options);
      return 0;
    default:
      reject(`모르는 연산 '${options.command}'\n\n${USAGE}`);
  }
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof Halt) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.code;
  } else {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = EXIT_OPERATIONAL;
  }
}
