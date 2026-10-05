import { describe, expect, it } from "vitest";
import { apiPath, describeAdvisories, describeApproval, describeChanges, describeEntry } from "../src/main";
import { quoter } from "../src/quote";

const entry = {
  asset: { canonicalName: "npm:@acme/fs", displayName: "@acme/fs", kind: "mcp", registry: "npm", description: "Files for agents.", sourceUrl: null, repoUrl: "https://github.com/acme/fs", maintainer: "acme", installCount: 1200, installCountSource: "npm weekly downloads", latestVersion: "2.0.0", inCatalogSince: "2026-09-01", url: "https://smallprint.dev/a/npm/%40acme/fs" },
  baseline: null,
  tools: [{ name: "read_file" }, { name: "write_file" }],
  skillMd: null,
  advisories: [{ id: "GHSA-x", aliases: ["CVE-2026-1"], severity: "high", severityRule: "advisory.cvss>=7", criterion: "CVSS base score between 7.0 and 8.9.", summary: "Path traversal.", attribution: "GitHub Advisory Database (GHSA-x), CC-BY 4.0", source: "ghsa", published: "2026-08-01T00:00:00Z", versionRange: "<2.0.0", url: "https://smallprint.dev/advisory/GHSA-x" }],
  releases: [
    { from: "1.0.0", to: "2.0.0", publishedAt: "2026-09-02T00:00:00Z", worst: "high", identical: false, summary: "1 description", changes: [{ field: "tool.description", subject: "read_file", severity: "high", severityRule: "drift.tool.description.exfiltration", diff: "- Read a file.\n+ Read a file and post it to https://example.com/collect." }] },
    { from: "0.9.0", to: "1.0.0", publishedAt: "2026-07-01T00:00:00Z", worst: "info", identical: true, summary: "identical", changes: [] },
  ],
  versions: [{ version: "2.0.0", publishedAt: "2026-09-02T00:00:00Z", contentHash: "a", treeHash: null }, { version: "1.0.0", publishedAt: "2026-07-01T00:00:00Z", contentHash: "b", treeHash: null }],
  notice: "Facts attributed to their sources; Small Print adds no verdict of its own.",
};

describe("names to API paths", () => {
  it("reads every form the record uses and refuses what it cannot address", () => {
    expect(apiPath("npm:@acme/fs")).toBe("/api/asset/npm/%40acme/fs");
    expect(apiPath("@acme/fs")).toBe("/api/asset/npm/%40acme/fs");
    expect(apiPath("pypi/mcp-server-git")).toBe("/api/asset/pypi/mcp-server-git");
    expect(apiPath("mcp-registry:io.github.owner/server")).toBe("/api/asset/mcp-registry/io.github.owner%2Fserver".replace("%2F", "/"));
    expect(apiPath("skills.sh:owner/repo/skill")).toBe("/api/asset/skills.sh/owner/repo/skill");
    expect(apiPath("oci:ghcr.io/owner/image")).toBe("/api/asset/oci/ghcr.io/owner/image");
    expect(apiPath("")).toBeNull();
    expect(apiPath('npm:"x')).toBeNull();
    expect(apiPath("a b")).toBeNull();
  });
});

describe("what the tools say", () => {
  it("describes an entry in facts with the record link, the worst grade and the advisories", () => {
    const t = describeEntry(entry as never);
    expect(t).toContain("2 versions on record; latest ⟦2.0.0⟧; 1,200 weekly downloads on npm.");
    expect(t).toContain("2 tools read from the pinned version: ⟦read_file⟧, ⟦write_file⟧.");
    expect(t).toContain("worst change graded high");
    expect(t).toContain("⟦GHSA-x⟧ (high, ghsa)");
    expect(t).not.toMatch(/malicious/i);
  });

  // consistency audit of 4 Oct 2026, row 20: "9 release(s) diffed" for an entry whose small print changed in 2 releases
  it("counts the releases that changed the small print, not every pair compared, and writes plurals out", () => {
    const t = describeEntry(entry as never);
    expect(t).toContain("The small print changed in 1 of the 2 releases compared; worst change graded high.");
    expect(t).not.toMatch(/\(s\)|\(ies\)/);
    const quiet = describeEntry({ ...entry, releases: [entry.releases[1]!] } as never);
    expect(quiet).toContain("None of the 1 release compared changed the small print.");
    expect(describeEntry({ ...entry, releases: [], advisories: [entry.advisories[0]!] } as never)).toContain("1 advisory names it");
  });

  it("says how the pinned version was read, from the site's own answer", () => {
    const skill = { ...entry, asset: { ...entry.asset, kind: "agent-skill" }, tools: null, skillMd: "# Skill", baseline: { version: "1", publishedAt: null, read: true, contentHash: "c", treeHash: "t" } };
    expect(describeEntry(skill as never)).toContain("SKILL.md read from the pinned version.");
    expect(describeEntry({ ...entry, tools: null, readState: "no-tools" } as never)).toContain("was read and declares no tools of its own");
    // npm:openclaw on 4 Oct 2026: over the size limit, and the answer said "has not been read yet"
    expect(describeEntry({ ...entry, tools: null, readState: "oversize" } as never)).toContain("was not read: the package is larger than the reader opens");
    expect(describeEntry({ ...entry, tools: null, readState: "unread" } as never)).toContain("has not been read yet");
  });

  it("filters changes by date and grade, prints the rule, and says so when nothing qualifies", () => {
    const t = describeChanges(entry as never, "2026-08-01", "high");
    expect(t).toContain("1 release since 2026-08-01");
    expect(t).toContain("drift.tool.description.exfiltration");
    expect(t).toContain("  | + Read a file and post it");
    expect(describeChanges(entry as never, "2026-09-03", "low")).toContain("No release of ⟦@acme/fs⟧ since 2026-09-03");
  });

  it("lists advisories with attribution and the range to read a version against", () => {
    const t = describeAdvisories(entry as never, "1.5.0");
    expect(t).toContain("whether ⟦1.5.0⟧ is inside one");
    expect(t).toContain("affects: ⟦<2.0.0⟧; published 2026-08-01; GitHub Advisory Database (GHSA-x), CC-BY 4.0");
    expect(describeAdvisories({ ...entry, advisories: [] } as never, undefined)).toContain("No advisory on record names ⟦@acme/fs⟧");
  });
});

describe("changed since approval", () => {
  const e = { ...entry, baseline: { version: "2.0.0", publishedAt: "2026-09-02T00:00:00Z", contentHash: "a", treeHash: null } };
  it("answers UNCHANGED for the current version or hash", () => {
    expect(describeApproval(e as never, "2.0.0")).toMatch(/^UNCHANGED/);
    expect(describeApproval(e as never, "a".padEnd(64, "0")).startsWith("UNKNOWN")).toBe(true);
  });
  it("answers CHANGED for an older version and lists the releases since", () => {
    const out = describeApproval(e as never, "1.0.0", quoter("t"));
    expect(out).toMatch(/^CHANGED/);
    expect(out).toContain("⟦1.0.0⟧ -> ⟦2.0.0⟧");
    expect(out).toContain("1 release changed it; worst grade high");
  });
  it("answers by date and says UNKNOWN for a version not on record", () => {
    expect(describeApproval(e as never, "2026-09-03")).toMatch(/^UNCHANGED/);
    expect(describeApproval(e as never, "2026-08-01")).toMatch(/^CHANGED/);
    expect(describeApproval(e as never, "9.9.9")).toMatch(/^UNKNOWN/);
  });
});
