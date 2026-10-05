/**
 * One question in the terminal, and what the site answered, read without trusting either (tools audit of 4 Oct 2026,
 * fix 8). End of input at a question (Ctrl+D) used to end the command in a Node stack trace, and so did an answer from
 * the site that was not the shape the command expected. End of input is the answer "no"; an answer that cannot be read
 * is one plain sentence and a non-zero exit.
 */
import { createInterface } from "node:readline/promises";

/**
 * Ask and return what was typed. End of input, or Ctrl+C, returns the empty string, which every question here reads as
 * no: nothing is sent and nothing is started.
 */
export async function ask(question: string, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<string> {
  const rl = createInterface({ input, output });
  let ended = false;
  const closed = new Promise<string>((resolve) => rl.once("close", () => { ended = true; resolve(""); }));
  try {
    const answer = await Promise.race([rl.question(question), closed]);
    // the cursor is still on the question's line when the input ended there
    if (ended) output.write("\n");
    return answer;
  } catch (err) {
    const e = err as { name?: string; code?: string };
    if (e.name === "AbortError" || e.code === "ABORT_ERR" || e.code === "ERR_USE_AFTER_CLOSE") {
      output.write("\n");
      return "";
    }
    throw err;
  } finally {
    rl.close();
  }
}

/** Thrown for an answer from the site that is not what this version of the command reads; main prints the message and exits 1. */
export class UnexpectedReply extends Error {}

const unexpected = (what: string, where: string): UnexpectedReply => new UnexpectedReply(`${where} answered with something this version of the command cannot read (${what}). Nothing on this machine changed; try again, or update with npx smallprint@latest.`);

async function json(res: Response, where: string): Promise<Record<string, unknown>> {
  let j: unknown;
  try {
    j = await res.json();
  } catch {
    throw unexpected("not JSON", where);
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) throw unexpected("not an object", where);
  return j as Record<string, unknown>;
}

const isList = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.every((x) => x && typeof x === "object");
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export interface CheckReply {
  grade: string;
  criterion: string;
  headline: string;
  results: { name: string; status: string; detail: string; url: string | null }[];
  cardUrl?: string;
}

/** The answer of /api/check, or UnexpectedReply. */
export async function readCheckReply(res: Response, where: string): Promise<CheckReply> {
  const j = await json(res, where);
  if (typeof j.grade !== "string" || !isList(j.results)) throw unexpected("no grade or no results", where);
  return {
    grade: j.grade,
    criterion: str(j.criterion),
    headline: str(j.headline),
    results: j.results.map((x) => ({ name: str(x.name), status: str(x.status), detail: str(x.detail), url: typeof x.url === "string" ? x.url : null })),
    ...(typeof j.cardUrl === "string" ? { cardUrl: j.cardUrl } : {}),
  };
}

export interface FileChange {
  pathHash: string;
  kind: string;
  from: string | null;
  to: string | null;
  since: string | null;
  where?: string[];
}

export interface SyncReply {
  rekeyed?: number;
  pinned: number;
  created: number;
  dropped: number;
  unknown: { name: string; host: string; reason: string }[];
  files?: { recorded: number; firstSeen: FileChange[]; changed: FileChange[]; removed: FileChange[]; returned: FileChange[]; limited: { pathHash: string; kind: string; reason: string }[] };
}

/** The answer of /api/sync, or UnexpectedReply. Lists the answer leaves out are read as empty; a missing count is not. */
export async function readSyncReply(res: Response, where: string): Promise<SyncReply> {
  const j = await json(res, where);
  if (typeof j.pinned !== "number") throw unexpected("no count of pins", where);
  const changes = (v: unknown): FileChange[] =>
    isList(v) ? v.map((c) => ({ pathHash: str(c.pathHash), kind: str(c.kind), from: typeof c.from === "string" ? c.from : null, to: typeof c.to === "string" ? c.to : null, since: typeof c.since === "string" ? c.since : null, ...(Array.isArray(c.where) ? { where: c.where.filter((w): w is string => typeof w === "string") } : {}) })) : [];
  const f = j.files && typeof j.files === "object" ? (j.files as Record<string, unknown>) : null;
  return {
    ...(typeof j.rekeyed === "number" ? { rekeyed: j.rekeyed } : {}),
    pinned: j.pinned,
    created: num(j.created),
    dropped: num(j.dropped),
    unknown: isList(j.unknown) ? j.unknown.map((u) => ({ name: str(u.name), host: str(u.host), reason: str(u.reason) })) : [],
    ...(f ? { files: { recorded: num(f.recorded), firstSeen: changes(f.firstSeen), changed: changes(f.changed), removed: changes(f.removed), returned: changes(f.returned), limited: isList(f.limited) ? f.limited.map((l) => ({ pathHash: str(l.pathHash), kind: str(l.kind), reason: str(l.reason) })) : [] } } : {}),
  };
}

/** The answer of /api/asset for the gate, the lock and show: the lists a reader walks are lists, or UnexpectedReply. */
export async function readAssetReply<T>(res: Response, where: string): Promise<T> {
  const j = await json(res, where);
  if (!j.asset || typeof j.asset !== "object" || !Array.isArray(j.versions) || !Array.isArray(j.releases) || !Array.isArray(j.advisories)) throw unexpected("no asset, versions, releases or advisories", where);
  return j as T;
}
