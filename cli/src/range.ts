/**
 * A copy of packages/vscode/src/range.ts for the command (the two packages are bundled separately); test/range.test.ts
 * fails the day this file and the extension's differ, or either answers differently from the site.
 *
 * Version ranges as advisories write them, the same rule the site uses (apps/web/src/lib/tie.ts); a test fails the day the
 * two differ. Numeric dotted compare; a prerelease tag or build suffix is ignored, which is all advisory ranges need.
 */
type Cmp = { op: ">=" | ">" | "<=" | "<" | "="; v: number[] };

export function versionParts(v: string): number[] {
  return v.trim().replace(/^v/i, "").split(/[-+]/)[0]!.split(".").map((p) => Number.parseInt(p, 10)).map((n) => (Number.isFinite(n) ? n : 0));
}

export function compareVersions(a: string, b: string): number {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

function parseSet(set: string): Cmp[] | "any" | null {
  const parts = set.trim().split(/\s+/).filter(Boolean);
  if (!parts.length || parts.some((p) => p === "*")) return "any";
  const out: Cmp[] = [];
  for (const p of parts) {
    const m = /^(>=|<=|>|<|=)?\s*v?(\d[\w.]*)$/.exec(p);
    if (!m) return null;
    out.push({ op: (m[1] as Cmp["op"]) || "=", v: versionParts(m[2]!) });
  }
  return out;
}

/** True when the version falls inside the range; null when the range cannot be read. */
export function inRange(version: string, range: string): boolean | null {
  let readable = false;
  for (const set of range.split("||")) {
    const cmps = parseSet(set);
    if (cmps === null) continue;
    readable = true;
    if (cmps === "any") return true;
    const v = versionParts(version);
    const ok = cmps.every((c) => {
      const w = c.v; let d = 0;
      for (let i = 0; i < Math.max(v.length, w.length); i++) { const k = (v[i] ?? 0) - (w[i] ?? 0); if (k) { d = k < 0 ? -1 : 1; break; } }
      return c.op === ">=" ? d >= 0 : c.op === ">" ? d > 0 : c.op === "<=" ? d <= 0 : c.op === "<" ? d < 0 : d === 0;
    });
    if (ok) return true;
  }
  return readable ? false : null;
}
