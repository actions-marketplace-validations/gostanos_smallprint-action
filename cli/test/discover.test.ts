import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { configLocations, discover, inferPackage, parseClaudeJson, parseCodexToml, readSkillsDir, toUpload } from "../src/discover";

const fx = (n: string) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));

describe("package inference", () => {
  it("reads npx, uvx, uv run, python -m, docker and local commands", () => {
    expect(inferPackage("npx", ["-y", "@modelcontextprotocol/server-filesystem@2026.8.31", "/x"])).toEqual({ canonicalName: "npm:@modelcontextprotocol/server-filesystem", version: "2026.8.31", transport: "stdio" });
    expect(inferPackage("/usr/local/bin/npx", ["mcp-remote", "https://x"])).toMatchObject({ canonicalName: "npm:mcp-remote", version: null });
    expect(inferPackage("pnpm", ["dlx", "some-mcp@2.0.0"])).toMatchObject({ canonicalName: "npm:some-mcp", version: "2.0.0" });
    expect(inferPackage("uvx", ["mcp-server-git==0.6.2"])).toEqual({ canonicalName: "pypi:mcp-server-git", version: "0.6.2", transport: "stdio" });
    // an option's value is never the package; --from and --spec name it
    expect(inferPackage("uvx", ["--python", "3.11", "mcp-server-git"])).toMatchObject({ canonicalName: "pypi:mcp-server-git" });
    expect(inferPackage("uvx", ["--from", "mcp-server-git==0.6.2", "mcp-server-git-cli"])).toMatchObject({ canonicalName: "pypi:mcp-server-git", version: "0.6.2" });
    expect(inferPackage("uvx", ["--with", "requests", "-p", "3.12", "some_server[extra]"])).toMatchObject({ canonicalName: "pypi:some-server" });
    expect(inferPackage("pipx", ["run", "mcp-server-git"])).toMatchObject({ canonicalName: "pypi:mcp-server-git" });
    expect(inferPackage("pipx", ["run", "--spec", "mcp-server-git==0.6.2", "mcp-server-git"])).toMatchObject({ canonicalName: "pypi:mcp-server-git", version: "0.6.2" });
    expect(inferPackage("pipx", ["install", "x"]).canonicalName).toBeNull();
    expect(inferPackage("uv", ["run", "mcp_server_fetch"])).toMatchObject({ canonicalName: "pypi:mcp-server-fetch" });
    expect(inferPackage("python3", ["-m", "mcp_server_time"])).toMatchObject({ canonicalName: "pypi:mcp-server-time" });
    expect(inferPackage("docker", ["run", "-i", "--rm", "ghcr.io/acme/mcp-thing:1.4.0"])).toEqual({ canonicalName: "oci:ghcr.io/acme/mcp-thing", version: "1.4.0", transport: "stdio" });
    expect(inferPackage("node", ["/path/dist/index.js"])).toEqual({ canonicalName: null, version: null, transport: "stdio" });
    expect(inferPackage(undefined, [])).toMatchObject({ transport: "unknown" });
  });
});

describe("a run from the home directory", () => {
  it("reads a config that is both the home and the project entry once", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-home-"));
    mkdirSync(join(home, ".cursor"));
    writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] } } }));
    const r = discover({ home, cwd: home });
    expect(r.read).toEqual([join(home, ".cursor", "mcp.json")]);
    expect(r.items.map((i) => i.name)).toEqual(["github"]);
  });
});

