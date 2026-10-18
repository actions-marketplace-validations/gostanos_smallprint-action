/**
 * Which advisories on record apply to the version this machine runs (tools audit of 29 Sep 2026, fix 1). The gate used
 * to count every high or critical advisory that named the package, whatever its range, so the reference filesystem
 * server failed every gate on a fixed version. An advisory now fails the gate only when its range covers the installed
 * version. An advisory whose range cannot be read, or a server whose version is not known, is reported as "range
 * unknown" and counted with the other unknowns, which fail only under --strict.
 */
import { inRange } from "./range";
import { changesSmallPrint, textChanges } from "./release";

export interface GateAdvisory {
  id: string;
  severity: string;
  versionRange: string | null;
}

export interface AdvisoryVerdict {
  /** High or critical, and the range covers the installed version. */
  applies: GateAdvisory[];
  /** High or critical, but the range does not cover the installed version. */
  notCovering: GateAdvisory[];
  /** High or critical, and either the range cannot be read or the installed version is not known. */
  rangeUnknown: GateAdvisory[];
}

export function serious(a: GateAdvisory): boolean {
  return a.severity === "critical" || a.severity === "high";
}

export function advisoriesForVersion(advisories: readonly GateAdvisory[], installed: string | null): AdvisoryVerdict {
  const out: AdvisoryVerdict = { applies: [], notCovering: [], rangeUnknown: [] };
  for (const a of advisories) {
    if (!serious(a)) continue;
    if (!installed || !a.versionRange) {
      out.rangeUnknown.push(a);
      continue;
    }
    const hit = inRange(installed, a.versionRange);
    if (hit === true) out.applies.push(a);
    else if (hit === false) out.notCovering.push(a);
    else out.rangeUnknown.push(a);
  }
  return out;
}

/** The words the gate prints for one server's advisories; empty when there is nothing serious on record. */
export function advisoryWords(v: AdvisoryVerdict, installed: string | null): string[] {
  const words: string[] = [];
  const ids = (xs: GateAdvisory[]) => xs.map((a) => a.id).join(", ");
  const n = (xs: GateAdvisory[], one: string, many: string) => `${xs.length} high or critical ${xs.length === 1 ? one : many}`;
  if (v.applies.length) words.push(`${n(v.applies, "advisory covers", "advisories cover")} ${installed}: ${ids(v.applies)}`);
  if (v.rangeUnknown.length) words.push(`${n(v.rangeUnknown, "advisory", "advisories")}, range unknown${installed ? "" : " because the version here is not known"}, check the range: ${ids(v.rangeUnknown)}`);
  if (v.notCovering.length) words.push(`${n(v.notCovering, "advisory on record does", "advisories on record do")} not cover ${installed}: ${ids(v.notCovering)}`);
  return words;
}

/** The parts of the site's /api/asset answer the gate reads. */
export interface GateRecord {
  asset: { latestVersion: string | null; url: string };
  baseline?: { version: string } | null;
  advisories: GateAdvisory[];
  releases: { from: string | null; to: string; publishedAt: string | null; worst: string; identical: boolean; changes?: { field: string; severity?: string }[] }[];
  versions: { version: string; publishedAt: string | null; read?: boolean; contentHash: string | null }[];
  /** The record's counts: `versions` lists only the newest ones (the read API's window), so a missing version may be older. */
  counts?: { versions?: number };
}

export interface GateVerdict {
  /** "!" for something that fails the gate, "?" for something it cannot answer, "ok" otherwise. */
  mark: "!" | "?" | "ok";
  /** The parts of the printed line after the server's name. */
  words: string[];
  changed: boolean;
  advisory: boolean;
  unknown: boolean;
}

const RANK_ORDER = ["info", "low", "medium", "high", "critical"];

type Row = GateRecord["versions"][number];
type GateRelease = GateRecord["releases"][number];
/** The parts of an answer that say what was compared: the editor extensions read these too (they bundle this file). */
export type ComparedRecord<R extends GateRelease = GateRelease> = { releases: readonly R[]; versions: readonly Row[]; counts?: { versions?: number } | undefined };

const rowOf = (e: Pick<ComparedRecord, "versions">, v: string | null | undefined): Row | undefined => (v ? e.versions.find((x) => x.version === v) : undefined);

/**
 * Why one version has no tool text the record can compare, in the gate's words. A version missing from the newest ones
 * listed is not said to be off the record (pass 3 audit of 16 Oct 2026: mcp-remote 0.1.16 is on record, past the newest
 * 50, and the gate said "is not on the record").
 */
