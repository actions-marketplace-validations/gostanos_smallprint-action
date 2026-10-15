/**
 * `smallprint scan-chats` (decision 513): look through the conversation logs that agents keep on this machine for keys
 * and passwords that were pasted into a chat or printed by a tool. Only this command runs it, and only after a yes.
 *
 * It reads; it never changes, redacts or deletes a log, and it sends nothing. A found value is held in memory only long
 * enough to mask it: the output names the file, the line, the kind of secret and at most the first four characters,
 * and nothing found is written to disk or to a log.
 *
 * Where it reads, the places each agent keeps its logs:
 *   Claude Code  ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects), the .jsonl session files
 *   Codex        ~/.codex/sessions (or $CODEX_HOME/sessions), the session files, and ~/.codex/history.jsonl
 *   Gemini CLI   ~/.gemini/tmp/<project>/chats, the saved sessions
 */
import { createReadStream, existsSync, lstatSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { visible } from "./lines";

export interface ChatSource {
  agent: string;
  /** A folder, or one file. */
  path: string;
  /** Which files under the folder are transcripts, by their path relative to it (forward slashes). */
  match: (rel: string) => boolean;
}

export function chatSources(home: string, env: NodeJS.ProcessEnv = process.env): ChatSource[] {
  const claude = env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const codex = env.CODEX_HOME || join(home, ".codex");
  return [
    { agent: "Claude Code", path: join(claude, "projects"), match: (r) => r.endsWith(".jsonl") },
    { agent: "Codex", path: join(codex, "sessions"), match: (r) => r.endsWith(".jsonl") || r.endsWith(".json") },
    { agent: "Codex", path: join(codex, "history.jsonl"), match: () => true },
    { agent: "Gemini CLI", path: join(home, ".gemini", "tmp"), match: (r) => /^[^/]+\/chats\/[^/]+\.jsonl?$/.test(r) },
  ];
}

export interface SecretPattern {
  kind: string;
  /** Cheap test before the expression runs: a substring the line must hold (compared in lower case when `lower`). */
  hint: string;
  lower?: boolean;
  re: RegExp;
  /** Which group holds the secret value; 0 for the whole match. */
  group: number;
  /** A value that is a placeholder or an example, not a secret. */
  skip?: (value: string) => boolean;
}

/** Words that mark a value as a placeholder rather than a secret. */
const PLACEHOLDER = /(?:example|placeholder|your[_-]?|redacted|dummy|changeme|change[_-]me|xxxx|\*\*\*|\.\.\.|<|>|\{|\}|\$)/i;
const lowVariety = (v: string): boolean => new Set(v).size < Math.min(8, Math.ceil(v.length / 3));
const placeholder = (v: string): boolean => PLACEHOLDER.test(v) || lowVariety(v);

/** Values that are names of things in code or common stand-ins, not passwords. */
const NOT_A_PASSWORD = new Set(["password", "passwd", "pass", "pwd", "secret", "changeme", "admin", "root", "none", "null", "true", "false", "undefined", "string", "required", "hunter2", "letmein", "test", "testing", "foobar", "mysecret", "mypassword", "yourpassword", "123456", "12345678", "qwerty"]);
function notPassword(v: string): boolean {
  const low = v.toLowerCase();
  if (NOT_A_PASSWORD.has(low)) return true;
  if (/^[$%{<(@*/~.]/.test(v) || /[()[\]]/.test(v)) return true; // a variable, a template or a call
  if (/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(v)) return true; // args.password, self.pwd
  if (/^[a-z_][a-z0-9_]*$/.test(v) && v.includes("_")) return true; // password_hash, user_password
  if (/^[A-Z_][A-Z0-9_]*$/.test(v) && v.includes("_")) return true; // DB_PASSWORD
  return placeholder(v);
}

// Edges: a key is not part of a longer run of letters, digits or base64, so text inside an image's base64 is not taken for one.
const L = "(?<![A-Za-z0-9/+_-])";
const R = "(?![A-Za-z0-9/+=_-])";

export const PATTERNS: readonly SecretPattern[] = [
  { kind: "AWS access key ID", hint: "A", re: new RegExp(`${L}((?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[A-Z0-9]{16})${R}`, "g"), group: 1, skip: (v) => /EXAMPLE$/.test(v) || lowVariety(v.slice(4)) },
  { kind: "AWS secret access key", hint: "aws_secret_access_key", lower: true, re: /aws_?secret_?access_?key\\?["']?\s*[:=]\s*\\?["']?([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+=])/gi, group: 1, skip: (v) => /EXAMPLEKEY$/.test(v) || placeholder(v) },
  { kind: "GitHub token", hint: "_", re: new RegExp(`${L}(gh[pousr]_[A-Za-z0-9]{36})${R}`, "g"), group: 1, skip: (v) => placeholder(v.slice(4)) },
  { kind: "GitHub token", hint: "github_pat_", re: new RegExp(`${L}(github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59})${R}`, "g"), group: 1, skip: (v) => placeholder(v.slice(11)) },
  { kind: "Anthropic API key", hint: "sk-ant-", re: new RegExp(`${L}(sk-ant-(?:api|admin)\\d{2}-[A-Za-z0-9_-]{80,120})${R}`, "g"), group: 1, skip: (v) => placeholder(v.slice(14)) },
  { kind: "OpenAI API key", hint: "sk-", re: new RegExp(`${L}(sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,200})${R}`, "g"), group: 1, skip: (v) => placeholder(v.slice(8)) },
  { kind: "OpenAI API key", hint: "T3BlbkFJ", re: new RegExp(`${L}(sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20})${R}`, "g"), group: 1 },
  { kind: "Stripe secret key", hint: "k_", re: new RegExp(`${L}((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,99})${R}`, "g"), group: 1, skip: (v) => placeholder(v.slice(8)) },
  { kind: "Stripe webhook secret", hint: "whsec_", re: new RegExp(`${L}(whsec_[A-Za-z0-9]{32,64})${R}`, "g"), group: 1, skip: (v) => placeholder(v.slice(6)) },
  { kind: "Slack token", hint: "xox", re: new RegExp(`${L}(xox[abposr]-[0-9]{6,}-[A-Za-z0-9-]{10,})${R}`, "g"), group: 1, skip: (v) => placeholder(v) },
  { kind: "Slack token", hint: "xapp-", re: new RegExp(`${L}(xapp-\\d-[A-Z0-9]{9,}-\\d{6,}-[a-f0-9]{32,})${R}`, "g"), group: 1 },
  { kind: "Slack webhook address", hint: "hooks.slack.com", re: /(https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{6,}\/B[A-Z0-9]{6,}\/[A-Za-z0-9]{20,})/g, group: 1, skip: (v) => placeholder(v.slice(-24)) },
  // a key block counts when the base64 body follows the header, so a mention of the header in documentation does not
  { kind: "Private key block", hint: "PRIVATE KEY", re: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----)(?:\\[rn]|\s)+(?:[A-Za-z-]+: [^\\\n]*(?:\\[rn]|\s)+)*[A-Za-z0-9+/=]{40,}/g, group: 1 },
  // user:password@host in an address; the user part and the password stop at characters an address cannot hold there
  { kind: "Password inside an address", hint: "://", re: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[A-Za-z0-9._~%!$&'*+,;=-]{1,64}:([A-Za-z0-9._~%!$&'*+,;=-]{4,128})@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b[a-z][a-z0-9+.-]{1,20}:\/\/[A-Za-z0-9._~%!$&'*+,;=-]{1,64}:([A-Za-z0-9._~%!$&'*+,;=-]{4,128})@(?:localhost|\d{1,3}(?:\.\d{1,3}){3})\b/g, group: -1, skip: notPassword },
  // NAME_PASSWORD=value, password = "value": an assignment with =, never a comparison (==, !=, <=, >=)
  { kind: "Password assignment", hint: "pass", lower: true, re: /(?<![A-Za-z0-9])(?:[A-Za-z0-9]+_)*(?:password|passwd)(?![A-Za-z0-9])\\?["']?\s*(?<![!<>=])=(?!=)\s*\\?["']?([^\s"'\\&;,`]{6,128})/gi, group: 1, skip: notPassword },
];

/** At most the first four characters, fewer for a short value, then "…". */
export function mask(value: string): string {
  return `${value.slice(0, Math.min(4, Math.floor(value.length / 4)))}…`;
}

export interface Finding {
  file: string;
  line: number;
  kind: string;
  preview: string;
}

/** The findings in one line of text: kind and masked preview, once for each value. The values themselves are not returned. */
export function findInLine(text: string): { kind: string; preview: string }[] {
  const out: { kind: string; preview: string }[] = [];
  const seen = new Set<string>();
  let lower: string | null = null;
  for (const p of PATTERNS) {
    if (p.lower) {
      lower ??= text.toLowerCase();
      if (!lower.includes(p.hint)) continue;
    } else if (!text.includes(p.hint)) continue;
    p.re.lastIndex = 0;
    for (const m of text.matchAll(p.re)) {
      const value = p.group === -1 ? (m.slice(1).find((g) => g !== undefined) ?? "") : (m[p.group] ?? "");
      if (!value || p.skip?.(value)) continue;
      const key = `${p.kind}\u0000${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: p.kind, preview: mask(value) });
    }
  }
  return out;
}

/** Every transcript file under a source, symbolic links not followed, at most ten folders deep. */
export function transcriptFiles(src: ChatSource): string[] {
  let st;
  try { st = lstatSync(src.path); } catch { return []; }
  if (st.isFile()) return [src.path];
  if (!st.isDirectory()) return [];
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 10) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && src.match(relative(src.path, full).split(sep).join("/"))) out.push(full);
    }
  };
  walk(src.path, 0);
  return out.sort();
}

