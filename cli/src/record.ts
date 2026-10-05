/**
 * How the command and the MCP server read one answer of the site's /api/asset. The site decides what "read" means, by
 * one definition, and says it in two fields: `baseline.read` (true when the pinned version's small print is on record
 * in any form) and `readState` (what kind of read it was). Nothing here decides it a second time: `show` used to test
 * only whether a tool list came back, and so told people that read skills, read plugins and servers read with no tools
 * were "not read yet". No Node imports, so the MCP server bundles this file too (packages/mcp/src/main.ts).
 */
export interface RecordAnswer {
  asset?: { kind?: string };
  /** "tools", "no-tools", "oversize" or "unread" on 4 Oct 2026; the site may add states for read skills and plugins. */
  readState?: string;
  baseline: { version: string; read?: boolean; contentHash?: string | null } | null;
  tools: unknown[] | null;
  skillMd?: string | null;
}

export type ReadKind = "tools" | "instructions" | "no-tools" | "read" | "oversize" | "unread";

/** What the site's answer says about the pinned version, in one word the callers turn into a sentence. */
export function readKind(e: RecordAnswer): ReadKind {
  if (e.tools && e.tools.length) return "tools";
  if (e.readState === "oversize") return "oversize";
  // read by the site's own flag, or by a state the site names that is not one of its two unread ones (the state for a
  // read skill is being added on the site; whatever it is called, it is a read)
  const read = e.baseline?.read === true || (e.readState !== undefined && e.readState !== "unread" && e.readState !== "oversize") || (e.baseline?.read === undefined && e.readState === undefined && (!!e.skillMd || !!e.tools));
  if (!read) return "unread";
  if (e.skillMd) return "instructions";
  if (e.readState === "no-tools" || (e.tools && !e.tools.length && e.asset?.kind === "mcp")) return "no-tools";
  return "read";
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The read state as `show` prints it after the baseline version. */
export function readWords(e: RecordAnswer): string {
  const kind = readKind(e);
  if (kind === "tools") return `${plural(e.tools!.length, "tool")} read`;
  if (kind === "instructions") return e.asset?.kind === "agent-skill" ? "SKILL.md read" : "instruction files read";
  if (kind === "no-tools") return "read, no tool declarations found";
  if (kind === "read") return "small print read";
  if (kind === "oversize") return "not read: the package is larger than the reader opens";
  return "small print not read yet";
}

/**
 * Whether one version has tool text the record can compare with another's: only a version with a content hash does. A
 * version read and found to declare no tools has nothing to compare, and neither has one that was never read; the gate
 * says so instead of "unchanged".
 */
export function comparable(v: { contentHash?: string | null; read?: boolean } | undefined): "yes" | "no-tool-text" | "unread" | "absent" {
  if (!v) return "absent";
  if (v.contentHash) return "yes";
  return v.read ? "no-tool-text" : "unread";
}
