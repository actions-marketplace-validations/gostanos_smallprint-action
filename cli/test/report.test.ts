/**
 * The level-four reporter is a separate program in a separate language, and it
 * must produce exactly the hashes and kind labels the node CLI produces, or the
 * record would show a change the moment someone moved from level three to four.
 * This runs the shipped Python file with the system interpreter against a
 * fixture home and compares it with the node code path.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discover, toUpload } from "../src/discover";
import { pathHash, readInstructionFiles, toFileUpload, type FileUpload } from "../src/instructions";

const PY = "/usr/bin/python3";
const HELPER = fileURLToPath(new URL("../report/smallprint-report.py", import.meta.url));

describe("level-four reporter parity", () => {
  it.skipIf(!existsSync(PY))("hashes the same files, kinds, sections and skill trees as the node CLI", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-l4-"));
    mkdirSync(join(home, ".claude", "notes"), { recursive: true });
    mkdirSync(join(home, ".openclaw", "workspace"), { recursive: true });
    mkdirSync(join(home, ".openclaw", "skills", "pdf-tools", "scripts"), { recursive: true });
    mkdirSync(join(home, ".claude", "agents"), { recursive: true });
    writeFileSync(join(home, ".claude", "CLAUDE.md"), "Be careful. See @~/.claude/notes/a.md\n");
    writeFileSync(join(home, ".claude", "notes", "a.md"), "imported\n");
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash(git status:*)"] }, hooks: { PreToolUse: [] } }, null, 2));
    writeFileSync(join(home, ".claude", "agents", "reviewer.md"), "review things\n");
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "ghp_x" } } }, projects: { "/Users/x/p": { mcpServers: { local: { command: "node", args: ["x.js"] } }, history: [1] } }, numStartups: 3 }));
    writeFileSync(join(home, ".openclaw", "workspace", "TOOLS.md"), "tools: none\n");
    writeFileSync(join(home, ".openclaw", "workspace", "SOUL.md"), "kind\n");
    writeFileSync(join(home, ".openclaw", "skills", "pdf-tools", "SKILL.md"), "---\nname: pdf-tools\n---\nExtract\n");
    writeFileSync(join(home, ".openclaw", "skills", "pdf-tools", "scripts", "extract.sh"), "#!/bin/sh\necho hi\n");
    // since 29 Sep 2026 (tools audit fixes 2, 5 and 10): a bare @import, VS Code and Roo configs, and an installed plugin
    writeFileSync(join(home, ".claude", "CLAUDE.md"), "Be careful. See @~/.claude/notes/a.md and @bare.md\n");
    writeFileSync(join(home, ".claude", "bare.md"), "bare import\n");
    const code = join(home, "Library", "Application Support", "Code", "User");
    mkdirSync(join(code, "globalStorage", "rooveterinaryinc.roo-cline", "settings"), { recursive: true });
    writeFileSync(join(code, "mcp.json"), JSON.stringify({ servers: { gh: { url: "https://api.githubcopilot.com/mcp/" } } }));
    writeFileSync(join(code, "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json"), JSON.stringify({ mcpServers: { t: { command: "uvx", args: ["mcp-server-time"] } } }));
    const plugin = join(home, ".claude", "plugins", "cache", "m", "p", "1.0.0");
    mkdirSync(join(plugin, "skills", "s1"), { recursive: true });
    mkdirSync(join(plugin, "hooks"), { recursive: true });
    mkdirSync(join(plugin, "commands"), { recursive: true });
    writeFileSync(join(plugin, ".mcp.json"), JSON.stringify({ srv: { command: "npx", args: ["-y", "smallprint-mcp@0.2.3"] } }));
    writeFileSync(join(plugin, "hooks", "hooks.json"), JSON.stringify({ hooks: {} }));
    writeFileSync(join(plugin, "commands", "go.md"), "go\n");
    writeFileSync(join(plugin, "skills", "s1", "SKILL.md"), "---\nname: s1\n---\nDo it\n");
    writeFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "p@m": [{ scope: "user", installPath: plugin }] } }));
    // since 3 Oct 2026 (decision 363): a Codex plugin and a GitHub Copilot CLI plugin, each with servers, an agent and a skill
    const codex = join(home, ".codex", "plugins", "cache", "openai-curated", "linear", "5.0.1");
    mkdirSync(join(codex, "agents"), { recursive: true });
    mkdirSync(join(codex, "skills", "cx"), { recursive: true });
    writeFileSync(join(codex, ".mcp.json"), JSON.stringify({ mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } } }));
    writeFileSync(join(codex, "agents", "planner.md"), "plan\n");
    writeFileSync(join(codex, "skills", "cx", "SKILL.md"), "---\nname: cx\n---\nCodex skill\n");
    // since 3 Oct 2026 (decision 370): a mod synced from claude.ai, and a plugin saved under ~/.claude/skills/
    const synced = join(home, ".claude", "plugins", "synced", "spinner-count");
    mkdirSync(join(synced, ".claude-plugin"), { recursive: true });
    mkdirSync(join(synced, "hooks"), { recursive: true });
    mkdirSync(join(synced, "skills", "sy"), { recursive: true });
    writeFileSync(join(synced, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "spinner-count" }));
    writeFileSync(join(synced, "hooks", "hooks.json"), JSON.stringify({ modules: ["./register.js"] }));
    writeFileSync(join(synced, "hooks", "register.js"), "export function register(on) { on('tool.describe', async ($, e, next) => next(e)) }\n");
    writeFileSync(join(synced, "skills", "sy", "SKILL.md"), "---\nname: sy\n---\nSynced skill\n");
    const saved = join(home, ".claude", "skills", "deploy-helper");
    mkdirSync(join(saved, ".claude-plugin"), { recursive: true });
    mkdirSync(join(saved, "commands"), { recursive: true });
    writeFileSync(join(saved, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "deploy-helper" }));
    writeFileSync(join(saved, ".mcp.json"), JSON.stringify({ deploy: { command: "npx", args: ["-y", "deploy-mcp@1.0.0"] } }));
    writeFileSync(join(saved, "commands", "ship.md"), "ship it\n");
    const cop = join(home, ".copilot", "installed-plugins", "awesome-copilot", "kanban");
    mkdirSync(join(cop, "agents"), { recursive: true });
    mkdirSync(join(cop, "skills", "kb"), { recursive: true });
    writeFileSync(join(cop, "mcp.json"), JSON.stringify({ mcpServers: { kb: { type: "stdio", command: "npx", args: ["-y", "kanban-mcp@1.0.0"] } } }));
    writeFileSync(join(cop, "agents", "triage.agent.md"), "triage\n");
    writeFileSync(join(cop, "skills", "kb", "SKILL.md"), "---\nname: kb\n---\nCopilot skill\n");

    const py = JSON.parse(execFileSync(PY, [HELPER, "--user", "nobody", "--label", "t", "--json", "--home", home], { encoding: "utf8" })) as { files: { path: string; kind: string; sha256: string; sections?: Record<string, string> }[]; items: Record<string, unknown>[] };
    const nodeFiles = readInstructionFiles(home, home).map((f) => ({ path: f.path, kind: f.kind, sha256: f.sha256, ...(f.sections ? { sections: f.sections } : {}) }));
    const nodeItems = toUpload(discover({ home, cwd: home }).items).filter((i) => i.kind === "agent-skill");
    const byPath = (xs: { path: string }[]) => Object.fromEntries(xs.map((x) => [x.path, x]));
    expect(Object.keys(byPath(py.files)).sort()).toEqual(Object.keys(byPath(nodeFiles)).sort());
    expect(byPath(py.files)).toEqual(byPath(nodeFiles));
    expect(py.items).toEqual(nodeItems);
    expect(py.files.map((f) => f.kind)).toContain("Claude Code CLAUDE.md import, home");
    expect(py.files.map((f) => f.kind)).toContain("Codex plugin MCP servers, home");
    expect(py.files.map((f) => f.kind)).toContain("Claude Code mod code, home");
    expect(py.files.map((f) => f.kind)).toContain("Copilot plugin agent definition, home");
    expect(py.files.map((f) => f.path)).toEqual(expect.arrayContaining([join(home, ".claude", "bare.md"), join(plugin, ".mcp.json"), join(plugin, "hooks", "hooks.json"), join(plugin, "commands", "go.md"), join(code, "mcp.json")]));
    expect(py.files.find((f) => f.path === join(plugin, ".mcp.json"))!.sections).toHaveProperty("srv");
    expect(py.items.map((i) => i.name)).toContain("s1");
    expect(py.files.find((f) => f.kind === "Claude Code MCP servers, home")!.sections).toHaveProperty("github");
    expect(JSON.stringify(py)).not.toContain("ghp_x");
    // an imported file is hashed whole, never per key (both sides)
    const imported = py.files.find((f) => f.kind === "Claude Code CLAUDE.md import, home")!;
    expect(imported.sections).toBeUndefined();
  });

  it.skipIf(!existsSync(PY))("sends the same keyed hashes as sync from the same salt, and the unkeyed ones only for a label the installer found reporting unkeyed, once (security audit item 36; tools audit of 4 Oct 2026, fix 3)", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-l4-salt-"));
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "CLAUDE.md"), "Be careful.\n");
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "ghp_x" } } }, projects: { "/Users/x/p": { mcpServers: { local: { command: "node", args: ["x.js"] } } } } }));
    const key = "ab".repeat(32);
    const saltFile = join(home, "salt");
    writeFileSync(saltFile, key + "\n");
    const keyedFile = join(home, "keyed-labels");
    const migrateFile = join(home, "migrate-labels");
    const py = (extra: string[] = []) => JSON.parse(execFileSync(PY, [HELPER, "--user", "nobody", "--label", "t", "--json", "--home", home, "--salt-file", saltFile, "--keyed-file", keyedFile, "--migrate-file", migrateFile, ...extra], { encoding: "utf8" })) as { upload: FileUpload[] };
    const node = (migrate: boolean) => toFileUpload(readInstructionFiles(home, home, [], key).filter((f) => f.scope === "home"), home, key, migrate).files;
    // a machine with nothing to move: no unkeyed hash of any path leaves it, on the first report or any other
    expect(py().upload).toEqual(node(false));
    expect(JSON.stringify(py().upload)).not.toContain("former");
    // the installer found an earlier reporter without a salt and wrote the label down: the earlier hashes go once
    writeFileSync(migrateFile, JSON.stringify(["t"]));
    expect(py().upload).toEqual(node(true));
    expect(py().upload.every((f) => f.formerPathHash === pathHash(join(home, f.kind.includes("MCP") ? ".claude.json" : ".claude/CLAUDE.md")))).toBe(true);
    writeFileSync(keyedFile, JSON.stringify(["t"]));
    expect(py().upload).toEqual(node(false));
    expect(JSON.stringify(node(false))).not.toContain(pathHash(join(home, ".claude.json")));
  });

  it.skipIf(!existsSync(PY))("follows an @import only to a file inside the home directory, and never a json import's sections", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-l4-imp-"));
    mkdirSync(join(home, ".claude"), { recursive: true });
    const outside = mkdtempSync(join(tmpdir(), "sp-l4-outside-"));
    writeFileSync(join(outside, "secret.json"), JSON.stringify({ port: 22, admin: true }));
    writeFileSync(join(home, ".claude", "inside.json"), JSON.stringify({ port: 22, admin: true }));
    // the import line is user-written text: it may name any path, and root must not hash what the user could not read
    writeFileSync(join(home, ".claude", "CLAUDE.md"), `See @${join(outside, "secret.json")} and @/etc/hosts and @~/.claude/inside.json\n`);
    const py = JSON.parse(execFileSync(PY, [HELPER, "--user", "nobody", "--label", "t", "--json", "--home", home], { encoding: "utf8" })) as { files: { path: string; kind: string; sections?: Record<string, string> }[] };
    const paths = py.files.map((f) => f.path);
    expect(paths).toContain(join(home, ".claude", "inside.json"));
    expect(paths).not.toContain(join(outside, "secret.json"));
    expect(paths).not.toContain("/etc/hosts");
    expect(py.files.find((f) => f.path.endsWith("inside.json"))!.sections).toBeUndefined();
  });
});