/** Read one file a line at a time and return its findings. */
export async function scanFile(path: string, shown: string): Promise<Finding[]> {
  const out: Finding[] = [];
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    n++;
    for (const f of findInLine(line)) out.push({ file: shown, line: n, ...f });
  }
  return out;
}

export interface ScanResult {
  sources: { agent: string; path: string; present: boolean; files: number }[];
  filesRead: number;
  unreadable: string[];
  findings: Finding[];
}

export async function scanChats(sources: readonly ChatSource[], shorten: (p: string) => string): Promise<ScanResult> {
  const result: ScanResult = { sources: [], filesRead: 0, unreadable: [], findings: [] };
  for (const src of sources) {
    const present = existsSync(src.path);
    const files = present ? transcriptFiles(src) : [];
    result.sources.push({ agent: src.agent, path: shorten(src.path), present, files: files.length });
    for (const f of files) {
      try {
        result.findings.push(...(await scanFile(f, shorten(f))));
        result.filesRead++;
      } catch {
        result.unreadable.push(shorten(f));
      }
    }
  }
  return result;
}

export function countByKind(findings: readonly Finding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[f.kind] = (out[f.kind] ?? 0) + 1;
  return out;
}

export const SCAN_QUESTION = "This reads your agents' conversation logs on this machine to look for keys and passwords. Nothing is sent. Continue? [y/N] ";

