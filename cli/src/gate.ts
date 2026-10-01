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
  if (v.applies.length) words.push(`${v.applies.length} high or critical advisory(ies) cover ${installed}: ${ids(v.applies)}`);
  if (v.rangeUnknown.length) words.push(`${v.rangeUnknown.length} high or critical advisory(ies), range unknown${installed ? "" : " because the version here is not known"}, check the range: ${ids(v.rangeUnknown)}`);
  if (v.notCovering.length) words.push(`${v.notCovering.length} high or critical advisory(ies) on record do not cover ${installed}: ${ids(v.notCovering)}`);
  return words;
}
