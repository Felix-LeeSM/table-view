#!/usr/bin/env node
// sweep/core-split-prose.mjs — #1769 core 분리(PR #2082)가 낡게 만든 산문의
// 스윕 범위를 기계로 생성한다 (issue #2092).
//
// 사용:
//   node scripts/sweep/core-split-prose.mjs                 # 스윕 범위
//   node scripts/sweep/core-split-prose.mjs --check         # 처분 안 된 hit 이 있으면 exit 1
//   node scripts/sweep/core-split-prose.mjs --no-exclude    # 필터 증명용 (아래)
//   node scripts/sweep/core-split-prose.mjs --arm a         # 한 arm 만
//   node scripts/sweep/core-split-prose.mjs --merge <SHA>   # 다른 머지 커밋으로
//
// 왜 스크립트인가: 손으로 연 grep 은 "옛 배치를 전제로 쓴 자리" 를 구조적으로 못
// 본다 — 분리 전에는 manifest 를 적을 필요가 없어서 안 적은 자리에는 검색할 문자열
// 자체가 없다. 그래서 범위를 사람이 아니라 이 파일이 정의한다. 잔여 판정도 이
// 출력으로만 한다 (issue #2092).
//
// 출력 머리는 계약이다 (issue #2092 수용 기준) — `merge=` 와 arm 별 건수,
// `total=`, 그리고 이번 실행에 걸린 `excludes=`. 그 뒤로 hit 이
// `<arm>\t<path>:<line>\t<evidence>\t<본문>` 으로 한 줄씩 붙는다.
// `--arm` 으로 일부만 돌리면 안 돈 arm 은 건수 자리에 `-` 가 온다 — 0 과
// 구분된다.
//
// arm 은 넷이고, 각각이 분리가 낡게 만드는 서로 다른 문장 모양을 본다:
//   A  이동한 경로(와 그 디렉토리·crate 상대 표기)를 언급하는 자리
//   B  manifest 를 안 준 cargo 명령
//   C  분리가 바꾼 집합의 닫힌 개수 서술 ("four commands", "4종이 전부다")
//   D  분리가 이름을 겹치게 만든 파일을 맨 이름으로 부르는 자리 (`Cargo.lock`)
// A·B 는 issue #2092 「방법」이 지정했고, C·D 는 같은 이슈 「알려진 잔여」의 항목이
// A·B 에 안 잡혀서 보강했다 — 그 목록이 이 파일의 테스트 케이스다.
//
// 전수 도구는 `git grep` 이다 — `rg` 는 루트 `.ignore` 와 dotfile 기본 제외
// 때문에 전수가 아니다 (memory/workflow/orchestration/memory.md §1).
// 여기서는 hit 수집을 전부 `git grep` 에 맡기고, 분류만 JS 로 한다.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// PR #2082 의 squash 머지 커밋. 다른 이동을 재려면 --merge 로 갈아끼운다.
const DEFAULT_MERGE = "91724b2c7a91761869bb7a86124d15d30e5ffd1a";

// 제외 절. `--no-exclude` 로 끄고 돌려 실제로 무엇을 거르는지 증명한다
// (memory/workflow/implementation/memory.md §5 「전수 명령의 필터가 검증 안 됨」).
// 셋 다 저장소에 커밋된 SOT 가 근거다:
//   - docs/archives, docs/explorations — 루트 `.ignore` 가 "과거 기록" 으로 지정
//   - docs/decisions — ADR 본문 동결 (AGENTS.md 「강제 룰」)
const FROZEN = [
  ":!docs/archives/**",
  ":!docs/explorations/**",
  ":!docs/decisions/**",
];

// arm B 는 여기에 core crate 를 더 뺀다: crate 안에서 맨 `cargo` 는 이미 그
// crate 의 manifest 로 풀린다 (issue #2092 「방법」 2 의 원문 필터).
const ARM_B_EXTRA = [":!src-tauri/table-view-core/**"];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const MERGE = value("--merge", DEFAULT_MERGE);
const NO_EXCLUDE = flag("--no-exclude");
const CHECK = flag("--check");
const ONLY = (value("--arm", "") || "").toLowerCase();
const wants = (arm) => !ONLY || ONLY === arm;