/** The lines the command prints for a scan. */
export function formatScan(r: ScanResult): string[] {
  const lines: string[] = [];
  lines.push(`Looked in ${r.sources.length} places:`);
  for (const s of r.sources) lines.push(`  ${s.agent}  ${s.path}  ${s.present ? `${s.files} file${s.files === 1 ? "" : "s"}` : "not on this machine"}`);
  for (const u of r.unreadable) lines.push(`  could not read ${u}`);
  lines.push("");
  if (r.findings.length) {
    lines.push("Possible secrets (each shown with at most its first four characters):");
    for (const f of r.findings) lines.push(`  ${visible(f.file)}:${f.line}  ${f.kind}  ${visible(f.preview)}`);
    lines.push("");
  }
  const by = Object.entries(countByKind(r.findings)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  lines.push(`Read ${r.filesRead} file${r.filesRead === 1 ? "" : "s"}. ${r.findings.length ? `Found ${r.findings.length} possible secret${r.findings.length === 1 ? "" : "s"}: ${by.map(([k, n]) => `${n} ${k}`).join(", ")}.` : "Found nothing that matches the kinds of keys and passwords this command looks for. A secret in another form would not be found."}`);
  if (r.findings.length) {
    lines.push("These are matches to patterns, and this command cannot tell which ones are real or whether one has been used. Text in these logs may have been sent to an AI model during a conversation. If one of them is a real key or password, consider replacing it where it was issued; removing it from the log does not change where the text has already been.");
  }
  lines.push("Nothing was sent, and no log file was changed.");
  return lines;
}
