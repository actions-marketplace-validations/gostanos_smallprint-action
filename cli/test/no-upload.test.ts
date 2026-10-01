/**
 * --no-upload means nothing leaves the machine, also with --live, and a private host is never sent (tools audit of 29 Sep
 * 2026, fix 6). The command runs as a child process with a preloaded hook that records every fetch it makes.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isPrivateHost, withoutPrivateHosts } from "../src/private-host";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const HOOK = fileURLToPath(new URL("./fixtures/netlog.mjs", import.meta.url));
// the child runs in a scratch folder, so tsx is named by its full path from this package
const TSX = pathToFileURL(join(fileURLToPath(new URL("..", import.meta.url)), "node_modules", "tsx", "dist", "loader.mjs")).href;

function run(args: string[]): { out: string; requests: string[] } {
  const home = mkdtempSync(join(tmpdir(), "sp-nu-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "sp-nu-cwd-"));
  const log = join(home, "net.log");
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { local: { url: "http://127.0.0.1:8765/mcp" }, corp: { url: "https://mcp.corp.internal/mcp" }, pub: { url: "https://mcp.example.com/mcp" } } }));
  let out = "";
  try {
    out = execFileSync(process.execPath, ["--import", TSX, "--import", HOOK, MAIN, ...args], { cwd, env: { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, ".config"), NETLOG: log }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    out = String((err as { stdout?: string }).stdout ?? "");
  }
  return { out, requests: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [] };
}

describe("--no-upload with --live (tools audit fix 6)", () => {
  it("makes no request at all", () => {
    const r = run(["check", "--live", "--no-upload"]);
    expect(r.requests).toEqual([]);
    expect(r.out).toContain("--no-upload: nothing sent");
  }, 30_000);

  it("without --no-upload, looks up only the public host on the record, never a private one", () => {
    const r = run(["check", "--live"]);
    const lookups = r.requests.filter((u) => u.startsWith("https://smallprint.dev/"));
    expect(lookups).toEqual(["https://smallprint.dev/api/remote?host=mcp.example.com"]);
    expect(r.requests.join("\n")).not.toContain("host=127.0.0.1");
    expect(r.requests.join("\n")).not.toContain("corp.internal%");
    expect(r.out).toContain("a private address");
  }, 30_000);
});

describe("private hosts", () => {
  it("knows loopback, private ranges, single labels and internal names, and leaves public names alone", () => {
    for (const h of ["127.0.0.1:8765", "localhost:3000", "10.1.2.3", "172.20.0.1", "192.168.1.5:80", "169.254.1.1", "100.64.0.1", "[::1]:8080", "[fd00::1]", "[fe80::1]", "nas", "mcp.corp.internal", "printer.local", "x.home.arpa"]) expect(isPrivateHost(h), h).toBe(true);
    for (const h of ["mcp.example.com", "8.8.8.8", "172.32.0.1", "api.githubcopilot.com:443", "[2606:4700::1]"]) expect(isPrivateHost(h), h).toBe(false);
    const items = withoutPrivateHosts([{ kind: "mcp", host: "claude-code", name: "a", canonicalName: null, version: null, transport: "http", remoteHost: "127.0.0.1:8765" }, { kind: "mcp", host: "claude-code", name: "b", canonicalName: null, version: null, transport: "http", remoteHost: "mcp.example.com" }]);
    expect(items.map((i) => i.remoteHost)).toEqual([null, "mcp.example.com"]);
  });
});
