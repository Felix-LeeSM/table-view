import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Purpose: `scripts/mcp/repo-recon/server.mjs` 를 잠근다 — issue #2289.
//
// 서버는 git 의 얇은 래퍼이므로 단언도 그 성질을 문다: 응답이 실행한 argv 와 git 의
// stdout 그대로인가, 서버가 지어낸 필드가 없는가, `rev` 슬롯이 git 옵션을 삼키지
// 않는가, 판단이 필요한 자리에 경고가 붙는가.
//
// **개수 비교로 성질을 세우지 않는다.** 라운드 1 은 `-E` 와 `-P` 의 일치 건수 차이를
// 단언해 CI(glibc ERE)에서 red 였다 — 같은 정규식이 플랫폼마다 다르게 물기 때문이다.
// 대신 만들어진 argv 를 본다: 서버가 고르는 것은 git 플래그뿐이고, 그 플래그가 무엇을
// 무는지는 서버의 주장이 아니다.
//
// 왕복은 실물 프로세스다 — `.mcp.json` 이 선언한 command/args 를 그대로 spawn 해
// stdio JSON-RPC 로 initialize → tools/list → tools/call 을 돈다. 서버 함수를
// 직접 부르면 그 등록 파일과 프로토콜 층이 통째로 단언 밖으로 빠진다.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const mcpConfigPath = resolve(repoRoot, ".mcp.json");
// JSON.parse 는 주석도 후행 쉼표도 안 받는다 — 「엄격 JSON 파싱」이 곧 이 호출이다.
const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf8")) as {
  mcpServers: Record<string, { command: string; args: string[] }>;
};
const repoRecon = mcpConfig.mcpServers["repo-recon"];

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Payload = { argv: string[]; stdout: string; warnings: string[] };

function textOf(result: ToolResult): string {
  const content = result.content as { text?: string }[] | undefined;
  return (content ?? []).map((part) => part.text ?? "").join("");
}

function payloadOf(result: ToolResult): Payload {
  expect(result.isError ?? false, textOf(result)).toBe(false);
  return JSON.parse(textOf(result)) as Payload;
}

