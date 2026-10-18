/**
 * The off-site audit of 16 Oct 2026: what the command line, its README, the plugin and the Action say. Each test failed
 * before its fix.
 * - The gate called every release that was not identical, and any fingerprint difference, a change to the small print,
 *   and exited 2: @modelcontextprotocol/server-filesystem from 2026.8.31 to 1.0.0, whose release holds no change on
 *   record and whose 14 tool descriptions are the same in both packages' own files.
 * - The gate and `show` said a version "declares no tools of its own" or that its "small print" was read when the record
 *   holds no tool text for it (the "files" state).
 * - The SARIF alerts said the small print changed, though the lock check reads no tool text.
 * - Overclaims about the command itself: every server installed, every mod file read, nothing sent until you say yes,
 *   "and nothing else", tokens never sent, one item per request, a dated decisions entry nobody can read.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gateServer, type GateRecord } from "../src/gate";
import { sarifLog } from "../src/lock";
import { readWords } from "../src/record";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MAIN = read("packages/cli/src/main.ts");
const HELP = MAIN.slice(MAIN.indexOf("const HELP = `"), MAIN.indexOf("`;", MAIN.indexOf("const HELP = `")));
const README = read("packages/cli/README.md");

// the shape of /api/asset for the filesystem server on 16 Oct 2026: the release holds no change, and the two versions'
// fingerprints differ because of a reader limit (decision 520)
const filesystem = (): GateRecord => ({
  asset: { latestVersion: "1.0.0", url: "https://smallprint.dev/a/npm/@modelcontextprotocol/server-filesystem" },
  advisories: [],
  releases: [{ from: "2026.8.31", to: "1.0.0", publishedAt: "2026-10-01", worst: "low", identical: false, changes: [] }],
  versions: [
    { version: "1.0.0", publishedAt: "2026-10-01", read: true, contentHash: "h-new" },
    { version: "2026.8.31", publishedAt: "2026-08-31", read: true, contentHash: "h-old" },
  ],
});

describe("the gate says changed only when a change to the small print is on record (decision 523)", () => {
  it("does not fail on a release with no change on record, whatever the fingerprints say", () => {
    const moved = gateServer(filesystem(), "1.0.0", { version: "2026.8.31" });
    expect(moved).toMatchObject({ mark: "ok", changed: false, unknown: false });
    expect(moved.words[0]).toBe("no change to the small print is on record between 2026.8.31 in the lock and 1.0.0");
    const pinned = gateServer(filesystem(), "2026.8.31", { version: "2026.8.31" });
    expect(pinned.words.join("; ")).not.toMatch(/changed the small print/);
    expect(JSON.stringify([moved.words, pinned.words])).not.toMatch(/\bunchanged\b|small print changed/);
  });

  it("does not count a release that holds only an install script or a version line", () => {
    const e = filesystem();
    e.releases[0]!.changes = [{ field: "install.script", severity: "high" }, { field: "version.bump", severity: "info" }];
    expect(gateServer(e, "1.0.0", { version: "2026.8.31" })).toMatchObject({ changed: false });
    e.releases[0]!.changes = [{ field: "tool.description", severity: "low" }];
    const v = gateServer(e, "1.0.0", { version: "2026.8.31" });
    expect(v).toMatchObject({ mark: "!", changed: true });
    expect(v.words[0]).toBe("a change to the small print is on record between 2026.8.31 in the lock and 1.0.0: 1 release, worst low");
    expect(gateServer(e, "2026.8.31", { version: "2026.8.31" }).words[1]).toBe("1 release after 2026.8.31 changed the small print, worst low; read the entry page before you move up");
  });

  it("says the record holds no tool text, and never that a version declares no tools", () => {
    const e = filesystem();
    e.versions[0] = { version: "1.0.0", publishedAt: "2026-10-01", read: true, contentHash: null };
    const v = gateServer(e, "1.0.0", undefined);
    expect(v).toMatchObject({ mark: "?", unknown: true });
    expect(v.words[0]).toBe("the record holds no tool text for version 1.0.0, so there is nothing to compare");
    expect(read("packages/cli/src/gate.ts")).not.toContain("declares no tools of its own");
  });

  it("the plugin's gate skill, its README, the Action's README and the command's README say the same", () => {
    // the check skill tells Claude what the gate does too, and kept the old words until pass 3 (16 Oct 2026)
    for (const p of ["packages/plugin/skills/gate/SKILL.md", "packages/plugin/skills/check/SKILL.md", "packages/plugin/README.md", "action/README.md", "packages/cli/README.md"]) {
      const text = read(p);
      expect(text, p).toMatch(/a change to [^.]*? is on record/);
      expect(text, p).not.toMatch(/gained a high advisory|small print changed between|has changed what it tells|changed what it tells an agent since/);
    }
    expect(read("packages/plugin/skills/gate/SKILL.md")).not.toMatch(/nothing changed/);
    // the gate asks only about servers with a registry name, and compares with the pinned version (pass 5 audit of 16 Oct 2026)
    expect(HELP).toContain("ask the record about each server here that has a registry name");
    expect(HELP).toContain("2 when a change to the small print is on record between the lock and the pinned version (the newest on record when none is pinned)");
    expect(HELP).not.toMatch(/every server here|what runs here/);
  });
});

describe("show says what the record holds for a version whose files alone were fingerprinted", () => {
  it("names no read of small print the record does not hold", () => {
    const files = (kind: string) => ({ asset: { kind }, readState: "files", baseline: { version: "0.15.1", read: true, contentHash: null }, tools: null, skillMd: null });
    expect(readWords(files("mcp"))).toBe("files fingerprinted, no tool text on record");
    expect(readWords(files("agent-plugin"))).toBe("files fingerprinted, no instruction text on record");
  });
});

describe("the SARIF alerts say what differs from the lock", () => {
  it("never that the small print changed", () => {
    const log = JSON.stringify(sarifLog(["  CHANGED  server x: version 1.0.0 -> 1.1.0"], "smallprint.lock", "0.0.0"));
    expect(log).toContain("This is not what smallprint.lock holds. If the change is yours, run smallprint lock again and commit it.");
    expect(log).not.toMatch(/small print/i);
  });
});

describe("the command claims no more than it does", () => {
  it("the help and the HTML report do not say every server installed", () => {
    expect(HELP).not.toMatch(/every MCP server and skill your agents have installed/i);
    expect(HELP).toContain("find the MCP servers and skills in the agent configs it reads");
    expect(read("packages/cli/src/html-report.ts")).not.toMatch(/Every MCP server and skill your agent apps have installed|sent only server names|catalog yet/);
  });

  it("a name not in the catalog gets no promise of a page", () => {
    expect(MAIN).toContain("console.log(`${spec}: not in the catalog.`)");
    expect(MAIN).not.toContain("next catalog pass");
  });

  it("says less about what is sent, and leaves the full list to the privacy page", () => {
    expect((JSON.parse(read("packages/cli/package.json")) as { description: string }).description).not.toMatch(/Nothing is sent/);
    expect(MAIN).not.toContain("for each file and each skill, and nothing else");
    expect(MAIN).not.toMatch(/Not sent:[^"`]*\btokens\b/);
    expect(README).not.toContain("carrying the registry name and nothing else");
  });

  it("the README promises no fact links, no every-file read, no one item per request and no decisions entry", () => {
    expect(README).not.toContain("with every fact linked to an official source");
    expect(README).not.toContain("Every code file a mod names");
    expect(README).toContain("are read, up to a limit");
    expect(README).not.toContain("One item per request");
    for (const p of ["packages/cli/README.md", "packages/mcp/README.md"]) expect(read(p), p).not.toContain("dated entry in the record's decisions");
  });
});
