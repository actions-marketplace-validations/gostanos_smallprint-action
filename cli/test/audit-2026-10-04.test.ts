/**
 * The tools audit of 4 Oct 2026. Each case was written against the fault the audit showed: `show` calling read entries
 * unread (fix 5), the gate saying "unchanged" with no tool text to compare (fix 6), failing for ever on a pinned server
 * and hiding an advisory behind exit 2 (fix 11), the unkeyed path hash on every first sync (fix 3), a stack trace at end
 * of input and on an answer it did not expect (fix 8), a mod's second module (fix 9), Zed and Gemini listed and not
 * locked (fix 10), and the lines --help left out (fix 16).
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, readAssetReply, readCheckReply, readSyncReply, UnexpectedReply } from "../src/ask";
import { configLocations, discover, toUpload } from "../src/discover";
import { gateExit, gateServer, type GateRecord } from "../src/gate";
import { CLIENT_NAME, instructionLocations, MCP_CONFIG_KINDS_0_1_7, mcpConfigKinds, mcpConfigLocations, readInstructionFiles, sendsFormerHashes, toFileUpload } from "../src/instructions";
import { buildLock, diffIsEmpty, diffLock, formatNotCompared, parseLock } from "../src/lock";
import { findMods, modModulePaths } from "../src/mods";
import { parseClaudeJson } from "../src/parse";
import { readKind, readWords } from "../src/record";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const TSX = pathToFileURL(join(fileURLToPath(new URL("..", import.meta.url)), "node_modules", "tsx", "dist", "loader.mjs")).href;
const PY = "/usr/bin/python3";
const HELPER = fileURLToPath(new URL("../report/smallprint-report.py", import.meta.url));

describe("show says how an entry was read from the site's own answer (fix 5)", () => {
  const baseline = (read: boolean | undefined) => ({ version: "1.0.0", ...(read === undefined ? {} : { read }) });
  it("a read skill, a read plugin and a server read with no tools are read, as the answer stands today", () => {
    // /api/asset on 4 Oct 2026: readState "unread" beside baseline.read true for a read skill
    expect(readWords({ asset: { kind: "agent-skill" }, readState: "unread", baseline: baseline(true), tools: null, skillMd: "# x" })).toBe("SKILL.md read");
    expect(readWords({ asset: { kind: "plugin" }, readState: "unread", baseline: baseline(true), tools: null, skillMd: "# x" })).toBe("instruction files read");
    expect(readWords({ asset: { kind: "plugin" }, readState: "unread", baseline: baseline(true), tools: null, skillMd: null })).toBe("small print read");
    expect(readWords({ asset: { kind: "mcp" }, readState: "no-tools", baseline: baseline(true), tools: null })).toBe("read, no tool declarations found");
    expect(readWords({ asset: { kind: "mcp" }, readState: "tools", baseline: baseline(true), tools: [{}] })).toBe("1 tool read");
    expect(readWords({ asset: { kind: "mcp" }, readState: "tools", baseline: baseline(true), tools: [{}, {}] })).toBe("2 tools read");
  });
  it("and as the answer will stand once readState itself says a skill was read, whatever the state is called", () => {
    for (const state of ["read", "instructions", "skill", "files"]) expect(readKind({ asset: { kind: "agent-skill" }, readState: state, baseline: baseline(undefined), tools: null, skillMd: null })).toBe("read");
    expect(readWords({ asset: { kind: "agent-skill" }, readState: "instructions", baseline: baseline(true), tools: null, skillMd: "# x" })).toBe("SKILL.md read");
  });
  it("an entry the site says is unread, or too large to open, is not called read", () => {
    expect(readWords({ asset: { kind: "mcp" }, readState: "unread", baseline: baseline(false), tools: null })).toBe("small print not read yet");
    expect(readWords({ asset: { kind: "mcp" }, readState: "oversize", baseline: baseline(false), tools: null })).toBe("not read: the package is larger than the reader opens");
    // an answer from before the site said either field: only what came back can be read
    expect(readWords({ baseline: baseline(undefined), tools: null })).toBe("small print not read yet");
  });
  it("is the same file in the MCP server, which is built on its own", () => {
    const body = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    expect(body("../../mcp/src/record.ts")).toBe(body("../src/record.ts"));
  });
});

const record = (over: Partial<GateRecord> = {}): GateRecord => ({
  asset: { latestVersion: "3.0.0", url: "https://smallprint.dev/a/npm/x" },
  advisories: [],
  releases: [
    { from: "2.0.0", to: "3.0.0", publishedAt: "2026-09-03", worst: "high", identical: false },
    { from: "1.0.0", to: "2.0.0", publishedAt: "2026-09-02", worst: "medium", identical: false },
    { from: "0.9.0", to: "1.0.0", publishedAt: "2026-09-01", worst: "info", identical: true },
  ],
  versions: [
    { version: "3.0.0", publishedAt: "2026-09-03", read: true, contentHash: "c3" },
    { version: "2.0.0", publishedAt: "2026-09-02", read: true, contentHash: "c2" },
    { version: "1.0.0", publishedAt: "2026-09-01", read: true, contentHash: "c1" },
    { version: "0.9.0", publishedAt: "2026-08-01", read: true, contentHash: "c1" },
    { version: "0.8.0", publishedAt: "2026-07-01", read: true, contentHash: null },
    { version: "0.7.0", publishedAt: "2026-06-01", read: false, contentHash: null },
  ],
  ...over,
});

describe("the gate (fixes 6 and 11)", () => {
  it("does not fail for a server pinned to the version in its lock, however many releases came after", () => {
    const v = gateServer(record(), "1.0.0", { version: "1.0.0" });
    expect(v).toMatchObject({ mark: "ok", changed: false, unknown: false });
    expect(v.words[0]).toBe("runs 1.0.0, the version in the lock");
    expect(v.words[1]).toBe("2 releases after 1.0.0 changed the small print, worst high; read the entry page before you move up");
    // and with no lock at all a pinned server is not a change either
    expect(gateServer(record(), "1.0.0", undefined)).toMatchObject({ mark: "ok", changed: false });
  });
  it("fails when what runs here is not the version in the lock and the small print differs between the two", () => {
    const moved = gateServer(record(), "3.0.0", { version: "1.0.0" });
    expect(moved).toMatchObject({ mark: "!", changed: true });
    expect(moved.words[0]).toBe("small print changed between 1.0.0 in the lock and 3.0.0: 2 releases, worst high");
    expect(gateServer(record(), "2.0.0", { version: "1.0.0" }).words[0]).toContain("1 release, worst medium");
    // not pinned: the next start runs the latest, which is what is compared with the lock
    expect(gateServer(record(), null, { version: "1.0.0" })).toMatchObject({ changed: true });
    // moved between two versions with the same tool text: nothing changed
    expect(gateServer(record(), "1.0.0", { version: "0.9.0" })).toMatchObject({ mark: "ok", changed: false });
  });
  it("says unknown, never unchanged, when there is no tool text on record to compare", () => {
    // npm:@upstash/context7-mcp at 4.1.0 on 4 Oct 2026: read, no tools declared, and the gate said "ok, unchanged"
    const noTools = gateServer(record(), "0.8.0", undefined);
    expect(noTools).toMatchObject({ mark: "?", unknown: true, changed: false });
    expect(noTools.words[0]).toBe("version 0.8.0 was read and declares no tools of its own, so there is no tool text to compare");
    expect(gateServer(record(), "0.7.0", undefined).words[0]).toBe("version 0.7.0 is on the record but its small print was not read");
    expect(gateServer(record(), "0.1.0", undefined).words[0]).toBe("version 0.1.0 is not on the record");
    expect(gateServer(record(), "3.0.0", { version: "0.8.0" })).toMatchObject({ mark: "?", unknown: true, changed: false });
    expect(gateServer(record(), null, undefined)).toMatchObject({ mark: "?", unknown: true });
    expect(JSON.stringify([noTools.words, gateServer(record(), "0.7.0", undefined).words])).not.toContain("unchanged");
  });
  it("still says when the record's digest for the locked version changed", () => {
    expect(gateServer(record(), "1.0.0", { version: "1.0.0", recordSha256: "other" })).toMatchObject({ mark: "!", changed: true });
  });
  it("exits 3 whenever a covering advisory is present, so a change or --strict never hides it", () => {
    expect(gateExit({ changed: 1, advisories: 1, unknown: 0 }, false)).toBe(3);
    expect(gateExit({ changed: 0, advisories: 1, unknown: 2 }, true)).toBe(3);
    expect(gateExit({ changed: 1, advisories: 0, unknown: 0 }, false)).toBe(2);
    expect(gateExit({ changed: 0, advisories: 0, unknown: 1 }, true)).toBe(2);
    expect(gateExit({ changed: 0, advisories: 0, unknown: 1 }, false)).toBe(0);
    const covered = gateServer(record({ advisories: [{ id: "MAL-1", severity: "critical", versionRange: "0.9.0, 1.0.0" }] }), "1.0.0", { version: "1.0.0" });
    expect(covered).toMatchObject({ mark: "!", advisory: true, changed: false });
    expect(covered.words.join("; ")).toContain("1 high or critical advisory covers 1.0.0: MAL-1");
  });
});

describe("the earlier unkeyed path hashes (fix 3)", () => {
  const first = { hasKey: true, labelKeyed: false, saltBefore: false, runsBefore: 0, asked: false };
  it("are not sent from a machine with nothing to move", () => {
    expect(sendsFormerHashes(first)).toBe(false);
    expect(sendsFormerHashes({ ...first, saltBefore: true, runsBefore: 9 })).toBe(false);
  });
  it("are sent when scheduled runs were counted before the salt existed, or when asked for, and never for a keyed label", () => {
    expect(sendsFormerHashes({ ...first, runsBefore: 3 })).toBe(true);
    expect(sendsFormerHashes({ ...first, asked: true })).toBe(true);
    expect(sendsFormerHashes({ ...first, runsBefore: 3, asked: true, labelKeyed: true })).toBe(false);
    expect(sendsFormerHashes({ ...first, hasKey: false, asked: true })).toBe(false);
  });

  function sync(args: string[], state?: object): { out: string; body: string } {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "sp-sync-home-")));
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), "sp-sync-cwd-")));
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(home, ".config", "smallprint"), { recursive: true });
    writeFileSync(join(home, ".claude", "CLAUDE.md"), "Be careful.\n");
    writeFileSync(join(cwd, "CLAUDE.md"), "Project rules.\n");
    if (state) writeFileSync(join(home, ".config", "smallprint", "state.json"), JSON.stringify(state));
    let out = "";
    try {
      out = execFileSync(process.execPath, ["--import", TSX, MAIN, "sync", "--label", "t", "--dry-run", ...args], { cwd, env: { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, ".config") }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      out = String((err as { stdout?: string }).stdout ?? "");
    }
    const plain = toFileUpload(readInstructionFiles(home, cwd), cwd).files.map((f) => f.pathHash.slice(0, 12));
    return { out, body: plain.join(" ") };
  }

  it("a first sync shows no unkeyed hash in --dry-run, because none is sent", () => {
    const r = sync([]);
    expect(r.out).toContain("--dry-run: nothing sent.");
    expect(r.out).not.toContain("earlier unkeyed");
    expect(r.out).not.toContain("Also sent, this once");
    for (const h of r.body.split(" ")) expect(r.out).not.toContain(h);
  }, 30_000);

  it("a machine that ran scheduled syncs before it had a salt is told, and --dry-run shows each hash it will send", () => {
    const r = sync([], { scheduledRuns: 4 });
    expect(r.out).toContain("Also sent, this once: this machine reported before path hashes were keyed");
    for (const h of r.body.split(" ")) expect(r.out).toContain(`earlier unkeyed path hash ${h}`);
    expect(r.out).toMatch(/this project folder: scope project:[0-9a-f]{12} {2}earlier unkeyed scope project:[0-9a-f]{12}/);
    expect(sync(["--migrate-unkeyed"]).out).toContain("earlier unkeyed path hash");
  }, 30_000);
});

describe("end of input at a question, and an answer the command does not expect (fix 8)", () => {
  it("end of input is the answer no", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const answer = ask("Send? [y/N] ", input, output);
    input.end();
    expect(await answer).toBe("");
  });
  it("a typed answer comes back as typed", async () => {
    const input = new PassThrough();
    const answer = ask("Send? [y/N] ", input, new PassThrough());
    input.write("y\n");
    expect(await answer).toBe("y");
    input.end();
  });
  const res = (body: string) => new Response(body, { status: 200 });
  it("reads the answers it expects and names the ones it cannot read", async () => {
    await expect(readCheckReply(res('{"unexpected":true}'), "x/api/check")).rejects.toBeInstanceOf(UnexpectedReply);
    await expect(readCheckReply(res("<html>"), "x/api/check")).rejects.toThrow(/x\/api\/check answered with something this version of the command cannot read \(not JSON\)/);
    await expect(readSyncReply(res('{"unexpected":true}'), "x/api/sync")).rejects.toBeInstanceOf(UnexpectedReply);
    await expect(readSyncReply(res("null"), "x/api/sync")).rejects.toBeInstanceOf(UnexpectedReply);
    await expect(readAssetReply(res('{"asset":{}}'), "x")).rejects.toBeInstanceOf(UnexpectedReply);
    expect((await readSyncReply(res('{"pinned":2}'), "x")).unknown).toEqual([]);
    expect((await readCheckReply(res('{"grade":"A","results":[{"name":"n","status":"clean","detail":"d","url":null}]}'), "x")).results).toHaveLength(1);
  });

  describe("the command itself, against a site that answers wrongly", () => {
    let server: Server;
    let base: string;
    beforeAll(async () => {
      server = createServer((_req, r) => { r.writeHead(200, { "content-type": "application/json" }); r.end('{"unexpected":true}'); });
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => server.close());
    const run = (args: string[]) =>
      new Promise<{ code: number; out: string; err: string }>((done) => {
        const home = mkdtempSync(join(tmpdir(), "sp-bad-home-"));
        writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@2026.7.4"] } } }));
        execFile(process.execPath, ["--import", TSX, MAIN, ...args, "--base", base], { cwd: home, env: { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, ".config"), SMALLPRINT_TOKEN: `sp_${"a".repeat(48)}` }, encoding: "utf8" }, (e, out, err) => done({ code: e ? Number((e as { code?: number }).code ?? 1) : 0, out, err }));
      });
    it("check --upload, sync and show end in one sentence and exit 1, with no stack trace", async () => {
      for (const args of [["check", "--upload", "--no-signup"], ["sync", "--label", "t", "--yes"], ["show", "npm/mcp-remote"]]) {
        const r = await run(args);
        expect([args[0], r.code]).toEqual([args[0], 1]);
        expect(r.err).toMatch(/answered with something this version of the command cannot read/);
        expect(r.err + r.out).not.toMatch(/TypeError|at .*\(.*:\d+:\d+\)|node:internal/);
      }
    }, 60_000);
    it("the gate counts a server whose answer it cannot read as unknown and goes on", async () => {
      const r = await run(["gate"]);
      expect(r.out).toContain("the record's answer could not be read by this version of the command");
      expect(r.out).toContain("Gate: clear. 1 server, 1 unknown (--strict fails on these).");
      expect(r.code).toBe(0);
    }, 30_000);
  });
});

function modHome(): { home: string; cwd: string; root: string } {
  const home = mkdtempSync(join(tmpdir(), "sp-mod2-"));
  const cwd = mkdtempSync(join(tmpdir(), "sp-mod2-cwd-"));
  const root = join(home, ".claude", "plugins", "synced", "two-files");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "hooks", "lib"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "two-files" }));
  writeFileSync(join(root, "hooks", "hooks.json"), JSON.stringify({ modules: ["./first.js", "./second.js"] }));
  writeFileSync(join(root, "hooks", "first.js"), "import { helper } from './lib/helper.js';\nexport function register(on) { on('tool.describe', async ($, e, next) => next(e)) }\n");
  writeFileSync(join(root, "hooks", "second.js"), "export function register(on) { on('ui.render', async ($, e, next) => next(e)) }\n");
  writeFileSync(join(root, "hooks", "lib", "helper.js"), "export const helper = 1;\n");
  return { home, cwd, root };
}

describe("every code file of a mod is watched (fix 9)", () => {
  it("a network call added to the second module, or to a file the first imports, is a new ability and a changed file", () => {
    const { home, cwd, root } = modHome();
    expect(modModulePaths(root)).toEqual([join(root, "hooks", "first.js"), join(root, "hooks", "second.js"), join(root, "hooks", "lib", "helper.js")]);
    const before = findMods(home, cwd)[0]!;
    expect(before.capabilities).toEqual(["changes the tool descriptions Claude reads"]);
    const lockBefore = buildLock([], readInstructionFiles(home, cwd), { home, cwd });
    expect(lockBefore.files.filter((f) => f.kind === "Claude Code mod code, home")).toHaveLength(3);

    writeFileSync(join(root, "hooks", "second.js"), "export function register(on) { on('ui.render', async ($, e, next) => { await $.http.get('https://collect.example'); return next(e) }) }\n");
    const second = findMods(home, cwd)[0]!;
    expect(second.capabilities).toContain("uses the network");
    expect(second.sha256).not.toBe(before.sha256);
    expect(diffLock(lockBefore, buildLock([], readInstructionFiles(home, cwd), { home, cwd })).filesChanged.map((f) => f.path)).toEqual(["~/.claude/plugins/synced/two-files/hooks/second.js"]);

    writeFileSync(join(root, "hooks", "lib", "helper.js"), "export const helper = (x) => $.process.run('sh', ['-c', x]);\n");
    expect(findMods(home, cwd)[0]!.capabilities).toContain("runs programs");
  });
  it("never follows an import out of the plugin", () => {
    const { root } = modHome();
    const outside = mkdtempSync(join(tmpdir(), "sp-mod2-out-"));
    writeFileSync(join(outside, "evil.js"), "x");
    writeFileSync(join(root, "hooks", "second.js"), `import x from '${join("..", "..", "..", "..", "..", "..", outside, "evil.js")}';\nimport y from '../../../outside.js';\n`);
    expect(modModulePaths(root).every((p) => p.startsWith(root))).toBe(true);
  });
  it.skipIf(!existsSync(PY))("the root reporter reads the same files", () => {
    const { home } = modHome();
    const py = JSON.parse(execFileSync(PY, [HELPER, "--user", "nobody", "--label", "t", "--json", "--home", home], { encoding: "utf8" })) as { files: { path: string; kind: string; sha256: string }[] };
    const node = readInstructionFiles(home, home).map((f) => ({ path: f.path, kind: f.kind, sha256: f.sha256 }));
    expect(py.files.map(({ path, kind, sha256 }) => ({ path, kind, sha256 }))).toEqual(node);
    expect(py.files.filter((f) => f.kind === "Claude Code mod code, home")).toHaveLength(3);
  });
});

describe("one table of clients: what is listed is locked (fix 10)", () => {
  it("every place the command lists servers from is a watched file, under its client's name", () => {
    const listed = configLocations("/h", "/p").filter((l) => l.format !== "skills-dir");
    const watched = instructionLocations("/h", "/p");
    expect(listed.length).toBeGreaterThanOrEqual(18);
    for (const l of listed) {
      expect(CLIENT_NAME[l.host], `a name for ${l.host}`).toBeDefined();
      const w = watched.find((x) => x.path === l.path);
      expect(w, `${l.host} ${l.path} is listed and must be watched`).toBeDefined();
      expect(w!.kind.startsWith(CLIENT_NAME[l.host]!)).toBe(true);
      expect(w!.scope).toBe(l.scope);
      expect(w!.digest).toBe(l.format === "codex-toml" ? undefined : "mcp-json");
    }
    expect(mcpConfigLocations("/h", "/p").map((l) => l.path)).toEqual(listed.map((l) => l.path));
  });

  it("a server changed in Zed's or Gemini's settings fails the lock, and a changed editor preference does not", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-zed-"));
    const cwd = mkdtempSync(join(tmpdir(), "sp-zed-cwd-"));
    mkdirSync(join(home, ".config", "zed"), { recursive: true });
    mkdirSync(join(home, ".gemini"), { recursive: true });
    mkdirSync(join(cwd, ".zed"), { recursive: true });
    const zed = (args: string[], theme = "One Dark") => JSON.stringify({ theme, context_servers: { files: { command: "npx", args } } });
    const gemini = (env: Record<string, string>) => JSON.stringify({ theme: "x", mcpServers: { search: { command: "npx", args: ["-y", "search-mcp@1.0.0"], env } } });
    writeFileSync(join(home, ".config", "zed", "settings.json"), zed(["-y", "files-mcp@1.0.0"]));
    writeFileSync(join(cwd, ".zed", "settings.json"), zed(["-y", "files-mcp@1.0.0"]));
    writeFileSync(join(home, ".gemini", "settings.json"), gemini({ KEY: "one" }));
    const lock = () => buildLock(toUpload(discover({ home, cwd }).items), readInstructionFiles(home, cwd), { home, cwd });
    const before = lock();
    expect(before.files.map((f) => f.kind).sort()).toEqual(["Gemini MCP servers, home", "Zed MCP servers, home", "Zed MCP servers, project"]);

    writeFileSync(join(home, ".config", "zed", "settings.json"), zed(["-y", "files-mcp@1.0.0"], "Solarized"));
    expect(diffIsEmpty(diffLock(before, lock()))).toBe(true);

    writeFileSync(join(home, ".config", "zed", "settings.json"), zed(["-y", "files-mcp@1.0.0", "--evil-flag"]));
    writeFileSync(join(home, ".gemini", "settings.json"), gemini({ KEY: "two" }));
    expect(diffLock(before, lock()).filesChanged.map((f) => f.path)).toEqual(["~/.config/zed/settings.json", "~/.gemini/settings.json"]);
    expect(JSON.stringify(lock())).not.toMatch(/"one"|"two"/);
  });

  it.skipIf(!existsSync(PY))("the root reporter watches the same Zed and Gemini files with the same digests", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-zed-py-"));
    mkdirSync(join(home, ".config", "zed"), { recursive: true });
    mkdirSync(join(home, ".gemini"), { recursive: true });
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(join(home, ".windsurf"), { recursive: true });
    writeFileSync(join(home, ".config", "zed", "settings.json"), JSON.stringify({ context_servers: { files: { command: { path: "npx", args: ["-y", "files-mcp@1.0.0"] } } } }));
    writeFileSync(join(home, ".gemini", "settings.json"), JSON.stringify({ mcpServers: { s: { command: "npx", args: ["-y", "search-mcp"], env: { K: "v" } } } }));
    writeFileSync(join(home, ".codex", "config.toml"), '[mcp_servers.x]\ncommand = "npx"\n');
    writeFileSync(join(home, ".windsurf", "mcp.json"), JSON.stringify({ mcpServers: { w: { serverUrl: "https://mcp.example.com/sse" } } }));
    const py = JSON.parse(execFileSync(PY, [HELPER, "--user", "nobody", "--label", "t", "--json", "--home", home], { encoding: "utf8" })) as { files: { path: string; kind: string; sha256: string; sections?: Record<string, string> }[] };
    const node = readInstructionFiles(home, home).map((f) => ({ path: f.path, kind: f.kind, sha256: f.sha256, ...(f.sections ? { sections: f.sections } : {}) }));
    expect(py.files).toEqual(node);
    expect(node.map((f) => f.kind)).toEqual(expect.arrayContaining(["Zed MCP servers, home", "Gemini MCP servers, home", "Codex config.toml, home", "Windsurf MCP servers, project"]));
  });

  it("reads Zed's nested command form as a package, not as a local command", () => {
    const [s] = parseClaudeJson(JSON.stringify({ context_servers: { files: { command: { path: "npx", args: ["-y", "files-mcp@1.2.3"] } } } }), "zed", "/h/.config/zed/settings.json");
    expect(s).toMatchObject({ canonicalName: "npm:files-mcp", version: "1.2.3" });
  });
});

describe("a lock and a command one version apart (fix 2)", () => {
  const file = (path: string, kind: string) => ({ path, kind, sha256: "a".repeat(64) });
  const lockOf = (files: ReturnType<typeof file>[], covers?: string[]) => parseLock(JSON.stringify({ version: 1, written: "2026-10-01T00:00:00Z", scope: "project", items: [], files, ...(covers ? { covers } : {}) }));
  it("a lock from 0.1.7 does not fail on a kind of file 0.1.7 did not watch; the line says to write the lock again", () => {
    const old = lockOf([file(".mcp.json", "Claude Code MCP servers, project")]);
    const now = lockOf([file(".mcp.json", "Claude Code MCP servers, project"), file(".zed/settings.json", "Zed MCP servers, project")], mcpConfigKinds());
    const d = diffLock(old, now);
    expect(diffIsEmpty(d)).toBe(true);
    expect(formatNotCompared(d)).toEqual(["  NOT IN THIS LOCK  .zed/settings.json: the version that wrote the lock did not watch this kind of file (Zed MCP servers, project); run smallprint lock again to cover it"]);
  });
  it("a kind 0.1.7 did watch is still NEW or MISSING, and so is any other kind of file", () => {
    const old = lockOf([file(".mcp.json", "Claude Code MCP servers, project")]);
    const now = lockOf([file(".vscode/mcp.json", "VS Code MCP servers, project"), file("CLAUDE.md", "Claude Code CLAUDE.md, project")], mcpConfigKinds());
    const d = diffLock(old, now);
    expect(d.filesNew.map((f) => f.path)).toEqual([".vscode/mcp.json", "CLAUDE.md"]);
    expect(d.filesMissing.map((f) => f.path)).toEqual([".mcp.json"]);
  });
  it("a lock that lists a kind this version does not read says so and does not call the file missing", () => {
    const newer = lockOf([file(".future/mcp.json", "Future MCP servers, project")], [...mcpConfigKinds(), "Future MCP servers, project"]);
    const d = diffLock(newer, lockOf([], mcpConfigKinds()));
    expect(diffIsEmpty(d)).toBe(true);
    expect(formatNotCompared(d)[0]).toContain("NOT READ");
  });
  it("the list for 0.1.7 is what 0.1.7 watched, and every kind in it is still watched", () => {
    expect(MCP_CONFIG_KINDS_0_1_7).toHaveLength(12);
    for (const k of MCP_CONFIG_KINDS_0_1_7) expect(mcpConfigKinds()).toContain(k);
    expect(buildLock([], [], {}).covers).toEqual(mcpConfigKinds());
  });
});

describe("--help names every command and flag the command reads (fix 16)", () => {
  it("each one in the source is in the help", () => {
    const help = execFileSync(process.execPath, ["--import", TSX, MAIN, "--help"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: mkdtempSync(join(tmpdir(), "sp-help-")) } });
    const src = readFileSync(MAIN, "utf8");
    const flags = new Set([...src.matchAll(/\b(?:flag|opt)\("([a-z-]+)"\)/g)].map((m) => m[1]!));
    // set by the scheduled job for itself, never typed by a person
    for (const internal of ["scheduled", "no-jitter", "user"]) flags.delete(internal);
    expect(flags.size).toBeGreaterThan(25);
    for (const f of flags) expect(help, `--${f}`).toContain(`--${f}`);
    for (const c of ["check", "show", "lock", "gate", "sync", "schedule"]) expect(help).toMatch(new RegExp(`smallprint ${c}\\b`));
    expect(help).toContain("Five ways to keep the record");
    expect(help).not.toMatch(/\(s\)|\(ies\)/);
  }, 30_000);
});
