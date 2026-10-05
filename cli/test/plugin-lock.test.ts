/**
 * The plugin in packages/plugin carries its own smallprint.lock, and the public repository runs `check --locked` on it
 * every day. On 2 Oct 2026 the plugin's server pin moved to smallprint-mcp 0.2.5 and the lock was not written again, so
 * the public check failed every day until 4 Oct. This runs the same check here, so a pin change without a new lock
 * fails our own tests first.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const PLUGIN = fileURLToPath(new URL("../../plugin", import.meta.url));
const TSX = pathToFileURL(join(fileURLToPath(new URL("..", import.meta.url)), "node_modules", "tsx", "dist", "loader.mjs")).href;

describe("the plugin's lock", () => {
  it("matches the plugin's configuration, as the public repository's daily check reads it", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-plugin-lock-"));
    let out = "", code = 0;
    try {
      out = execFileSync(process.execPath, ["--import", TSX, MAIN, "check", "--locked", "--no-upload", "--no-signup"], { cwd: PLUGIN, env: { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, ".config") }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      code = e.status ?? 1;
      out = String(e.stdout ?? "");
    }
    expect(out).toContain("Matches smallprint.lock");
    expect(code).toBe(0);
  }, 30_000);
});
