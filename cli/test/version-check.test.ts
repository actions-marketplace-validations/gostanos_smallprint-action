import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { compareVersions, LATEST_URL, versionCheckLine } from "../src/update-check";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const TSX = pathToFileURL(join(fileURLToPath(new URL("..", import.meta.url)), "node_modules", "tsx", "dist", "loader.mjs")).href;
const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** A fetch that records each call and answers with `reply`, or throws when `reply` is an Error. */
function stub(reply: Error | { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (reply instanceof Error) throw reply;
    return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

describe("smallprint version --check (cli-gaps)", () => {
  it("sends one GET to npm's latest record with the command's user agent and no body", async () => {
    const s = stub({ status: 200, body: { name: "smallprint", version: "1.2.0" } });
    expect(await versionCheckLine("1.2.0", s.f)).toBe("smallprint 1.2.0 is the newest version.");
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.url).toBe("https://registry.npmjs.org/smallprint/latest");
    expect(LATEST_URL).toBe(s.calls[0]!.url);
    expect(s.calls[0]!.init?.method ?? "GET").toBe("GET");
    expect(s.calls[0]!.init?.body).toBeUndefined();
    expect((s.calls[0]!.init?.headers as Record<string, string>)["user-agent"]).toBe("smallprint-cli/1.2.0");
    expect(s.calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("names the published version and the changelog when npm has a newer one", async () => {
    expect(await versionCheckLine("1.2.0", stub({ status: 200, body: { version: "1.3.0" } }).f)).toBe("smallprint 1.2.0 is installed; 1.3.0 is published. Changes: https://smallprint.dev/changelog");
    expect(await versionCheckLine("1.2.0", stub({ status: 200, body: { version: "1.10.0" } }).f)).toContain("1.10.0 is published");
  });

  it("calls a build newer than the published one the newest", async () => {
    expect(await versionCheckLine("1.3.0", stub({ status: 200, body: { version: "1.2.0" } }).f)).toBe("smallprint 1.3.0 is the newest version.");
  });

  it("says it could not reach npm when the request fails, and could not read a version from an answer without one", async () => {
    expect(await versionCheckLine("1.2.0", stub(new TypeError("fetch failed")).f)).toBe("The check could not reach npm, so nothing was compared. smallprint 1.2.0 is installed.");
    expect(await versionCheckLine("1.2.0", stub(new DOMException("timed out", "TimeoutError")).f)).toContain("could not reach npm");
    for (const reply of [{ status: 503, body: "busy" }, { status: 200, body: "not json" }, { status: 200, body: { version: 12 } }, { status: 200, body: { version: "latest" } }]) {
      expect(await versionCheckLine("1.2.0", stub(reply).f)).toBe("The check could not read a version from npm's answer, so nothing was compared. smallprint 1.2.0 is installed.");
    }
  });

  it("compares versions by number", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("0.9.0", "1.0.0")).toBe(-1);
    expect(compareVersions("x", "1.0.0")).toBeNaN();
  });

  // the command itself, with fetch replaced before main.ts loads: --version asks nothing, version --check asks once
  const run = (args: string[]) => {
    const fake = "data:text/javascript," + encodeURIComponent(`globalThis.fetch = async (u, o) => { process.stderr.write("FETCH " + String(u) + " " + (o && o.headers && o.headers["user-agent"]) + "\\n"); if (process.env.SP_FAIL) throw new TypeError("fetch failed"); return new Response(JSON.stringify({ version: "9.9.9" }), { status: 200 }); };`);
    return (fail = false) => spawnSync(process.execPath, ["--import", TSX, "--import", fake, MAIN, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: mkdtempSync(join(tmpdir(), "sp-ver-")), ...(fail ? { SP_FAIL: "1" } : {}) } });
  };

  it("plain --version prints the version and sends nothing", () => {
    for (const args of [["--version"], ["version"], ["-v"]]) {
      const r = run(args)();
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(VERSION);
      expect(r.stderr).not.toContain("FETCH");
    }
  });

  it("version --check asks npm once and exits 0, also when npm cannot be reached", () => {
    const ok = run(["version", "--check"])();
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim()).toBe(`smallprint ${VERSION} is installed; 9.9.9 is published. Changes: https://smallprint.dev/changelog`);
    expect(ok.stderr.trim().split("\n").filter((l) => l.startsWith("FETCH"))).toEqual([`FETCH https://registry.npmjs.org/smallprint/latest smallprint-cli/${VERSION}`]);
    const down = run(["version", "--check"])(true);
    expect(down.status).toBe(0);
    expect(down.stdout.trim()).toBe(`The check could not reach npm, so nothing was compared. smallprint ${VERSION} is installed.`);
  });

  it("is in the help", () => {
    const help = execFileSync(process.execPath, ["--import", TSX, MAIN, "--help"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: mkdtempSync(join(tmpdir(), "sp-help-")) } });
    expect(help).toContain("smallprint version --check ");
  });
});
