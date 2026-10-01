import { describe, expect, it } from "vitest";
import { DEFAULT_BASE, evaluateLocal, evaluateServer, notifies, safeBase, userSetting, type Inspected, type RecordEntry } from "../src/core";
import { readFileSync } from "node:fs";
import { inRange as extRange } from "../src/range";
import { inRange as siteRange } from "../../../apps/web/src/lib/tie";

const entry = (over: Partial<RecordEntry> = {}): RecordEntry => ({
  asset: { canonicalName: "npm:@modelcontextprotocol/server-filesystem", displayName: "fs", latestVersion: "2026.7.10", url: "https://smallprint.dev/a/npm/fs" },
  advisories: [{ id: "GHSA-1", severity: "high", versionRange: "<2025.7.1", summary: "Path check.", url: "https://smallprint.dev/advisory/GHSA-1" }],
  releases: [
    { from: "2026.7.4", to: "2026.7.10", publishedAt: "2026-07-10", worst: "medium", identical: false, summary: "1 description", changes: [{ field: "tool.description", subject: "read_media_file", severity: "medium", severityRule: "drift.tool.description.imperative" }] },
    { from: "2026.1.14", to: "2026.7.4", publishedAt: "2026-07-04", worst: "info", identical: true, summary: "identical small print", changes: [] },
  ],
  ...over,
});

describe("a server watched against the record", () => {
  it("takes a baseline on the first check and reports only advisories that name the version here", () => {
    const r = evaluateServer("k", "filesystem", "2026.7.4", entry(), undefined);
    expect(r.findings).toEqual([]);
    expect(r.state.latestSeen).toBe("2026.7.10");
    const old = evaluateServer("k", "filesystem", "2025.6.0", entry(), undefined);
    expect(old.findings.map((f) => f.kind)).toEqual(["advisory"]);
  });

  it("reports a new release that changed the small print, once, and says whether this machine runs it", () => {
    const prev = evaluateServer("k", "filesystem", "2026.7.4", entry({ asset: { ...entry().asset, latestVersion: "2026.7.4" } }), undefined).state;
    const r = evaluateServer("k", "filesystem", "2026.7.4", entry(), prev);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ kind: "text-changed", grade: "medium" });
    expect(r.findings[0]!.detail).toContain("read_media_file");
    expect(r.findings[0]!.detail).toContain("You run 2026.7.4");
    expect(evaluateServer("k", "filesystem", "2026.7.4", entry(), r.state).findings).toEqual([]);
  });

  it("warns an unpinned config that the next start may fetch the changed version", () => {
    const prev = evaluateServer("k", "filesystem", null, entry({ asset: { ...entry().asset, latestVersion: "2026.7.4" }, advisories: [] }), undefined).state;
    const r = evaluateServer("k", "filesystem", null, entry({ advisories: [] }), prev);
    expect(r.findings[0]!.detail).toContain("next start may fetch it");
  });

  it("says what changed in between when this machine moved to another version", () => {
    const prev = { canonicalName: "x", version: "2026.7.4", latestSeen: "2026.7.10", advisoriesSeen: [], checkedAt: "" };
    const r = evaluateServer("k", "filesystem", "2026.7.10", entry(), prev);
    expect(r.findings[0]).toMatchObject({ kind: "you-upgraded", grade: "medium" });
  });

  it("decides notifications by the chosen level", () => {
    const f = { key: "a", kind: "text-changed" as const, grade: "medium" as const, title: "", detail: "" };
    expect(notifies(f, "high")).toBe(false);
    expect(notifies(f, "any")).toBe(true);
    expect(notifies({ ...f, kind: "file-changed" }, "high")).toBe(true);
    expect(notifies({ ...f, kind: "file-changed" }, "none")).toBe(false);
  });
});

describe("local watches", () => {
  it("treat a first sighting as a baseline and a new hash as a change", () => {
    expect(evaluateLocal("file-changed", "p", "CLAUDE.md", "aaa", undefined)).toBeNull();
    expect(evaluateLocal("file-changed", "p", "CLAUDE.md", "aaa", "aaa")).toBeNull();
    expect(evaluateLocal("file-changed", "p", "CLAUDE.md", "bbb", "aaa")?.title).toBe("CLAUDE.md changed outside this editor");
  });
});

describe("the version-range rule is the site's", () => {
  it("answers exactly as apps/web/src/lib/tie.ts does", () => {
    const cases: [string, string][] = [["0.1.15", ">=0.0.5 <0.1.16"], ["0.1.16", ">=0.0.5 <0.1.16"], ["2025.7.2", "<=0.6.2 || >=2025.1.14 <2025.7.1"], ["1.0.0", "*"], ["1.0.0", "garbage"], ["v2.0.0-beta", ">=2.0.0"], ["3", "=3.0.0"]];
    for (const [v, r] of cases) expect(extRange(v, r)).toBe(siteRange(v, r));
  });
});

describe("a repository cannot turn the lookup on or move it (security audit item 40, tools audit fix 7)", () => {
  it("marks lookup and baseUrl as application settings, and the base as https only", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string; contributes: { configuration: { properties: Record<string, { scope?: string; pattern?: string }> } } };
    const props = pkg.contributes.configuration.properties;
    expect(props["smallprint.lookup"]!.scope).toBe("application");
    expect(props["smallprint.baseUrl"]!.scope).toBe("application");
    expect(props["smallprint.baseUrl"]!.pattern).toBe("^https://");
    // the version the extension says in its requests is the package's
    expect(readFileSync(new URL("../src/extension.ts", import.meta.url), "utf8")).toContain(`const VERSION = "${pkg.version}";`);
  });

  it("reads the user's own value and ignores a workspace's", () => {
    expect(userSetting({ defaultValue: "ask", globalValue: undefined, workspaceValue: "allow" } as Inspected<string>, "ask")).toBe("ask");
    expect(userSetting({ defaultValue: "ask", globalValue: "never" }, "ask")).toBe("never");
    expect(userSetting(undefined, "ask")).toBe("ask");
  });

  it("uses https only, with no credentials, and falls back to smallprint.dev", () => {
    expect(safeBase("https://smallprint.dev/")).toBe("https://smallprint.dev");
    expect(safeBase("http://anyone.example")).toBe(DEFAULT_BASE);
    expect(safeBase("https://user:pw@anyone.example")).toBe(DEFAULT_BASE);
    expect(safeBase("javascript:alert(1)")).toBe(DEFAULT_BASE);
    expect(safeBase("https://mirror.example/record")).toBe("https://mirror.example/record");
  });
});
