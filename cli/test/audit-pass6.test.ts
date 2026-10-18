/**
 * Pass 6 of the audits of 16 Oct 2026, the command. Each test failed before its fix.
 * - `show` printed "(mcp on npm)" for npm's security holding package; the entry page and the read API's kindChip say package.
 * - The level-four reporter's install message and the README said it sends "a kind label and hashes"; it also sends the
 *   names of skills, of a JSON file's top-level settings and of the servers in an MCP config, as sync does.
 * - The gate's comparison of two versions is one function the editor extensions read too (betweenVersions).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { betweenVersions, gateServer, type GateRecord } from "../src/gate";
import { kindOf } from "../src/record";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("show and the level-four reporter", () => {
  it("names what an entry is by the entry page's word, falling back to the filed kind", () => {
    expect(kindOf({ asset: { kind: "mcp", kindChip: "package" } })).toBe("package");
    expect(kindOf({ asset: { kind: "mcp" } })).toBe("mcp");
    expect(src("../src/main.ts")).toContain("(${kindOf(j) ?? j.asset.kind} on ${j.asset.registry})");
  });

  it("says the reporter sends what sync sends, and points to the privacy page for the list", () => {
    const main = src("../src/main.ts");
    expect(main).toContain("and reports them in the same form as a sync.");
    expect(main).toContain("What each command sends, and when, is listed on the privacy page: https://smallprint.dev/legal/privacy. Remove with: sudo smallprint schedule --uninstall --system");
    expect(main).not.toContain("sends a kind label and hashes for each file and each skill");
    const readme = src("../README.md");
    expect(readme).toContain("It reports the account's instruction files and skills in the same form as `sync`;");
    expect(readme).not.toContain("as a kind label and hashes;");
  });
});

describe("betweenVersions", () => {
  const rec = (over: Partial<GateRecord> = {}): GateRecord => ({
    asset: { latestVersion: "0.4.1", url: "u" },
    advisories: [],
    releases: [{ from: "0.3.3", to: "0.4.1", publishedAt: "2026-09-17T16:50:05Z", worst: "medium", identical: false, changes: [{ field: "tool.description", severity: "medium" }] }],
    versions: [
      { version: "0.4.1", publishedAt: "2026-09-17T16:50:05Z", read: true, contentHash: "h2" },
      { version: "0.4.0", publishedAt: "2026-09-17T16:49:07Z", read: false, contentHash: null },
      { version: "0.3.3", publishedAt: "2026-09-10T00:00:00Z", read: true, contentHash: "h1" },
    ],
    ...over,
  });

  it("gives a version with no tool text as such, a release between two read versions as a change, and the gate agrees", () => {
    expect(betweenVersions(rec(), "0.4.0", "0.4.1")).toEqual({ state: "no-text", version: "0.4.0", why: "version 0.4.0 is on the record but its small print was not read" });
    expect(betweenVersions(rec(), "0.3.3", "0.4.1")).toMatchObject({ state: "changed", worst: "medium" });
    expect(gateServer(rec(), "0.4.1", { version: "0.4.0" }).words[0]).toBe("the lock holds 0.4.0: version 0.4.0 is on the record but its small print was not read, so it cannot be compared with 0.4.1");
    // two read versions with different fingerprints and a read version no release reaches were not compared
    const gap = rec({ releases: [], versions: [{ version: "2.1.0", publishedAt: "2026-09-01", read: true, contentHash: "b" }, { version: "1.1.0", publishedAt: "2026-08-01", read: true, contentHash: "a" }] });
    expect(betweenVersions(gap, "1.1.0", "2.1.0")).toEqual({ state: "not-compared" });
    expect(betweenVersions({ ...gap, versions: gap.versions.map((x) => ({ ...x, contentHash: "a" })) }, "1.1.0", "2.1.0")).toEqual({ state: "no-change" });
  });
});