function gitOutput(argv: string[]): string {
  return execFileSync("git", argv, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

const headOid = gitOutput(["rev-parse", "HEAD"]).trim();

/**
 * git 이 오브젝트 하나로 푸는 6자 축약 oid 를 `rev` 의 조상 쪽에서 찾는다.
 *
 * 6자 접두사는 커밋만의 이름공간이 아니라 tree · blob 과 같이 쓴다. 겹치면 git 이 rev 를
 * 아예 못 풀어 `rev-parse` 도 `git grep` 도 죽으므로, 그 접두사를 rev 로 쓰는 단언은
 * 저장소 오브젝트 상태에 따라 통째로 무너진다 (#2390 — CI 가 체크아웃한 merge 커밋의 앞
 * 6자가 저장소의 tree 와 겹쳐, repo-recon 과 무관한 PR 의 Frontend Checks 가 red 였다).
 *
 * `--abbrev=6` 을 준 `%h` 가 6자를 그대로 내면 그 접두사가 유일하다는 git 자신의 판정이다 —
 * 겹치면 git 이 스스로 7자 이상으로 늘린다. 유일성 규칙을 다시 구현하지 않고 그 길이를 읽는다.
 * @param rev 여기서부터 조상 쪽으로 훑는다
 */
function resolvableShortOid(rev: string): string {
  const abbreviated = gitOutput([
    "log",
    "--format=%h",
    "--abbrev=6",
    "-n",
    "50",
    rev,
  ])
    .trim()
    .split("\n");
  const unique = abbreviated.find((abbrev) => abbrev.length === 6);
  if (unique === undefined) {
    // 훑은 커밋이 전부 겹쳐야 여기 온다. 조용히 옛 동작으로 되돌아가면 같은 결함이
    // 되살아나므로, 범위를 넓혀야 한다는 사실이 보이게 죽는다.
    throw new Error(`6자 접두사가 유일한 커밋이 ${rev} 에서 50개 안에 없다`);
  }
  return unique;
}

// `rev` 로 들어가는 git 옵션이 파일을 만드는지 보는 자리. 저장소 안에 두면 그 실패가
// 트리를 더럽히므로 임시 디렉토리에 둔다.
const probeDir = mkdtempSync(join(tmpdir(), "repo-recon-"));
const probeFile = join(probeDir, "MARKER");

// 저장소 밖을 가리키는 심링크와 커밋 안 된 파일. 둘 다 저장소 루트에 실물로 있어야 뜻이
// 있는 단언이라 beforeAll 에서 만들고 afterAll 에서 지운다 — 앞 실행이 죽어 남았을 수
// 있으니 만들기 전에 지운다.
//
// **모듈 최상위가 아니라 beforeAll 이어야 한다** (#2483). `vitest list` 는 수집만 하고
// 실행하지 않는데 모듈은 import 하므로, 최상위에 두면 프로브가 만들어지고 짝인 afterAll 은
// 안 돌아 저장소 루트에 남는다. 남은 심링크의 대상은 이 머신의 TMPDIR 절대 경로라 다른
// 노드의 `git add -A` 가 집으면 깨진 링크가 커밋된다. `beforeAll` 은 `list` 가 안 돌린다.
const outsideMarker = "repo-recon outside-the-tree marker";
const outsideFile = join(probeDir, "OUTSIDE");
const symlinkProbe = "RR_SYMLINK_PROBE";
const untrackedProbe = "RR_UNTRACKED_PROBE";

let client: Client;

beforeAll(async () => {
  writeFileSync(outsideFile, outsideMarker);
  for (const probe of [symlinkProbe, untrackedProbe]) {
    rmSync(join(repoRoot, probe), { force: true });
  }
  symlinkSync(outsideFile, join(repoRoot, symlinkProbe));
  writeFileSync(join(repoRoot, untrackedProbe), "uncommitted\n");

  client = new Client({ name: "repo-recon-test", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: repoRecon.command,
      args: repoRecon.args,
      // `.mcp.json` 의 args 가 상대 경로다 — 등록 시점과 같은 기준(저장소 루트)에서 연다.
      cwd: repoRoot,
      stderr: "inherit",
    }),
  );
}, 30_000);

afterAll(async () => {
  await client?.close();
  rmSync(probeDir, { recursive: true, force: true });
  for (const probe of [symlinkProbe, untrackedProbe]) {
    rmSync(join(repoRoot, probe), { force: true });
  }
});

describe("repo-recon MCP server", () => {
  // Reason: 등록 파일이 실행되지 않는 경로를 가리켜도 나머지 단언은 다른 경로로
  // 서버를 띄우면 전부 green 이다. spawn 을 이 파일에서 뽑아 쓰는 것으로 그 구멍을
  // 막고, 여기서는 그 값이 무엇인지까지 고정한다.
  it("declares the repo-recon stdio server in .mcp.json", () => {
    expect(Object.keys(mcpConfig.mcpServers)).toContain("repo-recon");
    expect(repoRecon.command).toBe("node");
    expect(repoRecon.args).toEqual(["scripts/mcp/repo-recon/server.mjs"]);
    expect(
      readFileSync(resolve(repoRoot, repoRecon.args[0]), "utf8"),
    ).toContain("repo_grep");
  });

  // Reason: 이름은 호출자가 손으로 적는 유일한 문자열이다. 하나라도 바뀌면 그
  // 노드의 호출이 통째로 죽는데, 서버 쪽만 고치면 아무 데서도 안 걸린다.
  it("answers initialize and lists the recon tools by name", async () => {
    expect(client.getServerVersion()?.name).toBe("repo-recon");
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "repo_git",
      "repo_grep",
      "repo_ls",
      "repo_show",
    ]);
  });

  // Reason: 이름만 보면 description 축이 통째로 단언 밖이다 — 라운드 1 이 blocking 으로
  // 지운 문장(정규식 엔진 동작 서술)을 그 자리에 되살려도 전부 green 이었다. 범위 수정
  // 코멘트가 문자 그대로 정한 첫 줄이라 문자열 동일성으로 문다. 무는 것은 문구이지 그
  // 문구가 서술하는 플랫폼 동작이 아니므로 엔진마다 갈리지 않는다.
  it("puts the contract sentence first in every tool description", async () => {
    const { tools } = await client.listTools();
    const firstLine = (name: string) =>
      (tools.find((tool) => tool.name === name)?.description ?? "").split(
        "\n",
      )[0];
    const thin =
      "git 의 얇은 래퍼다. 권한 범위를 좁히고 인자 모양을 고정할 뿐, 결과를 해석하거나 보정하지 않는다.";
    expect(firstLine("repo_grep")).toBe(thin);
    expect(firstLine("repo_show")).toBe(thin);
    expect(firstLine("repo_ls")).toBe(thin);
    expect(firstLine("repo_git")).toBe(
      "타입도 가드도 없는 탈출구다. argv 를 그대로 git 에 넘긴다 — 인자는 부르는 쪽 책임이다.",
    );
  });

  // Reason: 응답 계약 자체를 문다. 서버가 세거나 자르는 필드를 되살리면 여기가 red 다 —
  // 서버가 세면 서버가 오계수를 만든다. argv 를 통째로 고정해 `--end-of-options` 가
  // rev 앞에 서는 것도 같은 단언에 넣는다.
  it("answers with the argv it ran, git stdout, and nothing it made up", async () => {
    const result = await client.callTool({
      name: "repo_grep",
      arguments: {
        pattern: "memory",
        rev: "HEAD",
        pathspec: ["AGENTS.md"],
        mode: "files",
        regex: "fixed",
      },
    });
    const payload = payloadOf(result);
    expect(Object.keys(payload).sort()).toEqual(["argv", "stdout", "warnings"]);
    expect(payload.argv).toEqual([
      "grep",
      "-l",
      "-F",
      "-e",
      "memory",
      "--end-of-options",
      "HEAD",
      "--",
      "AGENTS.md",
    ]);
    expect(payload.stdout).toBe("HEAD:AGENTS.md\n");
  });

  // Reason: 이 저장소가 반복해서 틀린 자리 — `grep -c` 가 낸 줄 수를 파일 수로 옮겨
  // 적는 것 — 를 시그니처가 가르는지 본다. 결과 개수가 아니라 만들어진 플래그를 보는
  // 이유는 위 파일 머리에 적었다: 개수는 플랫폼과 산문에 흔들린다.
  it("picks a different git flag per mode and per regex kind", async () => {
    const flagsFor = async (over: Record<string, string>) => {
      const result = await client.callTool({
        name: "repo_grep",
        arguments: {
          pattern: "memory",
          rev: "HEAD",
          pathspec: ["AGENTS.md"],
          mode: "lines",
          regex: "fixed",
          ...over,
        },
      });
      return payloadOf(result).argv.slice(1, 3);
    };
    expect(await flagsFor({ mode: "files" })).toEqual(["-l", "-F"]);
    expect(await flagsFor({ mode: "lines" })).toEqual(["-n", "-F"]);
    expect(await flagsFor({ mode: "matches" })).toEqual(["-o", "-F"]);
    expect(await flagsFor({ regex: "extended" })).toEqual(["-n", "-E"]);
    expect(await flagsFor({ regex: "perl" })).toEqual(["-n", "-P"]);
  });

  // Reason: 라운드 1 의 blocking — 서버가 파일 내용에서 빈 줄을 지워 줄 번호가
  // 어긋났다. `path:line` 이 이 저장소의 리뷰 근거 형식이라 그 어긋남이 그대로
  // 거짓 근거가 된다. 바이트 동일성으로 문다.
  it("returns git stdout byte for byte, blank lines included", async () => {
    const expected = gitOutput(["show", `${headOid}:AGENTS.md`]);
    // 이 파일에 빈 줄이 없으면 위 단언이 아무것도 증명하지 않는다.
    expect(expected).toContain("\n\n");
    const result = await client.callTool({
      name: "repo_show",
      arguments: { rev: "HEAD", path: "AGENTS.md" },
    });
    expect(payloadOf(result).stdout).toBe(expected);
  });

  // Reason: `argv` 는 실제로 실행된 배열이라는 것이 응답 계약이고, `repo_show` 는 rev 를
  // oid 로 먼저 푼 뒤 그 oid 로 돈다. 보고만 `<rev>:<path>` 로 되돌리면 받는 쪽이 붙여
  // 넣는 명령이 움직이는 ref 를 다시 가리키는데 응답 어디에도 그 사실이 안 남는다.
  it("reports the resolved oid in argv, not the rev it was called with", async () => {
    const payload = payloadOf(
      await client.callTool({
        name: "repo_show",
        arguments: { rev: "HEAD", path: "AGENTS.md" },
      }),
    );
    expect(payload.argv).toEqual(["show", `${headOid}:AGENTS.md`]);
  });

  // Reason: 라운드 1 의 blocking — `rev` 가 자유 문자열인 채 git 의 옵션 파싱 구간에
  // 놓여, `-O` 는 pager 로 셸을 돌리고 `--output=` 은 파일을 썼다. 응답이 정상
  // JSON 이라 호출자 쪽에서는 안 보였다. 그래서 "에러가 났다" 와 "파일이 안 생겼다"
  // 를 같이 문다.
  it("refuses a rev that smuggles git options, and writes no file", async () => {
    const hostileRevs = [
      `-Osh -c "touch ${probeFile}"`,
      `--output=${probeFile}`,
    ];
    for (const rev of hostileRevs) {
      const calls: { name: string; arguments: Record<string, unknown> }[] = [
        {
          name: "repo_grep",
          arguments: {
            pattern: "memory",
            rev,
            pathspec: ["AGENTS.md"],
            mode: "files",
            regex: "fixed",
          },
        },
        { name: "repo_show", arguments: { rev, path: "AGENTS.md" } },
        { name: "repo_ls", arguments: { rev, pathspec: ["AGENTS.md"] } },
      ];
      for (const call of calls) {
        const result = await client.callTool(call);
        expect(result.isError, `${call.name} / ${rev}`).toBe(true);
      }
    }
    expect(existsSync(probeFile)).toBe(false);
  });

  // Reason: 셸이 glob 을 삼켜 명령이 안 돌았는데 exit 0 이던 유형을 죽였는지 본다.
  // "에러가 안 났다" 로는 증명이 안 된다 — 셸 확장이 끼면 `*.md` 는 루트의 .md 로만
  // 줄어들어 하위 경로가 애초에 나올 수 없다. 그래서 하위 디렉토리 경로가 결과에
  // 있는지를 문다.
  it("hands a glob pathspec to git unexpanded", async () => {
    const result = await client.callTool({
      name: "repo_ls",
      arguments: { rev: "HEAD", pathspec: ["*.md"] },
    });
    const lines = payloadOf(result).stdout.split("\n");
    expect(lines).toContain("AGENTS.md");
    expect(lines).toContain("memory/workflow/delivery/memory.md");
  });

  // Reason: `rev` 가 선택이 되는 순간 이 서버는 작업 트리를 조용히 읽는 도구로
  // 되돌아간다. 거부가 스키마 단계라는 것까지 문다 — 핸들러가 돌았다면 메시지가
  // git 쪽 문구다.
  it("rejects a call that omits rev before the handler runs", async () => {
    const result = await client.callTool({
      name: "repo_grep",
      arguments: {
        pattern: "memory",
        pathspec: ["AGENTS.md"],
        mode: "files",
        regex: "fixed",
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Input validation error");
    expect(textOf(result)).toContain("rev");
  });

  // Reason: 움직이는 ref 로 읽은 결과는 사본이 밀린 만큼 밀린다. 막지 않는 설계이므로
  // 남는 장치가 이 경고뿐이고, 고정 oid 에 붙으면 경고가 배경 소음이 된다.
  it("warns on a moving ref and stays quiet on a fixed oid", async () => {
    const warningsFor = async (rev: string) => {
      const result = await client.callTool({
        name: "repo_grep",
        arguments: {
          pattern: "memory",
          rev,
          pathspec: ["AGENTS.md"],
          mode: "files",
          regex: "fixed",
        },
      });
      return payloadOf(result).warnings.join("\n");
    };
    expect(await warningsFor("HEAD")).toMatch(/움직이는 ref/);
    expect(await warningsFor(headOid)).not.toMatch(/움직이는 ref/);
    // 축약 oid 는 git 이 커밋으로 풀지만 판정식이 7자리부터라 「고정」으로 안 센다.
    // 그 아래까지 고정으로 세면 hex 로만 된 짧은 ref 이름(`beef` · `dead`)이 경고를 잃는다.
    // 접두사가 겹치면 rev 가 안 풀려 아래 두 줄이 같이 죽으므로 HEAD 를 그대로 자르지 않고
    // git 이 유일하다고 판정한 것을 받는다 — 사유는 `resolvableShortOid` 에 적었다.
    const shortOid = resolvableShortOid("HEAD");
    expect(gitOutput(["cat-file", "-t", shortOid]).trim()).toBe("commit");
    expect(await warningsFor(shortOid)).toMatch(/움직이는 ref/);
  });

  // Reason: 위 단언이 죽는 조건은 6자 접두사가 tree · blob 과 겹치는 것이고, 그것은 HEAD 가
  // 무엇이냐에 달려 있어 평소 실행에서는 한 번도 안 밟힌다 (#2390 은 CI 가 그 HEAD 를 골라서야
  // 드러났다). 그 조건을 만드는 오브젝트 쌍이 이 저장소 히스토리에 영구히 있으므로 — 커밋
  // 8b81cf52… 와 blob 8b81cf4d… 가 앞 6자를 공유한다 — 거기서 시작시켜 고르기를 직접 문다.
  // 앞 단언이 없으면 그 쌍이 사라져도 뒤가 조용히 공회전한다.
  it("skips a short oid whose prefix collides with a non-commit object", () => {
    const collidingOid = "8b81cf52cabc68d44e5c2bfee4b27f36b9091079";
    const collidingPrefix = collidingOid.slice(0, 6);
    expect(
      gitOutput(["rev-parse", `--disambiguate=${collidingPrefix}`])
        .trim()
        .split("\n").length,
    ).toBeGreaterThan(1);
    const shortOid = resolvableShortOid(collidingOid);
    expect(shortOid).not.toBe(collidingPrefix);
    // 길이도 같이 문다 — 겹침을 자릿수를 늘려 피하면 판정식이 「고정」으로 세어
    // 위 테스트가 재려던 것이 사라진다.
    expect(shortOid).toHaveLength(6);
    expect(gitOutput(["cat-file", "-t", shortOid]).trim()).toBe("commit");
  });

  // Reason: 작업 트리 읽기를 막으면 노드는 우회를 발명한다. 정식 값으로 받되 읽었다는
  // 사실이 응답에 남는지를 문다 — 막는 대신 보이게 하는 쪽이 이 설계다.
  it("reads the work tree on rev WORKTREE and says so", async () => {
    const calls: { name: string; arguments: Record<string, unknown> }[] = [
      {
        name: "repo_grep",
        arguments: {
          pattern: "memory",
          rev: "WORKTREE",
          pathspec: ["AGENTS.md"],
          mode: "files",
          regex: "fixed",
        },
      },
      {
        name: "repo_ls",
        arguments: { rev: "WORKTREE", pathspec: ["AGENTS.md"] },
      },
      { name: "repo_show", arguments: { rev: "WORKTREE", path: "AGENTS.md" } },
    ];
    for (const call of calls) {
      const payload = payloadOf(await client.callTool(call));
      expect(payload.warnings.join("\n"), call.name).toMatch(/작업 트리/);
      // rev 토큰이 실제로 빠졌다 — 붙어 있으면 git 이 커밋을 읽는다.
      expect(payload.argv, call.name).not.toContain("WORKTREE");
    }
    const shown = payloadOf(
      await client.callTool({
        name: "repo_show",
        arguments: { rev: "WORKTREE", path: "AGENTS.md" },
      }),
    );
    expect(shown.stdout).toBe(
      readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8"),
    );
  });

  // Reason: `rev: "WORKTREE"` 는 git 을 안 부르고 파일을 직접 읽는 유일한 경로다. 문자열
  // 대조만 하던 라운드 2 head 에서는 심링크와 `.git/**` 이 그대로 통과해 저장소 정찰
  // 도구가 임의 파일 리더였다. `..` 와 절대경로는 그때도 막혔고 지금도 막힌다 — 세
  // 형태를 같이 무는 이유는 봉쇄 블록이 통째로 사라지는 회귀를 잡기 위해서다.
  it("keeps rev WORKTREE inside the work tree — symlink, .git, and ..", async () => {
    // 가드가 없었다면 실제로 읽혔을 파일이라는 것을 먼저 확인한다. 안 그러면 심링크가
    // 깨져 있어도 (읽기 실패로) 이 단언이 green 이라 아무것도 증명하지 않는다.
    expect(readFileSync(join(repoRoot, symlinkProbe), "utf8")).toBe(
      outsideMarker,
    );
    for (const path of [symlinkProbe, ".git/config", "../AGENTS.md"]) {
      const result = await client.callTool({
        name: "repo_show",
        arguments: { rev: "WORKTREE", path },
      });
      expect(result.isError, path).toBe(true);
      expect(textOf(result), path).not.toContain(outsideMarker);
    }
    // 봉쇄가 작업 트리 안까지 잠그면 도구가 죽는다 — 정상 경로가 그대로 읽히는지 같이 문다.
    const inside = payloadOf(
      await client.callTool({
        name: "repo_show",
        arguments: { rev: "WORKTREE", path: "AGENTS.md" },
      }),
    );
    expect(inside.stdout).toBe(
      readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8"),
    );
  });

  // Reason: `rev: "WORKTREE"` 의 목록은 커밋 안 된 파일이 들어오는 쪽이 그 값의 뜻이다.
  // `--others --exclude-standard` 가 빠지면 같은 이름의 tool 이 조용히 커밋된 것만 내고,
  // 호출자는 「그 파일이 없다」로 읽는다.
  it("lists uncommitted files on rev WORKTREE and committed ones on a rev", async () => {
    const worktree = payloadOf(
      await client.callTool({
        name: "repo_ls",
        arguments: { rev: "WORKTREE", pathspec: [untrackedProbe] },
      }),
    );
    expect(worktree.argv).toEqual([
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      untrackedProbe,
    ]);
    expect(worktree.stdout.split("\n")).toContain(untrackedProbe);
    const committed = payloadOf(
      await client.callTool({
        name: "repo_ls",
        arguments: { rev: "HEAD", pathspec: [untrackedProbe] },
      }),
    );
    expect(committed.stdout).toBe("");
  });

  // Reason: 아무것도 안 무는 glob 은 셸(zsh nomatch)에서 명령 자체를 죽여 「0건」과
  // 구분이 안 됐다. 여기서는 0 이 에러가 아니라 결과로 돌아오고, 그 0 이 오타인지
  // 실제인지 확인하라는 경고가 붙어야 한다.
  it("answers zero with a warning instead of an error", async () => {
    const payload = payloadOf(
      await client.callTool({
        name: "repo_ls",
        arguments: { rev: "HEAD", pathspec: ["*.no-such-extension"] },
      }),
    );
    expect(payload.stdout).toBe("");
    expect(payload.warnings.join("\n")).toMatch(/0건/);
    // `git grep` 만 0건을 rc 1 로 낸다 — 위 `repo_ls` 의 `git diff-tree` 는 rc 0 이라 그
    // 분기를 안 탄다. rc 1 을 에러로 올리면 「없다」와 「호출이 실패했다」가 다시 섞인다.
    const grepped = payloadOf(
      await client.callTool({
        name: "repo_grep",
        arguments: {
          pattern: "ZZ_repo_recon_no_such_string_ZZ",
          rev: "HEAD",
          pathspec: ["AGENTS.md"],
          mode: "files",
          regex: "fixed",
        },
      }),
    );
    expect(grepped.stdout).toBe("");
    expect(grepped.warnings.join("\n")).toMatch(/0건/);
  });

  // Reason: 상한을 없앤 대신 큰 출력에 경고를 얹는다. 자르는 쪽으로 되돌리면 그
  // 절단값이 다시 전수처럼 읽힌다.
  it("warns when the output is large instead of truncating it", async () => {
    const payload = payloadOf(
      await client.callTool({
        name: "repo_show",
        arguments: { rev: "HEAD", path: "pnpm-lock.yaml" },
      }),
    );
    expect(payload.warnings.join("\n")).toMatch(/줄이다/);
    expect(payload.stdout).toBe(
      gitOutput(["show", `${headOid}:pnpm-lock.yaml`]),
    );
    // 문턱을 낮추면 작은 출력에도 붙어 경고가 배경 소음이 된다. 줄 수를 저장소 파일에 안
    // 기대게 `-n 5` 로 만든 출력을 쓴다 — 특정 파일의 줄 수는 다음 커밋이 바꾼다.
    const small = payloadOf(
      await client.callTool({
        name: "repo_git",
        arguments: { argv: ["log", "--oneline", "-n", "5"] },
      }),
    );
    // 한 줄짜리 출력이면 문턱을 1 로 낮춰도 안 걸려 아래 단언이 항진명제가 된다.
    expect(small.stdout.trimEnd()).toContain("\n");
    expect(small.warnings.join("\n")).not.toMatch(/줄이다/);
  });

  // Reason: 탈출구가 없으면 노드가 우회를 발명한다. 타입이 안 잡혔다는 사실이
  // 응답에 남는지를 문다.
  it("runs arbitrary argv through repo_git and marks it untyped", async () => {
    const payload = payloadOf(
      await client.callTool({
        name: "repo_git",
        arguments: { argv: ["rev-parse", "--verify", "HEAD"] },
      }),
    );
    expect(payload.stdout.trim()).toBe(headOid);
    expect(payload.warnings.join("\n")).toMatch(/타입 안 잡힌 호출/);
    expect(payload.warnings.join("\n")).not.toMatch(/Hard block/);
  });

  // Reason: 오늘 git-policy 「Hard block」을 호출 시점에 알려 주는 장치가 없다. 막지는
  // 않으므로 이 경고가 유일한 신호다. 확인용 호출은 아무것도 안 바꾸는 `status` 이고
  // hard block 어휘(`commit.gpgsign=false`)만 실어 보낸다.
  it("names git-policy Hard block on a call that hits it, and still runs it", async () => {
    const payload = payloadOf(
      await client.callTool({
        name: "repo_git",
        arguments: {
          argv: ["-c", "commit.gpgsign=false", "status", "--porcelain"],
        },
      }),
    );
    expect(payload.warnings.join("\n")).toMatch(
      /memory\/workflow\/git-policy\/memory\.md/,
    );
    expect(payload.warnings.join("\n")).toMatch(/실행은 한다/);
    // `reset --hard` + upstream target 은 별도 분기라 위 호출이 안 덮는다. 확인용 호출은
    // 아무것도 안 바꾸는 `git log` 이고 그 표기는 `--` 뒤 pathspec 으로 싣는다 — 진짜로
    // 돌리면 이 사본이 날아간다. 판정이 문자열 대조라 이렇게 실어도 걸리고, 그 성질은
    // `scripts/mcp/repo-recon/server.mjs` 의 `hitsHardBlock` 주석이 적는다.
    const upstream = payloadOf(
      await client.callTool({
        name: "repo_git",
        arguments: {
          argv: [
            "log",
            "--oneline",
            "-n",
            "1",
            "--",
            "reset",
            "--hard",
            "origin/main",
          ],
        },
      }),
    );
    expect(upstream.warnings.join("\n")).toMatch(/Hard block/);
  });
});
