/**
 * Version ranges as advisories write them. This file is the one implementation: the command bundles it, the editor
 * extension imports it by path (packages/vscode/src/core.ts) and the site imports it through the workspace
 * (apps/web/src/lib/tie.ts), so the gate, the extension and the entry page give the same answer for the same range.
 *
 * The shapes read here are the ones on record on 4 Oct 2026 (test/fixtures/advisory-ranges.json holds every distinct
 * one): comparator sets (">=1.2.0 <1.4.1"), alternatives joined by "||", GitHub's comma form (">= 0.13.2, < 0.14.0"),
 * a comma list of exact versions as malware reports write it ("1.0.0, 1.0.1"), a bare version, and "*". A range that
 * names a commit or a package instead of a version cannot be read, and the answer for it is null, never a guess.
 *
 * Order: the numeric parts first, then a prerelease sorts before its release ("1.2.3-beta.1" is older than "1.2.3",
 * so "<1.2.3" covers it), and a post release after it. A build suffix after "+" is ignored.
 */
type Op = ">=" | ">" | "<=" | "<" | "=";

/** A version in the order advisories use: numeric parts, then before (-1), at (0) or after (1) the release, then the tag's own parts. */
interface Parsed {
  nums: number[];
  phase: -1 | 0 | 1;
  tag: (number | string)[];
}

type Cmp = { op: Op; v: Parsed };

/** Python's spellings of a prerelease, in their order, and of a post release; anything else after the numbers is a prerelease tag. */
const PY_PRE: Record<string, number> = { dev: 0, a: 1, alpha: 1, b: 2, beta: 2, c: 3, rc: 3, pre: 3, preview: 3 };
const PY_POST = new Set(["post", "rev", "r"]);

/** A commit hash is not a version, though one that starts with a digit looks like one to a loose pattern. */
const looksLikeCommit = (s: string): boolean => /^[0-9a-f]{7,64}$/i.test(s) && /[a-f]/i.test(s) && !s.includes(".");

function parseVersion(raw: string): Parsed | null {
  const s = raw.trim().replace(/^v/i, "").split("+")[0]!;
  if (looksLikeCommit(s)) return null;
  const m = /^(\d+(?:\.\d+)*)(.*)$/.exec(s);
  if (!m) return null;
  const nums = m[1]!.split(".").map((p) => Number.parseInt(p, 10));
  const rest = m[2]!;
  if (!rest) return { nums, phase: 0, tag: [] };
  if (!/^[\w.-]+$/.test(rest)) return null;
  const ids = (t: string) => t.split(/[.-]/).filter(Boolean).map((p) => (/^\d+$/.test(p) ? Number.parseInt(p, 10) : p.toLowerCase()));
  // the npm form, "1.2.3-beta.1": everything after the hyphen is a prerelease tag
  if (rest.startsWith("-")) return { nums, phase: -1, tag: ids(rest.slice(1)) };
  // the Python form, "1.2.dev1", "1.0rc1", "1.0.post1"
  const py = /^[._]?([a-z]+)[._-]?(\d*)(.*)$/i.exec(rest);
  if (!py) return null;
  const word = py[1]!.toLowerCase();
  const n = py[2] ? Number.parseInt(py[2], 10) : 0;
  if (PY_POST.has(word)) return { nums, phase: 1, tag: [n, ...ids(py[3]!)] };
  return { nums, phase: -1, tag: word in PY_PRE ? [PY_PRE[word]!, n, ...ids(py[3]!)] : [word, n, ...ids(py[3]!)] };
}

function compareParsed(a: Parsed, b: Parsed): number {
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (a.phase !== b.phase) return a.phase < b.phase ? -1 : 1;
  // tag parts as semver orders them: a number before a word, numbers by value, words by letter, and the shorter tag first
  for (let i = 0; i < Math.max(a.tag.length, b.tag.length); i++) {
    const x = a.tag[i], y = b.tag[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The numeric parts of a version, for a caller that only needs those. */
export function versionParts(v: string): number[] {
  return parseVersion(v)?.nums ?? v.trim().replace(/^v/i, "").split(/[-+]/)[0]!.split(".").map((p) => Number.parseInt(p, 10)).map((n) => (Number.isFinite(n) ? n : 0));
}

/** -1, 0 or 1 in the order above; a version that cannot be read sorts by whatever numbers it starts with. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a) ?? { nums: versionParts(a), phase: 0 as const, tag: [] };
  const y = parseVersion(b) ?? { nums: versionParts(b), phase: 0 as const, tag: [] };
  return compareParsed(x, y);
}

/** One comparator set: "any", comparators that must all hold, exact versions of which one must match, or null when it cannot be read. */
function parseSet(set: string): { all: Cmp[] } | { anyOf: Parsed[] } | "any" | null {
  const s = set.trim();
  if (!s) return null;
  const parts = s.split(",").map((p) => p.trim());
  if (parts.some((p) => !p)) return null;
  const all: Cmp[] = [];
  const exact: Parsed[] = [];
  let any = false;
  for (const part of parts) {
    // one comma part holds one comparator or several separated by spaces; an operator may stand apart from its version
    const tokens = part.replace(/(>=|<=|>|<|=)\s+/g, "$1").split(/\s+/);
    for (const t of tokens) {
      const m = /^(>=|<=|>|<|=)?(.+)$/.exec(t)!;
      if (m[2] === "*") { any = true; continue; }
      const v = parseVersion(m[2]!);
      if (!v) return null;
      if (m[1]) all.push({ op: m[1] as Op, v });
      else if (tokens.length === 1) exact.push(v);
      else return null; // a bare version beside other words ("openclaw 2026.2.17") is not a range
    }
  }
  if (any) return "any";
  // a comma joins comparators that must all hold (">= 1.0, < 2.0") or lists exact versions ("1.0.0, 1.0.1"), never both
  if (all.length && exact.length) return null;
  return exact.length ? { anyOf: exact } : { all };
}

/** True when the version falls inside the range; null when the range, or the version, cannot be read. */
export function inRange(version: string, range: string): boolean | null {
  const v = parseVersion(version);
  let readable = false;
  for (const set of range.split("||")) {
    const cmps = parseSet(set);
    if (cmps === null) continue;
    readable = true;
    if (cmps === "any") return true;
    if (!v) continue;
    if ("anyOf" in cmps) {
      if (cmps.anyOf.some((w) => compareParsed(v, w) === 0)) return true;
      continue;
    }
    const ok = cmps.all.every((c) => {
      const d = compareParsed(v, c.v);
      return c.op === ">=" ? d >= 0 : c.op === ">" ? d > 0 : c.op === "<=" ? d <= 0 : c.op === "<" ? d < 0 : d === 0;
    });
    if (ok) return true;
  }
  return readable && v ? false : null;
}
