/**
 * Pass 3 of the off-site audit of 16 Oct 2026: the command line. Each test failed before its fix.
 * - The gate said a version on record, past the newest 50 the read API lists, "is not on the record" (mcp-remote 0.1.16).
 * - `show` said a remote server "answered our request" when it gave no answer, and "published" for a date Small Print
 *   took when it first saw the version.
 * - `check --live` closed with "Nothing served differs from the record." when every server came back "?".
 * - A 401 or 403 from a hosted server was "it asks for a sign-in"; a mod was said to change what it can change.
 * - The level-four install line said the account and its agent cannot read the token; the helper said "and nothing else".
 * - The README promised a list of what sign-up could not pin, and search over every entry's tool text.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gateServer, type GateRecord } from "../src/gate";
import { readHttp } from "../src/live";
import { baselineDateWords, remoteAnswerWords } from "../src/record";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MAIN = read("packages/cli/src/main.ts");
const README = read("packages/cli/README.md");

describe("the gate and the read API's window of versions", () => {
  const listed = (n: number) => Array.from({ length: n }, (_, i) => ({ version: `0.1.${100 - i}`, publishedAt: `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, "0")}`, read: true, contentHash: `h${i}` }));
  const record = (versions: number): GateRecord => ({ asset: { latestVersion: "0.1.100", url: "https://smallprint.dev/a/npm/mcp-remote" }, advisories: [], releases: [], versions: listed(50), counts: { versions } });

  it("says a version past the newest listed is not among them, never that it is off the record", () => {
    const v = gateServer(record(123), "0.1.16", undefined);
    expect(v).toMatchObject({ mark: "?", unknown: true });
    expect(v.words[0]).toBe("version 0.1.16 is not among the newest 50 versions the record lists");
    expect(v.words.join(" ")).not.toContain("not on the record");
  });

  it("still says a version is not on the record when the answer lists every version", () => {
    expect(gateServer(record(50), "0.1.16", undefined).words[0]).toBe("version 0.1.16 is not on the record");
  });
});

describe("show says what the record holds, in the entry page's words", () => {
  // the entry page's file is read where it exists: this folder is also mirrored to the public repository, which has no site
  const FACTS = join(ROOT, "apps/web/src/lib/entry-facts.ts");
  it.skipIf(!existsSync(FACTS))("says a remote server's last answer as the entry page does, for every state", async () => {
    const { remoteAnswerFact } = (await import(FACTS)) as { remoteAnswerFact: (r: unknown) => string };
    for (const status of ["ok", "auth", "no-tools", "protocol", "unreachable", "something-new"]) {
      for (const httpStatus of [undefined, 401, 403]) {
        const r = { checkedAt: "2026-10-13T08:02:05.521Z", status, toolCount: status === "ok" ? 5 : null, httpStatus };
        expect(remoteAnswerWords(r)).toBe(remoteAnswerFact(r));
      }
    }
    expect(remoteAnswerWords({ checkedAt: "2026-10-13T08:02:05.521Z", status: "unreachable", toolCount: null })).toBe("2026-10-13: no answer, or only an error");
    expect(MAIN).toContain("console.log(`  asked ${remoteAnswerWords(j.remoteRead)}`)");
    expect(MAIN).not.toContain("answered our request");
  });

  it("says \"published\" only when the site says the date is the source's", () => {
    // the words moved into record.ts's baselineDateWords in pass 5, which also prints firstSeenAt (audit-pass5 test)
    expect(MAIN).toContain("baselineDateWords(j.baseline)");
    expect(baselineDateWords({ publishedAt: "2026-09-01T00:00:00Z", firstSeen: false })).toBe("published 2026-09-01");
    expect(baselineDateWords({ publishedAt: "2026-09-01T00:00:00Z" })).toBe("first seen 2026-09-01");
  });
});

describe("the live check", () => {
  it("never closes with \"nothing differs\" when nothing was compared", () => {
    expect(MAIN).toContain('compared ? `\\nNothing served differs from the record in the ${plural(compared, "server")} compared.` : "\\nNo server was compared with the record."');
    expect(MAIN).not.toContain(': "\\nNothing served differs from the record.")');
  });

  it("says a 401 or 403 as the status it was", async () => {
    for (const status of [401, 403]) {
      const r = await readHttp("https://example.invalid/mcp", 1000, (async () => new Response("", { status })) as unknown as typeof fetch);
      expect(r).toEqual({ ok: false, why: `it answered HTTP ${status}, and the live check does not sign in` });
    }
  });
});

describe("what the command says about itself", () => {
  it("the level-four install line and the scheduler's comment claim nothing about who can read the token", () => {
    expect(MAIN).toContain("(root-owned, mode 600)`);");
    expect(MAIN).not.toMatch(/cannot read it\)/);
    expect(read("packages/cli/src/schedule.ts")).not.toMatch(/cannot read the token|agent cannot reach/);
  });

  it("the root helper points at the privacy page and does not say \"and nothing else\"", () => {
    const doc = read("packages/cli/report/smallprint-report.py").split('"""')[1]!;
    expect(doc).not.toMatch(/nothing\s+else/);
    expect(doc).toContain("https://smallprint.dev/legal/privacy");
  });

  it("the Action's README promises no read every night (a night was missed on 27 Sep 2026, decision 291)", () => {
    expect(read("action/README.md")).not.toMatch(/every night/i);
  });

  it("the README promises no list of what sign-up could not pin, and does not say search covers every entry's text", () => {
    expect(README).not.toContain("names anything it could not pin");
    expect(README).not.toContain("every entry's tool text");
    expect(README).toContain('"can change the tool descriptions Claude reads"');
  });
});
