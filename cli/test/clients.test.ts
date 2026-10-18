/**
 * The further clients of decision 458: Kiro, OpenCode, Kilo Code, Crush, Amp, Continue, Goose, LM Studio, Qwen Code,
 * Junie, Trae, Augment, Visual Studio, Warp and ZCode. Every config here is a fake written into a scratch home and
 * project, in the shape the client's own docs show (the doc addresses are beside the rows in src/discover.ts). No real
 * home folder is read: every version is pinned in the command line, so the npx cache is never consulted.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { configLocations, discover, toUpload, type DiscoveredServer } from "../src/discover";
import { buildLock, diffIsEmpty, diffLock } from "../src/lock";
import { CLIENT_NAME, mcpServersDigest, readInstructionFiles } from "../src/instructions";
import { parseClaudeJson, parseContinueYaml, parseGooseYaml, parseYaml, stripJsonc } from "../src/parse";

const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** One fake config per new client, home and project, as each client's docs show it. */
function fakeMachine() {
  const home = mkdtempSync(join(tmpdir(), "sp-clients-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "sp-clients-cwd-"));
  const std = (pkg: string) => JSON.stringify({ mcpServers: { [pkg.split("@")[0]!]: { command: "npx", args: ["-y", pkg] } } });
  // Kiro: mcpServers, home and workspace
  put(join(home, ".kiro", "settings", "mcp.json"), JSON.stringify({ mcpServers: { "web-search": { command: "npx", args: ["-y", "@modelcontextprotocol/server-brave-search@0.6.2"], env: { BRAVE_API_KEY: "BSA-fake-key-value" } } } }));
  put(join(cwd, ".kiro", "settings", "mcp.json"), std("kiro-project-mcp@1.0.0"));
  // OpenCode: JSONC, "mcp", command as one array, env as "environment", remote with a url
  put(
    join(home, ".config", "opencode", "opencode.json"),
    `{
  "$schema": "https://opencode.ai/config.json",
  // my servers
  "mcp": {
    "everything": { "type": "local", "command": ["npx", "-y", "@modelcontextprotocol/server-everything@2025.9.25"], "enabled": true, "environment": { "MY_API_KEY": "sk-fake-opencode-secret" }, },
    "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp?key=abc" },
  },
}`,
  );
  put(join(cwd, "opencode.json"), JSON.stringify({ mcp: { gh_grep: { type: "remote", url: "https://mcp.grep.app" } } }));
  // Kilo Code: OpenCode's shape, in kilo.jsonc at home and .kilo/kilo.json in the project
  put(join(home, ".config", "kilo", "kilo.jsonc"), `{ "mcp": { "kilo-local": { "type": "local", "command": ["uvx", "mcp-server-time==0.6.2"] } } }`);
  put(join(cwd, ".kilo", "kilo.json"), JSON.stringify({ mcp: { figma: { type: "remote", url: "http://127.0.0.1:3845/mcp" } } }));
  // Crush: legacy JSON, "mcp", a plain command string, http with headers
  put(join(home, ".config", "crush", "crush.json"), `{ "$schema": "https://charm.land/crush.json", "mcp": { "filesystem": { "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem@2026.8.31", "/tmp"] }, }, }`);
  put(join(cwd, ".crush.json"), JSON.stringify({ mcp: { linear: { type: "http", url: "https://mcp.linear.app/mcp", oauth: true } } }));
  // Amp: "amp.mcpServers" in settings.json(c)
  put(join(home, ".config", "amp", "settings.json"), JSON.stringify({ "amp.mcpServers": { playwright: { command: "npx", args: ["-y", "@playwright/mcp@0.0.41", "--headless"] } }, "amp.showCosts": true }));
  put(join(cwd, ".amp", "settings.jsonc"), `{ // workspace\n "amp.mcpServers": { "linear": { "url": "https://mcp.linear.app/sse" } } }`);
  // Continue: config.yaml list, and a block file and a copied JSON config in .continue/mcpServers
  put(
    join(home, ".continue", "config.yaml"),
    `name: My Config
version: 1.0.0
schema: v1
models:
  - name: x
    provider: ollama
    model: llama3
mcpServers:
  - name: SQLite MCP
    command: npx
    args:
      - "-y"
      - "mcp-sqlite@1.2.0"
      - "/path/to/your/database.db"
    env:
      SUPABASE_TOKEN: \${{ secrets.SUPABASE_TOKEN }}
  - name: Remote
    type: streamable-http
    url: https://mcp.example.com/mcp
  - uses: anthropic/memory-mcp
`,
  );
  put(join(cwd, ".continue", "mcpServers", "playwright-mcp.yaml"), `name: Playwright mcpServer\nversion: 0.0.1\nschema: v1\nmcpServers:\n  - name: Browser search\n    command: npx\n    args:\n      - "@playwright/mcp@0.0.41"\n`);
  put(join(cwd, ".continue", "mcpServers", "mcp.json"), std("copied-from-claude@2.0.0"));
  put(join(cwd, ".continue", "mcpServers", "notes.md"), "not a server file\n");
  // Goose: extensions; builtin ones are Goose itself
  const goose = platform() === "win32" ? join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Block", "goose", "config", "config.yaml") : join(home, ".config", "goose", "config.yaml");
  put(
    goose,
    `active_provider: anthropic
GOOSE_MODE: "smart_approve"
extensions:
  developer:
    bundled: true
    enabled: true
    name: developer
    timeout: 300
    type: builtin
  filesystem:
    type: stdio
    name: filesystem
    enabled: true
    cmd: npx
    args: [ "-y", "@modelcontextprotocol/server-filesystem@2026.8.31", "/tmp" ]
    env_keys: [ ]
    envs: { GITHUB_TOKEN: "ghp_fakegoosetokenvalue" }
    timeout: 300
  remote-tools:
    type: streamable_http
    name: remote-tools
    enabled: true
    uri: "https://example.com/mcp"
    headers: { }
`,
  );
  // LM Studio, Qwen Code, Junie, Trae, Augment, Visual Studio, Warp: Claude-style mcpServers / servers
  put(join(home, ".lmstudio", "mcp.json"), JSON.stringify({ mcpServers: { "hf-mcp-server": { url: "https://huggingface.co/mcp", headers: { Authorization: "Bearer <YOUR_HF_TOKEN>" } } } }));
  put(join(home, ".qwen", "settings.json"), JSON.stringify({ theme: "x", mcp: { allowed: ["qwen-home"] }, mcpServers: { "qwen-home": { command: "uvx", args: ["mcp-server-fetch==2025.4.7"] } } }));
  put(join(cwd, ".qwen", "settings.json"), std("qwen-project-mcp@1.0.0"));
  put(join(home, ".junie", "mcp", "mcp.json"), std("junie-home-mcp@1.0.0"));
  put(join(cwd, ".junie", "mcp", "mcp.json"), std("junie-project-mcp@1.0.0"));
  put(join(cwd, ".trae", "mcp.json"), std("trae-project-mcp@1.0.0"));
  put(join(home, ".augment", "settings.json"), JSON.stringify({ mcpServers: { context7: { type: "http", url: "https://mcp.context7.com/mcp", headers: { CONTEXT7_API_KEY: "YOUR_API_KEY" } } } }));
  put(join(cwd, ".vs", "mcp.json"), JSON.stringify({ servers: { github: { url: "https://api.githubcopilot.com/mcp/" } } }));
  put(join(home, ".warp", ".mcp.json"), std("warp-home-mcp@1.0.0"));
  put(join(cwd, ".warp", ".mcp.json"), std("warp-project-mcp@1.0.0"));
  put(join(cwd, ".agents", ".mcp.json"), std("agents-dot-project-mcp@1.0.0"));
  // ZCode: "mcp"."servers" in its own config.json, and the .agents/mcp.json files it also reads
  put(join(home, ".zcode", "cli", "config.json"), JSON.stringify({ mcp: { servers: { memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory@2025.8.4"], env: {} } } } }));
  put(join(cwd, ".zcode", "config.json"), JSON.stringify({ mcp: { servers: { "zcode-project": { command: "npx", args: ["-y", "zcode-project-mcp@1.0.0"] } } } }));
  put(join(home, ".agents", "mcp.json"), std("agents-home-mcp@1.0.0"));
  return { home, cwd, goose };
}

const byHost = (items: readonly { kind: string; host: string; name: string }[], host: string) =>
  items
    .filter((i) => i.kind === "mcp" && i.host === host)
    .map((i) => i.name)
    .sort();

describe("discovery of the clients added in decision 458", () => {
  const { home, cwd, goose } = fakeMachine();
  const r = discover({ home, cwd });
  const servers = r.items.filter((i): i is DiscoveredServer => i.kind === "mcp");
  const one = (host: string, name: string) => servers.find((s) => s.host === host && s.name === name)!;

  it("reads every client's home and project config, and nothing goes wrong", () => {
    expect(r.errors).toEqual([]);
    expect(byHost(r.items, "kiro")).toEqual(["kiro-project-mcp", "web-search"]);
    expect(byHost(r.items, "opencode")).toEqual(["context7", "everything", "gh_grep"]);
    expect(byHost(r.items, "kilo")).toEqual(["figma", "kilo-local"]);
    expect(byHost(r.items, "crush")).toEqual(["filesystem", "linear"]);
    expect(byHost(r.items, "amp")).toEqual(["linear", "playwright"]);
    expect(byHost(r.items, "continue")).toEqual(["Browser search", "Remote", "SQLite MCP", "copied-from-claude"]);
    expect(byHost(r.items, "goose")).toEqual(["filesystem", "remote-tools"]);
    expect(byHost(r.items, "lmstudio")).toEqual(["hf-mcp-server"]);
    expect(byHost(r.items, "qwen")).toEqual(["qwen-home", "qwen-project-mcp"]);
    expect(byHost(r.items, "junie")).toEqual(["junie-home-mcp", "junie-project-mcp"]);
    expect(byHost(r.items, "trae")).toEqual(["trae-project-mcp"]);
    expect(byHost(r.items, "augment")).toEqual(["context7"]);
    expect(byHost(r.items, "visual-studio")).toEqual(["github"]);
    expect(byHost(r.items, "warp")).toEqual(["agents-dot-project-mcp", "warp-home-mcp", "warp-project-mcp"]);
    expect(byHost(r.items, "zcode")).toEqual(["agents-home-mcp", "memory", "zcode-project"]);
    expect(r.read).toContain(goose);
    expect(r.read).toContain(join(cwd, ".continue", "mcpServers", "playwright-mcp.yaml"));
    expect(r.read).not.toContain(join(cwd, ".continue", "mcpServers", "notes.md"));
  });

  it("reads the package and version from each client's own entry shape", () => {
    // OpenCode's command array is the program and its arguments
    expect(one("opencode", "everything")).toMatchObject({ transport: "stdio", canonicalName: "npm:@modelcontextprotocol/server-everything", version: "2025.9.25" });
    expect(one("kilo", "kilo-local")).toMatchObject({ canonicalName: "pypi:mcp-server-time", version: "0.6.2" });
    // a remote entry keeps the host and never the query string
    expect(one("opencode", "context7")).toMatchObject({ transport: "http", remoteHost: "mcp.context7.com", canonicalName: null });
    expect(one("crush", "filesystem")).toMatchObject({ canonicalName: "npm:@modelcontextprotocol/server-filesystem", version: "2026.8.31" });
    expect(one("amp", "linear")).toMatchObject({ transport: "http", remoteHost: "mcp.linear.app" });
    // Goose's cmd and uri
    expect(one("goose", "filesystem")).toMatchObject({ canonicalName: "npm:@modelcontextprotocol/server-filesystem", version: "2026.8.31" });
    expect(one("goose", "remote-tools")).toMatchObject({ transport: "http", remoteHost: "example.com" });
    expect(one("continue", "SQLite MCP")).toMatchObject({ canonicalName: "npm:mcp-sqlite", version: "1.2.0" });
    expect(one("continue", "Remote")).toMatchObject({ transport: "http", remoteHost: "mcp.example.com" });
    expect(one("zcode", "memory")).toMatchObject({ canonicalName: "npm:@modelcontextprotocol/server-memory", version: "2025.8.4" });
    expect(one("visual-studio", "github")).toMatchObject({ transport: "http", remoteHost: "api.githubcopilot.com" });
  });

  it("judges env values where they are and keeps none of them", () => {
    expect(one("opencode", "everything").hygiene.join(" ")).toContain("env MY_API_KEY looks like a plaintext secret");
    expect(one("goose", "filesystem").hygiene.join(" ")).toContain("env GITHUB_TOKEN looks like a plaintext secret");
    expect(one("kiro", "web-search").hygiene.join(" ")).toContain("env BRAVE_API_KEY");
    // the payload a check or sync sends: names, versions, hosts, never a value, a path or a query string
    const payload = JSON.stringify(toUpload(r.items));
    for (const secret of ["sk-fake-opencode-secret", "ghp_fakegoosetokenvalue", "BSA-fake-key-value", "YOUR_API_KEY", "key=abc", home, cwd]) expect(payload).not.toContain(secret);
    for (const u of toUpload(r.items)) expect(Object.keys(u).sort()).toEqual(u.kind === "mcp" ? ["canonicalName", "host", "kind", "name", "remoteHost", "transport", "version"] : expect.any(Array));
  });

  it("does not take Qwen's or Gemini's mcp.allowed list for a server", () => {
    expect(servers.some((s) => s.name === "allowed")).toBe(false);
  });

  it("names every new client in the lock's kind labels", () => {
    for (const l of configLocations("/h", "/p")) if (l.format !== "skills-dir") expect(CLIENT_NAME[l.host], l.host).toBeDefined();
  });
});

describe("the lock watches the new clients' files", () => {
  it("records a server file inside a watched client folder once, under its own kind and by its digest", () => {
    const { home, cwd } = fakeMachine();
    put(join(cwd, ".kiro", "steering", "style.md"), "be terse\n");
    const files = readInstructionFiles(home, cwd);
    const kiro = files.filter((f) => f.path.startsWith(join(cwd, ".kiro")));
    expect(kiro.map((f) => [f.path, f.kind]).sort()).toEqual([
      [join(cwd, ".kiro", "settings", "mcp.json"), "Kiro MCP servers, project"],
      [join(cwd, ".kiro", "steering", "style.md"), "Kiro file, project"],
    ]);
    const amp = files.find((f) => f.path === join(cwd, ".amp", "settings.jsonc"))!;
    expect(amp.kind).toBe("Amp MCP servers, project");
    expect(Object.keys(amp.sections!)).toEqual(["linear"]);
    expect(files.find((f) => f.path.endsWith(join("goose", "config.yaml")))!.kind).toBe("Goose config.yaml, home");
    expect(files.filter((f) => f.kind === "Continue MCP server file, project").map((f) => f.path.split(/[\\/]/).pop()).sort()).toEqual(["mcp.json", "playwright-mcp.yaml"]);
    expect(files.find((f) => f.kind === "ZCode MCP servers, home" && f.path.endsWith("config.json"))!.sections).toEqual({ memory: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("a server changed in OpenCode's config fails the lock, and a changed preference does not", () => {
    const { home, cwd } = fakeMachine();
    const lock = () => buildLock(toUpload(discover({ home, cwd }).items), readInstructionFiles(home, cwd), { home, cwd });
    const before = lock();
    put(join(cwd, "opencode.json"), JSON.stringify({ model: "anthropic/claude-sonnet-4-5", mcp: { gh_grep: { type: "remote", url: "https://mcp.grep.app" } } }));
    expect(diffIsEmpty(diffLock(before, lock()))).toBe(true);
    put(join(cwd, "opencode.json"), JSON.stringify({ mcp: { gh_grep: { type: "remote", url: "https://evil.example/mcp" } } }));
    expect(diffIsEmpty(diffLock(before, lock()))).toBe(false);
  });
});

describe("digest of the new shapes", () => {
  it("hashes OpenCode's environment values like env, so the digest moves with a secret and never holds it", () => {
    const doc = (v: string) => JSON.stringify({ mcp: { s: { type: "local", command: ["npx", "x@1.0.0"], environment: { KEY: v } } } });
    const a = mcpServersDigest(doc("one"), undefined, "mcp-key")!;
    const b = mcpServersDigest(doc("two"), undefined, "mcp-key")!;
    expect(a.sections.s).not.toBe(b.sections.s);
    expect(Object.keys(a.sections)).toEqual(["s"]);
    // a Claude-style file reads exactly as before: same digest with or without a comment around it
    const claude = JSON.stringify({ mcpServers: { fs: { command: "npx", args: ["x"], env: { K: "v" } } } });
    expect(mcpServersDigest(`// comment\n${claude}`)).toEqual(mcpServersDigest(claude));
  });

  it("reads Amp's and ZCode's keys and nothing else", () => {
    expect(Object.keys(mcpServersDigest(JSON.stringify({ "amp.mcpServers": { a: { url: "https://x" } }, mcpServers: { b: {} } }), undefined, "amp")!.sections)).toEqual(["a"]);
    expect(Object.keys(mcpServersDigest(JSON.stringify({ mcp: { servers: { z: { command: "npx" } } } }), undefined, "zcode")!.sections)).toEqual(["z"]);
  });
});

describe("JSONC", () => {
  it("removes comments and trailing commas outside strings and leaves valid JSON alone", () => {
    expect(JSON.parse(stripJsonc(`{ "a": "http://x//y", /* b */ "c": [1, 2, ], // d\n }`))).toEqual({ a: "http://x//y", c: [1, 2] });
    const valid = JSON.stringify({ a: "a,]", b: ["//", "/*"], c: { d: "\\\"," } });
    expect(stripJsonc(valid)).toBe(valid);
  });

  it("lets a commented Zed settings file list its servers", () => {
    const servers = parseClaudeJson(`// Zed settings\n{\n  "theme": "One Dark",\n  "context_servers": { "files": { "command": "npx", "args": ["-y", "files-mcp@1.0.0"], }, },\n}`, "zed", "/z");
    expect(servers.map((s) => s.name)).toEqual(["files"]);
  });
});

describe("the YAML reader", () => {
  it("reads block mappings, lists of mappings, flow lists and maps, quotes, comments and text blocks", () => {
    const doc = parseYaml(`# top comment
name: "My # Config" # trailing
empty:
list:
- a
- 'it''s'
nested:
  - name: one
    args: [ "-y", 'x', plain, "a,b" ]
    env: { A: "1", B: two }
  -   name: two
      args:
        - "--port"
        - 3000
script: |
  line one
  line two
folded: >
  one
  two
flag: true
nothing: ~
url: https://example.com/a#frag
`);
    expect(doc).toEqual({
      name: "My # Config",
      empty: null,
      list: ["a", "it's"],
      nested: [
        { name: "one", args: ["-y", "x", "plain", "a,b"], env: { A: "1", B: "two" } },
        { name: "two", args: ["--port", "3000"] },
      ],
      script: "line one\nline two",
      folded: "one two",
      flag: true,
      nothing: null,
      url: "https://example.com/a#frag",
    });
  });

  it("reports what it cannot read instead of guessing", () => {
    expect(() => parseYaml("a: 1\n  b: 2\n")).toThrow(/YAML not understood/);
    expect(() => parseYaml('a: "unclosed\n')).toThrow(/YAML not understood/);
    expect(parseYaml("")).toBeNull();
  });

  it("lists only Goose extensions that start a program or name a URL, and Continue entries with a command or URL", () => {
    expect(parseGooseYaml("extensions:\n  developer:\n    type: builtin\n    name: developer\n", "/g")).toEqual([]);
    expect(parseGooseYaml("GOOSE_MODE: auto\n", "/g")).toEqual([]);
    expect(parseContinueYaml("mcpServers:\n  - uses: anthropic/memory-mcp\n", "/c")).toEqual([]);
    expect(parseContinueYaml("mcpServers:\n  - name: S\n    type: sse\n    url: https://h.example/sse\n", "/c")[0]).toMatchObject({ name: "S", transport: "sse", remoteHost: "h.example" });
  });
});
