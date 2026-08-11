#!/usr/bin/env node
// mcp/repo-recon/server.mjs — 노드가 저장소를 정찰할 때 쓰는 stdio MCP 서버 (issue #2289).
//
// 사용:
//   node scripts/mcp/repo-recon/server.mjs   # stdio 로 말한다. 사람이 직접 부를 일은 없다
//   등록은 루트 `.mcp.json` 이 한다.
//
// 설계 두 줄 (이슈 #2289 범위 수정, 2026-08-11):
//
//   - **막지 않는다.** 노드는 어차피 빈틈을 찾는다. 막는 대신 이상하면 경고를 얹고
//     그대로 통과시킨다.
//   - **선언한 대로 동작한다.** `repo_grep` 을 부르면 grep 이 돈다. 도구가 거짓말을
//     하지 않는 문제다.
//
// 그래서 이 서버는 git 의 얇은 래퍼다. 응답은 `argv` (stdout 을 낸 배열) ·
// `stdout` (git 출력 그대로, 빈 줄도 안 자른다) · `warnings` 뿐이고, 서버가 세거나
// 자르는 필드는 없다 — 서버가 세면 서버가 오계수를 만든다.
//
// 값은 인자 모양에 있다: `pathspec` 이 문자열 배열이라 문자열이 셸 파서에 안 닿고,
// `rev` 가 필수이며, `mode` 와 `regex` 가 git 플래그를 고르게 한다.
//
// `rev` 는 자유 문자열이라 git 의 옵션 파싱 구간에 들어간다. typed tool 은 그래서
// `rev` 를 `--end-of-options` 뒤에 두고, `repo_show` 는 `git rev-parse` 로 먼저 풀어
// 문자열 조립에서 뺀다. 안 그러면 `-Osh -c "..."` 가 pager 로 셸을 돌리고
// `--output=` 이 파일을 쓴다 — 라운드 1 리뷰가 실물 MCP 왕복으로 재현했다.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 서버 파일 위치에서 파생한다 — cwd 를 안 읽으므로 어디서 spawn 되든 같은 트리를 본다.
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

// `rev` 의 정식 값. 이 값이면 rev 인자 없이 git 을 불러 작업 트리를 읽고 경고를 단다 —
// 못 읽게 막는 대신 읽으면 보이게 한다.
const WORKTREE = "WORKTREE";

// `mode` · `regex` → git 플래그. 이 표가 고르는 것은 플래그뿐이고, 각 엔진이 무엇을
// 어떻게 무는지는 서술하지 않는다 (플랫폼마다 갈린다).
const MODE_FLAG = { files: "-l", lines: "-n", matches: "-o" };
const REGEX_FLAG = { fixed: "-F", extended: "-E", perl: "-P" };

// ponytail: 자르지 않고 경고만 얹는 문턱. 호출자가 이 줄 수를 넘겨 받아도 응답은 전량이다.
const BIG_OUTPUT_LINES = 2000;

// `memory/workflow/git-policy/memory.md` 「Hard block」의 사본이다 — SOT 는 그 방이고
// 이쪽은 호출 시점에 알려 주는 경고일 뿐이다. 놓쳐도 실행은 원래 되던 대로 된다.
const UPSTREAM_TARGET =
  /^(FETCH_HEAD|ORIG_HEAD|@\{u\}|origin\/|refs\/remotes\/)/;

const run = promisify(execFile);

/**
 * git 을 argv 배열로 실행한다 — 셸을 안 거친다.
 * @param {string[]} argv
 * @param {{ emptyIsAnswer?: boolean }} [options]
 * @returns {Promise<string>}
 */