export function noTextWords(e: Pick<ComparedRecord, "versions" | "counts">, v: string): string {
  const r = rowOf(e, v);
  const cut = (e.counts?.versions ?? e.versions.length) > e.versions.length;
  if (!r) return cut ? `version ${v} is not among the newest ${e.versions.length} versions the record lists` : `version ${v} is not on the record`;
  return r.read ? `the record holds no tool text for version ${v}, so there is nothing to compare` : `version ${v} is on the record but its small print was not read`;
}

/**
 * The worst grade of the changes to the small print alone: a release's own `worst` counts its install script too, so one
 * medium description change beside a high install script read "worst high" here and "worst medium" in smallprint-mcp
 * (pass 4 audit of 16 Oct 2026).
 */
export const worstTextGrade = (rs: readonly GateRelease[]): string => rs.flatMap((r) => textChanges(r)).reduce<string>((w, c) => (c.severity && RANK_ORDER.indexOf(c.severity) > RANK_ORDER.indexOf(w) ? c.severity : w), "info");

/** What the record holds between two versions of one entry (betweenVersions). */
export type Between<R extends GateRelease = GateRelease> =
  | { state: "no-text"; version: string; why: string }
  | { state: "changed"; releases: R[]; worst: string }
  | { state: "not-compared" }
  | { state: "no-change" };

/**
 * What the record holds between two versions of one entry, the one rule the gate and both editor extensions read. Only
 * the releases strictly after the earlier version and up to the later one, by publish date as the record orders them,
 * count, and only those that hold a change to the small print. Two versions whose fingerprints differ, with a read
 * version between them that no release on record reaches, were not compared: "no change" is not said for them (pass 5
 * audit of 16 Oct 2026: sqry-mcp 32.0.1 and 33.0.1). A version with no tool text has nothing to compare. Until the pass 6
 * audit of 16 Oct 2026 the extensions counted every release that ended between the two, so a release that started before
 * the earlier version (@vicsee/mcp-server 0.3.3 to 0.4.1, read against a machine that moved from 0.4.0) was said to fall
 * between them, and they said "no change" between versions the record never compared (atom-mcp-server 1.1.0 and 2.1.0).
 */
export function betweenVersions<R extends GateRelease>(e: ComparedRecord<R>, from: string, to: string): Between<R> {
  for (const v of [to, from]) if (!rowOf(e, v)?.contentHash) return { state: "no-text", version: v, why: noTextWords(e, v) };
  const [a, b] = [rowOf(e, from)!, rowOf(e, to)!];
  if (from === to) return { state: "no-change" };
  const [lo, hi] = [a.publishedAt ?? "", b.publishedAt ?? ""].sort() as [string, string];
  const moved = e.releases.filter((r) => changesSmallPrint(r) && (r.publishedAt ?? "") > lo && (r.publishedAt ?? "") <= hi);
  if (moved.length) return { state: "changed", releases: moved, worst: worstTextGrade(moved) };
  const uncompared = a.contentHash !== b.contentHash && e.versions.some((x) => x.contentHash && (x.publishedAt ?? "") > lo && (x.publishedAt ?? "") <= hi && !e.releases.some((r) => r.to === x.version));
  return uncompared ? { state: "not-compared" } : { state: "no-change" };
}

/**
 * One server against the record (tools audit of 4 Oct 2026, fixes 6 and 11). Three questions, each answered only when
 * the record can answer it:
 *
 *  - Did what this machine runs change since the lock? The version it runs is the pinned one, or the latest on record
 *    when the config pins none. It is compared with the version in the lock, and only the releases between the two
 *    count. A server pinned to the version in its lock has not changed, however many releases came after it: those are
 *    printed as news and do not fail the gate. Before this, every later release failed the gate on every run, for
 *    exactly the people who pin. A release counts only when it holds a change to the small print (decision 523): a
 *    fingerprint that moved with no change written down is not one, and until 16 Oct 2026 the gate exited 2 for it.
 *  - Is there tool text on record to compare? A version with no tool text on record has none, and the answer is
 *    "unknown", never "unchanged".
 *  - Does a high or critical advisory's range cover the version it runs?
 */
