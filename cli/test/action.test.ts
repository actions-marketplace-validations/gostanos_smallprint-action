/**
 * The GitHub Action passes its inputs through the environment, never pasted into the script (security audit of 29 Sep
 * 2026, item 45). The step's script is run here with bash, with a stand-in npx that prints its arguments, and inputs that
 * would run a command if they were pasted into the script.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ACTION = readFileSync(new URL("../../../action/action.yml", import.meta.url), "utf8");
const script = () => {
  const m = /run: \|\n((?: {8}.*\n?)+)/.exec(ACTION);
  return m![1]!.split("\n").map((l) => l.slice(8)).join("\n");
};

function run(env: Record<string, string>): { out: string; code: number; pwned: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "sp-action-"));
  writeFileSync(join(dir, "npx"), '#!/bin/bash\nfor a in "$@"; do printf "[%s]" "$a"; done\n');
  chmodSync(join(dir, "npx"), 0o755);
  const marker = join(dir, "pwned");
  try {
    const out = execFileSync("/bin/bash", ["-c", script()], { cwd: dir, env: { PATH: `${dir}:/usr/bin:/bin`, ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.replace("MARKER", marker)])) }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { out, code: 0, pwned: existsSync(marker) };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { out: e.stdout, code: e.status, pwned: existsSync(marker) };
  }
}

describe("the Action's inputs", () => {
  it("never appear in the script as expressions", () => {
    expect(script()).not.toContain("${{");
    expect(ACTION).toContain("SP_LOCKFILE: ${{ inputs.lockfile }}");
  });

  it.skipIf(!existsSync("/bin/bash"))("reach npx as plain arguments, and a hostile value runs nothing", () => {
    const ok = run({ SP_LOCKFILE: "smallprint.lock", SP_VERSION: "0.1.5", SP_SARIF: "" });
    expect(ok.out).toBe("[-y][smallprint@0.1.5][check][--locked][--file][smallprint.lock][--no-upload][--no-signup]");
    const hostile = run({ SP_LOCKFILE: 'x"; touch MARKER; echo "', SP_VERSION: "0.1.5", SP_SARIF: "$(touch MARKER)" });
    expect(hostile.pwned).toBe(false);
    expect(hostile.out).toContain("[--sarif]");
    const badVersion = run({ SP_LOCKFILE: "smallprint.lock", SP_VERSION: "0.1.5 && touch MARKER", SP_SARIF: "" });
    expect(badVersion.code).toBe(2);
    expect(badVersion.pwned).toBe(false);
  });
});
