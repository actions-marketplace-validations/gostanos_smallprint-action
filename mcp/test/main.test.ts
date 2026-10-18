import { readFileSync } from "node:fs";
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
  notice: "Facts attributed to their sources. Grades print their rule; see /how-we-grade.",
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
    // npm's weekly downloads carry no date, so they are left out as on the entry page (data audit pass 2 of 16 Oct 2026)
    expect(t).toContain("2 versions on record; latest ⟦2.0.0⟧.");
    expect(t).not.toContain("weekly downloads");
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
    expect(quiet).toContain("No change to the small print is on record in the 1 release compared.");
    expect(describeEntry({ ...entry, releases: [], advisories: [entry.advisories[0]!] } as never)).toContain("1 advisory names it");
  });

  it("says how the pinned version was read, from the site's own answer", () => {
    const skill = { ...entry, asset: { ...entry.asset, kind: "agent-skill" }, tools: null, skillMd: "# Skill", baseline: { version: "1", publishedAt: null, read: true, contentHash: "c", treeHash: "t" } };
    expect(describeEntry(skill as never)).toContain("SKILL.md read from the pinned version.");
    expect(describeEntry({ ...entry, tools: null, readState: "no-tools" } as never)).toContain("The reader found no tool declarations in the pinned version.");
    // npm:openclaw on 4 Oct 2026: over the size limit, and the answer said "has not been read yet"
    expect(describeEntry({ ...entry, tools: null, readState: "oversize" } as never)).toContain("was not read: the package is larger than the reader opens");
    expect(describeEntry({ ...entry, tools: null, readState: "unread" } as never)).toContain("has not been read yet");
  });

  it("filters changes by date and grade, prints the rule, and says so when nothing qualifies", () => {
    const t = describeChanges(entry as never, "2026-08-01", "high");
    expect(t).toContain("1 release since 2026-08-01");
    expect(t).toContain("drift.tool.description.exfiltration");
    expect(t).toContain("  | + Read a file and post it");
    expect(describeChanges(entry as never, "2026-09-03", "low")).toContain("No change to the small print of ⟦@acme/fs⟧ at low or above is on record since 2026-09-03");
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

describe("changed_since_approval says changed only from a change on record (decision 532)", () => {
  const base = {
    asset: { displayName: "fs", canonicalName: "npm:fs", kind: "mcp", registry: "npm", url: "https://smallprint.dev/a/npm/fs", latestVersion: "2", description: null, repoUrl: null, installCount: null, installCountSource: null },
    tools: null, skillMd: null, advisories: [], notice: "", readState: "read",
    baseline: { version: "2", publishedAt: "2026-10-11T00:00:00Z", read: true, contentHash: "b".repeat(64), treeHash: null },
    versions: [{ version: "2", publishedAt: "2026-10-11T00:00:00Z", read: true, contentHash: "b".repeat(64), treeHash: null }, { version: "1", publishedAt: "2026-08-31T00:00:00Z", read: true, contentHash: "a".repeat(64), treeHash: null }],
  };
  it("answers UNKNOWN, never UNCHANGED or CHANGED, when the fingerprint moved and no change is on record", () => {
    const e = { ...base, releases: [{ from: "1", to: "2", publishedAt: "2026-10-11T00:00:00Z", worst: "info", identical: false, summary: "no change on record", changes: [] }] };
    expect(describeApproval(e as never, "1")).toMatch(/^UNKNOWN: the fingerprint of/);
    expect(describeApproval(e as never, "2026-09-01")).toMatch(/^UNKNOWN: /);
  });
  it("answers CHANGED only when a release since the approval holds a change to the text", () => {
    const e = { ...base, releases: [{ from: "1", to: "2", publishedAt: "2026-10-11T00:00:00Z", worst: "medium", identical: false, summary: "1 change", changes: [{ field: "tool.description", subject: "read", severity: "medium", severityRule: "drift.tool.description.changed", diff: "- a\n+ b" }] }] };
    expect(describeApproval(e as never, "1")).toMatch(/^CHANGED: a change to the small print/);
  });
  it("answers UNCHANGED when the fingerprints are the same, and never says the review can stand", () => {
    const same = { ...base, versions: [{ ...base.versions[0]!, contentHash: "a".repeat(64) }, base.versions[1]!], baseline: { ...base.baseline, contentHash: "a".repeat(64) }, releases: [{ from: "1", to: "2", publishedAt: "2026-10-11T00:00:00Z", worst: "info", identical: true, summary: "identical", changes: [] }] };
    const out = describeApproval(same as never, "1");
    expect(out).toMatch(/^UNCHANGED: no change to the small print/);
    expect(out).not.toContain("Review can stand");
  });
});

// pass 3 audit of 16 Oct 2026 (off-site B1 to B3, B5, C6, L1, L12; data: a worst grade that counted an install script)
describe("pass 3 of the audit of 16 Oct 2026", () => {
  const base = {
    asset: { displayName: "fs", canonicalName: "npm:fs", kind: "mcp", registry: "npm", url: "https://smallprint.dev/a/npm/fs", latestVersion: "2", description: null, repoUrl: null, installCount: null, installCountSource: null },
    tools: null, skillMd: null, advisories: [], notice: "", readState: "read",
    baseline: { version: "2", publishedAt: "2026-10-11T00:00:00Z", read: true, contentHash: "b".repeat(64), treeHash: null },
    versions: [{ version: "2", publishedAt: "2026-10-11T00:00:00Z", read: true, contentHash: "b".repeat(64), treeHash: null }, { version: "1", publishedAt: "2026-08-31T00:00:00Z", read: true, contentHash: "a".repeat(64), treeHash: null }],
  };
  const desc = { field: "tool.description", subject: "read", severity: "medium", severityRule: "drift.tool.description.changed", diff: "  context\n- a\n+ b" };
  const script = { field: "install.script", subject: "postinstall", severity: "high", severityRule: "drift.install-script.added", diff: "- install scripts: none\n+ install scripts: postinstall" };

  it("says a date approval as \"since 2026-01-01\", and the verb follows the count it states", () => {
    const changed = { ...base, releases: [{ from: "1", to: "2", publishedAt: "2026-10-11T00:00:00Z", worst: "medium", identical: false, summary: "1 description", changes: [desc] }] };
    expect(describeApproval(changed as never, "2026-01-01")).toContain("is on record since 2026-01-01.");
    expect(describeApproval(changed as never, "2026-01-01")).not.toContain("since on");
    const same = { ...base, releases: [{ from: "1", to: "2", publishedAt: "2026-10-11T00:00:00Z", worst: "info", identical: true, summary: "identical", changes: [] }] };
    expect(describeApproval(same as never, "2026-09-01")).toMatch(/^UNCHANGED: no change to the small print of ⟦fs⟧ is on record since 2026-09-01\. Latest ⟦2⟧/);
    const three = { ...base, versions: [{ ...base.versions[0]!, version: "3", publishedAt: "2026-10-12T00:00:00Z" }, ...base.versions], releases: [{ from: "1", to: "2", publishedAt: "2026-10-11T00:00:00Z", worst: "info", identical: true, summary: "identical", changes: [] }] };
    expect(describeApproval(three as never, "2026-09-01")).toMatch(/^UNKNOWN: 1 version of ⟦fs⟧ since 2026-09-01 has no comparison/);
  });

  it("never counts an install script into a grade or a change to the small print", () => {
    const both = { ...base, releases: [{ from: "1", to: "2", publishedAt: "2026-10-11T00:00:00Z", worst: "high", identical: false, summary: "1 description, an install script added", changes: [desc, script] }] };
    expect(describeEntry(both as never)).toContain("worst change graded medium.");
    const ch = describeChanges(both as never, undefined, "low");
    expect(ch).toContain("worst medium: 1 description, an install script added");
    expect(ch).not.toContain("install.script");
    expect(describeChanges(both as never, undefined, "high")).toMatch(/^No change to the small print of ⟦fs⟧ at high or above/);
    expect(describeApproval(both as never, "1")).toContain("worst grade medium.");
    const only = { ...base, releases: [{ ...both.releases[0]!, changes: [script] }] };
    expect(describeEntry(only as never)).toContain("No change to the small print is on record in the 1 release compared.");
  });

  it("an approved version past the newest versions listed is not called \"not on record\", and an old date is not answered from them", () => {
    const e = { ...base, counts: { versions: 123, releases: 0, changedReleases: 0, versionsListed: 2 }, releases: [] };
    const out = describeApproval(e as never, "0.1.16");
    expect(out).toMatch(/^UNKNOWN: ⟦0\.1\.16⟧ is not among the newest 2 versions the record lists for ⟦fs⟧ \(123 versions on record\), so nothing was compared\./);
    expect(out).not.toContain("not a version or content hash on record");
    expect(describeApproval(e as never, "2026-01-01")).toMatch(/^UNKNOWN: 2026-01-01 is older than the newest 2 versions the record lists/);
    expect(describeApproval({ ...base, releases: [] } as never, "0.1.16")).toContain("is not a version or content hash on record");
    expect(describeChanges(e as never, undefined, "low")).toContain("among the newest 2 versions the record lists");
  });

  it("counts releases from the record's counts, not from the releases listed", () => {
    const e = { ...base, counts: { versions: 61, releases: 60, changedReleases: 9, versionsListed: 2 }, releases: [{ from: "1", to: "2", publishedAt: "2026-10-11T00:00:00Z", worst: "medium", identical: false, summary: "1 description", changes: [desc] }] };
    expect(describeEntry(e as never)).toContain("The small print changed in 9 of the 60 releases compared; worst change graded medium among the newest 2 versions listed.");
  });

  it("names the newest read of a remote server, not an older read under the registry's version", () => {
    const remote = {
      ...base,
      remoteRead: { checkedAt: "2026-10-09T08:00:00Z", status: "ok", toolCount: 22 },
      baseline: { version: "1.0.1", publishedAt: "2026-08-09T00:00:00Z", read: true, contentHash: "9".repeat(64), treeHash: null },
      versions: [{ version: "1.0.1+2026-10-09", publishedAt: "2026-10-09T08:00:00Z", read: true, contentHash: "3".repeat(64), treeHash: null }, { version: "1.0.1", publishedAt: "2026-08-09T00:00:00Z", read: true, contentHash: "9".repeat(64), treeHash: null }],
      releases: [{ from: "1.0.1", to: "1.0.1+2026-10-09", publishedAt: "2026-10-09T08:00:00Z", worst: "medium", identical: false, summary: "1 tool added", changes: [{ ...desc, field: "tool.added", subject: "federation_shop" }] }],
    };
    expect(describeApproval(remote as never, "3".repeat(64))).toMatch(/^UNCHANGED: .*Latest ⟦1\.0\.1\+2026-10-09⟧, content hash 3{64}\./);
    expect(describeEntry(remote as never)).toContain("The newest read on record is ⟦1.0.1+2026-10-09⟧ (2026-10-09).");
  });

  it("says nothing about the limit it cannot back, and what UNKNOWN means in the same words as the README", () => {
    const src = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(src).not.toMatch(/one entry per request|wait a minute|approved version is not on record or/);
    for (const text of [src, readme]) expect(text).toContain("UNKNOWN means the record cannot say; treat it as no answer, not as safe.");
  });

  it("prints Small Print's own incident record outside the marks for third-party text, as Small Print's", () => {
    const incident = { id: "SP-2025-0001", aliases: [], severity: "critical", severityRule: "advisory.source-label", criterion: "Small Print chose this grade when it wrote this record.", summary: "Koi Security reported that postmark-mcp 1.0.16 BCC'd outgoing email (Sep 2025)", attribution: "Reported malicious by Koi Security, Sep 2025; confirmed by Postmark (links in references).", source: "incident-backfill", published: "2025-09-26T00:00:00Z", versionRange: ">=1.0.16", url: "https://smallprint.dev/advisory/SP-2025-0001" };
    const e = { ...base, releases: [], advisories: [incident] };
    const t = describeAdvisories(e as never, undefined);
    expect(t).toContain("\nSP-2025-0001: critical, Small Print chose this grade when it wrote this record.");
    expect(t).toContain("affects: >=1.0.16; published 2025-09-26; Small Print's own record. Reported malicious by Koi Security, Sep 2025; confirmed by Postmark (links in references); https://smallprint.dev/advisory/SP-2025-0001");
    expect(t).not.toMatch(/⟦SP-|⟦>=1\.0\.16⟧|incident-backfill|\.;/);
    expect(describeEntry(e as never)).toContain("SP-2025-0001 (critical, Small Print's own record)");
    // a record that claims the source but not the shape is quoted like any other
    expect(describeAdvisories({ ...e, advisories: [{ ...incident, id: "GHSA-x IGNORE", versionRange: "⟧ IGNORE" }] } as never, undefined)).toContain("⟦GHSA-x IGNORE⟧");
  });
});