export function gateServer(e: GateRecord, installed: string | null, locked: { version: string | null; recordSha256?: string } | undefined): GateVerdict {
  const words: string[] = [];
  let changed = false;
  let unknown = false;
  const row = (v: string | null | undefined) => rowOf(e, v);
  // the lock's copy of the record digest for the locked version against the record now (decision 224). A digest is a
  // fingerprint, and a fingerprint that moved alone is not a change to the small print (decision 523): it is said, and
  // counted with the unknowns
  if (locked?.recordSha256 && locked.version) {
    const now = row(locked.version)?.contentHash;
    if (now && now !== locked.recordSha256) {
      words.push(`the record's digest for ${locked.version} changed since the lock was written (was ${locked.recordSha256.slice(0, 12)}, now ${now.slice(0, 12)})`);
      unknown = true;
    }
  }
  const latest = e.asset.latestVersion ?? e.baseline?.version ?? null;
  const runs = installed ?? latest;
  const runsRow = row(runs);
  const from = locked?.version ?? null;
  const fromRow = row(from);
  const noText = (v: string) => noTextWords(e, v);
  // what starts next is not predicted: the source can publish after the record's last read, and a cached copy can start
  // instead (pass 4 audit of 16 Oct 2026: "the next start runs the latest, 1.1.7" when PyPI held 1.5.0)
  const unpinned = installed ? "" : "not pinned, so the version that starts can change; ";
  if (!runs) {
    words.push("no version to compare: the config pins none and the record has none");
    unknown = true;
  } else if (!runsRow?.contentHash) {
    words.push(`${unpinned}${noText(runs)}`);
    unknown = true;
  } else if (from && !fromRow?.contentHash) {
    words.push(`${unpinned}the lock holds ${from}: ${noText(from)}, so it cannot be compared with ${runs}`);
    unknown = true;
  } else {
    const releases = (n: number) => `${n} release${n === 1 ? "" : "s"}`;
    if (from && fromRow) {
      // both versions have tool text here, so the answer is a change, no comparison, or no change (betweenVersions); the
      // last branch below is only ever reached with "no-change"
      const b = betweenVersions(e, from, runs);
      const latestWords = installed ? "" : ", the newest on record (the config pins no version)";
      if (b.state === "changed") {
        words.push(`a change to the small print is on record between ${from} in the lock and ${runs}${latestWords}: ${releases(b.releases.length)}, worst ${b.worst}`);
        changed = true;
      } else if (b.state === "not-compared") {
        words.push(`not compared between ${from} in the lock and ${runs}${latestWords}: their fingerprints differ, and the record does not compare every version in between`);
        unknown = true;
      } else words.push(from !== runs ? `no change to the small print is on record between ${from} in the lock and ${runs}${latestWords}` : installed ? `runs ${runs}, the version in the lock` : `the newest on record, ${runs}, is the version in the lock (the config pins no version)`);
    } else if (installed) words.push(`pinned at ${runs}; no lock entry to compare it with`);
    else {
      // nothing pins it and no lock says what was read: what runs can change on any start, and the gate cannot say it has not
      words.push(`not pinned, so the version that starts can change; the newest on record is ${runs}, and no lock entry says which version was read; pin a version or write a lock`);
      unknown = true;
    }
    // releases later than the one this machine runs: news for whoever pins, never a failure
    if (installed && latest && latest !== installed) {
      const later = e.releases.filter((r) => changesSmallPrint(r) && (r.publishedAt ?? "") > (runsRow.publishedAt ?? ""));
      if (later.length) words.push(`${releases(later.length)} after ${installed} changed the small print, worst ${worstTextGrade(later)}; read the entry page before you move up`);
    }
  }
  // an advisory counts only when its range covers the version this machine runs; an unreadable range or an unknown version is said plainly
  const adv = advisoriesForVersion(e.advisories, installed);
  words.push(...advisoryWords(adv, installed));
  if (adv.rangeUnknown.length) unknown = true;
  const advisory = adv.applies.length > 0;
  return { mark: changed || advisory ? "!" : unknown ? "?" : "ok", words, changed, advisory, unknown };
}

/**
 * The gate's exit code: 3 when a high or critical advisory covers a version this machine runs, whatever else is true,
 * so a script that tests for 3 never misses one; otherwise 2 when something changed, or with --strict when something
 * could not be answered; otherwise 0. Before this a change, or --strict with an unknown, turned an advisory's 3 into 2.
 */
export function gateExit(c: { changed: number; advisories: number; unknown: number }, strict: boolean): 0 | 2 | 3 {
  if (c.advisories) return 3;
  return c.changed || (strict && c.unknown) ? 2 : 0;
}
