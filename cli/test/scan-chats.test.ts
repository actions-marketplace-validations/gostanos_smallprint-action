/**
 * smallprint scan-chats (decision 513): the patterns find what they should and leave look-alikes alone, every finding is
 * masked, a full secret never reaches stdout, stderr or a file, the question is asked without --yes, and check and sync
 * never read a conversation log.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { chatSources, findInLine, mask, SCAN_QUESTION } from "../src/chatscan";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const TSX = pathToFileURL(join(fileURLToPath(new URL("..", import.meta.url)), "node_modules", "tsx", "dist", "loader.mjs")).href;

// made-up values in the shape of each kind; none of them is a real key
const S = {
  aws: "AK" + "IA4QW7RZ2NX5KP8TLM",
  awsSecret: "wJ9rXUtnF3MI7K8DENGbPxRfiCYz2kLm5qA1sT0v",
  ghp: "gh" + "p_R8kL2mQ9xV4nB7cT1wZ5yH3jF6dS0aG2pE9u",
  ghpat: "github" + "_pat_11ABCDEFG0aBcDeFgHiJkL_" + "mN0pQrStUvWxYz1234567890aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789",
  openai: "sk-" + "proj-Zq8vT2mWx9LkR4pN7sJ3hB6yC1fD5gA0eU8iO2tKwXzQvMnB",
  anthropic: "sk-ant-api03-" + "Qw3rTy7uIo9pAs1dFg5hJk2lZx8cVb4nMq6wEr0tYu3iOp7aSd1fGh5jKl9zXc2vBn6mQw4eRt8yUi0oPa3sDf7gHj1kLz5xCv9bNm2qWe-AA",
  stripe: "sk_" + "live_51Hq8vT2mWx9LkR4pN7sJ3hB6y",
  whsec: "wh" + "sec_Zq8vT2mWx9LkR4pN7sJ3hB6yC1fD5gA0",
  slack: "xo" + "xb-123456789012-1234567890123-Zq8vT2mWx9LkR4pN7sJ3hB6y",
  urlPass: "Tr0ub4dor-n3w",
  assigned: "q7Lp2vXk9Rm",
};

describe("the patterns", () => {
  const cases: [string, string, string][] = [
    ["AWS access key ID", `export AWS_ACCESS_KEY_ID=${S.aws}`, S.aws],
    ["AWS secret access key", `aws_secret_access_key = ${S.awsSecret}`, S.awsSecret],
    ["GitHub token", `{"text":"token is ${S.ghp}"}`, S.ghp],
    ["GitHub token", `GITHUB_TOKEN=${S.ghpat}`, S.ghpat],
    ["OpenAI API key", `OPENAI_API_KEY=\\"${S.openai}\\"`, S.openai],
    ["Anthropic API key", `x-api-key: ${S.anthropic}`, S.anthropic],
    ["Stripe secret key", `Stripe.apiKey = '${S.stripe}'`, S.stripe],
    ["Stripe webhook secret", `STRIPE_WEBHOOK_SECRET=${S.whsec}`, S.whsec],
    ["Slack token", `SLACK_BOT_TOKEN=${S.slack}`, S.slack],
    ["Password inside an address", `DATABASE_URL=postgres://app:${S.urlPass}@db.internal.example.org:5432/app`, S.urlPass],
    ["Password assignment", `DB_PASSWORD=${S.assigned}`, S.assigned],
    ["Password assignment", `{"content":"password=\\"${S.assigned}\\""}`, S.assigned],
  ];
  for (const [kind, line, value] of cases) {
    it(`finds ${kind} in: ${line.slice(0, 40)}`, () => {
      const got = findInLine(line);
      expect(got.map((g) => g.kind)).toContain(kind);
      const hit = got.find((g) => g.kind === kind)!;
      expect(hit.preview).toBe(mask(value));
      expect(hit.preview.length).toBeLessThanOrEqual(5);
      expect(JSON.stringify(got)).not.toContain(value);
    });
  }

  it("finds a private key block with its body, as it appears escaped in a JSON line", () => {
    const line = `{"text":"-----BEGIN OPENSSH PRIVATE ${"KEY"}-----\\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\\n-----END OPENSSH PRIVATE KEY-----"}`;
    expect(findInLine(line)).toEqual([{ kind: "Private key block", preview: "----…" }]);
  });

  it("leaves look-alikes, placeholders and code alone", () => {
    const negatives = [
      "AK" + "IAIOSFODNN7EXAMPLE", // AWS's own documentation example
      "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "gh" + "p_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "OPENAI_API_KEY=sk-proj-your-key-here",
      "sk-proj-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "pk_" + "live_51Hq8vT2mWx9LkR4pN7sJ3hB6y", // a publishable key is meant to be public
      "-----BEGIN RSA PRIVATE " + "KEY----- ... -----END RSA PRIVATE KEY-----", // a mention, no key body
      "postgres://user:password@localhost:5432/db",
      "postgres://app:${DB_PASSWORD}@db.example.org/app",
      "https://user:****@example.com/",
      "git@github.com:owner/repo.git",
      "password=os.environ[\\\"DB_PASSWORD\\\"]",
      "password=args.password",
      "password = getpass()",
      "if password == stored_password:",
      "password=password_hash",
      "PASSWORD=$DB_PASSWORD",
      "password=<your password>",
      "PWD=/Users/someone/projects/app",
      "OLDPWD=/tmp",
      "PASSWORD_FILE=/run/secrets/db",
      "the image data iVBORw0KGgoAAAANSUhEUgAK" + "IA4QW7RZ2NX5KP8TLMAAAAAElFTkSuQmCC continues",
      "assertEquals(password, \"changeme\")",
      "a sentence that says the password is long and sk- prefixes are OpenAI keys",
    ];
    for (const n of negatives) expect(findInLine(n), n).toEqual([]);
  });

  it("masks with at most four characters, fewer for a short value", () => {
    expect(mask(S.aws)).toBe("AKIA…");
    expect(mask("q7Lp2vXk")).toBe("q7…");
    expect(mask("abc")).toBe("…");
  });
});

function fakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sp-scan-home-"));
  const proj = join(home, ".claude", "projects", "-Users-someone-app");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "a1.jsonl"), [JSON.stringify({ type: "user", message: { content: "hello" } }), JSON.stringify({ type: "user", message: { content: `my key is ${S.openai} and DB_PASSWORD=${S.assigned}` } })].join("\n") + "\n");
  const codex = join(home, ".codex", "sessions", "2026", "10", "15");
  mkdirSync(codex, { recursive: true });
  writeFileSync(join(codex, "rollout-1.jsonl"), JSON.stringify({ payload: { output: `export AWS_ACCESS_KEY_ID=${S.aws}` } }) + "\n");
  writeFileSync(join(home, ".codex", "history.jsonl"), JSON.stringify({ text: "nothing here" }) + "\n");
  const gemini = join(home, ".gemini", "tmp", "abc123", "chats");
  mkdirSync(gemini, { recursive: true });
  writeFileSync(join(gemini, "session-1.json"), `{"messages":[{"content":"${S.ghp}"}]}\n`);
  // a file outside the transcript folders is not read
  writeFileSync(join(home, ".claude", "notes.txt"), `ANTHROPIC=${S.anthropic}\n`);
  return home;
}

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(p, readFileSync(p, "utf8"));
    }
  };
  walk(dir);
  return out;
}

const run = (home: string, args: string[], input?: string) => spawnSync(process.execPath, ["--import", TSX, MAIN, ...args], { cwd: home, input: input ?? "", encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, ".config") } });

describe("smallprint scan-chats", () => {
  it("reads the documented folders and prints masked findings, the summary and the advice", () => {
    const home = fakeHome();
    const before = snapshot(home);
    const r = run(home, ["scan-chats", "--yes"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Claude Code  ~/.claude/projects  1 file");
    expect(r.stdout).toContain("Codex  ~/.codex/sessions  1 file");
    expect(r.stdout).toContain("Codex  ~/.codex/history.jsonl  1 file");
    expect(r.stdout).toContain("Gemini CLI  ~/.gemini/tmp  1 file");
    expect(r.stdout).toContain(`~/.claude/projects/-Users-someone-app/a1.jsonl:2  OpenAI API key  ${mask(S.openai)}`);
    expect(r.stdout).toContain("~/.claude/projects/-Users-someone-app/a1.jsonl:2  Password assignment");
    expect(r.stdout).toContain("~/.codex/sessions/2026/10/15/rollout-1.jsonl:1  AWS access key ID  AKIA…");
    expect(r.stdout).toContain("~/.gemini/tmp/abc123/chats/session-1.json:1  GitHub token  ghp_…");
    expect(r.stdout).toContain("Read 4 files. Found 4 possible secrets:");
    expect(r.stdout).toContain("consider replacing it where it was issued");
    expect(r.stdout).toContain("cannot tell which ones are real");
    for (const v of Object.values(S)) {
      expect(r.stdout).not.toContain(v);
      expect(r.stderr).not.toContain(v);
    }
    expect(r.stdout).not.toContain(S.anthropic.slice(0, 12)); // notes.txt is not a transcript
    // no file changed, none was added (the scan writes no state)
    expect(snapshot(home)).toEqual(before);
  }, 30_000);

  it("prints the same findings as JSON for a script, masked", () => {
    const home = fakeHome();
    const r = run(home, ["scan-chats", "--yes", "--json"]);
    const j = JSON.parse(r.stdout) as { sent: string; filesRead: number; findings: { kind: string; preview: string }[]; byKind: Record<string, number> };
    expect(j.sent).toBe("nothing");
    expect(j.filesRead).toBe(4);
    expect(j.byKind).toEqual({ "OpenAI API key": 1, "Password assignment": 1, "AWS access key ID": 1, "GitHub token": 1 });
    for (const v of Object.values(S)) expect(r.stdout).not.toContain(v);
  }, 30_000);

  it("asks first without --yes, and reads nothing on no or on end of input", () => {
    const home = fakeHome();
    for (const input of ["n\n", ""]) {
      const r = run(home, ["scan-chats"], input);
      expect(r.stdout).toContain(SCAN_QUESTION.trim());
      expect(r.stdout).toContain("Nothing was read.");
      expect(r.stdout).not.toContain("Possible secrets");
      expect(r.status).toBe(1);
    }
    const yes = run(home, ["scan-chats"], "y\n");
    expect(yes.stdout).toContain("Possible secrets");
    expect(SCAN_QUESTION).toBe("This reads your agents' conversation logs on this machine to look for keys and passwords. Nothing is sent. Continue? [y/N] ");
  }, 30_000);

  it("is never run by check or sync", () => {
    const home = fakeHome();
    for (const args of [["check", "--no-upload"], ["check", "--json"], ["sync", "--label", "t", "--dry-run", "--token", "sp_test"]]) {
      const r = run(home, args);
      const all = r.stdout + r.stderr;
      expect(all, args.join(" ")).not.toContain("Possible secrets");
      expect(all).not.toContain("conversation logs");
      for (const v of Object.values(S)) expect(all).not.toContain(v);
    }
    // and the source holds it to its one command: chatscan is called from scanChatsCommand only
    const src = readFileSync(MAIN, "utf8");
    expect([...src.matchAll(/scanChats\(/g)]).toHaveLength(1);
    expect(src).toMatch(/async function scanChatsCommand\(\)[\s\S]*?scanChats\(chatSources/);
  }, 60_000);

  it("knows the agents' own folders and their environment overrides", () => {
    const paths = chatSources("/h", { CLAUDE_CONFIG_DIR: "/c", CODEX_HOME: "/x" }).map((s) => s.path);
    expect(paths).toEqual(["/c/projects", "/x/sessions", "/x/history.jsonl", "/h/.gemini/tmp"]);
  });
});

describe("help", () => {
  it("names both commands", () => {
    const help = execFileSync(process.execPath, ["--import", TSX, MAIN, "--help"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: mkdtempSync(join(tmpdir(), "sp-help-")) } });
    expect(help).toContain("smallprint watch [--file smallprint.lock] [--no-notify] -- <server command> [its arguments]");
    expect(help).toContain("smallprint scan-chats [--yes] [--json]");
  }, 30_000);
});

describe("scan-chats makes no network request at all", () => {
  it("reads and reports with every fetch recorded, and the record is empty", () => {
    const home = mkdtempSync(join(tmpdir(), "sp-scan-net-"));
    mkdirSync(join(home, ".claude", "projects", "p"), { recursive: true });
    writeFileSync(join(home, ".claude", "projects", "p", "s.jsonl"), JSON.stringify({ text: "token " + "ghp_" + "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7c" }) + "\n");
    const log = join(home, "net.log");
    writeFileSync(log, "");
    const hook = pathToFileURL(fileURLToPath(new URL("./fixtures/checkreply.mjs", import.meta.url))).href;
    const r = spawnSync(process.execPath, ["--import", TSX, "--import", hook, MAIN, "scan-chats", "--yes"], { cwd: home, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, ".config"), NETLOG: log } });
    expect(r.stdout).toContain("GitHub token");
    expect(readFileSync(log, "utf8")).toBe("");
  });
});
