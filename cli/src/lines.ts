/**
 * Line memory for instruction files (decision 470). For each text instruction file the command already reads, the local
 * state file keeps a set of keyed hashes of its lines, never the text: each hash is HMAC-SHA256 under the machine's
 * salt (salt.ts), so the set means nothing off this machine and no copy of a file is ever stored, which matters because
 * instruction files sometimes hold keys. On the next run a line whose hash was not in the set is an added line, and the
 * number of hashes that are gone is the number of removed lines. The added lines are printed here, graded by grade.ts,
 * and sent nowhere.
 */
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { formatMatch, gradeLine, WHO_ADDED_IT, type LineMatch } from "./grade";
import { mcpConfigKinds, type InstructionBaseline, type InstructionFile, type InstructionRecord, type InstructionStatus } from "./instructions";
import { plural } from "./record";

/**
 * The most distinct lines remembered for one file. A file with more is remembered by its hash alone, as before, and
 * when it changes the command says its added lines cannot be shown and asks for the file to be read. 5,000 lines is
 * several times the longest instruction file we have seen; a set that size is about 85 KB in the state file.
 */
export const LINE_CAP = 5000;
/** Added lines printed per file; the rest are counted. */
export const SHOWN_MAX = 20;
/** Characters printed per added line; a longer line is clipped and ends in "…". */
export const CLIP_AT = 200;
/** Hex characters kept of each line hash: 64 bits, enough that two lines of one file never share one. */
const HASH_HEX = 16;

/**
 * Whether a file's lines are remembered: Markdown, plain text and the rules files that have no extension
 * (.cursorrules, .windsurfrules, .clinerules). Settings, server definitions and scripts are not, because a line of
 * those can be a key or a token (an env value), and printing it would put the secret in a terminal or a CI log; they
 * keep the one-line report, and a settings file still names the section that changed.
 */
let serverKinds: Set<string> | undefined;
export function remembersLines(file: Pick<InstructionFile, "path" | "kind">): boolean {
  serverKinds ??= new Set(mcpConfigKinds());
  if (serverKinds.has(file.kind)) return false;
  const name = basename(file.path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return true; // no extension, or a dotfile such as .cursorrules
  return [".md", ".mdc", ".markdown", ".txt"].includes(name.slice(dot).toLowerCase());
}

/** The lines that count, with their line numbers: line endings normalised, trailing spaces and tabs trimmed, empty lines skipped. */
export function textLines(text: string): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = raw.replace(/[ \t]+$/, "");
    if (line) out.push({ n: i + 1, text: line });
  });
  return out;
}

/** How a line is hashed: keyed with the machine's salt for the state file, plain for a project file in a committed lock. */
export type LineHasher = (line: string) => string;
export const keyedLineHasher = (key: string): LineHasher => (line) => createHmac("sha256", Buffer.from(key, "hex")).update(`line\0${line}`).digest("hex").slice(0, HASH_HEX);
export const plainLineHasher: LineHasher = (line) => createHash("sha256").update(`line\0${line}`).digest("hex").slice(0, HASH_HEX);

/** A short name for the key a set was made with, so a set made under another salt is never compared (it would read as all new). */
export const keyId = (key: string): string => createHmac("sha256", Buffer.from(key, "hex")).update("line-set-key").digest("hex").slice(0, 12);

/** What is stored for one file: the sorted set, space-separated (no order, so the order of lines is not kept either), or the count when it is over the cap. */
export type LineMemory = { lines: string } | { linesOver: number };

export function lineMemory(text: string, hash: LineHasher): LineMemory {
  const set = new Set(textLines(text).map((l) => hash(l.text)));
  if (set.size > LINE_CAP) return { linesOver: set.size };
  return { lines: [...set].sort().join(" ") };
}

export interface AddedLine {
  n: number;
  text: string;
  grades: LineMatch[];
}

/** What changed in one file's lines. */
export type LineChange =
  /**
   * No set to compare with: the file is new, the state is from a version before line memory, or the salt changed. The
   * set is recorded now. The lines already there are read once for the high-grade rules only (decision 499): a line that
   * hides characters, moves data out or tells the agent to keep something from the person is shown, so something risky
   * that was in the file before the command first read it is not passed over as the baseline. Nothing else is graded.
   */
  | { kind: "first"; existing: AddedLine[] }
  /** The file is over the cap now (`before` false), or was at the last run and so has no set to compare with (`before` true). */
  | { kind: "over"; count: number; before: boolean }
  | { kind: "diff"; added: AddedLine[]; removed: number };

