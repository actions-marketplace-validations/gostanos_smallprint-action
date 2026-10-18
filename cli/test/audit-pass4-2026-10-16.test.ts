/**
 * Pass 4 of the off-site audit of 16 Oct 2026: the command line. Each test failed before its fix.
 * - The gate graded a release by its install script: one medium description change beside a high install script read
 *   "worst high", where smallprint-mcp said "worst medium" for the same release.
 * - The gate predicted what the next start runs ("the next start runs the latest, 1.1.7") when PyPI already held 1.5.0.
 * - The gate's sentence for a lock version it could not compare did not read ("... was not read with 1.1.7").
 * - `check --live` printed a failed lookup as a fact about the record.
 * - An env key named like a secret, holding a reference such as ${GITHUB_TOKEN}, was said to hold a plaintext secret.
 * - `schedule --status` said every 6 hours whatever was installed; the README credited the advisories to databases.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gateServer, type GateRecord } from "../src/gate";
import { lookupFailed } from "../src/live";
import { envHygiene } from "../src/parse";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MAIN = read("packages/cli/src/main.ts");

const record = (): GateRecord => ({
  asset: { latestVersion: "1.0.100", url: "https://smallprint.dev/a/npm/x" },
  advisories: [],
  releases: [{ from: "1.0.99", to: "1.0.100", publishedAt: "2026-10-14", worst: "high", identical: false, changes: [{ field: "tool.description", severity: "medium" }, { field: "install.script", severity: "high" }] }],
  versions: [
    { version: "1.0.100", publishedAt: "2026-10-14", read: true, contentHash: "h100" },
    { version: "1.0.99", publishedAt: "2026-10-01", read: true, contentHash: "h99" },
    { version: "1.0.98", publishedAt: "2026-09-01", read: false, contentHash: null },
  ],
});

describe("the gate grades a release by its changes to the small print alone", () => {
  it("says worst medium for one medium description change beside a high install script", () => {
    expect(gateServer(record(), "1.0.100", { version: "1.0.99" }).words[0]).toBe("a change to the small print is on record between 1.0.99 in the lock and 1.0.100: 1 release, worst medium");
    expect(gateServer(record(), "1.0.99", { version: "1.0.99" }).words[1]).toBe("1 release after 1.0.99 changed the small print, worst medium; read the entry page before you move up");
    expect(JSON.stringify(gateServer(record(), "1.0.100", { version: "1.0.99" }).words)).not.toContain("worst high");
  });
});

describe("the gate says what the record lists, never what the next start runs", () => {
  it("names the newest on record for an unpinned server, with no prediction", () => {
    const words = [gateServer(record(), null, undefined), gateServer(record(), null, { version: "1.0.99" }), gateServer(record(), null, { version: "1.0.100" }), gateServer(record(), null, { version: "1.0.98" })].flatMap((v) => v.words);
    expect(words).toContain("not pinned, so the version that starts can change; the newest on record is 1.0.100, and no lock entry says which version was read; pin a version or write a lock");
    expect(words).toContain("a change to the small print is on record between 1.0.99 in the lock and 1.0.100, the newest on record (the config pins no version): 1 release, worst medium");
    expect(words).toContain("the newest on record, 1.0.100, is the version in the lock (the config pins no version)");
    expect(words.join(" ")).not.toMatch(/next start|runs the latest|\bruns 1\.0\.100/);
  });

  it("says a lock version it cannot compare in a sentence that reads", () => {
    expect(gateServer(record(), "1.0.100", { version: "1.0.98" }).words[0]).toBe("the lock holds 1.0.98: version 1.0.98 is on the record but its small print was not read, so it cannot be compared with 1.0.100");
    expect(gateServer(record(), null, { version: "1.0.98" }).words[0]).toBe("not pinned, so the version that starts can change; the lock holds 1.0.98: version 1.0.98 is on the record but its small print was not read, so it cannot be compared with 1.0.100");
  });
});

describe("check --live tells a failed lookup apart from the record", () => {
  it("says the lookup failed, with its status, and never that the record lacks something", () => {
    expect(lookupFailed(503)).toBe("the lookup on smallprint.dev failed (HTTP 503)");
    expect(lookupFailed(null)).toBe("the lookup on smallprint.dev got no answer");
    expect(MAIN).toContain("return r.status === 404 ? { body: null } : { body: null, failed: lookupFailed(r.status) };");
    expect(MAIN).toContain("if (rec.failed) {");
    expect(MAIN).not.toContain("the record has not read the tools of");
    expect(MAIN).not.toMatch(/\.catch\(\(\) => null\)\) as \{ (tools|entries)/);
  });
});

describe("env hygiene says what a value looks like, and skips references", () => {
  it("skips ${NAME} and $NAME, and says looks like for the rest", () => {
    expect(envHygiene({ env: { GITHUB_TOKEN: "${GITHUB_TOKEN}", API_KEY: "$API_KEY" } }, "/c.json")).toEqual([]);
    expect(envHygiene({ env: { GITHUB_TOKEN: "ghp_x" } }, "/c.json")).toEqual(["env GITHUB_TOKEN looks like a plaintext secret in /c.json"]);
    expect(envHygiene({ env: { TOKEN: "${TOKEN:-sk-literal}" } }, "/c.json")).toHaveLength(1);
    expect(read("packages/cli/src/parse.ts")).not.toContain("holds a plaintext secret");
  });
});

describe("what the command says about itself", () => {
  it("schedule --status names no interval it did not read, and the README credits no advisory to databases", () => {
    expect(MAIN).not.toContain("(launchd, every 6 hours)");
    expect(read("packages/cli/README.md")).not.toContain("advisory databases have on record");
    const pkg = JSON.parse(read("packages/cli/package.json")) as { description: string };
    expect(pkg.description).not.toMatch(/be told when/);
  });
});
