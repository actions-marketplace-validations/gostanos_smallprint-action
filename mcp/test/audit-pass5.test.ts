/**
 * Pass 5 of the off-site audit of 16 Oct 2026: smallprint-mcp. Each test failed before its fix.
 * - A Gemini extension re-read under one version (0.7.3, then 0.7.3+2026-10-05 to 0.7.3+2026-10-14) was answered with the
 *   read of 11 Sep as "Latest", with its content hash, because only a remote server's newer reads were looked at.
 * - The notice said everything inside the marks was written by a publisher, a registry or an advisory database, while a
 *   "+date" label is Small Print's.
 * - changes_since's input description promised every release on record; the answer lists the newest versions' releases.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, DATED_LABEL, describeApproval, describeChanges, describeEntry } from "../src/main";
import { quoter } from "../src/quote";

const v = (version: string, publishedAt: string, contentHash: string) => ({ version, publishedAt, contentHash, treeHash: null });
// the shape of /api/asset/gemini/googlecloudplatform/db-context-enrichment on 16 Oct 2026, shortened
const gemini = (over: Record<string, unknown> = {}) => ({
  asset: { canonicalName: "gemini:googlecloudplatform/db-context-enrichment", displayName: "db-context-enrichment", kind: "mcp", registry: "gemini", description: null, sourceUrl: null, repoUrl: null, maintainer: null, installCount: null, latestVersion: "0.7.3", inCatalogSince: "2026-09-11", url: "https://smallprint.dev/a/gemini/googlecloudplatform/db-context-enrichment" },
  baseline: { version: "0.7.3", publishedAt: "2026-09-11T22:25:45.378Z", read: true, contentHash: "a969", treeHash: null },
  tools: [{ name: "t" }],
  skillMd: null,
  advisories: [],
  releases: [
    { from: "0.7.3+2026-10-12", to: "0.7.3+2026-10-14", publishedAt: "2026-10-14T10:15:45.760Z", worst: "info", identical: true, summary: "identical small print", changes: [] },
    { from: "0.7.3", to: "0.7.3+2026-10-12", publishedAt: "2026-10-12T09:26:50.050Z", worst: "low", identical: false, summary: "1 description", changes: [{ field: "tool.description", subject: "t", severity: "low", severityRule: "drift.tool.description.changed", diff: "+ x" }] },
  ],
  versions: [v("0.7.3+2026-10-14", "2026-10-14T10:15:45.760Z", "b345"), v("0.7.3+2026-10-12", "2026-10-12T09:26:50.050Z", "b345"), v("0.7.3", "2026-09-11T22:25:45.378Z", "a969")],
  counts: { versions: 3, releases: 1, changedReleases: 0, versionsListed: 3 },
  readState: "tools",
  notice: "n",
  ...over,
});

let realFetch: typeof fetch;
let client: Client;
beforeEach(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(gemini()), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer().connect(a);
  client = new Client({ name: "test", version: "0" });
  await client.connect(b);
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await client.close();
});

describe("the latest read of an entry re-read under one version", () => {
  it("is the newest read, in the text and the structured result", async () => {
    const t = describeApproval(gemini() as never, "0.7.3", quoter("t"));
    expect(t).toContain("Latest ⟦0.7.3+2026-10-14⟧, content hash b345.");
    expect(t).not.toContain("content hash a969");
    expect(describeEntry(gemini() as never, quoter("t"))).toContain("The newest read on record is ⟦0.7.3+2026-10-14⟧ (2026-10-14).");
    const r = await client.callTool({ name: "changed_since_approval", arguments: { name: "gemini:googlecloudplatform/db-context-enrichment", approved: "0.7.3" } });
    expect(r.structuredContent).toMatchObject({ latestVersion: "0.7.3+2026-10-14", latestContentHash: "b345" });
  });

  it("is still the pinned version of a package whose newer version has another number", () => {
    const pkg = gemini({ versions: [v("0.8.0-beta.1", "2026-10-14T10:15:45.760Z", "beta"), v("0.7.3", "2026-09-11T22:25:45.378Z", "a969")], releases: [] });
    expect(describeApproval(pkg as never, "0.7.3", quoter("t"))).toContain("Latest ⟦0.7.3⟧, content hash a969.");
  });
});

describe("Small Print's own version labels", () => {
  it("are named as its own in the answers that print versions, the structured note, the instructions and every tool", async () => {
    expect(DATED_LABEL).toBe("A version that ends in +YYYY-MM-DD can be Small Print's own label for a version it read again on that date under the same number.");
    for (const t of [describeEntry(gemini() as never, quoter("t")), describeChanges(gemini() as never, undefined, "low", quoter("t")), describeApproval(gemini() as never, "0.7.3", quoter("t"))]) expect(t).toContain(DATED_LABEL);
    const r = await client.callTool({ name: "lookup_entry", arguments: { name: "gemini:googlecloudplatform/db-context-enrichment" } });
    expect((r.structuredContent as { quoted: string }).quoted).toContain(DATED_LABEL);
    expect(client.getInstructions()).toContain(DATED_LABEL);
    const { tools } = await client.listTools();
    for (const t of tools) expect(t.description).toContain(DATED_LABEL);
  });
});

describe("changes_since's input", () => {
  it("promises the releases the record lists, not every release on record", async () => {
    const { tools } = await client.listTools();
    const since = (tools.find((t) => t.name === "changes_since")!.inputSchema as { properties: Record<string, { description?: string }> }).properties.since!.description;
    expect(since).toContain("Omit for the releases the record lists.");
    expect(since).not.toContain("every release on record");
  });
});
