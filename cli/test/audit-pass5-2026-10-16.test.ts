/**
 * Pass 5 of the off-site audit of 16 Oct 2026: the command line. Each test failed before its fix.
 * - The gate said "no change to the small print is on record" between two versions that were never compared and whose
 *   fingerprints differ (oci:ghcr.io/verivus-oss/sqry-mcp, 32.0.1 in the lock and 33.0.1, no release on record), and
 *   closed with "Gate: clear."
 * - "no advisory" stood in the status column and the report's pill beside a line naming advisories on other versions.
 * - `show` graded a release by its install script, where the entry page grades it by its changes to the text.
 * - `show` printed a plugin's commit date as the day Small Print first saw it.
 * - The consent list before "Upload and pin?" said file contents are not sent, and left out the names of settings and
 *   servers that sync sends with their hashes; the schedule lines said "never paths or contents".
 * - The start question said "every morning"; each account picks its own time.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gateServer, type GateRecord } from "../src/gate";
import { NO_COVERING_ADVISORY } from "../src/html-report";
import { baselineDateWords } from "../src/record";
import { releaseGrade } from "../src/release";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MAIN = read("packages/cli/src/main.ts");
const README = read("packages/cli/README.md");

// the live answer for oci:ghcr.io/verivus-oss/sqry-mcp on 16 Oct 2026: two versions read, different hashes, no release
const sqry = (): GateRecord => ({
  asset: { latestVersion: "33.0.1", url: "https://smallprint.dev/a/oci/ghcr.io/verivus-oss/sqry-mcp" },
  advisories: [],
  releases: [],
  versions: [
    { version: "33.0.1", publishedAt: "2026-10-06T01:38:24.346256Z", read: true, contentHash: "51de58283f9edf95" },
    { version: "32.0.1", publishedAt: "2026-09-30T23:48:16.751304Z", read: true, contentHash: "a63204c8e927955c" },
  ],
  counts: { versions: 2 },
});

describe("the gate never says no change between versions it did not compare", () => {
  it("says not compared, and counts the server as unknown, when no release reaches a version between them", () => {
    const pinned = gateServer(sqry(), "33.0.1", { version: "32.0.1" });
    expect(pinned).toMatchObject({ mark: "?", changed: false, unknown: true });
    expect(pinned.words[0]).toBe("not compared between 32.0.1 in the lock and 33.0.1: their fingerprints differ, and the record does not compare every version in between");
    const unpinned = gateServer(sqry(), null, { version: "32.0.1" });
    expect(unpinned).toMatchObject({ mark: "?", unknown: true });
    expect(unpinned.words[0]).toContain("33.0.1, the newest on record (the config pins no version): their fingerprints differ");
    expect(JSON.stringify([pinned.words, unpinned.words])).not.toMatch(/no change|unchanged/);
  });

  it("still says no change on record when the versions were compared, or when their fingerprints are the same", () => {
    const compared = sqry();
    compared.releases = [{ from: "32.0.1", to: "33.0.1", publishedAt: "2026-10-06T01:38:24.346256Z", worst: "info", identical: false, changes: [] }];
    expect(gateServer(compared, "33.0.1", { version: "32.0.1" })).toMatchObject({ mark: "ok", unknown: false, words: ["no change to the small print is on record between 32.0.1 in the lock and 33.0.1"] });
    const same = sqry();
    same.versions[1]!.contentHash = same.versions[0]!.contentHash;
    expect(gateServer(same, "33.0.1", { version: "32.0.1" })).toMatchObject({ mark: "ok", unknown: false });
  });

  it("prints Gate: clear only when nothing is unknown", () => {
    expect(MAIN).toContain("Gate: ${plural(items.length, \"server\")} checked, ${counts.unknown} unknown. The exit code is 0, and --strict fails on unknowns.");
    expect(MAIN).toContain("`Gate: clear. ${plural(items.length, \"server\")}, 0 unknown.`");
  });
});

describe("the status of an entry with advisories on other versions", () => {
  it("is the check page's words in the column, the pill and the summary, never \"no advisory\" alone", () => {
    expect(NO_COVERING_ADVISORY).toBe("no advisory on record covers this version");
    expect(MAIN).toContain('s === "clean" ? NO_COVERING_ADVISORY : s');
    expect(MAIN).not.toContain('"no advisory" : x.status');
    expect(read("packages/cli/src/html-report.ts")).not.toMatch(/words: "no advisory"/);
  });
});

describe("show grades a release as the entry page does", () => {
  it("by its changes to the small print, not an install script beside them", () => {
    expect(releaseGrade({ worst: "high", changes: [{ field: "tool.description", severity: "medium" }, { field: "install.script", severity: "high" }] })).toBe("medium");
    // a release that only added an install script keeps that note's grade
    expect(releaseGrade({ worst: "high", changes: [{ field: "install.script", severity: "high" }] })).toBe("high");
    expect(MAIN).toContain("${releaseGrade(r) ?? \"graded\"}");
    expect(MAIN).not.toContain("${r.worst ?? \"graded\"}");
  });

  it("prints the day Small Print first saw the version, never a commit date, as first seen", () => {
    // claude-plugins:claude-community/slop-gate d52a646cfed6: commit date 2026-06-09 after the plugin-date repair, row made 2026-09-11
    expect(baselineDateWords({ publishedAt: "2026-06-09T00:00:00Z", firstSeen: true, firstSeenAt: "2026-09-11T03:00:00Z" })).toBe("first seen 2026-09-11");
    expect(baselineDateWords({ publishedAt: "2026-06-09T00:00:00Z", firstSeen: false, firstSeenAt: "2026-09-11T03:00:00Z" })).toBe("published 2026-06-09");
    expect(baselineDateWords({ publishedAt: null, firstSeen: false })).toBe("");
  });
});

describe("what sync and schedule say they send", () => {
  it("names the settings and server names with their hashes, and claims nothing as never sent", () => {
    expect(MAIN).toContain("for a JSON file the name of each top-level setting, or of each server in an MCP config, with a hash of it");
    expect(MAIN).not.toMatch(/Not sent: paths|never paths or contents|never paths, contents or config values/);
    expect(README).toContain("for a JSON file the name of each top-level part with a hash of it");
    expect(README).not.toMatch(/Paths, config values, environment variables and file contents are not sent/);
  });
});

describe("the start question and the README say no morning", () => {
  it("asks about the daily brief, and the README promises no time of day", () => {
    expect(MAIN).toContain('ask("\\nWatch these in the daily brief? Type your email to start.');
    expect(MAIN).not.toMatch(/every morning/);
    expect(README).not.toMatch(/the morning|every morning/);
    expect(read("action/README.md")).not.toMatch(/the morning/);
    expect(README).toContain("An account needs only an email address");
    expect(README).not.toMatch(/Your email is the account|signed chain row/);
    expect(README).toContain("when the record's answer lists one, fetched when the lock is written");
  });
});