/** The lines of a file seen for the first time that match a high-grade rule, each with its high grades only (decision 499). */
export function firstLook(text: string): AddedLine[] {
  const out: AddedLine[] = [];
  const seen = new Set<string>();
  for (const l of textLines(text)) {
    if (seen.has(l.text)) continue;
    seen.add(l.text);
    const grades = gradeLine(l.text).filter((g) => g.severity === "high");
    if (grades.length) out.push({ n: l.n, text: l.text, grades });
  }
  return out;
}

/** Printed under every line the first look shows, word for word (decision 499). */
export const ALREADY_THERE = "This line was already in the file the first time the command read it. If you did not write it, find out where it came from before your agent runs again.";

/** Compare a file's text with the set recorded for it; every added line is graded. */
export function diffLines(previous: LineMemory | undefined, text: string, hash: LineHasher): { change: LineChange; memory: LineMemory } {
  const memory = lineMemory(text, hash);
  if ("linesOver" in memory) return { change: { kind: "over", count: memory.linesOver, before: false }, memory };
  if (!previous) return { change: { kind: "first", existing: firstLook(text) }, memory };
  if ("linesOver" in previous) return { change: { kind: "over", count: previous.linesOver, before: true }, memory };
  const before = new Set(previous.lines ? previous.lines.split(" ") : []);
  const now = new Set(memory.lines ? memory.lines.split(" ") : []);
  const added: AddedLine[] = [];
  const seen = new Set<string>();
  for (const l of textLines(text)) {
    const h = hash(l.text);
    if (before.has(h) || seen.has(h)) continue;
    seen.add(h);
    added.push({ n: l.n, text: l.text, grades: gradeLine(l.text) });
  }
  let removed = 0;
  for (const h of before) if (!now.has(h)) removed++;
  return { change: { kind: "diff", added, removed }, memory };
}

/** The file's text, or null when it cannot be read now. */
export function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * A line as it can be printed safely: every character that does not show, or that a terminal would act on (an escape
 * sequence, a direction control, a zero-width character), is written out as its code point, e.g. <U+200B>, so the
 * reader sees what the agent reads. Clipped to CLIP_AT characters first.
 */
export function visible(text: string): string {
  const chars = [...text];
  const clipped = chars.length > CLIP_AT ? chars.slice(0, CLIP_AT).join("") + "…" : text;
  return clipped.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\p{Cf}\u034F\u180E\u2028\u2029]/gu, (c) => `<U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}>`);
}

/**
 * The lines printed under a file's CHANGED line: the counts, up to SHOWN_MAX added lines with their line numbers
 * (graded lines first, so twenty harmless lines cannot push a graded one out of sight; printed in file order), each
 * graded line's rules and the one sentence about who added it, and a count of what is not shown.
 */
export function formatLineChange(change: LineChange, indent = "      "): string[] {
  if (change.kind === "first") {
    const recorded = `${indent}Its lines are recorded from this run on, so the next change to it shows the lines that were added.`;
    if (!change.existing.length) return [recorded];
    const lines = [`${indent}First look: ${plural(change.existing.length, "line already in this file matches", "lines already in this file match")} a high grading rule.`];
    for (const a of change.existing.slice(0, SHOWN_MAX)) {
      lines.push(`${indent}line ${a.n}: ${visible(a.text)}`);
      for (const g of a.grades) lines.push(`${indent}  ${formatMatch(g)}`);
      lines.push(`${indent}  ${ALREADY_THERE}`);
    }
    const rest = change.existing.length - Math.min(change.existing.length, SHOWN_MAX);
    if (rest > 0) lines.push(`${indent}${plural(rest, "more such line is", "more such lines are")} not shown here. Read the file to see them.`);
    lines.push(recorded);
    return lines;
  }
  if (change.kind === "over" && change.before) return [`${indent}At the last run this file had ${plural(change.count, "distinct line")}, more than the ${LINE_CAP.toLocaleString("en-US")} the command remembers, so the added lines cannot be shown. Its lines are recorded from this run on. Read the file.`];
  if (change.kind === "over") return [`${indent}This file has ${plural(change.count, "distinct line")}, more than the ${LINE_CAP.toLocaleString("en-US")} the command remembers, so the added lines cannot be shown. Read the file.`];
  const { added, removed } = change;
  const lines: string[] = [];
  const graded = added.filter((a) => a.grades.length).length;
  lines.push(`${indent}${added.length ? plural(added.length, "line") : "No line"} added and ${removed ? plural(removed, "line") : "none"} removed${graded ? `; ${plural(graded, "added line matches", "added lines match")} a grading rule` : ""}.`);
  if (!added.length && !removed) lines.push(`${indent}The same lines are there, so the change is in their order, in blank lines or in trailing spaces.`);
  const pick = new Set([...added.filter((a) => a.grades.length), ...added.filter((a) => !a.grades.length)].slice(0, SHOWN_MAX));
  for (const a of added) {
    if (!pick.has(a)) continue;
    lines.push(`${indent}line ${a.n}: ${visible(a.text)}`);
    const order = { high: 0, medium: 1 };
    for (const g of [...a.grades].sort((x, y) => order[x.severity] - order[y.severity])) lines.push(`${indent}  ${formatMatch(g)}`);
    if (a.grades.length) lines.push(`${indent}  ${WHO_ADDED_IT}`);
  }
  const rest = added.length - pick.size;
  if (rest > 0) lines.push(`${indent}${plural(rest, "more added line is", "more added lines are")} not shown here. Read the file to see them.`);
  return lines;
}

