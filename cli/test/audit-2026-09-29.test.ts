/**
 * The tools audit of 29 Sep 2026: plugins seen and hashed (fix 2), bare @imports followed (fix 5), VS Code, Cline and
 * Roo configs in the record and the lock (fix 10), hosts in the lock (fix 11), and the docker identity rule that took a
 * path for an image (security audit item 35). Each case was written to fail on the code before the fix.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discover, inferPackage, rooHomeSettings, toUpload } from "../src/discover";
import { claudeImports, mcpServersDigest, readInstructionFiles, vscodeUserMcp } from "../src/instructions";
import { buildLock, diffIsEmpty, diffLock, formatDiff } from "../src/lock";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function pluginHome(pkg = "smallprint-mcp@0.2.3") {
  const home = mkdtempSync(join(tmpdir(), "sp-plug-"));
  const root = join(home, ".claude", "plugins", "cache", "smallprint", "smallprint", "0.1.2");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "skills", "check"), { recursive: true });
  mkdirSync(join(root, "hooks"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "smallprint", version: "0.1.2" }));
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ smallprint: { command: "npx", args: ["-y", pkg] } }));
  writeFileSync(join(root, "skills", "check", "SKILL.md"), "---\nname: check\n---\nRun the check.\n");
  writeFileSync(join(root, "hooks", "hooks.json"), JSON.stringify({ hooks: { SessionStart: [] } }));
  // version 2 of the list: an array of records per plugin; an install path outside the home is never read
  writeFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "smallprint@smallprint": [{ scope: "user", installPath: root, version: "0.1.2" }], "stray@x": [{ scope: "user", installPath: tmpdir() }] } }));
  return { home, root };
}

describe("Claude Code plugins (tools audit fix 2)", () => {
  it("a plugin's bare .mcp.json is hashed by its servers, not as an empty object", () => {
    const a = mcpServersDigest(JSON.stringify({ smallprint: { command: "npx", args: ["-y", "smallprint-mcp@0.2.3"] } }))!;
    const b = mcpServersDigest(JSON.stringify({ smallprint: { command: "npx", args: ["-y", "totally-different-evil-package@6.6.6"] } }))!;
    expect(a.sha256).not.toBe(sha("{}"));
    expect(a.sha256).not.toBe(b.sha256);
    expect(Object.keys(a.sections)).toEqual(["smallprint"]);
    // a settings file with other top-level values is not a server map
    expect(mcpServersDigest(JSON.stringify({ theme: "dark", smallprint: { command: "x" } }))!.sha256).toBe(sha("{}"));
  });

  it("a project lock in a plugin folder fails when the pinned server is swapped", () => {
    const cwd = mkdtempSync(join(tmpdir(), "sp-plugdir-"));
    const home = mkdtempSync(join(tmpdir(), "sp-empty-"));
    writeFileSync(join(cwd, ".mcp.json"), JSON.stringify({ smallprint: { command: "npx", args: ["-y", "smallprint-mcp@0.2.3"] } }));
    const lockOf = () => buildLock(toUpload(discover({ home, cwd }).items), readInstructionFiles(home, cwd), { scope: "project", cwd, home });
    const before = lockOf();
    expect(before.items.map((i) => `${i.name} ${i.canonicalName} ${i.version}`)).toEqual(["smallprint npm:smallprint-mcp 0.2.3"]);
    writeFileSync(join(cwd, ".mcp.json"), JSON.stringify({ smallprint: { command: "npx", args: ["-y", "totally-different-evil-package@6.6.6"] } }));
    const d = diffLock(before, lockOf());
    expect(diffIsEmpty(d)).toBe(false);
    expect(d.filesChanged.map((f) => f.path)).toEqual([".mcp.json"]);
  });

  it("check finds an installed plugin's servers and skills, and the record hashes its .mcp.json and hooks", () => {
    const { home, root } = pluginHome();
    const cwd = mkdtempSync(join(tmpdir(), "sp-cwd-"));
    const found = discover({ home, cwd });
    const names = found.items.map((i) => `${i.kind} ${i.name}`);
    expect(names).toContain("mcp plugin:smallprint:smallprint");
    expect(names).toContain("agent-skill check");
    expect(found.items.find((i) => i.name === "plugin:smallprint:smallprint")).toMatchObject({ canonicalName: "npm:smallprint-mcp", version: "0.2.3" });
    const files = readInstructionFiles(home, cwd);
    expect(files.find((f) => f.path === join(root, ".mcp.json"))?.kind).toBe("Claude Code plugin MCP servers, home");
    expect(files.find((f) => f.path === join(root, "hooks", "hooks.json"))?.kind).toBe("Claude Code plugin hooks, home");
    // nothing from the stray entry whose install path is outside the home
    expect(files.every((f) => f.path.startsWith(home))).toBe(true);
  });
});

describe("@imports in CLAUDE.md (tools audit fix 5)", () => {
  it("follows a bare relative import when it names a file, and not a mention of a person", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-imp-"));
    mkdirSync(join(home, ".claude", "docs"), { recursive: true });
    writeFileSync(join(home, ".claude", "extra.md"), "extra\n");
    writeFileSync(join(home, ".claude", "docs", "git-instructions.md"), "git\n");
    writeFileSync(join(home, ".claude", "extra2.md"), "extra2\n");
    const text = "See @extra.md and @docs/git-instructions.md. Ask @nick, or mail nick@example.com. Also @./extra2.md\n";
    expect(claudeImports(text, join(home, ".claude"), home)).toEqual([join(home, ".claude", "extra.md"), join(home, ".claude", "docs", "git-instructions.md"), join(home, ".claude", "extra2.md")]);
    writeFileSync(join(home, ".claude", "CLAUDE.md"), text);
    const kinds = readInstructionFiles(home, mkdtempSync(join(tmpdir(), "sp-cwd-"))).map((f) => f.path);
    expect(kinds).toContain(join(home, ".claude", "extra.md"));
    expect(kinds).toContain(join(home, ".claude", "docs", "git-instructions.md"));
  });
});

describe("VS Code, Cline and Roo in the record and the lock (tools audit fix 10)", () => {
  it.skipIf(process.platform === "win32")("hashes .vscode/mcp.json and the user mcp.json by their servers, and reads Roo's home settings", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-vs-"));
    const cwd = mkdtempSync(join(tmpdir(), "sp-vscwd-"));
    mkdirSync(join(cwd, ".vscode"), { recursive: true });
    mkdirSync(join(home, "Library", "Application Support", "Code", "User"), { recursive: true });
    const proj = (extra: string[]) => JSON.stringify({ servers: { fs: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@2026.7.10", ...extra] } }, inputs: [] });
    writeFileSync(join(cwd, ".vscode", "mcp.json"), proj([]));
    writeFileSync(vscodeUserMcp(home), JSON.stringify({ servers: { gh: { url: "https://api.githubcopilot.com/mcp/" } } }));
    const roo = rooHomeSettings(home, false);
    mkdirSync(join(roo, ".."), { recursive: true });
    writeFileSync(roo, JSON.stringify({ mcpServers: { roo1: { command: "uvx", args: ["mcp-server-time"] } } }));
    const lockOf = () => buildLock(toUpload(discover({ home, cwd }).items), readInstructionFiles(home, cwd), { home, cwd });
    const before = lockOf();
    expect(before.files.map((f) => f.path)).toEqual(expect.arrayContaining([".vscode/mcp.json", "~/Library/Application Support/Code/User/mcp.json", "~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json"]));
    expect(before.items.map((i) => i.name)).toContain("roo1");
    writeFileSync(join(cwd, ".vscode", "mcp.json"), proj(["--evil-flag"]));
    const d = diffLock(before, lockOf());
    expect(d.filesChanged.map((f) => f.path)).toEqual([".vscode/mcp.json"]);
  });
});

describe("hosts in the lock (tools audit fix 11)", () => {
  it("keeps a hosted server's host and reports when it moves; an older lock without hosts claims no change", () => {
    const item = (remoteHost: string) => ({ kind: "mcp" as const, host: "claude-code" as const, name: "sentry", canonicalName: null, version: null, transport: "http", remoteHost });
    const a = buildLock([item("mcp.sentry.dev")], []);
    expect(a.items[0]).toMatchObject({ name: "sentry", remoteHost: "mcp.sentry.dev" });
    const moved = diffLock(a, buildLock([item("collector.example")], []));
    expect(formatDiff(moved).join("\n")).toContain("host mcp.sentry.dev -> collector.example");
    const old = { ...a, items: a.items.map(({ remoteHost: _r, ...rest }) => rest) };
    expect(diffIsEmpty(diffLock(old, a))).toBe(true);
  });
});

describe("docker identity (security audit item 35)", () => {
  it("never takes the value of --env-file, -v or --mount for the image", () => {
    expect(inferPackage("docker", ["run", "--env-file", "config/prod.env", "-i", "--rm", "mcp/github"]).canonicalName).toBe("oci:mcp/github");
    expect(inferPackage("docker", ["run", "-v", "data/x:/x", "--mount", "type=bind,src=a/b,dst=/c", "ghcr.io/acme/tool:1.0"])).toMatchObject({ canonicalName: "oci:ghcr.io/acme/tool", version: "1.0" });
    expect(inferPackage("docker", ["run", "--env-file", "config/prod.env"]).canonicalName).toBeNull();
  });
});

describe("keyed hashes (security audit item 36, tools audit fix 8)", () => {
  it("keys path hashes, project scopes and env value hashes with the machine's salt, and keeps the lock's digest unkeyed", async () => {
    const { keyedHash, pathHash, projectScope } = await import("../src/instructions");
    const { machineSalt } = await import("../src/salt");
    const { statSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "sp-salt-"));
    const file = join(dir, "smallprint", "salt");
    const key = machineSalt(true, file)!;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(machineSalt(false, file)).toBe(key);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const p = "/Users/nick/.claude/CLAUDE.md";
    expect(pathHash(p)).toBe(sha(p));
    expect(pathHash(p, key)).not.toBe(sha(p));
    expect(pathHash(p, key)).toBe(keyedHash(key, "path", p));
    expect(projectScope("/Users/nick/proj", key)).toMatch(/^project:[0-9a-f]{12}$/);
    expect(projectScope("/Users/nick/proj", key)).not.toBe(projectScope("/Users/nick/proj"));
    const cfg = JSON.stringify({ mcpServers: { gh: { command: "npx", env: { GITHUB_TOKEN: "ghp_guessable" } } }, projects: { "/Users/nick/p": { mcpServers: { l: { command: "node" } } } } });
    const plain = mcpServersDigest(cfg)!;
    const keyed = mcpServersDigest(cfg, key)!;
    expect(keyed.sha256).not.toBe(plain.sha256);
    expect(Object.keys(keyed.sections).some((k) => k.includes(sha("/Users/nick/p").slice(0, 12)))).toBe(false);
    // a guessed secret cannot be confirmed from the keyed digest: its plain SHA-256 is not what was hashed
    expect(keyed.sections.gh).not.toBe(plain.sections.gh);
  });
});
