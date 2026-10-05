/**
 * The range rule against every distinct range on record (fixtures/advisory-ranges.json: advisory_assets.version_range
 * read from the live database on 4 Oct 2026, 1,233 distinct values over 5,156 links). Until then a comma list of exact
 * versions, the shape malware reports use, could not be read, and a prerelease was treated as its release.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareVersions, inRange } from "../src/range";
import { inRange as siteRange } from "../../../apps/web/src/lib/tie";

const RANGES = JSON.parse(readFileSync(new URL("./fixtures/advisory-ranges.json", import.meta.url), "utf8")) as string[];

describe("every shape of range on record", () => {
  it("reads a comma list of exact versions as any of them", () => {
    expect(inRange("0.0.1", "0.0.0, 0.0.1")).toBe(true);
    expect(inRange("0.0.2", "0.0.0, 0.0.1")).toBe(false);
    expect(inRange("0.4", "0.1, 0.2, 0.3, 0.4.0")).toBe(true);
    expect(inRange("3.7.0-rc-37", "3.7.2, 3.7.0-rc-37, 1.0.0, 3.7.1")).toBe(true);
    expect(inRange("3.7.0", "3.7.2, 3.7.0-rc-37, 1.0.0, 3.7.1")).toBe(false);
    expect(inRange("1.2.dev1", "0.0.0, 1.2.dev1, 1.2.dev2")).toBe(true);
    expect(inRange("0.0.1-security", "0.0.1-security, 1.0.0")).toBe(true);
  });

  it("reads GitHub's comma form, where the comma joins two bounds, and an operator set apart from its version", () => {
    expect(inRange("0.13.5", ">= 0.13.2, < 0.14.0")).toBe(true);
    expect(inRange("0.14.0", ">= 0.13.2, < 0.14.0")).toBe(false);
    expect(inRange("0.5.0", ">= 0.2.116 < 1.0.24")).toBe(true);
    expect(inRange("0.1.2", "<= 0.1.2")).toBe(true);
    expect(inRange("0.3.0", "= 0.3.0")).toBe(true);
    expect(inRange("0.8.3-rc1", ">= v0.8.2-rc1, <= v0.8.3-rc1")).toBe(true);
    expect(inRange("0.8.3", ">= v0.8.2-rc1, <= v0.8.3-rc1")).toBe(false);
  });

  it("orders a prerelease before its release and a post release after it", () => {
    expect(inRange("1.2.3-beta.1", "<1.2.3")).toBe(true);
    expect(inRange("2.0.0-beta.16", ">=2.0.0-beta.1 <2.0.0-beta.17 || >=1.0.0 <1.0.2")).toBe(true);
    expect(inRange("2.0.0-beta.17", ">=2.0.0-beta.1 <2.0.0-beta.17 || >=1.0.0 <1.0.2")).toBe(false);
    expect(inRange("2.0.0", ">=2.0.0-beta.1 <2.0.0-beta.17 || >=1.0.0 <1.0.2")).toBe(false);
    expect(inRange("2026.2.22-2", ">=2026.2.22-2 <2026.2.23")).toBe(true);
    expect(inRange("2026.2.22-1", ">=2026.2.22-2 <2026.2.23")).toBe(false);
    expect(inRange("0.218.2-pre", "<0.218.2-pre")).toBe(false);
    expect(inRange("0.218.1", "<0.218.2-pre")).toBe(true);
    expect(inRange("2.10.2", "<= 2.10.2-lts")).toBe(false);
    expect(compareVersions("1.0rc1", "1.0")).toBe(-1);
    expect(compareVersions("1.0.dev3", "1.0a1")).toBe(-1);
    expect(compareVersions("1.0.post1", "1.0")).toBe(1);
    expect(compareVersions("1.0.0+build.5", "1.0.0")).toBe(0);
    expect(compareVersions("v2.0", "2.0.0")).toBe(0);
  });

  it("reads the shapes it always read the same way", () => {
    const cases: [string, string, boolean | null][] = [["0.1.15", ">=0.0.5 <0.1.16", true], ["0.1.16", ">=0.0.5 <0.1.16", false], ["2025.7.2", "<=0.6.2 || >=2025.1.14 <2025.7.1", false], ["2025.3.0", "<=0.6.2 || >=2025.1.14 <2025.7.1", true], ["1.0.0", "*", true], ["1.0.0", "<=*", true], ["1.0.0", ">=2.0.9 || *", true], ["3", "=3.0.0", true], ["0.8.11", "0.8.11", true], ["1.0.1", ">=1.0.0 <=1.0.0", false], ["2025.7.0", "<0.6.4 || <2025.7.01", true]];
    for (const [v, r, want] of cases) expect([v, r, inRange(v, r)]).toEqual([v, r, want]);
  });

  it("answers null, never a guess, for a range that names a commit or a package, and for a version it cannot read", () => {
    expect(inRange("1.0.0", "<7f19b52280f414f57af2b79a95333d1c8fbeece5")).toBeNull();
    expect(inRange("1.0.0", "<84567b74e3c72e42d5e50ee07c56864613f519c2")).toBeNull();
    expect(inRange("1.0.0", "openclaw 2026.2.17")).toBeNull();
    expect(inRange("1.0.0", "@aborruso/ckan-mcp-server")).toBeNull();
    expect(inRange("1.0.0", "garbage")).toBeNull();
    expect(inRange("latest", ">=1.0.0")).toBeNull();
    // one alternative names commits, the other versions: the readable one still answers
    expect(inRange("0.9.0", ">=0.8.0 <1.0.0 || >=c94f0b17fbe252f68755ba512678586164ba6139 <28af68d73134df0b8fb3aa6ab03e8fd795b07c21")).toBe(true);
  });

  it("reads every range on record except the eleven that name a commit or a package", () => {
    const unreadable = RANGES.filter((r) => inRange("0", r) === null);
    expect(RANGES.length).toBeGreaterThan(1200);
    expect(unreadable.every((r) => /^<?[0-9a-f]{40}$/.test(r) || r === "openclaw 2026.2.17" || r === "@aborruso/ckan-mcp-server")).toBe(true);
    expect(unreadable).toHaveLength(11);
  });

  it("finds each version of every exact-version list inside its own range", () => {
    const lists = RANGES.filter((r) => r.includes(",") && !/[<>=]/.test(r));
    expect(lists.length).toBeGreaterThan(150);
    for (const r of lists) for (const v of r.split(",").map((x) => x.trim())) expect([r, v, inRange(v, r)]).toEqual([r, v, true]);
  });
});

describe("one implementation", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (f === "node_modules" || f === "dist" || f.startsWith(".")) return [];
      return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });

  it("is the only definition of inRange in the command, the extension, the MCP server and the site", () => {
    const defining = ["packages/cli/src", "packages/vscode/src", "packages/mcp/src", "apps/web/src", "apps/web/app"].flatMap((d) => sources(join(root, d))).filter((p) => /function inRange\b|const inRange\s*=/.test(readFileSync(p, "utf8")));
    expect(defining.map((p) => p.slice(root.length))).toEqual(["packages/cli/src/range.ts"]);
  });

  it("is what the extension and the site import", () => {
    expect(readFileSync(join(root, "packages/vscode/src/core.ts"), "utf8")).toContain('from "../../cli/src/range"');
    expect(readFileSync(join(root, "apps/web/src/lib/tie.ts"), "utf8")).toContain('from "smallprint/src/range"');
    expect(siteRange("0.0.1", "0.0.0, 0.0.1")).toBe(true);
  });
});
