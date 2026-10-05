/**
 * What follows a publish, held together before it (tools audit of 4 Oct 2026, fixes 1 and 2). The documented
 * `rev: v1.8` ran 0.1.5 while the command, the Action and the site said 0.1.7; the public Action stayed on 0.1.6
 * because the mirror never carried action.yml; the MCP install note stayed on 0.2.3 because it lived only in the public
 * repository. Here: one tag for every document, one version for everything that runs the command, a mirror that
 * carries every public file, and a publish that goes through the workflow.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const CLI = (JSON.parse(read("packages/cli/package.json")) as { version: string }).version;
const MCP = (JSON.parse(read("packages/mcp/package.json")) as { version: string }).version;
const TAG = read("action/TAG").trim();

const under = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules" || f.startsWith(".")) return [];
    return statSync(join(ROOT, p)).isDirectory() ? under(p) : [p];
  });

describe("the Action's tag is one fact", () => {
  // every place a reader is told which tag to pin: the two READMEs, llms.txt, the site's pages, the plugin
  const documents = ["packages/cli/README.md", "action/README.md", "apps/web/public/llms.txt", "packages/plugin/README.md", ...under("apps/web/app").filter((p) => /\.(tsx|ts|md)$/.test(p))];

  it("action/TAG holds one tag", () => {
    expect(TAG).toMatch(/^v1\.\d+$/);
  });

  it("every documented rev and every tagged use of the Action names it", () => {
    const named: [string, string][] = [];
    for (const d of documents) for (const m of read(d).matchAll(/(?:\brev: |smallprint-action@)(v\d+(?:\.\d+)*)/g)) if (m[1] !== "v1") named.push([d, m[1]!]);
    expect(named.length).toBeGreaterThanOrEqual(4);
    expect(named.filter(([, t]) => t !== TAG)).toEqual([]);
  });
});

describe("everything that runs the command runs the version in packages/cli/package.json", () => {
  it("the pre-commit hooks, the Action's default, the public repository's own check and the plugin", () => {
    const pins = (p: string) => [...read(p).matchAll(/smallprint@(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    expect(pins("ops/pre-commit/.pre-commit-hooks.yaml")).toEqual([CLI, CLI]);
    expect(read("action/action.yml")).toContain(`default: "${CLI}"`);
    expect(pins("action/workflows/small-print.yml")).toEqual([CLI]);
    for (const skill of ["check", "locked", "gate"]) expect([...new Set(pins(`packages/plugin/skills/${skill}/SKILL.md`))]).toEqual([CLI]);
  });

  it("the MCP install note and the plugin name the version in packages/mcp/package.json", () => {
    expect([...read("packages/mcp/llms-install.md").matchAll(/smallprint-mcp@(\d+\.\d+\.\d+)/g)].map((m) => m[1])).toEqual([MCP]);
    expect(read("packages/plugin/.mcp.json")).toContain(`smallprint-mcp@${MCP}`);
  });
});

describe("the mirror carries every public file", () => {
  const list = read("ops/deploy/public-files.txt").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(" ") as [string, string]);

  it("the list names files that exist, the Action and its README, the hooks and both checking scripts among them", () => {
    for (const [from] of list) expect(existsSync(join(ROOT, from)), from).toBe(true);
    const there = list.map(([, to]) => to);
    for (const f of ["action.yml", "README.md", ".pre-commit-hooks.yaml", "tools/verify-chain.mjs", "tools/no-upload-trap.mjs", ".github/workflows/publish-cli.yml", ".github/workflows/publish-mcp.yml", ".claude-plugin/marketplace.json"]) expect(there).toContain(f);
  });

  it.skipIf(spawnSync("rsync", ["--version"]).status !== 0)("run against a scratch repository, it writes each of them, cli/, mcp/ and plugin/, and pushes nothing", () => {
    const clone = mkdtempSync(join(tmpdir(), "sp-mirror-"));
    const git = (...a: string[]) => execFileSync("git", ["-C", clone, "-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(clone, "LICENSE"), "MIT\n");
    writeFileSync(join(clone, "action.yml"), 'default: "0.1.6"\n');
    git("add", "-A");
    git("commit", "-q", "-m", "seed");
    const out = execFileSync("bash", [join(ROOT, "ops/deploy/mirror-cli.sh"), clone, "--local"], { encoding: "utf8" });
    expect(out).toContain("not pushed");
    for (const [from, to] of list) expect(readFileSync(join(clone, to), "utf8"), to).toBe(read(from));
    expect(readFileSync(join(clone, "action.yml"), "utf8")).toContain(`default: "${CLI}"`);
    expect(JSON.parse(readFileSync(join(clone, "cli/package.json"), "utf8")).version).toBe(CLI);
    expect(JSON.parse(readFileSync(join(clone, "mcp/package.json"), "utf8")).version).toBe(MCP);
    expect(readFileSync(join(clone, "mcp/llms-install.md"), "utf8")).toContain(`smallprint-mcp@${MCP}`);
    expect(existsSync(join(clone, "plugin/smallprint.lock"))).toBe(true);
    // each package stands alone there: nothing in cli/ or mcp/ reaches outside its own folder to build
    for (const pkg of ["cli", "mcp"]) for (const f of readdirSync(join(clone, pkg, "src"))) expect(readFileSync(join(clone, pkg, "src", f), "utf8"), `${pkg}/src/${f}`).not.toMatch(/from "\.\.\/\.\.\//);
    expect(git("log", "--oneline").trim().split("\n")).toHaveLength(1);
  }, 60_000);
});

describe("a publish goes through the workflow, where npm attaches the signed build record", () => {
  it("both packages run the guard before a publish from this repository", () => {
    for (const pkg of ["cli", "mcp"]) expect((JSON.parse(read(`packages/${pkg}/package.json`)) as { scripts: Record<string, string> }).scripts.prepublishOnly).toBe("node ../../ops/deploy/publish-guard.mjs && pnpm build");
  });

  it("the guard refuses a hand publish, says how to publish, and lets the workflow through", () => {
    const run = (env: Record<string, string>) => spawnSync(process.execPath, [join(ROOT, "ops/deploy/publish-guard.mjs")], { env: { PATH: process.env.PATH ?? "", npm_package_name: "smallprint", ...env }, encoding: "utf8" });
    const hand = run({});
    expect(hand.status).toBe(1);
    expect(hand.stderr).toContain("gh workflow run publish-cli.yml -R gostanos/smallprint-action");
    expect(run({ npm_package_name: "smallprint-mcp" }).stderr).toContain("publish-mcp.yml");
    expect(run({ GITHUB_ACTIONS: "true", ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid" }).status).toBe(0);
    const forced = run({ SMALLPRINT_HAND_PUBLISH: "without-build-record" });
    expect(forced.status).toBe(0);
    expect(forced.stderr).toContain("NO signed build record");
  });

  it("each workflow publishes with provenance from its own folder", () => {
    for (const [file, dir] of [["publish-cli.yml", "cli"], ["publish-mcp.yml", "mcp"]] as const) {
      const w = read(`action/workflows/${file}`);
      expect(w).toContain("id-token: write");
      expect(w).toContain(`working-directory: ${dir}`);
      expect(w).toContain("npm stage publish --access public --provenance --ignore-scripts");
    }
  });
});

// "about 125 KB ... plus a 23 KB Python helper" was said of 0.1.6 and still printed at 0.1.7, which was 135 KB and 29 KB
describe("the sizes the README gives", () => {
  const said = /about (\d+) KB of unminified JavaScript plus a (\d+) KB Python helper/.exec(read("packages/cli/README.md"));
  const kb = (p: string) => statSync(join(ROOT, p)).size / 1000;

  it("are within a twentieth of the Python helper's size, and of the built file's when it has been built", () => {
    expect(said).not.toBeNull();
    expect(Math.abs(Number(said![2]) - kb("packages/cli/report/smallprint-report.py")) / kb("packages/cli/report/smallprint-report.py")).toBeLessThan(0.05);
    const built = "packages/cli/dist/smallprint.js";
    // the built file is not in the repository; a build that is older than the source says nothing about this version
    if (existsSync(join(ROOT, built)) && statSync(join(ROOT, built)).mtimeMs >= statSync(join(ROOT, "packages/cli/src/main.ts")).mtimeMs) expect(Math.abs(Number(said![1]) - kb(built)) / kb(built)).toBeLessThan(0.05);
  });
});