const run = (argv, cwd) =>
  execFileSync("git", argv, { cwd, encoding: "utf8", maxBuffer: 256 << 20 });

// 저장소 루트를 고정하고 모든 git 호출을 거기서 돈다. `process.chdir` 로 프로세스
// cwd 를 바꾸면 이 파일을 import 하는 테스트의 cwd 까지 흔든다.
const root = run(["rev-parse", "--show-toplevel"], process.cwd()).trim();
const git = (argv) => run(argv, root);
const abs = (p) => join(root, p);

// git grep 은 hit 이 없으면 exit 1 이다 — 정상이므로 stdout 만 건진다.
const gitGrep = (argv) => {
  try {
    return git(["grep", ...argv]);
  } catch (err) {
    if (err.status === 1) return err.stdout ?? "";
    throw err;
  }
};

const excludes = NO_EXCLUDE ? [] : FROZEN;
const lines = (s) => s.split("\n").filter(Boolean);

// M 의 name-status. arm A(R 행)와 arm D(A 행)가 같은 것을 읽으므로 한 번만 돈다.
//
// M 은 히스토리에 있는 커밋이라 **얕은 클론에는 객체가 없다** — `actions/checkout`
// 의 기본값이 depth 1 이고, 그 위에서 이 스크립트는 `fatal: bad object` 로 죽으면서
// stdout 을 한 글자도 안 낸다. 원인이 안 보이는 실패라서 여기서 진단 문장으로 바꾼다.
// CI 쪽 대응은 이 스크립트를 돌리는 잡의 `fetch-depth: 0` 이다.
let nameStatusCache = null;
function nameStatus() {
  if (nameStatusCache) return nameStatusCache;
  try {
    nameStatusCache = lines(
      git(["diff-tree", "-r", "-M", "--name-status", MERGE]),
    );
  } catch (err) {
    throw new Error(
      `merge commit ${MERGE} is not in this checkout — shallow clone? ` +
        "fetch the full history (CI: actions/checkout with fetch-depth: 0), " +
        `or pass --merge <SHA>. git said: ${String(err.stderr ?? err.message).trim()}`,
    );
  }
  return nameStatusCache;
}

// ── arm A — 이동 경로를 언급하는 자리 ────────────────────────────────────
//
// 용어 집합은 M 의 rename(R) 행에서 나온다. old 경로 하나마다
//   ① 경로 자체            src-tauri/src/db/raw_where.rs
//   ② 모든 디렉토리 prefix  src-tauri/src/db, src-tauri/src
//   ③ 모든 경로 tail        db/raw_where.rs
// 을 넣는다. ③ 이 필요한 이유: 산문은 crate 상대로 짧게 쓴다 — `db/raw_where.rs`
// 는 옛 배치에서 `src-tauri/src/` 상대였고 지금은 core crate 상대라, 전체 경로
// grep 으로는 구조적으로 안 잡힌다.
function movedPaths() {
  const rows = nameStatus()
    .filter((l) => l.startsWith("R"))
    .map((l) => l.split("\t"));
  return { olds: rows.map((r) => r[1]), news: rows.map((r) => r[2]) };
}

function armATerms(olds) {
  const terms = new Set();
  const tails = new Set();
  for (const p of olds) {
    const seg = p.split("/");
    for (let i = 1; i <= seg.length; i++) terms.add(seg.slice(0, i).join("/"));
    for (let i = 1; i < seg.length; i++) {
      const tail = seg.slice(i).join("/");
      terms.add(tail);
      tails.add(tail);
    }
  }
  // 슬래시 없는 용어(맨 basename)를 뺀다. `mod.rs` · `queries.rs` 는 이 저장소에
  // 수십 벌 있어 이동과 무관한 자리를 전부 끌어온다 — 경로 신호가 0 이다.
  for (const t of [...terms]) {
    if (!t.includes("/")) {
      terms.delete(t);
      tails.delete(t);
    }
  }
  // `src-tauri` 단독도 뺀다. 앱 crate 루트는 이동하지 않았고, 모든 이동 경로의
  // prefix 라서 저장소 거의 전체를 hit 으로 만든다.
  terms.delete("src-tauri");
  return { terms, tails };
}

