#!/usr/bin/env node
// mcp/repo-recon/server.mjs — 노드가 저장소를 정찰할 때 쓰는 stdio MCP 서버 (issue #2289).
//
// 사용:
//   node scripts/mcp/repo-recon/server.mjs   # stdio 로 말한다. 사람이 직접 부를 일은 없다
//   등록은 루트 `.mcp.json` 이 한다.
//
// 왜 서버인가: 이 저장소의 금지 규칙은 집행 장치가 없고(`AGENTS.md` 「강제 룰」),
// hook 은 금지형을 열거하는 층이라 집합이 안 닫힌다. 이 서버는 반대 방향이다 —
// **틀린 형태를 표현할 수 없게** 인자 모양을 시그니처로 강제한다. 반복 관측된
// 측정 실패와 그것을 죽이는 자리:
//
//   - 셸이 glob 인자를 삼켜 명령이 안 돌았는데 exit 0 → `pathspec` 이 문자열
//     배열이고 argv 로 git 에 그대로 간다. 문자열이 셸 파서에 닿지 않는다
//   - 작업 트리가 stale 한데 그대로 읽음 → `rev` 가 세 tool 모두 필수 인자다
//   - `grep -c` 줄 수를 파일 수로 옮겨 적음 → `mode` 로 세는 단위를 골라야 한다
//   - `grep -P` 가 rc=2 로 죽어 0건처럼 보임 / `-E` 가 `\s` 를 리터럴 s 로 읽음
//     → `regex` 종류를 서버가 git 플래그로 매핑한다
//
// 출력에 `rev:` 접두사가 붙은 채로 두는 것도 같은 이유다 — 어느 커밋을 읽었는지가
// 결과 줄마다 남아야 stale 트리 오독이 눈에 띈다.

import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
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

// `mode` → git 플래그. 이 표가 이 서버의 요점이다: 세는 단위를 호출자가 고른다.
const MODE_FLAG = { files: "-l", lines: "-n", matches: "-o" };
const REGEX_FLAG = { fixed: "-F", extended: "-E", perl: "-P" };

// ponytail: 목록만 자르고 `count` 는 늘 전수다. 잘린 수를 세면 이 서버가 막으려는
// 오계수를 이 서버가 만든다. tool 별로 다른 상한이 필요해지면 그때 인자로 올린다.
const MAX_LINES = 2000;

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

/**
 * @param {string} stdout
 * @param {Record<string, unknown>} echo 호출이 실제로 무엇을 물었는지 결과에 남긴다
 */
function result(stdout, echo) {
  const all = stdout.split("\n").filter((line) => line !== "");
  const body = {
    ...echo,
    count: all.length,
    truncated: all.length > MAX_LINES,
    lines: all.slice(0, MAX_LINES),
  };
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

// `git ls-tree` 의 pathspec 은 정확 경로와 디렉토리 접두사만 받는다 — `*.md` 도
// `memory/*` 도 에러 없이 0건이다 (2026-08-11 실측). 그 조용한 0 이 이 서버가 없애려는
// 바로 그 실패라, 목록은 빈 트리와의 diff 로 낸다: 같은 rev 의 같은 경로 전수를 내면서
// pathspec 전체(글롭·`:(glob)` 매직 포함)를 받는다. 빈 트리 해시는 해시 알고리즘마다
// 달라 상수로 박지 않고 git 에게 묻는다.
const EMPTY_TREE = (
  await git(["hash-object", "-t", "tree", "/dev/null"])
).trim();

const server = new McpServer({ name: "repo-recon", version: "0.1.0" });

const rev = z
  .string()
  .min(1)
  .describe(
    "읽을 커밋/트리 (`HEAD`, `origin/main`, SHA). 작업 트리는 안 읽는다",
  );
const pathspec = z
  .array(z.string())
  .describe(
    "git pathspec 배열. 셸을 안 거치므로 `*.md` 는 확장 없이 git 이 받고 하위 디렉토리까지 민다. 전체는 `[]`",
  );

server.registerTool(
  "repo_grep",
  {
    description:
      "`git grep` — rev 에서 pattern 을 찾는다. 출력 줄은 `rev:path[:line]` 형태 그대로다.",
    inputSchema: {
      pattern: z
        .string()
        .min(1)
        .describe("검색 패턴. regex 인자가 문법을 정한다"),
      rev,
      pathspec,
      mode: z
        .enum(["files", "lines", "matches"])
        .describe(
          "무엇을 세고 낼지: files=일치 파일(-l) · lines=일치 줄(-n) · matches=일치 횟수(-o). 셋의 count 는 서로 다르다",
        ),
      regex: z
        .enum(["fixed", "extended", "perl"])
        .describe(
          "문법: fixed=리터럴(-F) · extended=POSIX ERE(-E, `\\s` 는 리터럴 s 다) · perl=PCRE(-P, `\\s`·전방탐색 가능)",
        ),
    },
  },
  async (args) => {
    const argv = [
      "grep",
      MODE_FLAG[args.mode],
      REGEX_FLAG[args.regex],
      "-e",
      args.pattern,
      args.rev,
      "--",
      ...args.pathspec,
    ];
    const stdout = await git(argv, { emptyIsAnswer: true });
    return result(stdout, {
      rev: args.rev,
      mode: args.mode,
      regex: args.regex,
      pathspec: args.pathspec,
    });
  },
);

server.registerTool(
  "repo_show",
  {
    description:
      "`git show <rev>:<path>` — rev 시점의 파일 내용. 작업 트리 사본이 아니다.",
    inputSchema: {
      path: z.string().min(1).describe("저장소 루트 기준 경로"),
      rev,
    },
  },
  async (args) => {
    const stdout = await git(["show", `${args.rev}:${args.path}`]);
    return result(stdout, { rev: args.rev, path: args.path });
  },
);

server.registerTool(
  "repo_ls",
  {
    description:
      "rev 에서 pathspec 이 무는 경로 목록. 작업 트리도 index 도 안 읽으므로 커밋 안 된 파일은 안 나온다.",
    inputSchema: { rev, pathspec },
  },
  async (args) => {
    const stdout = await git([
      "diff-tree",
      "-r",
      "--name-only",
      "--no-commit-id",
      EMPTY_TREE,
      args.rev,
      "--",
      ...args.pathspec,
    ]);
    return result(stdout, { rev: args.rev, pathspec: args.pathspec });
  },
);

await server.connect(new StdioServerTransport());
