/**
 * Pass 4 of the off-site audit of 16 Oct 2026: smallprint-mcp. Each test failed before its fix.
 * - The structured results and the quoting rule credited Small Print's own incident record (SP-2025-0001) to third parties.
 * - "The small print of this entry has not been read yet." when only the pinned version was not read.
 * - Five registries named the way their page addresses are ("github-plugin/owner/repo") were looked up as npm names.
 * - lookup_entry's worstGrade came from the newest 50 versions while releasesChanged counted the whole entry.
 * - "1 installs on ClawHub".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { apiPath, buildServer, describeEntry } from "../src/main";
import { quoter } from "../src/quote";

const incident = { id: "SP-2025-0001", aliases: [], severity: "critical", severityRule: "advisory.source-label", criterion: "Small Print chose this grade when it wrote this record.", summary: "Small Print's summary.", attribution: null, source: "incident-backfill", published: "2025-09-26T00:00:00Z", versionRange: ">=1.0.16", url: "https://smallprint.dev/advisory/SP-2025-0001" };
const ghsa = { id: "GHSA-x", aliases: [], severity: "high", severityRule: "advisory.cvss>=7", criterion: "c", summary: "s", attribution: null, source: "ghsa", published: "2026-08-01T00:00:00Z", versionRange: "<2.0.0", url: "https://smallprint.dev/advisory/GHSA-x" };
const entry = (over: Record<string, unknown> = {}) => ({
  asset: { canonicalName: "npm:postmark-mcp", displayName: "postmark-mcp", kind: "mcp", registry: "npm", description: null, sourceUrl: null, repoUrl: null, maintainer: null, installCount: 1, installCountSource: "clawhub installs", latestVersion: "1.0.16", inCatalogSince: "2026-09-01", url: "https://smallprint.dev/a/npm/postmark-mcp" },
  baseline: { version: "1.0.16", publishedAt: "2025-09-15T00:00:00Z", read: false, contentHash: null, treeHash: null },
  tools: null,
  skillMd: null,
  advisories: [incident, ghsa],
  releases: [{ from: "1.0.15", to: "1.0.16", publishedAt: "2025-09-15T00:00:00Z", worst: "high", identical: false, summary: "an install script added", changes: [{ field: "install.script", subject: "postinstall", severity: "high", severityRule: "drift.install-script.added", diff: "+ postinstall" }] }],
  versions: [{ version: "1.0.16", publishedAt: "2025-09-15T00:00:00Z", contentHash: null, treeHash: null }, { version: "1.0.15", publishedAt: "2025-09-01T00:00:00Z", contentHash: "a", treeHash: null }],
  counts: { versions: 60, releases: 40, changedReleases: 3, versionsListed: 2 },
  worstChange: "medium",
  notice: "n",
  ...over,
});

let realFetch: typeof fetch;
let client: Client;
let served: unknown = entry();
beforeEach(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(served), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer().connect(a);
  client = new Client({ name: "test", version: "0" });
  await client.connect(b);
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  served = entry();
  await client.close();
});

describe("Small Print's own records are said to be its own", () => {
  it("marks an incident-backfill advisory as own in the structured result, and the note and the rule say so", async () => {
    const r = await client.callTool({ name: "advisories_for", arguments: { name: "npm:postmark-mcp" } });
    const s = r.structuredContent as { advisories: { id: string; own?: boolean }[]; quoted: string };
    expect(s.advisories.find((a) => a.id === "SP-2025-0001")?.own).toBe(true);
    expect(s.advisories.find((a) => a.id === "GHSA-x")).not.toHaveProperty("own");
    expect(s.quoted).toContain("except the id and versionRange of an advisory marked own, which is Small Print's own record");
    const { tools } = await client.listTools();
    for (const t of tools) expect(t.description).toContain("The exception is Small Print's own incident records (source incident-backfill)");
    expect(client.getInstructions()).toContain("The exception is Small Print's own incident records (source incident-backfill)");
  });
});

describe("lookup_entry", () => {
  it("says the pinned version was not read, never that the entry was not", () => {
    const t = describeEntry(entry() as never, quoter("t"));
    expect(t).toContain("The pinned version's small print has not been read yet.");
    expect(t).not.toContain("The small print of this entry has not been read yet.");
  });

  it("gives the whole entry's worst grade beside the whole entry's count, in the text and the structured result", async () => {
    const t = describeEntry(entry() as never, quoter("t"));
    expect(t).toContain("The small print changed in 3 of the 40 releases compared; worst change graded medium.");
    const r = await client.callTool({ name: "lookup_entry", arguments: { name: "npm:postmark-mcp" } });
    expect(r.structuredContent).toMatchObject({ releasesChanged: 3, worstGrade: "medium" });
    // an answer from a site without the field keeps the old reading, with its window said in the text
    served = entry({ worstChange: undefined });
    const old = await client.callTool({ name: "lookup_entry", arguments: { name: "npm:postmark-mcp" } });
    expect((old.structuredContent as { worstGrade: string }).worstGrade).toBe("info");
  });

  it("says a count of one in the singular", () => {
    expect(describeEntry(entry() as never, quoter("t"))).toContain("; 1 install on ClawHub.");
    expect(describeEntry(entry({ asset: { ...entry().asset, installCount: 2, installCountSource: "github stars" } }) as never, quoter("t"))).toContain("; 2 GitHub stars.");
    expect(describeEntry(entry({ asset: { ...entry().asset, installCount: 1, installCountSource: "github stars" } }) as never, quoter("t"))).toContain("; 1 GitHub star.");
  });
});

describe("names to API paths", () => {
  it("reads the five registries named the way their page addresses are", () => {
    expect(apiPath("github-plugin/LEE-ok/receipts")).toBe("/api/asset/github-plugin/LEE-ok/receipts");
    expect(apiPath("github-mcp/owner/repo")).toBe("/api/asset/github-mcp/owner/repo");
    expect(apiPath("smithery-skills/owner/skill")).toBe("/api/asset/smithery-skills/owner/skill");
    expect(apiPath("copilot-plugins/owner/plugin")).toBe("/api/asset/copilot-plugins/owner/plugin");
    expect(apiPath("codex-plugins/owner/plugin")).toBe("/api/asset/codex-plugins/owner/plugin");
  });
});
