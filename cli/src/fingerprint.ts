/**
 * Fingerprints of a server's tools (decision 513), in the record's canonical form, so `smallprint watch` compares what a
 * running server serves the same way the record and the lock do. The command has no runtime dependencies, so the
 * canonical form is copied from packages/normalize/src/canonical.ts; packages/normalize/test/cli-fingerprint-parity.test.ts
 * hashes the same tools with both and fails the day they differ.
 */
import { createHash } from "node:crypto";

export interface ToolInput {
  name?: unknown;
  description?: unknown;
  inputSchema?: unknown;
}

const WS = /\s+/g;
const MAX_TEXT_CHARS = 20_000;
const TRUNCATION_MARKER = " [truncated]";
const PROSE_KEYS = new Set(["description", "title"]);

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
const normalizeWhitespace = (s: string): string => s.replace(WS, " ").trim();
const capText = (s: string): string => (s.length > MAX_TEXT_CHARS ? s.slice(0, MAX_TEXT_CHARS) + TRUNCATION_MARKER : s);
const wholeTextOf = (s: string): { chars: number; sha256: string } | undefined => (s.length > MAX_TEXT_CHARS ? { chars: s.length, sha256: sha256(s) } : undefined);

function capProse(s: string): string {
  const whole = wholeTextOf(s);
  return whole ? `${s.slice(0, MAX_TEXT_CHARS)} [truncated; ${whole.chars} characters, sha256 ${whole.sha256}]` : s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Object keys sorted at every depth; whitespace collapsed only in description and title, so enum, const and pattern values keep their bytes. */
export function canonicalizeValue(v: unknown, key?: string): unknown {
  if (typeof v === "string") return key !== undefined && PROSE_KEYS.has(key) ? capProse(normalizeWhitespace(v)) : v;
  if (Array.isArray(v)) {
    const items = v.map((x) => canonicalizeValue(x));
    if (key === "required" && items.every((x) => typeof x === "string")) return [...(items as string[])].sort();
    return items;
  }
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const k of Object.keys(v).sort()) {
      const val = v[k];
      if (val === undefined) continue;
      out[k] = canonicalizeValue(val, k);
    }
    return out;
  }
  return v;
}

export interface CanonicalTool {
  name: string;
  description: string;
  inputSchema: unknown;
  descriptionWhole?: { chars: number; sha256: string };
}

export function canonicalizeTools(tools: readonly ToolInput[]): CanonicalTool[] {
  const out: CanonicalTool[] = tools.map((t) => {
    const description = normalizeWhitespace(String(t.description ?? ""));
    const whole = wholeTextOf(description);
    return { name: normalizeWhitespace(String(t.name ?? "")), description: capText(description), inputSchema: canonicalizeValue(t.inputSchema ?? {}), ...(whole ? { descriptionWhole: whole } : {}) };
  });
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

/** The digest of a whole tool list: the same value the record keeps as a version's content hash, and the lock as recordSha256. */
export const toolsDigest = (tools: readonly ToolInput[]): string => sha256(JSON.stringify(canonicalizeTools(tools)));

export interface ToolFingerprint {
  name: string;
  /** The canonical description, kept so a change can show the text before and after; it is what the agent reads. */
  description: string;
  descriptionSha256: string;
  schemaSha256: string;
}

/** One fingerprint per tool: the description (with the whole text's fingerprint when it was cut) and the input schema, separately. */
export function fingerprintTools(tools: readonly ToolInput[]): ToolFingerprint[] {
  return canonicalizeTools(tools).map((t) => ({
    name: t.name,
    description: t.description,
    descriptionSha256: sha256(JSON.stringify([t.description, t.descriptionWhole ?? null])),
    schemaSha256: sha256(JSON.stringify(t.inputSchema)),
  }));
}
