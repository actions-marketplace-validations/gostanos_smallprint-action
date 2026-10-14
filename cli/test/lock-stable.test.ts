/**
 * The lock file stays byte for byte the same when nothing changed (decision 494): only its "written" time would have
 * differed, and a lock that changes on every run shows up as a change in git and in anyone's own hash of it.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const TSX = pathToFileURL(join(fileURLToPath(new URL("..", import.meta.url)), "node_modules", "tsx", "dist", "loader.mjs")).href;

describe("smallprint lock on an unchanged project", () => {
  it("leaves the file exactly as it was, and still writes a real change", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "sp-lock-stable-"));
    const home = mkdtempSync(join(tmpdir(), "sp-lock-home-"));
    writeFileSync(join(cwd, "CLAUDE.md"), "# a project\nUse the tools carefully.\n");
    const run = () => execFileSync(process.execPath, ["--import", TSX, MAIN, "lock", "--project", "--offline"], { cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: home } });
    const file = join(cwd, "smallprint.lock");
    run();
    const first = readFileSync(file);
    const firstTime = statSync(file).mtimeMs;
    await new Promise((r) => setTimeout(r, 1100));
    expect(run()).toContain("left exactly as it was");
    expect(readFileSync(file).equals(first)).toBe(true);
    expect(statSync(file).mtimeMs).toBe(firstTime);
    appendFileSync(join(cwd, "CLAUDE.md"), "More text.\n");
    expect(run()).toContain("Updated");
    expect(readFileSync(file).equals(first)).toBe(false);
  }, 60_000);
});