async function git(argv, options = {}) {
  try {
    const { stdout } = await run("git", argv, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    // `git grep` 은 일치가 없으면 1 로 끝난다 — 실패가 아니라 답이다.
    if (options.emptyIsAnswer && error.code === 1) return error.stdout ?? "";
    // argv 를 공백으로 이어 붙이지 않는다 — 안 만든 셸 문자열을 에러가 지어내면
    // 다음 독자가 인용 문제를 찾으러 간다.
    throw new Error(
      `git ${JSON.stringify(argv)} exited ${error.code}: ${(error.stderr ?? "").trim()}`,
    );
  }
}

/** @param {string} stdout */
function lineCount(stdout) {
  if (stdout === "") return 0;
  return stdout.split("\n").length - (stdout.endsWith("\n") ? 1 : 0);
}

/** @param {string} rev */
function revWarnings(rev) {
  if (rev === WORKTREE) return ["커밋 안 된 작업 트리를 읽었다"];
  // 축약 포함 hex 이면 고정 객체다. 그 밖(`HEAD` · 브랜치 · 태그)은 다음에 부르면 다른
  // 것을 낼 수 있다.
  if (/^[0-9a-f]{7,64}$/.test(rev)) return [];
  return [
    `rev \`${rev}\` 는 움직이는 ref 다 — 사본이 뒤쳐져 있으면 결과도 뒤쳐진다`,
  ];
}

/**
 * 실행 결과를 그대로 돌려준다. 출력에 대한 경고는 여기서 얹는다.
 * @param {string[]} argv stdout 을 낸 배열. git 을 안 부른 경로면 빈 배열
 * @param {string} stdout
 * @param {string[]} warnings
 */
function reply(argv, stdout, warnings) {
  const observed =
    stdout === ""
      ? ["0건이다 — glob 오타인지, 그 rev 에 없는 경로인지 확인해라"]
      : lineCount(stdout) > BIG_OUTPUT_LINES
        ? [`${lineCount(stdout)}줄이다 — pathspec 을 좁히는 게 좋다`]
        : [];
  const body = { argv, stdout, warnings: [...warnings, ...observed] };
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

/**
 * rev 를 git 에 넘길 토큰으로 바꾼다. `--end-of-options` 가 옵션 파싱을 여기서 끊는다.
 * @param {string} rev
 */
function revArgv(rev) {
  return rev === WORKTREE ? [] : ["--end-of-options", rev];
}

/**
 * git-policy 「Hard block」에 걸리는 형태인가. 문자열 대조뿐이라 넓게 문다 —
 * 경고이지 게이트가 아니므로 헛경고가 못 잡는 것보다 싸다.
 * @param {string[]} argv
 */
function hitsHardBlock(argv) {
  const has = (...names) => names.some((name) => argv.includes(name));
  if (has("--no-verify", "--no-gpg-sign", "commit.gpgsign=false")) return true;
  if (has("--force", "--force-with-lease")) return true;
  if (argv.includes("push") && argv.includes("-f")) return true;
  if (argv.includes("pull")) return true;
  return (
    argv.includes("reset") &&
    argv.includes("--hard") &&
    argv.some((arg) => UPSTREAM_TARGET.test(arg))
  );
}

// `git ls-tree` 의 pathspec 은 정확 경로와 디렉토리 접두사만 받는다 — `*.md` 도
// `memory/*` 도 에러 없이 0건이다 (2026-08-11 실측). 그 조용한 0 이 이 서버가 없애려는
// 바로 그 실패라, 목록은 빈 트리와의 diff 로 낸다: 같은 rev 의 같은 경로 전수를 내면서
// pathspec 전체(글롭·`:(glob)` 매직 포함)를 받는다. 빈 트리 해시는 해시 알고리즘마다
// 달라 상수로 박지 않고 git 에게 묻는다.
const EMPTY_TREE = (
  await git(["hash-object", "-t", "tree", "/dev/null"])
).trim();

const server = new McpServer({ name: "repo-recon", version: "0.2.0" });

const THIN =
  "git 의 얇은 래퍼다. 권한 범위를 좁히고 인자 모양을 고정할 뿐, 결과를 해석하거나 보정하지 않는다.";

const rev = z
  .string()
  .min(1)
  .describe(
    `읽을 커밋/트리 (\`HEAD\`, \`origin/main\`, SHA). \`${WORKTREE}\` 면 rev 없이 git 을 불러 커밋 안 된 작업 트리를 읽고 경고를 단다`,
  );
const pathspec = z
  .array(z.string())
  .describe(
    "git pathspec 배열. 셸을 안 거치므로 `*.md` 는 확장 없이 git 이 받고 하위 디렉토리까지 민다. 전체는 `[]`",
  );

server.registerTool(
  "repo_grep",
  {
    description: `${THIN}\n\`git grep\` 을 돈다.`,
    inputSchema: {
      pattern: z
        .string()
        .min(1)
        .describe("검색 패턴. regex 인자가 문법을 정한다"),
      rev,
      pathspec,
      mode: z
        .enum(["files", "lines", "matches"])
        .describe("git 플래그: files=`-l` · lines=`-n` · matches=`-o`"),
      regex: z
        .enum(["fixed", "extended", "perl"])
        .describe("git 플래그: fixed=`-F` · extended=`-E` · perl=`-P`"),
    },
  },
  async (args) => {
    const argv = [
      "grep",
      MODE_FLAG[args.mode],
      REGEX_FLAG[args.regex],
      "-e",
      args.pattern,
      ...revArgv(args.rev),
      "--",
      ...args.pathspec,
    ];
    const stdout = await git(argv, { emptyIsAnswer: true });
    return reply(argv, stdout, revWarnings(args.rev));
  },
);

server.registerTool(
  "repo_show",
  {
    description: `${THIN}\n\`git rev-parse\` 로 rev 를 푼 뒤 \`git show <oid>:<path>\` 를 돈다. \`${WORKTREE}\` 면 git 에 해당 명령이 없어 작업 트리 파일을 그대로 읽는다.`,
    inputSchema: {
      path: z.string().min(1).describe("저장소 루트 기준 경로"),
      rev,
    },
  },
  async (args) => {
    if (args.rev === WORKTREE) {
      // `git show` 는 트리 밖을 못 읽는다. 작업 트리 읽기도 같은 범위로 둔다 —
      // 저장소 정찰 도구가 임의 파일 리더가 되지 않게.
      const file = resolve(REPO_ROOT, args.path);
      if (!file.startsWith(REPO_ROOT + sep)) {
        throw new Error(`path ${JSON.stringify(args.path)} 는 저장소 밖이다`);
      }
      return reply([], await readFile(file, "utf8"), [
        ...revWarnings(args.rev),
        `git 에는 작업 트리 파일을 그대로 내는 명령이 없어 파일을 직접 읽었다 — 재현은 \`cat ${args.path}\``,
      ]);
    }
    // rev 를 별도 토큰으로 넘겨 푼다. `${rev}:${path}` 조립에 자유 문자열이 들어가면
    // 그 문자열이 옵션으로 먹힌다 — 여기서 나온 oid 는 hex 라 조립해도 안전하고,
    // 돌려주는 argv 가 그 커밋에 못박힌다.
    const oid = (
      await git(["rev-parse", "--verify", ...revArgv(args.rev)])
    ).trim();
    const argv = ["show", `${oid}:${args.path}`];
    return reply(argv, await git(argv), revWarnings(args.rev));
  },
);

server.registerTool(
  "repo_ls",
  {
    description: `${THIN}\nrev 에서 pathspec 이 무는 경로 목록을 낸다.`,
    inputSchema: { rev, pathspec },
  },
  async (args) => {
    const argv =
      args.rev === WORKTREE
        ? ["ls-files", "--cached", "--others", "--exclude-standard", "--"]
        : [
            "diff-tree",
            "-r",
            "--name-only",
            "--no-commit-id",
            // 옵션 파싱을 EMPTY_TREE 앞에서 끊는다 — 뒤따르는 rev 도 같이 덮인다.
            "--end-of-options",
            EMPTY_TREE,
            args.rev,
            "--",
          ];
    argv.push(...args.pathspec);
    return reply(argv, await git(argv), revWarnings(args.rev));
  },
);

server.registerTool(
  "repo_git",
  {
    description:
      "타입도 가드도 없는 탈출구다. argv 를 그대로 git 에 넘긴다 — 인자는 부르는 쪽 책임이다.",
    inputSchema: {
      argv: z
        .array(z.string())
        .describe("`git` 뒤에 올 argv 배열. 서버가 아무것도 안 끼워 넣는다"),
    },
  },
  async (args) => {
    const warnings = ["타입 안 잡힌 호출이다"];
    if (hitsHardBlock(args.argv)) {
      warnings.push(
        "`memory/workflow/git-policy/memory.md` 「Hard block」에 걸리는 명령이다 — 실행은 한다",
      );
    }
    return reply(args.argv, await git(args.argv), warnings);
  },
);

await server.connect(new StdioServerTransport());