// 매치를 감싼 "경로처럼 생긴 토큰". 백틱/괄호/문장부호 안에서 경로만 떼어낸다.
// `.` 이 문자셋에 있어서 앞뒤 문장부호가 토큰에 붙어 온다. 정규화가 그것을 벗긴다 —
// 벗기지 않으면 `git ls-files` 로 푸는 처분 규칙이 0건을 받고 불발한다.
const PATH_TOKEN = /[A-Za-z0-9_.*{}-]+(?:\/[A-Za-z0-9_.*{}-]+)+\/?\**/g;
export const normalizeToken = (t) =>
  t
    .replace(/^\.{3,}\//, "") // `.../db/mysql/connection.rs` → 생략 표기를 벗긴다
    .replace(/[).,:;'"`]+$/, "")
    .replace(/(\/\*+)+$/, "") // `src-tauri/src/**` → `src-tauri/src`
    .replace(/\/$/, "");

// 용어가 토큰 안에 **세그먼트 단위로** 들어 있나. `git grep -F` 는 문자열
// 부분일치라 `db/mod.rs` 가 `commands/rdb/mod.rs` 에도 걸린다 — 옛 배치와
// 무관한 자리다. 경계를 세그먼트로 잡아 그 부류를 뺀다.
export function segmentAligned(token, term) {
  const t = normalizeToken(token).split("/");
  const q = term.split("/");
  for (let i = 0; i + q.length <= t.length; i++) {
    if (q.every((s, j) => s === t[i + j])) return true;
  }
  return false;
}

// 이동 경로가 전부 착지한 crate 루트. rename 의 new 쪽에서 뽑는다 — 이 안에서
// 쓴 crate 상대 경로(`db/mongodb.rs`)는 지금도 그대로 풀리므로 낡지 않았다.
// 밖에서 쓴 같은 표기는 읽는 사람의 기준 디렉토리가 사라져 낡는다.
function newRoots(olds, news) {
  const roots = new Set();
  for (let i = 0; i < news.length; i++) {
    const oldSeg = olds[i].split("/");
    const newSeg = news[i].split("/");
    let k = 0;
    while (k < newSeg.length && newSeg[k] === oldSeg[k]) k++;
    roots.add(newSeg.slice(0, k + 1).join("/"));
  }
  return [...roots];
}

function armA() {
  const { olds, news } = movedPaths();
  const { terms, tails } = armATerms(olds);
  const roots = newRoots(olds, news);
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  const dir = mkdtempSync(join(tmpdir(), "core-split-sweep-"));
  const file = join(dir, "terms.txt");
  writeFileSync(file, `${sorted.join("\n")}\n`);
  let raw;
  try {
    raw = gitGrep(["-n", "-I", "-F", "-f", file, "--", ".", ...excludes]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const hits = [];
  for (const line of lines(raw)) {
    const m = /^([^:]+):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    const [, path, no, text] = m;
    const inNewCrate = roots.some((r) => path.startsWith(`${r}/`));
    const tokens0 = [...text.matchAll(PATH_TOKEN)].map((x) => x[0]);
    const term = sorted.find(
      (t) =>
        text.includes(t) &&
        // crate 상대 tail 은 그 crate 안에서 읽으면 그대로 풀린다 — 낡지 않았다.
        !(tails.has(t) && inNewCrate) &&
        tokens0.some((tk) => segmentAligned(tk, t)),
    );
    if (!term) continue;
    const tokens = tokens0.filter((tk) => segmentAligned(tk, term));
    // 살아 있는 참조를 뺀다: 토큰이 지금 존재하는 파일/디렉토리로 풀리면 이동과
    // 무관하다 (`src-tauri/src/lib.rs` 는 그 자리에 그대로 있다). 단, 토큰이
    // 이동 용어 자체로 풀리는 경우 — `src-tauri/src/**` 처럼 디렉토리·글롭으로
    // 그 안의 내용을 주장하는 자리 — 는 남긴다. 디렉토리는 살아남았어도 안에
    // 있던 것이 core 로 빠져나갔으므로 주장이 낡는다 — `e2e/scope-map.mjs` 의
    // fail-closed fallback 열거가 이 모양이었다.
    const evidence = tokens.find((tk) => {
      const n = normalizeToken(tk);
      return !existsSync(abs(n)) || terms.has(n);
    });
    if (!evidence && tokens.length > 0) continue;
    // 정규화한 형태로 담는다 — 처분 규칙이 evidence 를 경로로 다시 푼다.
    hits.push({
      arm: "A",
      path,
      no,
      evidence: evidence ? normalizeToken(evidence) : term,
      text,
    });
  }
  return hits;
}

// ── arm B — manifest 를 안 준 cargo 명령 ─────────────────────────────────
//
// core 는 workspace member 가 아니라 path dependency 다. 저장소 루트에는
// `Cargo.toml` 이 아예 없어서 맨 `cargo <verb>` 는 실패하고, `src-tauri` 에서
// 돌리면 core 에 안 닿은 채로 exit 0 이다. 그래서 manifest 없는 cargo 명령을
// 지시로 적어 둔 자리는 분리 이후 전부 낡았다.
//
// `tree` 는 issue #2092 원문 동사 목록에 없다. 더한 이유: `cargo tree -i tauri` 를
// 「빈 결과」로 서술한 자리가 실측으로는 exit 101 이라 같은 클래스다.
const CARGO_RE = "cargo (test|fmt|clippy|build|llvm-cov|nextest|tree)";

function cargoLines() {
  const scope = NO_EXCLUDE ? [] : [...excludes, ...ARM_B_EXTRA];
  return lines(gitGrep(["-n", "-I", "-E", CARGO_RE, "--", ".", ...scope]))
    .map((l) => /^([^:]+):(\d+):(.*)$/.exec(l))
    .filter(Boolean)
    .map(([, path, no, text]) => ({ path, no, text }));
}

const armB = () =>
  cargoLines()
    .filter((h) => !h.text.includes("--manifest-path"))
    .map((h) => ({ arm: "B", ...h, evidence: "manifest 미지정" }));

// ── arm C — 분리가 바꾼 집합의 닫힌 개수 서술 ────────────────────────────
//
// "Rust lane, four commands in this order" 류. 오늘 값이 맞아도 다음 이동이 낡게
// 만든다 — 실측으로 그 문장은 #2082 이 넣고 이틀 뒤 #2110 이 `five` 로 고쳤다.
// 집합은 개수가 아니라 소유 파일 포인터로 가리켜야 한다.
//
// 범위는 cargo 명령 줄의 ±3 줄 창이다 — 분리가 바꾼 집합이 cargo lane 이라
// 그 근처가 이 서술이 사는 자리다.
// 뒤쪽 경계를 두지 않는다. 한국어 수량사는 조사가 바로 붙어서 (`4종이 전부다`)
// 경계를 요구하면 이 클래스의 대표 문장이 통째로 빠진다.
//
// 명사 목록의 `step` 은 오탐을 하나 만든다 (`sits one step further out`). 그래도
// 빼지 않는다 — 이 스윕이 고친 자리 하나가 `without these two steps` 였고, 빼면
// 그 자리를 놓친다. 잡는 쪽을 넓게 두고 부사구는 아래 `C/adverbial-distance` 처분이
// 사유와 함께 걷는다 (필터로 숨기지 않는다는 이 파일의 기조와 같다).
export const CARDINAL =
  /(^|[^\p{L}\p{N}])(one|two|three|four|five|six|seven|eight|nine|ten|하나|둘|셋|넷|다섯|여섯|일곱|여덟|\d+)[ -]?(개|종|벌|곳|가지|commands?|manifests?|crates?|lanes?|steps?|files?|invocations?|packages?)/u;
const WINDOW = 3;

function armC() {
  const byPath = new Map();
  for (const h of cargoLines()) {
    if (!byPath.has(h.path)) byPath.set(h.path, new Set());
    byPath.get(h.path).add(Number(h.no));
  }
  const hits = [];
  for (const [path, centers] of byPath) {
    // 워킹트리를 읽는다 — `git grep` 이 트리시 없이 보는 것과 같은 판이어야
    // 방금 고친 줄이 반영된다 (`HEAD:` 로 읽으면 커밋 전 수정이 안 보인다).
    const src = readFileSync(abs(path), "utf8").split("\n");
    const seen = new Set();
    for (const c of centers) {
      for (let n = c - WINDOW; n <= c + WINDOW; n++) {
        if (n < 1 || n > src.length || centers.has(n) || seen.has(n)) continue;
        seen.add(n);
        const text = src[n - 1];
        const m = CARDINAL.exec(text);
        if (!m) continue;
        hits.push({
          arm: "C",
          path,
          no: String(n),
          evidence: m[0].trim(),
          text,
        });
      }
    }
  }
  return hits.sort(
    (a, b) => a.path.localeCompare(b.path) || Number(a.no) - Number(b.no),
  );
}

// ── arm D — 분리가 이름을 겹치게 만든 파일 ────────────────────────────────
//
// M 은 새 crate 루트를 만들면서 거기에 `Cargo.toml` · `Cargo.lock` ·
// `clippy.toml` 을 새로 놓았다. 그래서 이 이름들은 이제 저장소에 둘 이상이고,
// 맨 이름으로 부르는 산문은 어느 쪽인지 못 가른다 — `sqlparser` 범프 재감사 룰의
// 맨 「Cargo.lock」 이 그 예다.
// 용어는 M 의 A(added) 행 중 crate 루트에 앉은 것에서 뽑는다 — `src/` 안에
// 생긴 `lib.rs` · `mod.rs` 는 원래 저장소에 수십 벌이라 분리가 만든 모호함이
// 아니다.
function armD() {
  const added = nameStatus()
    .filter((l) => l.startsWith("A"))
    .map((l) => l.split("\t")[1]);
  const names = new Set();
  for (const p of added) {
    const dir = p.slice(0, p.lastIndexOf("/"));
    const base = p.slice(p.lastIndexOf("/") + 1);
    if (!existsSync(abs(join(dir, "Cargo.toml")))) continue; // crate 루트만
    if (dir.endsWith("/src")) continue;
    const same = lines(git(["ls-files", base, `*/${base}`]));
    if (same.length >= 2) names.add(base);
  }
  const hits = [];
  for (const base of [...names].sort()) {
    for (const line of lines(
      gitGrep(["-n", "-I", "-F", base, "--", ".", ...excludes]),
    )) {
      const m = /^([^:]+):(\d+):(.*)$/.exec(line);
      if (!m) continue;
      const [, path, no, text] = m;
      // 디렉토리를 붙여 부른 자리는 이미 모호하지 않다.
      if (text.includes(`/${base}`)) continue;
      hits.push({ arm: "D", path, no, evidence: base, text });
    }
  }
  return hits;
}

// ── 처분 — 남은 hit 을 왜 안 고쳤나 ───────────────────────────────────────
//
// issue #2092 수용 기준은 생성기 출력의 **각 hit** 이 「수정」 또는 「명시 예외 +
// 사유」로 처리됐음을 보이라고 하고, 손 열거를 금지한다. 그래서 처분을 PR body 의
// 표가 아니라 여기 규칙으로 둔다: 고친 hit 은 출력에서 사라지고, 남은 hit 은 아래
// 규칙 중 하나에 걸려야 한다. 어디에도 안 걸리는 hit 이 하나라도 있으면
// `--check` 가 exit 1 이다 — 다음 이동이 새 자리를 만들면 거기서 걸린다.
//
// 규칙은 순서대로 첫 매치가 이긴다. 경로 목록으로 쓴 규칙은 그 파일들을 읽고
// 판단했다는 뜻이고, 술어로 쓴 규칙은 매번 다시 잰다.
//
// ponytail: 경로 목록 규칙은 파일 단위라 같은 파일에 새로 생긴 hit 도 조용히
// 덮는다 — 실측으로 이 PR 이 고친 21건 중 17건은 `--check` 가 잡았고 나머지 4건은
// 이 부류에 가려졌다. 줄·문구 단위 술어로 좁힐 수 있지만 줄이 밀리면 같이 썩는다.
// 그 파일들에 manifest 없는 **실행 지시**가 새로 들어오는 일이 실제로 생기면 그때
// 좁힌다.
//
// ponytail: arm C 의 ±3 줄 창도 같은 부류의 천장이다 — cargo 줄에서 먼 닫힌 개수
// 서술은 안 보인다. `docs/contributor-guide/testing-and-quality.md` 의 llvm-cov
// 절이 그렇고(거리 7), 그 개수들은 잡 id 와 커밋 SHA 로 시점을 박은 측정 기록이라
// 지금은 안 썩는다. 창을 넓히면 무관한 산문이 같이 딸려 온다.

// `<수사> step(s) <방향어>` — 거리를 재는 부사구다. 집합의 개수가 아니다.
const ADVERBIAL_DISTANCE =
  /\b(?:one|two|three|a|\d+)[ -]?steps?\s+(?:further|closer|deeper|back|up|down|out|away|beyond|ahead|behind)\b/i;

const CI_GATES = new Set([".github/workflows/ci.yml", "lefthook.yml"]);
const SELF_TEST = "scripts/__tests__/core-split-prose.test.ts";

// `scripts/check-ci-test-calls.sh` 게이트의 테스트 (#2146 이 넣었다). 이 파일의
// cargo 텍스트는 `mkdtempSync` 트리에 뿌리는 픽스처 workflow 문자열이고, 테스트는
// 게이트 스크립트를 spawn 해서 그 문자열을 파싱시킨다 — cargo 는 안 돈다.
const GATE_TEST_FIXTURE = "scripts/__tests__/check-ci-test-calls.test.ts";

// 이슈 본문이 N3 를 #2091 로 넘겼다 — "여기가 아니라 #2091 범위다, 중복 수리 금지".
const OWNED_BY_2091 = new Set([
  "docs/contributor-guide/repository-topology-inventory.md",
  "docs/contributor-guide/source-root-migration-constraints.md",
]);

// 파일이 속한 crate 의 루트. 없으면 null — cargo 가 풀 manifest 가 없다는 뜻이다.
function enclosingCrate(path) {
  const seg = path.split("/");
  for (let i = seg.length - 1; i > 0; i--) {
    const dir = seg.slice(0, i).join("/");
    if (existsSync(abs(join(dir, "Cargo.toml")))) return dir;
  }
  return null;
}

// 펜스 블록이 세운 작업 디렉토리. arm B 는 줄 단위라 블록 첫 줄의 `cd <dir>` 를 못
// 보는데, 그 블록 안에서 맨 cargo 는 그 디렉토리의 manifest 로 풀린다.
// 줄 배열을 받는 순수 함수다 — 픽스처 파일 없이 단언할 수 있고, 픽스처를 두면
// 그 파일이 다시 이 스윕의 hit 이 된다.
export function cwdFromBlock(src, lineNo) {
  let open = false;
  let cwd = null;
  for (let n = 1; n <= lineNo && n <= src.length; n++) {
    const line = src[n - 1];
    // 펜스를 지날 때마다 리셋한다 — 닫힌 뒤의 `cd` 는 산문이라 문맥이 아니고,
    // 다음 블록이 앞 블록의 `cd` 를 물려받지도 않는다.
    if (/^\s*```/.test(line)) {
      open = !open;
      cwd = null;
      continue;
    }
    if (!open) continue;
    const m = /^\s*cd\s+(\S+)/.exec(line);
    if (m) cwd = m[1];
  }
  return cwd;
}

// crate 상대 tail 이 저장소에서 몇 개로 풀리나. `*/x` 글롭은 세그먼트 경계를 안
// 지켜 `db/mod.rs` 가 `rdb/mod.rs` 에도 걸리므로 결과를 다시 걸러 센다.
function tailResolvesTo(tail) {
  return lines(git(["ls-files", tail, `*/${tail}`])).filter(
    (p) => p === tail || p.endsWith(`/${tail}`),
  );
}

const DISPOSITIONS = [
  {
    id: "self/generator-vocabulary",
    // 이 규칙은 생성기를 커밋한 순간 `git grep` 이 자기 소스를 보기 시작해서
    // 생겼다 — `--check` 가 그 커밋에서 바로 잡았다. 여기 있는 옛 경로·맨 파일
    // 이름·cargo 명령은 배치에 대한 주장이 아니라 검색 대상 어휘와 테스트
    // 픽스처다. 고치면 생성기가 찾아야 할 것을 못 찾는다.
    why: "생성기와 그 테스트가 검색 어휘를 정의하는 자리다. 여기 적힌 옛 경로·파일 이름·cargo 명령은 주장이 아니라 패턴과 픽스처이고, 고치면 생성기가 대상을 못 찾는다",
    test: (h) => h.path.startsWith("scripts/sweep/") || h.path === SELF_TEST,
  },
  {
    id: "owned-by-2091",
    why: "이슈 본문이 이 두 파일의 crate 행 누락(N3)을 #2091 로 넘겼다. 중복 수리 금지",
    test: (h) => OWNED_BY_2091.has(h.path),
  },
  {
    id: "A/tail-resolves-uniquely",
    why: "crate 상대 짧은 표기가 저장소에서 한 파일로만 풀린다. 그 문장은 루트를 주장하지 않으니 분리가 거짓으로 만들지 않았다",
    test: (h) =>
      h.arm === "A" &&
      !h.evidence.startsWith("src-tauri/") &&
      tailResolvesTo(h.evidence).length === 1,
  },
  {
    id: "A/live-surface-claim-holds",
    why: "언급한 디렉토리가 아직 살아 있고 그 줄의 주장이 분리 후에도 참이다 — 앱 crate 경계 서술, 이동 사실 자체의 기록, 옛 prefix 가 full suite 로 떨어지는지 보는 회귀 픽스처",
    test: (h) =>
      h.arm === "A" &&
      [
        "e2e/scope-map.mjs",
        "memory/engineering/architecture/memory.md",
        "memory/engineering/architecture/state-management/memory.md",
        "memory/index/by-surface.md",
      ].includes(h.path),
  },
  {
    id: "B/enclosing-crate-manifest",
    why: "그 파일을 감싸는 crate 안에서 맨 cargo 는 그 crate 의 manifest 로 풀린다 — 생성기가 core 를 필터에서 뺀 것과 같은 근거",
    test: (h) => h.arm === "B" && enclosingCrate(h.path) !== null,
  },
  {
    id: "B/block-sets-working-directory",
    why: "그 줄을 감싼 펜스 블록이 `cd <crate>` 로 작업 디렉토리를 세운다 — 블록 안에서 맨 cargo 는 그 디렉토리의 manifest 로 풀린다. arm B 는 줄 단위라 그 문맥을 못 본다",
    test: (h) => {
      if (h.arm !== "B") return false;
      const dir = cwdFromBlock(
        readFileSync(abs(h.path), "utf8").split("\n"),
        Number(h.no),
      );
      return dir !== null && existsSync(abs(join(dir, "Cargo.toml")));
    },
  },
  {
    id: "B/gate-passes-manifest",
    why: "게이트 배선 파일이고, 그 hit 이 실행 줄이면 감싼 step 이 `--manifest-path` 나 `working-directory` 로 crate 를 고른다 — 나머지는 그 step 을 설명하는 주석·이름이다",
    test: (h) => h.arm === "B" && CI_GATES.has(h.path),
  },
  {
    id: "B/gate-test-fixture",
    why: "게이트 테스트가 임시 트리에 뿌리는 픽스처 workflow 문자열이다 — `scripts/check-ci-test-calls.sh` 가 그 텍스트를 파싱만 하고 cargo 는 안 돈다. 셋 중 둘은 명령 줄도 아니다: step `name:` 줄(바로 아래 `run:` 이 manifest 를 준다)과, 주석 안의 `--test` 가 호출로 안 세어지는지 보는 주석 픽스처다",
    test: (h) => h.arm === "B" && h.path === GATE_TEST_FIXTURE,
  },
  {
    id: "B/names-the-lane",
    // 경로 목록은 각 항목이 실제로 hit 을 덮는지 재고 넣는다. `docs/roadmap/h7.md`
    // 가 처음엔 있었는데 0건이었다 — 그 파일의 cargo 줄에는 `--manifest-path` 가
    // 같이 있어 arm B 가 애초에 안 내보낸다.
    why: "cargo 를 돌리라는 지시가 아니라 lane·도구·소비자를 이름으로 부르는 산문이다. manifest 를 붙이면 문장이 명령으로 오독된다",
    test: (h) =>
      h.arm === "B" &&
      (h.path.startsWith("src/") ||
        h.path.startsWith("tests/fixtures/") ||
        [
          "docs/contributor-guide/smoke-matrix/h7-ops-security-reliability.md",
          "memory/engineering/architecture/memory.md",
          "memory/workflow/git-policy/memory.md",
        ].includes(h.path)),
  },
  {
    id: "C/adverbial-distance",
    why: "수사+명사가 집합의 개수가 아니라 거리·방향을 가리키는 부사구다 (`sits one step further out`). 명사 목록의 `step` 은 `these two steps` 류를 잡으려고 남겨 둔다",
    test: (h) => h.arm === "C" && ADVERBIAL_DISTANCE.test(h.text),
  },
  {
    id: "C/set-predates-the-split",
    why: "세는 집합이 분리와 무관하다 — capability flip 의 4-Surface Sync 는 #2082 전후가 같고 바로 아래 1-4 로 열거된다",
    test: (h) =>
      h.arm === "C" &&
      h.path === "memory/engineering/architecture/data-source/adding/memory.md",
  },
  {
    id: "D/own-crate-file",
    why: "그 파일이 속한 crate 루트에 같은 이름이 있다 — 맨 이름은 자기 crate 것으로 읽힌다",
    test: (h) => {
      if (h.arm !== "D") return false;
      const crate = enclosingCrate(h.path);
      return crate !== null && existsSync(abs(join(crate, h.evidence)));
    },
  },
  {
    id: "D/line-disambiguates-itself",
    why: "그 줄이 어느 것인지 스스로 밝힌다 — CARGO_MANIFEST_DIR 에서 crate 자기 사본을 읽는다는 서술과, 루트에는 그 파일이 없다는 서술",
    test: (h) =>
      h.arm === "D" &&
      [
        ".github/workflows/ci.yml",
        "memory/workflow/git-policy/memory.md",
      ].includes(h.path),
  },
];

export const classify = (hit) => DISPOSITIONS.find((d) => d.test(hit)) ?? null;

function main() {
  const a = wants("a") ? armA() : null;
  const b = wants("b") ? armB() : null;
  const c = wants("c") ? armC() : null;
  const d = wants("d") ? armD() : null;
  const all = [a, b, c, d].filter(Boolean).flat();
  const n = (arm) => (arm ? arm.length : "-");
  const at = (h) => `${h.arm}\t${h.path}:${h.no}`;

  if (CHECK) {
    const unclassified = all.filter((h) => classify(h) === null);
    const counts = new Map();
    for (const h of all) {
      const id = classify(h)?.id;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const out = [
      `merge=${MERGE}`,
      `hits=${all.length}`,
      `unclassified=${unclassified.length}`,
      "",
      ...DISPOSITIONS.map((d) => `${counts.get(d.id) ?? 0}\t${d.id}\t${d.why}`),
      ...unclassified.map((h) => `\nUNCLASSIFIED\t${at(h)}\t${h.text.trim()}`),
    ];
    process.stdout.write(`${out.join("\n")}\n`);
    process.exitCode = unclassified.length === 0 ? 0 : 1;
    return;
  }

  const out = [
    `merge=${MERGE}`,
    `arm_a_moved_path=${n(a)}`,
    `arm_b_cargo_no_manifest=${n(b)}`,
    `arm_c_closed_count=${n(c)}`,
    `arm_d_duplicated_basename=${n(d)}`,
    `total=${all.length}`,
    `excludes=${NO_EXCLUDE ? "(none — --no-exclude)" : FROZEN.join(" ")}`,
    "",
    ...all.map((h) => `${at(h)}\t${h.evidence}\t${h.text.trim()}`),
  ];
  process.stdout.write(`${out.join("\n")}\n`);
}

// import 되면(테스트) 실행하지 않는다 — `classify` 와 `segmentAligned` 만 노출.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