describe("config parsing", () => {
  it("parses a Claude Desktop config, flags plaintext secrets locally, never keeps values", () => {
    const servers = parseClaudeJson(readFileSync(fx("claude_desktop_config.json"), "utf8"), "claude-desktop", fx("claude_desktop_config.json"));
    expect(servers.map((s) => `${s.name}:${s.canonicalName ?? s.remoteHost ?? "local"}:${s.version ?? ""}`)).toEqual([
      "filesystem:npm:@modelcontextprotocol/server-filesystem:2026.8.31",
      "github:npm:@modelcontextprotocol/server-github:",
      "git:pypi:mcp-server-git:0.6.2",
      "remote:mcp.example.com:",
      "local:local:",
      "docker:oci:ghcr.io/acme/mcp-thing:1.4.0",
    ]);
    const gh = servers.find((s) => s.name === "github")!;
    expect(gh.hygiene.some((h) => h.includes("GITHUB_PERSONAL_ACCESS_TOKEN"))).toBe(true);
    expect(JSON.stringify(toUpload(servers))).not.toContain("ghp_");
    expect(JSON.stringify(toUpload(servers))).not.toContain("SECRET");
    expect(servers.find((s) => s.name === "remote")!.transport).toBe("sse");
  });

  it("parses Codex TOML tables", () => {
    const servers = parseCodexToml(readFileSync(fx("config.toml"), "utf8"), fx("config.toml"));
    expect(servers.map((s) => `${s.name}:${s.canonicalName}:${s.version ?? ""}`)).toEqual(["context7:npm:@upstash/context7-mcp:latest", "jira:pypi:mcp-atlassian:"]);
    expect(servers[1]!.hygiene.some((h) => h.includes("JIRA_API_TOKEN"))).toBe(true);
  });

  it("reads skill directories with SKILL.md and hashes every file", () => {
    const skills = readSkillsDir("openclaw", fx("skills"));
    expect(skills.length).toBe(1);
    expect(skills[0]).toMatchObject({ name: "pdf-tools", displayName: "pdf-tools", description: "Extract text from PDFs" });
    expect(skills[0]!.files.map((f) => f.path)).toEqual(["SKILL.md", "scripts/extract.sh"]);
    expect(skills[0]!.skillMdSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("discover walks configured locations and tolerates missing ones", () => {
    const r = discover({ home: fx("nonexistent-home"), cwd: fx("nonexistent-cwd"), extraJsonConfigs: [{ path: fx("claude_desktop_config.json"), host: "claude-desktop" }] });
    expect(r.errors).toEqual([]);
    expect(r.read).toEqual([fx("claude_desktop_config.json")]);
    expect(r.items.length).toBe(6);
  });
});

describe("package inference never yields a local path", () => {
  it("skips uv run --directory values and docker container arguments", () => {
    expect(inferPackage("uv", ["run", "--directory", "/Users/nick/mcp-servers/weather", "weather"])).toMatchObject({ canonicalName: "pypi:weather" });
    expect(inferPackage("uv", ["run", "--directory", "/Users/nick/mcp-servers/weather", "/Users/nick/x.py"]).canonicalName).toBeNull();
    expect(inferPackage("docker", ["run", "-i", "--rm", "-v", "/home/me:/projects", "mcp/filesystem", "/projects"])).toMatchObject({ canonicalName: "oci:mcp/filesystem" });
    expect(inferPackage("npx", ["-y", "/Users/nick/local-server/index.js"]).canonicalName).toBeNull();
    expect(inferPackage("npx", ["-y", "@scope/pkg@1.2.3"])).toMatchObject({ canonicalName: "npm:@scope/pkg", version: "1.2.3" });
    // versions and module names must look like versions and names, never paths
    expect(inferPackage("npx", ["-y", "foo@/Users/nick/secret/dir"])).toMatchObject({ canonicalName: "npm:foo", version: null });
    expect(inferPackage("uvx", ["bar==file:///Users/nick/x"])).toMatchObject({ canonicalName: "pypi:bar", version: null });
    expect(inferPackage("python", ["-m", "/Users/nick/proj/module"]).canonicalName).toBeNull();
    expect(inferPackage("python", ["-m", "mcp_server_git"])).toMatchObject({ canonicalName: "pypi:mcp-server-git" });
    // Windows shapes
    expect(inferPackage("C:\\Program Files\\nodejs\\npx.cmd", ["-y", "mcp-remote"])).toMatchObject({ canonicalName: "npm:mcp-remote" });
    expect(inferPackage("cmd", ["/c", "npx", "-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\me"])).toMatchObject({ canonicalName: "npm:@modelcontextprotocol/server-filesystem" });
  });
});

describe("skill directories never follow symbolic links", () => {
  it("hashes only regular files inside the skill and reports linked or looping skills", () => {
    const root = mkdtempSync(join(tmpdir(), "sp-skills-"));
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "id_rsa"), "PRIVATE");
    const skills = join(root, "skills");
    mkdirSync(join(skills, "good"), { recursive: true });
    writeFileSync(join(skills, "good", "SKILL.md"), "---\nname: good\n---\n# Good\n");
    writeFileSync(join(skills, "good", "helper.md"), "help");
    symlinkSync(outside, join(skills, "good", "data")); // a skill shipping data -> somewhere else
    symlinkSync(join(outside, "id_rsa"), join(skills, "good", "key")); // a file link
    symlinkSync(outside, join(skills, "linked")); // a skills entry that is itself a link
    mkdirSync(join(skills, "loop"));
    writeFileSync(join(skills, "loop", "SKILL.md"), "# loop\n");
    symlinkSync("..", join(skills, "loop", "up")); // a loop, which used to recurse until ENAMETOOLONG
    const errors: string[] = [];
    const found = readSkillsDir("openclaw", skills, errors);
    expect(found.map((s) => s.name).sort()).toEqual(["good", "loop"]);
    const good = found.find((s) => s.name === "good")!;
    expect(good.files.map((f) => f.path)).toEqual(["SKILL.md", "helper.md"]);
    expect(JSON.stringify(good)).not.toContain("id_rsa");
    expect(errors.some((e) => e.includes("linked") && e.includes("symbolic link"))).toBe(true);
  });
});

describe("the version npx actually runs (decision 222)", () => {
  it("reads the newest cached package.json for an unpinned npm server, and nothing when there is no cache", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, utimesSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { versionFromNpxCache } = await import("../src/discover");
    const root = mkdtempSync(join(tmpdir(), "npx-"));
    for (const [dir, version, age] of [["aaa", "1.0.0", 200], ["bbb", "1.2.0", 100]] as const) {
      const d = join(root, dir, "node_modules", "@scope", "pkg");
      mkdirSync(d, { recursive: true });
      const pj = join(d, "package.json");
      writeFileSync(pj, JSON.stringify({ name: "@scope/pkg", version }));
      const t = (Date.now() - age * 1000) / 1000;
      utimesSync(pj, t, t);
    }
    expect(versionFromNpxCache("@scope/pkg", root)).toBe("1.2.0");
    expect(versionFromNpxCache("other", root)).toBeNull();
    expect(versionFromNpxCache("@scope/pkg", join(root, "missing"))).toBeNull();
  });
});

