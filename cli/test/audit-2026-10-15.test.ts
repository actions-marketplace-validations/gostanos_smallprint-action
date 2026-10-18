/**
 * The off-site audit of 15 Oct 2026: what the README, the help, the root helper, the Action, the plugin and the MCP
 * server's README say about themselves. Each test failed before its fix.
 * - Level four said an agent running as you could not forge a report. The installer copies your own token and leaves
 *   it where it was, and the site accepts a level-four report from any valid token, so only the copy is root-owned.
 * - The help named products in a category the site compares against.
 * - "Every account starts with 30 days of Pro": another spelling of a live account's mailbox starts on Free, and a deleted
 *   account's address gets a new trial, so the shared sentence says only that new accounts get the trial.
 * - What leaves the machine is listed in full on the privacy page; the README and the help say it briefly and link there.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIREWALLS } from "../src/firewalls";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const README = read("packages/cli/README.md");
const MAIN = read("packages/cli/src/main.ts");
const HELP = MAIN.slice(MAIN.indexOf("const HELP = `"), MAIN.indexOf("`;", MAIN.indexOf("const HELP = `")));
const HELPER = read("packages/cli/report/smallprint-report.py");
const TRIAL = "New accounts get 30 days of Pro, no credit card required.";
const PRIVACY = "What each command sends, and when, is listed on the privacy page";

describe("level four claims only what the root-owned copy gives", () => {
  it("no surface the package carries says an agent cannot forge a report or read the token", () => {
    for (const text of [README, HELP, HELPER, MAIN]) {
      expect(text).not.toMatch(/forge/i);
      expect(text).not.toMatch(/cannot read the token|cannot read its token|cannot read, forge/);
      expect(text).not.toContain("the agent cannot reach");
    }
    expect(README).toContain("its own root-owned copy of your token");
    expect(HELP).toContain("--system  the same from a root-owned job with its own root-owned copy of the token");
    expect(HELPER).toContain("own root-owned copy of the account's token");
    // the token file is chmod 600 for the account, which an agent running as the account can still read
    expect(HELP).not.toContain("a file only you can read");
  });
});

describe("the help names no product of a category the site compares against", () => {
  it("names no agent firewall, only that their names are sent", () => {
    expect(FIREWALLS.length).toBeGreaterThan(0);
    for (const f of FIREWALLS) expect(HELP.toLowerCase()).not.toContain(f.name.toLowerCase());
    expect(HELP).not.toMatch(/AgentGate/i);
    expect(HELP).toContain("the names of any agent firewalls it finds installed");
  });
});

describe("one sentence for the trial, one place for what is sent", () => {
  it("the README, the sign-up question and the Action README say the trial the same way", () => {
    for (const text of [README, MAIN, read("action/README.md")]) {
      expect(text).toContain(TRIAL);
      expect(text).not.toMatch(/every account starts with 30 days|one trial per inbox/i);
    }
  });

  it("the README and the help point at the privacy page instead of keeping their own full list", () => {
    expect(README).toContain(`${PRIVACY}: https://smallprint.dev/legal/privacy`);
    expect(HELP).toContain(`${PRIVACY}: https://smallprint.dev/legal/privacy`);
    expect(README).not.toContain("never sent in any mode");
    expect(README).not.toContain("never sends one");
  });
});

describe("smaller claims that went past the code", () => {
  it("a pin fixes a version; it cannot know what you read", () => {
    for (const p of ["packages/cli/README.md", "packages/plugin/README.md"]) expect(read(p)).not.toMatch(/you have not read/);
  });

  it("the MCP server describes the versions it has read, not every version", () => {
    expect(read("packages/mcp/README.md")).not.toMatch(/every version/);
    expect((JSON.parse(read("packages/mcp/package.json")) as { description: string }).description).not.toMatch(/each version|every version/);
  });

  it("the Action says what it compares, and that it does not read tool descriptions", () => {
    const readme = read("action/README.md");
    expect(readme).not.toContain("the small print your agents read has changed");
    expect(readme).toContain("it does not read tool descriptions");
  });

  it("the receipt example is a version the record has a chain row for", () => {
    expect(README).toContain("GET /api/receipt/npm/@modelcontextprotocol/server-filesystem/2026.7.10");
    expect(README).not.toContain("/api/receipt/npm/mcp-remote/0.14.3");
  });
});
