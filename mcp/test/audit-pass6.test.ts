/**
 * Pass 6 of the audits of 16 Oct 2026: smallprint-mcp, and `show`'s copy of record.ts. Each test failed before its fix.
 * - npm's security holding package (@yongot/canary-mcp-test) was "kind mcp, listed on npm"; the entry page calls it a
 *   security holding package, and the read API now sends that word (asset.kindChip).
 * - An entry its source no longer serves was "not read yet" and "compared ... yet"; the entry page drops "yet" for it.
 * - Tools read from a repository's default branch were "read from version 1.7.4" (gograph); the read API says readFrom.
 * - The listing's text was labelled "Registry description:"; the entry page's label is "Its listing says:".
 * - changes_since said "Each grade prints its rule" over release lines that print none.
 * - changed_since_approval answered UNCHANGED for two equal content hashes, which since reader revision 6 do not mean the
 *   same small print when an input form carries a not-followed mark; a release between them is then not identical.
 */
import { describe, expect, it } from "vitest";
import { describeApproval, describeChanges, describeEntry } from "../src/main";
import { readWords } from "../src/record";
import { readWords as showReadWords } from "../../cli/src/record";
import { quoter } from "../src/quote";

const v = (version: string, publishedAt: string, contentHash: string | null, read = !!contentHash) => ({ version, publishedAt, read, contentHash, treeHash: null });
const entry = (over: Record<string, unknown> = {}, asset: Record<string, unknown> = {}) =>
  ({
    asset: { canonicalName: "npm:x", displayName: "x", kind: "mcp", registry: "npm", description: null, sourceUrl: null, repoUrl: null, maintainer: null, installCount: null, latestVersion: "1.0.0", inCatalogSince: "2026-09-11", url: "https://smallprint.dev/a/npm/x", ...asset },
    baseline: { version: "1.0.0", publishedAt: "2026-09-11T00:00:00Z", read: false, contentHash: null, treeHash: null },
    tools: null,
    skillMd: null,
    advisories: [],
    releases: [],
    versions: [v("1.0.0", "2026-09-11T00:00:00Z", null)],
    counts: { versions: 1, releases: 0, changedReleases: 0, versionsListed: 1 },
    readState: "unread",
    notice: "n",
    ...over,
  }) as unknown as Parameters<typeof describeEntry>[0];

describe("what an entry is, and whether a read can still come", () => {
  it("calls npm's security holding package by the entry page's word, and falls back to the filed kind for an older site", () => {
    const holding = entry({}, { canonicalName: "npm:@yongot/canary-mcp-test", displayName: "@yongot/canary-mcp-test", kindChip: "package", kindWord: "security holding package", maintainer: "npm-support", description: "security holding package", latestVersion: "0.0.1-security" });
    expect(describeEntry(holding, quoter())).toContain("kind package, listed on npm.");
    expect(describeEntry(holding, quoter())).not.toContain("kind mcp");
    expect(describeEntry(entry(), quoter())).toContain("kind mcp, listed on npm.");
  });

  it("drops 'yet' for an entry its source no longer serves, in smallprint-mcp and in show", () => {
    const gone = entry({}, { goneAt: "2026-10-10T03:00:00Z" });
    const text = describeEntry(gone, quoter());
    expect(text).toContain("The pinned version's small print has not been read.");
    expect(text).toContain("No release has been compared with the one before it.");
    expect(text).not.toContain(" yet");
    expect(readWords(gone)).toBe("small print not read");
    expect(showReadWords(gone)).toBe("small print not read");
    // an entry still served keeps "yet"
    expect(describeEntry(entry(), quoter())).toContain("The pinned version's small print has not been read yet.");
    expect(readWords(entry())).toBe("small print not read yet");
  });
});

describe("where the text came from, and what the listing says", () => {
  it("says a repository read came from the default branch, not from the release it is filed under", () => {
    const gograph = entry(
      { baseline: { version: "1.7.4", publishedAt: "2026-09-11T00:00:00Z", read: true, contentHash: "h", treeHash: null, readFrom: { repo: "ozgurcd/gograph", readOn: "2026-10-12", release: "1.7.4" } }, tools: [{ name: "find" }, { name: "ls" }], readState: "tools", versions: [v("1.7.4", "2026-09-11T00:00:00Z", "h")] },
      { canonicalName: "mcpb:gograph", displayName: "gograph", registry: "mcpb", latestVersion: "1.7.4", description: "A graph of your Go code." },
    );
    const q = quoter();
    const text = describeEntry(gograph, q);
    expect(text).toContain(`2 tools read from the repository's default branch on 2026-10-12, not from the ${q.inline("1.7.4")} release:`);
    expect(text).not.toMatch(/read from version/);
    expect(text).toContain("Its listing says:\n");
    expect(text).not.toContain("Registry description");
  });

  it("claims no rule beside a release's worst grade", () => {
    const e = entry({
      releases: [{ from: "0.9.0", to: "1.0.0", publishedAt: "2026-09-11T00:00:00Z", worst: "medium", identical: false, summary: "1 description", changes: [{ field: "tool.description", subject: "t", severity: "medium", severityRule: "drift.tool.description.changed", diff: "+ x" }] }],
    });
    const text = describeChanges(e, undefined, "low", quoter());
    expect(text).not.toContain("Each grade prints its rule");
    expect(text).toContain("The rules are at https://smallprint.dev/how-we-grade.");
  });
});

describe("an equal fingerprint is UNCHANGED only when every release between is identical on record", () => {
  const HASH = "a".repeat(64);
  const marked = () =>
    entry({
      baseline: { version: "0.2.0", publishedAt: "2026-10-02T00:00:00Z", read: true, contentHash: HASH, treeHash: null },
      tools: [{ name: "t" }],
      readState: "tools",
      // the release between two versions with one hash is not identical: a form on one side carries a not-followed mark
      releases: [{ from: "0.1.0", to: "0.2.0", publishedAt: "2026-10-02T00:00:00Z", worst: "info", identical: false, summary: "no change on record", changes: [] }],
      versions: [v("0.2.0", "2026-10-02T00:00:00Z", HASH), v("0.1.0", "2026-10-01T00:00:00Z", HASH)],
      counts: { versions: 2, releases: 1, changedReleases: 0, versionsListed: 2 },
    }, { latestVersion: "0.2.0" });

  it("answers UNKNOWN, in words that do not say the fingerprints differ", () => {
    const byVersion = describeApproval(marked(), "0.1.0", quoter());
    expect(byVersion.startsWith("UNKNOWN: ")).toBe(true);
    expect(byVersion).toContain("has the same fingerprint as version");
    expect(byVersion).not.toContain("differs");
    // a hash shared by the latest and an earlier version is read from the first version listed with it
    expect(describeApproval(marked(), HASH, quoter()).startsWith("UNKNOWN: ")).toBe(true);
  });

  it("still answers UNCHANGED when the release between is identical, and for the latest version itself", () => {
    const same = marked();
    (same as unknown as { releases: { identical: boolean }[] }).releases[0]!.identical = true;
    expect(describeApproval(same, "0.1.0", quoter()).startsWith("UNCHANGED: ")).toBe(true);
    expect(describeApproval(marked(), "0.2.0", quoter()).startsWith("UNCHANGED: ")).toBe(true);
  });
});