const memoryOf = (r: { lines?: string | undefined; linesOver?: number | undefined } | undefined): LineMemory | undefined => (!r ? undefined : typeof r.linesOver === "number" ? { linesOver: r.linesOver } : typeof r.lines === "string" ? { lines: r.lines } : undefined);
const withMemory = (r: InstructionRecord, m: LineMemory): InstructionRecord => {
  const { lines: _lines, linesOver: _over, ...rest } = r;
  return { ...rest, ...m };
};

/**
 * Line memory for one run of `check`: reads each text file that is new, changed, or has no set yet, records its set in
 * `next` (the baseline compareInstructions returned), and returns what changed for each CHANGED file. `sameKey` is
 * false when the sets on file were made under another salt, or the state has none: every file is then recorded and
 * nothing is graded, the first run's rule. An unchanged file with a set keeps it without being read again.
 */
export function rememberLines(statuses: readonly InstructionStatus[], previous: InstructionBaseline, next: InstructionBaseline, key: string, sameKey: boolean, read: (path: string) => string | null = readText): Map<string, LineChange> {
  const out = new Map<string, LineChange>();
  const hash = keyedLineHasher(key);
  for (const s of statuses) {
    if (s.status === "removed" || !remembersLines(s.file)) continue;
    const path = s.file.path;
    const before = sameKey ? memoryOf(previous[path]) : undefined;
    if (s.status === "unchanged" && before) continue;
    const text = read(path);
    const rec = next[path];
    if (text === null || !rec) continue;
    const { change, memory } = diffLines(s.status === "new" ? undefined : before, text, hash);
    next[path] = withMemory(rec, memory);
    // a changed file shows its added lines; a file read for the first time shows only lines that match a high rule
    if (s.status === "changed" || (change.kind === "first" && change.existing.length)) out.set(path, change);
  }
  return out;
}

/** A lock's entry for one file, with what it keeps of the file's lines. */
export interface LockLines {
  lines?: string;
  linesOver?: number;
  /** For a home file: the short name of the salt its line hashes were keyed with (keyId). Absent: plain hashes. */
  linesKey?: string;
}

/** What a lock keeps of one file's lines: plain hashes for a project file, keyed with this machine's salt for a home file, nothing for a file whose lines are not remembered. */
export function lockLineMemory(file: Pick<InstructionFile, "path" | "kind" | "scope">, key: string | undefined, read: (path: string) => string | null = readText): LockLines | undefined {
  if (!remembersLines(file)) return undefined;
  const text = file.scope === "home" && !key ? null : read(file.path);
  if (text === null) return undefined;
  if (file.scope === "home") return { ...lineMemory(text, keyedLineHasher(key!)), linesKey: keyId(key!) };
  return lineMemory(text, plainLineHasher);
}

/** The lines printed under a file the lock check found CHANGED. */
export function lockedLineChange(entry: LockLines & { kind: string }, absolutePath: string, key: string | undefined, read: (path: string) => string | null = readText): string[] {
  const indent = "      ";
  if (!remembersLines({ path: absolutePath, kind: entry.kind })) return [];
  const before = memoryOf(entry);
  if (!before) return [`${indent}The lock was written before it kept line hashes, so the added lines cannot be shown. Run smallprint lock again to keep them from now on.`];
  let hash: LineHasher = plainLineHasher;
  if (entry.linesKey) {
    if (!key || keyId(key) !== entry.linesKey) return [`${indent}The lock's line hashes for this file were made on another machine, so the added lines cannot be shown here.`];
    hash = keyedLineHasher(key);
  }
  const text = read(absolutePath);
  if (text === null) return [];
  return formatLineChange(diffLines(before, text, hash).change, indent);
}