describe("skills one level down in a group folder (decision 445)", () => {
  it("finds group/skill/SKILL.md, and still reads a plain skill folder", () => {
    const root = mkdtempSync(join(tmpdir(), "sp-skills-"));
    mkdirSync(join(root, "plain"), { recursive: true });
    writeFileSync(join(root, "plain", "SKILL.md"), "# plain\n");
    mkdirSync(join(root, "group", "nested"), { recursive: true });
    writeFileSync(join(root, "group", "nested", "SKILL.md"), "# nested\n");
    writeFileSync(join(root, "group", "README.md"), "a note, not a skill\n");
    const names = readSkillsDir("claude-code", root).map((s) => s.name).sort();
    expect(names).toEqual(["nested", "plain"]);
  });
});

describe("a repository's root skills folder (cli-gaps)", () => {
  const skillAt = (dir: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: x\n---\nDo it\n");
  };
  const installPlugin = (home: string) => {
    const plugin = join(home, ".claude", "plugins", "cache", "m", "p", "1.0.0");
    skillAt(join(plugin, "skills", "s1"));
    mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
    writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "p" }));
    writeFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "p@m": [{ scope: "user", installPath: plugin }] } }));
    return plugin;
  };
  const skillsOf = (r: ReturnType<typeof discover>) => r.items.filter((i) => i.kind === "agent-skill").map((s) => `${s.host}:${s.name}`).sort();

  it("finds skills/<name>/SKILL.md at the root of the working directory, as a project location", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "sp-repo-"));
    skillAt(join(cwd, "skills", "pdf"));
    skillAt(join(cwd, "skills", "document-skills", "docx")); // a group folder, one level down
    writeFileSync(join(cwd, "skills", "README.md"), "not a skill\n");
    const r = discover({ home, cwd });
    expect(skillsOf(r)).toEqual(["manual:docx", "manual:pdf"]);
    expect(r.read).toEqual([join(cwd, "skills")]);
    expect(configLocations(home, cwd).filter((l) => l.path === join(cwd, "skills"))).toEqual([{ host: "manual", path: join(cwd, "skills"), format: "skills-dir", scope: "project" }]);
  });

  it("finds nothing when there is no skills folder, or one that holds no SKILL.md", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-home-"));
    expect(discover({ home, cwd: mkdtempSync(join(tmpdir(), "sp-repo-")) }).items).toEqual([]);
    const other = mkdtempSync(join(tmpdir(), "sp-repo-"));
    mkdirSync(join(other, "skills", "notes"), { recursive: true });
    writeFileSync(join(other, "skills", "notes", "README.md"), "a folder called skills that holds no skill\n");
    const r = discover({ home, cwd: other });
    expect(r.items).toEqual([]);
    expect(r.read).toEqual([]);
  });

  it("reads a plugin's own skills folder once, under the plugin, when the run is from inside that plugin", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-home-"));
    const plugin = installPlugin(home);
    expect(skillsOf(discover({ home, cwd: mkdtempSync(join(tmpdir(), "sp-repo-")) }))).toEqual(["claude-code:s1"]);
    // from inside the plugin its skills/ is also the root skills folder: still one skill, still the plugin's
    const inside = discover({ home, cwd: plugin });
    expect(skillsOf(inside)).toEqual(["claude-code:s1"]);
    expect(inside.read.filter((p) => p === join(plugin, "skills"))).toHaveLength(1);
  });

  it("reads a plugin's skills and the project's root skills both when they are different folders", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-home-"));
    installPlugin(home);
    const cwd = mkdtempSync(join(tmpdir(), "sp-repo-"));
    skillAt(join(cwd, "skills", "s1"));
    expect(skillsOf(discover({ home, cwd }))).toEqual(["claude-code:s1", "manual:s1"]);
  });
});
