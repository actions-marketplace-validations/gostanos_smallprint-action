/**
 * What the extension decides, with no editor in it, so every rule is tested without VS Code. Three watches:
 *  - an MCP server with a package identity: the public record's releases and advisories for it, once the person allowed
 *    the lookup (names and versions only, one request per server, the same request `smallprint gate` makes);
 *  - a skill: its files, hashed on this machine, compared with the last time;
 *  - an instruction file (CLAUDE.md, AGENTS.md, an .mcp.json, rules): hashed on this machine, compared with the last time.
 */
import { compareVersions, inRange } from "./range";

export type Grade = "critical" | "high" | "medium" | "low" | "info";
const RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
export const atLeast = (g: string | null | undefined, floor: Grade): boolean => (RANK[g ?? ""] ?? 0) >= RANK[floor]!;

/** What the entry API returns, only the fields used here. */
export interface RecordEntry {
  asset: { canonicalName: string; displayName: string; latestVersion: string | null; url: string };
  advisories: { id: string; severity: string; versionRange: string | null; summary: string; url: string; attribution?: string | null }[];
  releases: { from: string | null; to: string; publishedAt: string | null; worst: string; identical: boolean; summary: string; changes: { field: string; subject: string; severity: string; severityRule: string }[] }[];
}

export interface ServerState {
  canonicalName: string;
  /** The version found on this machine at the last check; null when it could not be read. */
  version: string | null;
  /** The newest version on record at the last check. */
  latestSeen: string | null;
  /** High and critical advisories already reported for this server. */
  advisoriesSeen: string[];
  checkedAt: string;
}

