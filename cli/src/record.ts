/**
 * How the command and the MCP server read one answer of the site's /api/asset. The site decides what "read" means, by
 * one definition, and says it in two fields: `baseline.read` (true when the pinned version's small print is on record
 * in any form) and `readState` (what kind of read it was). Nothing here decides it a second time: `show` used to test
 * only whether a tool list came back, and so told people that read skills, read plugins and servers read with no tools
 * were "not read yet". No Node imports, so the MCP server bundles this file too (packages/mcp/src/main.ts).
 */
export interface RecordAnswer {
  /**
   * `kindChip` is the entry page's word for what the entry is (a package an advisory names, or npm's security holding
   * package, is "package", whatever kind it was filed under), and `goneAt` is when its source stopped serving it; both
   * are absent from sites older than the pass 6 audit of 16 Oct 2026, and then `kind` and no date are read.
   */
  asset?: { kind?: string; kindChip?: string; goneAt?: string | null };
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

/** What the entry is, in the entry page's word when the site sends it: never "mcp" for npm's security holding package (pass 6 audit). */
export const kindOf = (e: Pick<RecordAnswer, "asset">): string | undefined => e.asset?.kindChip ?? e.asset?.kind;

/** " yet" only where a read can still come: not for an entry its source no longer serves (the entry page's rule, pass 6 audit). */
export const yetWord = (e: Pick<RecordAnswer, "asset">): string => (e.asset?.goneAt ? "" : " yet");

/** The read state as `show` prints it after the baseline version. */
export function readWords(e: RecordAnswer): string {
  const kind = readKind(e);
  const what = kindOf(e);
  if (kind === "tools") return `${plural(e.tools!.length, "tool")} read`;
  if (kind === "instructions") return what === "agent-skill" ? "SKILL.md read" : "instruction files read";
  if (kind === "no-tools") return "read, no tool declarations found";
  // "files": the files were fingerprinted and no text was kept, said as the entry page says it (audit of 16 Oct 2026)
  // a package an advisory names is not shown to be a server, a skill or a plugin, so neither tools nor instructions are named
  if (kind === "read") return e.readState === "files" ? `files fingerprinted, no ${what === "mcp" ? "tool text" : what === "package" ? "small print" : "instruction text"} on record` : "small print read";
  if (kind === "oversize") return "not read: the package is larger than the reader opens";
  return `small print not read${yetWord(e)}`;
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

/**
 * A remote server's last answer, in the entry page's words (apps/web/src/lib/entry-facts.ts, remoteAnswerFact, held to
 * them by packages/cli/test/audit-pass3-2026-10-16.test.ts). `show` said "answered our request <date>: unreachable"
 * for a server that gave no answer (pass 3 audit of 16 Oct 2026).
 */
/** A remote answer filed as "auth", by its HTTP status, in the entry page's words (entry-facts.ts authWords): only a 401 asks for a sign-in. */
function authWords(httpStatus: number | null | undefined): string {
  if (httpStatus === 401) return "asked for a sign-in";
  if (httpStatus) return `refused the request (HTTP ${httpStatus})`;
  return "asked for a sign-in or refused the request";
}

export function remoteAnswerWords(r: { checkedAt: string; status: string; toolCount: number | null; httpStatus?: number | null | undefined }): string {
  const d = r.checkedAt.slice(0, 10);
  switch (r.status) {
    case "ok":
      return `${d}, ${r.toolCount ?? 0} tool${r.toolCount === 1 ? "" : "s"} listed`;
    case "auth":
      return `${d}: ${authWords(r.httpStatus)}, so listed and not read`;
    case "no-tools":
      return `${d}: answered and listed no tools`;
    case "protocol":
      return `${d}: answered, but not with a list of tools Small Print could read`;
    case "unreachable":
      return `${d}: no answer, or only an error`;
    default:
      return `${d}: no list of tools (${r.status})`;
  }
}

/**
 * The date `show` prints beside the pinned version, in the entry page's words: "published" only when the site says the
 * date is the source's; otherwise "first seen", with the day Small Print first saw the version (firstSeenAt) when the
 * answer gives it. A commit-pinned plugin's publishedAt is its commit's date, which `show` printed as "first seen"
 * (pass 5 audit of 16 Oct 2026). An answer from before the site said either field prints its publishedAt, as before.
 */
export function baselineDateWords(b: { publishedAt: string | null; firstSeen?: boolean; firstSeenAt?: string | null; committed?: boolean }): string {
  // a commit-pinned plugin version's date is its commit's, never a publish date (the site's committed flag, decision 563)
  if (b.committed && b.publishedAt) return `committed ${b.publishedAt.slice(0, 10)}`;
  if (b.firstSeen === false) return b.publishedAt ? `published ${b.publishedAt.slice(0, 10)}` : "";
  const d = (b.firstSeen ? b.firstSeenAt : null) ?? b.publishedAt;
  return d ? `first seen ${d.slice(0, 10)}` : "";
}
