import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

// `rev` 로 들어가는 git 옵션이 파일을 만드는지 보는 자리. 저장소 안에 두면 그 실패가
// 트리를 더럽히므로 임시 디렉토리에 둔다.
const probeDir = mkdtempSync(join(tmpdir(), "repo-recon-"));
const probeFile = join(probeDir, "MARKER");

let client: Client;

beforeAll(async () => {
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
  });
});