export interface Finding {
  key: string;
  kind: "text-changed" | "you-upgraded" | "advisory" | "skill-changed" | "file-changed";
  grade: Grade;
  title: string;
  detail: string;
  url?: string;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const subjects = (r: RecordEntry["releases"][number]) => [...new Set(r.changes.map((c) => c.subject))].slice(0, 3).join(", ");

/** Releases after `after`, oldest first; `after` null means none are new (the first check only takes a baseline). */
export function releasesAfter(entry: RecordEntry, after: string | null): RecordEntry["releases"] {
  if (!after) return [];
  return entry.releases.filter((r) => compareVersions(r.to, after) > 0).sort((a, b) => compareVersions(a.to, b.to));
}

/**
 * Compare one server's record now with what was seen last time. Returns the findings to show and the state to keep.
 * The first check keeps a baseline and reports only advisories that name the version found here.
 */
export function evaluateServer(key: string, name: string, version: string | null, entry: RecordEntry, prev: ServerState | undefined, now = new Date()): { findings: Finding[]; state: ServerState } {
  const findings: Finding[] = [];
  const latest = entry.asset.latestVersion;
  // new releases on record since the last check that changed the small print
  for (const r of releasesAfter(entry, prev?.latestSeen ?? null)) {
    if (r.identical || !r.changes.length) continue;
    const runs = version ? (compareVersions(version, r.to) >= 0 ? "you already run it" : `you run ${version}`) : "your config does not pin a version, so the next start may fetch it";
    findings.push({ key: `release:${key}:${r.to}`, kind: "text-changed", grade: (r.worst as Grade) ?? "info", title: `${name} ${r.to} changed what it tells your agent`, detail: `${plural(r.changes.length, "change")}, worst ${r.worst}${subjects(r) ? ` (${subjects(r)})` : ""}. ${runs[0]!.toUpperCase()}${runs.slice(1)}.`, url: entry.asset.url });
  }
  // this machine moved to another version since the last check: say what the record holds between the two
  if (prev?.version && version && prev.version !== version) {
    const between = entry.releases.filter((r) => compareVersions(r.to, prev.version!) > 0 && compareVersions(r.to, version) <= 0 && !r.identical && r.changes.length);
    const worst = between.reduce<Grade>((w, r) => (atLeast(r.worst, w) ? (r.worst as Grade) : w), "info");
    findings.push({ key: `upgrade:${key}:${version}`, kind: "you-upgraded", grade: between.length ? worst : "info", title: `${name} is now ${version} on this machine (was ${prev.version})`, detail: between.length ? `${plural(between.reduce((n, r) => n + r.changes.length, 0), "change")} to its small print in between, worst ${worst}.` : "The record holds no change to its small print in between.", url: entry.asset.url });
  }
  // high and critical advisories that name this version (or any version, when the version here is unknown), once each
  const seen = new Set(prev?.advisoriesSeen ?? []);
  const serious = entry.advisories.filter((a) => atLeast(a.severity, "high"));
  const applies = serious.filter((a) => !version || !a.versionRange || inRange(version, a.versionRange) !== false);
  for (const a of applies) {
    if (seen.has(a.id)) continue;
    findings.push({ key: `advisory:${key}:${a.id}`, kind: "advisory", grade: atLeast(a.severity, "critical") ? "critical" : "high", title: `${a.id} (${a.severity}) names ${name}${version ? ` ${version}` : ""}`, detail: `${/[.!?]$/.test(a.summary.trim()) ? a.summary.trim() : `${a.summary.trim()}.`}${a.versionRange ? ` Affected: ${a.versionRange}.` : ""}${version ? "" : " The version here is unknown, so check it against the range."}`, url: a.url });
  }
  return { findings, state: { canonicalName: entry.asset.canonicalName, version, latestSeen: latest ?? prev?.latestSeen ?? null, advisoriesSeen: [...new Set([...seen, ...applies.map((a) => a.id)])], checkedAt: now.toISOString() } };
}

/** A local hash compared with the last one; a first sighting is a baseline, not a finding. */
export function evaluateLocal(kind: "skill-changed" | "file-changed", key: string, label: string, hash: string, prev: string | undefined): Finding | null {
  if (!prev || prev === hash) return null;
  return kind === "skill-changed"
    ? { key: `skill:${key}:${hash.slice(0, 12)}`, kind, grade: "high", title: `The files of the skill ${label} changed on this machine`, detail: "A skill's instructions are read by your agent as written. If you did not update it, read it before your agent does." }
    : { key: `file:${key}:${hash.slice(0, 12)}`, kind, grade: "high", title: `${label} changed outside this editor`, detail: "Your agents read this file as instructions. If that was not you, read the change before your agent does." };
}

/** Whether a finding is worth a notification at the level the person chose. */
export function notifies(f: Finding, level: "high" | "any" | "none"): boolean {
  if (level === "none") return false;
  if (f.kind === "file-changed" || f.kind === "skill-changed" || f.kind === "advisory") return true;
  return level === "any" ? f.grade !== "info" : atLeast(f.grade, "high");
}

/**
 * The two settings that decide what leaves the machine and where it goes (security audit of 29 Sep 2026, item 40; tools
 * audit fix 7) are read from the user's own settings only. package.json marks them `"scope": "application"`, so VS Code
 * ignores a workspace's value, and the extension also reads the user-level value through `inspect`, so a repository's
 * .vscode/settings.json can neither turn the lookup on without asking nor point it at another address.
 */
export interface Inspected<T> {
  defaultValue?: T;
  globalValue?: T;
}

export function userSetting<T>(inspected: Inspected<T> | undefined, fallback: T): T {
  return inspected?.globalValue ?? inspected?.defaultValue ?? fallback;
}

export const DEFAULT_BASE = "https://smallprint.dev";

/** The record's address: https only, with no user name, password, query or fragment; anything else falls back to smallprint.dev. */
export function safeBase(value: string | undefined): string {
  try {
    const u = new URL((value ?? "").trim());
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return DEFAULT_BASE;
    return u.href.replace(/\/$/, "");
  } catch {
    return DEFAULT_BASE;
  }
}
