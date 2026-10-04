/** Decision 363: Codex plugins installed under ~/.codex/plugins/cache are read like Claude Code plugins. */
import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discover } from "../src/discover";
import { codexPlugins, copilotPlugins } from "../src/plugins";

describe("Codex plugins", () => {
  it("reads the newest version of each installed plugin: its servers under the codex host, and its skills", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-codex-"));
    const cache = join(home, ".codex", "plugins", "cache", "openai-curated");
    const old = join(cache, "linear", "4.0.0");
    const cur = join(cache, "linear", "5.0.1");
    for (const d of [old, cur]) mkdirSync(join(d, ".codex-plugin"), { recursive: true });
    writeFileSync(join(old, ".mcp.json"), JSON.stringify({ mcpServers: { linear: { type: "http", url: "https://old.example/mcp" } } }));
    writeFileSync(join(cur, ".mcp.json"), JSON.stringify({ mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } } }));
    mkdirSync(join(cur, "skills", "triage"), { recursive: true });
    writeFileSync(join(cur, "skills", "triage", "SKILL.md"), "---\nname: triage\n---\nTriage issues.\n");
    utimesSync(old, new Date("2026-01-01"), new Date("2026-01-01"));
    // a symbolic link in the cache is never followed
    const elsewhere = mkdtempSync(join(tmpdir(), "sp-elsewhere-"));
    symlinkSync(elsewhere, join(cache, "linked"));
    expect(codexPlugins(home).map((p) => p.root)).toEqual([cur]);
    const found = discover({ home, cwd: mkdtempSync(join(tmpdir(), "sp-cwd-")) });
    const server = found.items.find((i) => i.kind === "mcp" && i.host === "codex");
    expect(server).toMatchObject({ name: "plugin:linear:linear", host: "codex" });
    expect(JSON.stringify(server)).toContain("mcp.linear.app");
    expect(JSON.stringify(found.items)).not.toContain("old.example");
    expect(found.items.some((i) => i.kind === "agent-skill" && i.host === "codex")).toBe(true);
  });

  it("finds nothing when Codex has no plugin cache", () => {
    expect(codexPlugins(mkdtempSync(join(tmpdir(), "sp-none-")))).toEqual([]);
  });

  it("reads GitHub Copilot CLI plugins, from a marketplace and installed directly, under the copilot host", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-copilot-"));
    const viaMarket = join(home, ".copilot", "installed-plugins", "awesome-copilot", "awesome-copilot");
    const direct = join(home, ".copilot", "installed-plugins", "_direct", "src-1");
    for (const d of [viaMarket, direct]) mkdirSync(d, { recursive: true });
    writeFileSync(join(viaMarket, "plugin.json"), JSON.stringify({ name: "awesome-copilot" }));
    writeFileSync(join(viaMarket, "mcp.json"), JSON.stringify({ mcpServers: { "awesome-copilot": { type: "stdio", command: "npx", args: ["-y", "some-mcp@1.2.3"] } } }));
    mkdirSync(join(direct, "skills", "review"), { recursive: true });
    writeFileSync(join(direct, "skills", "review", "SKILL.md"), "---\nname: review\n---\nReview the change.\n");
    expect(copilotPlugins(home).map((p) => p.name)).toEqual(["src-1", "awesome-copilot"]);
    const found = discover({ home, cwd: mkdtempSync(join(tmpdir(), "sp-cwd-")) });
    expect(found.items.find((i) => i.kind === "mcp" && i.host === "copilot")).toMatchObject({ name: "plugin:awesome-copilot:awesome-copilot", host: "copilot" });
    expect(found.items.some((i) => i.kind === "agent-skill" && i.host === "copilot")).toBe(true);
  });
});
