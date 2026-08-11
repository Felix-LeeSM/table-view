import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Purpose: `scripts/mcp/repo-recon/server.mjs` 의 시그니처를 잠근다 — issue #2289.
//
// 이 서버의 값은 "돈다" 가 아니라 **틀린 형태를 표현할 수 없다** 는 쪽이라, 아래
// 단언은 전부 그 성질 하나씩을 문다: mode 가 세는 단위를 실제로 가르는가, 셸을
// 안 거치는가, `rev` 없이 부를 수 있는가, `perl` 이 PCRE 에 닿는가.
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
type Payload = { count: number; truncated: boolean; lines: string[] };

function textOf(result: ToolResult): string {
  const content = result.content as { text?: string }[] | undefined;
  return (content ?? []).map((part) => part.text ?? "").join("");
}

function payloadOf(result: ToolResult): Payload {
  expect(result.isError ?? false, textOf(result)).toBe(false);
  return JSON.parse(textOf(result)) as Payload;
}

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
  it("answers initialize and lists exactly the three recon tools", async () => {
    expect(client.getServerVersion()?.name).toBe("repo-recon");
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "repo_grep",
      "repo_ls",
      "repo_show",
    ]);
  });

  // Reason: 이 저장소가 반복해서 틀린 자리 — `grep -c` 가 낸 줄 수를 파일 수로
  // 옮겨 적는 것 — 를 시그니처가 가르는지 본다. 세 mode 가 같은 플래그로 붕괴하면
  // 여기가 red 다. 절대값 대신 엄격 부등식인 이유는 산문이 자라도 관계는 유지되기
  // 때문이고, files 만 1 로 못박는 것은 pathspec 이 파일 하나라서다.
  it("counts a different unit per mode over the same pattern", async () => {
    const counts: Record<string, number> = {};
    for (const mode of ["files", "lines", "matches"] as const) {
      const result = await client.callTool({
        name: "repo_grep",
        arguments: {
          pattern: "memory",
          rev: "HEAD",
          pathspec: ["AGENTS.md"],
          mode,
          regex: "fixed",
        },
      });
      counts[mode] = payloadOf(result).count;
    }
    expect(counts.files).toBe(1);
    expect(counts.lines).toBeGreaterThan(counts.files);
    expect(counts.matches).toBeGreaterThan(counts.lines);
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
    const { lines } = payloadOf(result);
    expect(lines).toContain("AGENTS.md");
    expect(lines).toContain("memory/workflow/delivery/memory.md");
    expect(lines.every((path) => path.endsWith(".md"))).toBe(true);
  });

  // Reason: 위 단언의 짝. 아무것도 안 무는 glob 은 셸(zsh nomatch)에서 명령 자체를
  // 죽여 「0건」과 구분이 안 됐다. 여기서는 0 이 결과로 돌아와야 한다.
  it("answers zero for a pathspec that matches nothing", async () => {
    const result = await client.callTool({
      name: "repo_ls",
      arguments: { rev: "HEAD", pathspec: ["*.no-such-extension"] },
    });
    expect(payloadOf(result).count).toBe(0);
  });

  // Reason: `rev` 가 선택이 되는 순간 이 서버는 작업 트리를 읽는 도구로 되돌아간다.
  // 거부가 스키마 단계라는 것까지 문다 — 핸들러가 돌았다면 메시지가 git 쪽 문구다.
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

  // Reason: `perl` 이 실제로 PCRE 엔진에 닿는지는 "죽지 않았다" 로 증명이 안 된다 —
  // `-E` 도 죽지 않고 0건을 낸다. 그래서 같은 패턴을 두 문법으로 돌려 갈리는 것을
  // 본다. `.mcp.json` 의 `"repo-recon": {` 에 대해 PCRE 는 `\s` 를 공백류로 읽어
  // 물고, ERE 는 리터럴 `s` 로 읽어 못 문다.
  it("routes regex kinds to the engine each one names", async () => {
    const counts: Record<string, number> = {};
    for (const regex of ["perl", "extended"] as const) {
      const result = await client.callTool({
        name: "repo_grep",
        arguments: {
          pattern: 'repo-recon"\\s*:\\s*\\{',
          rev: "HEAD",
          pathspec: [".mcp.json"],
          mode: "lines",
          regex,
        },
      });
      counts[regex] = payloadOf(result).count;
    }
    expect(counts.perl).toBe(1);
    expect(counts.extended).toBe(0);
  });

  // Reason: `rev` 를 받아 놓고 안 태우면 `repo_show` 는 작업 트리를 읽는 도구로
  // 되돌아가고, 내용이 대개 같아서 안 드러난다. 없는 커밋을 주면 실패해야 그 인자가
  // 실제로 git 에 간다는 뜻이다 — 읽기만 단언하면 무시해도 green 이다. 두 번째 커밋을
  // 안 쓰는 이유는 얕은 체크아웃에서 조상 rev 가 없을 수 있어서다.
  it("passes rev through to git instead of reading the work tree", async () => {
    const head = await client.callTool({
      name: "repo_show",
      arguments: { rev: "HEAD", path: "package.json" },
    });
    expect(payloadOf(head).lines.join("\n")).toContain("mcp:repo-recon");
    const missing = await client.callTool({
      name: "repo_show",
      arguments: { rev: "0".repeat(40), path: "package.json" },
    });
    expect(missing.isError).toBe(true);
  });
});
