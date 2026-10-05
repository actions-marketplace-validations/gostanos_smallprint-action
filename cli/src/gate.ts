/**
 * Which advisories on record apply to the version this machine runs (tools audit of 29 Sep 2026, fix 1). The gate used
 * to count every high or critical advisory that named the package, whatever its range, so the reference filesystem
 * server failed every gate on a fixed version. An advisory now fails the gate only when its range covers the installed
 * version. An advisory whose range cannot be read, or a server whose version is not known, is reported as "range
 * unknown" and counted with the other unknowns, which fail only under --strict.
 */
import { inRange } from "./range";

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
  releases: { from: string | null; to: string; publishedAt: string | null; worst: string; identical: boolean }[];
  versions: { version: string; publishedAt: string | null; read?: boolean; contentHash: string | null }[];
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

/**
 * One server against the record (tools audit of 4 Oct 2026, fixes 6 and 11). Three questions, each answered only when
 * the record can answer it:
 *
 *  - Did what this machine runs change since the lock? The version it runs is the pinned one, or the latest on record
 *    when the config pins none. It is compared with the version in the lock, and only the releases between the two
 *    count. A server pinned to the version in its lock has not changed, however many releases came after it: those are
 *    printed as news and do not fail the gate. Before this, every later release failed the gate on every run, for
 *    exactly the people who pin.
 *  - Is there tool text on record to compare? A version read and found to declare no tools, or never read, or not on
 *    record, has none, and the answer is "unknown", never "unchanged".
 *  - Does a high or critical advisory's range cover the version it runs?
 */
export function gateServer(e: GateRecord, installed: string | null, locked: { version: string | null; recordSha256?: string } | undefined): GateVerdict {
  const words: string[] = [];
  let changed = false;
  let unknown = false;
  const row = (v: string | null | undefined) => (v ? e.versions.find((x) => x.version === v) : undefined);
  // the lock's copy of the record digest for the locked version against the record now (decision 224)
  if (locked?.recordSha256 && locked.version) {
    const now = row(locked.version)?.contentHash;
    if (now && now !== locked.recordSha256) {
      words.push(`the record's digest for ${locked.version} changed since the lock was written (was ${locked.recordSha256.slice(0, 12)}, now ${now.slice(0, 12)})`);
      changed = true;
    }
  }
  const latest = e.asset.latestVersion ?? e.baseline?.version ?? null;
  const runs = installed ?? latest;
  const runsRow = row(runs);
  const from = locked?.version ?? null;
  const fromRow = row(from);
  const noText = (v: string, r: typeof runsRow) => (!r ? `version ${v} is not on the record` : r.read ? `version ${v} was read and declares no tools of its own, so there is no tool text to compare` : `version ${v} is on the record but its small print was not read`);
  const unpinned = installed ? "" : "not pinned, so the next start runs the latest; ";
  if (!runs) {
    words.push("no version to compare: the config pins none and the record has none");
    unknown = true;
  } else if (!runsRow?.contentHash) {
    words.push(`${unpinned}${noText(runs, runsRow)}`);
    unknown = true;
  } else if (from && !fromRow?.contentHash) {
    words.push(`${unpinned}the lock holds ${from}: ${noText(from, fromRow)} with ${runs}`);
    unknown = true;
  } else {
    // the releases strictly after one version and up to the other, by publish date, as the record orders them
    const between = (a: string, b: string) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return e.releases.filter((r) => !r.identical && (r.publishedAt ?? "") > lo && (r.publishedAt ?? "") <= hi);
    };
    const worstOf = (rs: { worst: string }[]) => rs.reduce((w, r) => (RANK_ORDER.indexOf(r.worst) > RANK_ORDER.indexOf(w) ? r.worst : w), "info");
    const releases = (n: number) => `${n} release${n === 1 ? "" : "s"}`;
    if (from && fromRow) {
      const moved = from === runs ? [] : between(fromRow.publishedAt ?? "", runsRow.publishedAt ?? "");
      // two versions with different tool text differ, whether or not a release row sits between them
      if (from !== runs && (moved.length || fromRow.contentHash !== runsRow.contentHash)) {
        words.push(`small print changed between ${from} in the lock and ${runs}${installed ? "" : ", the latest, which the next start runs because the config pins no version"}${moved.length ? `: ${releases(moved.length)}, worst ${worstOf(moved)}` : ""}`);
        changed = true;
      } else words.push(from === runs ? `runs ${runs}, the version in the lock` : `unchanged between ${from} in the lock and ${runs}`);
    } else if (installed) words.push(`pinned at ${runs}; no lock entry to compare it with`);
    else {
      // nothing pins it and no lock says what was read: what runs can change on any start, and the gate cannot say it has not
      words.push(`not pinned, so the next start runs the latest, ${runs}, and no lock entry says which version was read; pin a version or write a lock`);
      unknown = true;
    }
    // releases later than the one this machine runs: news for whoever pins, never a failure
    if (installed && latest && latest !== installed) {
      const later = e.releases.filter((r) => !r.identical && (r.publishedAt ?? "") > (runsRow.publishedAt ?? ""));
      if (later.length) words.push(`${releases(later.length)} after ${installed} changed the small print, worst ${worstOf(later)}; read the entry page before you move up`);
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
