/**
 * `smallprint watch -- <server command>` (decision 513): a local stdio proxy that only watches and warns.
 *
 * It starts the real MCP server as a child process and passes every byte between the client and the server through
 * unchanged, in both directions: the two streams are piped straight through, and the watcher reads a copy of them. It
 * never blocks, delays, rewrites, drops or injects a message. When anything in the watching part fails, the watching
 * stops with one line on stderr and the traffic keeps flowing.
 *
 * What it reads: the server's answers to tools/list (and that a notifications/tools/list_changed was sent). Each tool's
 * name, description and input schema is fingerprinted in the record's canonical form (fingerprint.ts) and compared with
 * the last list this watcher stored for the same server command, and the whole list's digest with the record's digest
 * in smallprint.lock when the lock has this server at the version that is running. A difference is one line on stderr,
 * which MCP clients keep in their server logs, and one JSON line per tool in a log file under the command's state
 * folder; the next `smallprint check` prints them.
 *
 * What it keeps: tool names, the kind of change, fingerprints, and a tool's description as the before and after text of
 * a change, because the description is what the agent reads. It never keeps or prints a call's arguments, a tool's
 * result, the server's arguments or environment values, and it sends nothing anywhere.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import { fingerprintTools, toolsDigest, type ToolFingerprint, type ToolInput } from "./fingerprint";
import { parseLock } from "./lock";
import { inferPackage } from "./parse";
import { visible } from "./lines";

/** A line longer than this is passed through and not read by the watcher. */
const MAX_LINE = 64 * 1024 * 1024;

export type ChangeKind = "added" | "removed" | "description" | "schema" | "lock";

export interface WatchLogEntry {
  time: string;
  server: string;
  tool: string;
  change: ChangeKind;
  fingerprintBefore?: string;
  fingerprintAfter?: string;
  descriptionBefore?: string;
  descriptionAfter?: string;
  /** For a "lock" entry: the version the lock holds the record's digest for. */
  version?: string;
  /** The server had said its tool list changed (notifications/tools/list_changed) before this list. */
  afterListChanged?: boolean;
}

interface Snapshot {
  server: string;
  seen: string;
  digest: string;
  tools: ToolFingerprint[];
  /** The digest last warned about against the lock, so a server that differs from the lock is told once, not at every start. */
  lockWarned?: string;
}

export const watchDir = (stateDir: string): string => join(stateDir, "watch");
export const watchLogFile = (stateDir: string): string => join(watchDir(stateDir), "changes.jsonl");

/** The key a server's snapshot is stored under: a hash of its command line, so the arguments themselves are never written. */
export const serverKey = (command: string, args: readonly string[]): string => createHash("sha256").update(JSON.stringify([command, ...args]), "utf8").digest("hex").slice(0, 32);

/** The name a server is shown under: its package identity when the command names one, else the program's name. Never its arguments. */
export function serverLabel(command: string, args: readonly string[]): string {
  const p = inferPackage(command, args);
  if (p.canonicalName) return `${p.canonicalName}${p.version ? `@${p.version}` : ""}`;
  return basename(command) || "server";
}

/** What changed between two fingerprinted lists, by tool name. */
export function compareFingerprints(before: readonly ToolFingerprint[], after: readonly ToolFingerprint[]): Omit<WatchLogEntry, "time" | "server">[] {
  const was = new Map(before.map((t) => [t.name, t]));
  const now = new Map(after.map((t) => [t.name, t]));
  const out: Omit<WatchLogEntry, "time" | "server">[] = [];
  for (const [name, t] of now) if (!was.has(name)) out.push({ tool: name, change: "added", fingerprintAfter: `${t.descriptionSha256.slice(0, 16)}/${t.schemaSha256.slice(0, 16)}`, descriptionAfter: t.description });
  for (const [name, t] of was) if (!now.has(name)) out.push({ tool: name, change: "removed", fingerprintBefore: `${t.descriptionSha256.slice(0, 16)}/${t.schemaSha256.slice(0, 16)}`, descriptionBefore: t.description });
  for (const [name, a] of now) {
    const b = was.get(name);
    if (!b) continue;
    if (b.descriptionSha256 !== a.descriptionSha256) out.push({ tool: name, change: "description", fingerprintBefore: b.descriptionSha256.slice(0, 16), fingerprintAfter: a.descriptionSha256.slice(0, 16), descriptionBefore: b.description, descriptionAfter: a.description });
    if (b.schemaSha256 !== a.schemaSha256) out.push({ tool: name, change: "schema", fingerprintBefore: b.schemaSha256.slice(0, 16), fingerprintAfter: a.schemaSha256.slice(0, 16) });
  }
  return out.sort((x, y) => (x.tool < y.tool ? -1 : x.tool > y.tool ? 1 : 0));
}

const quoted = (s: string) => JSON.stringify(s);
const WORDS: Record<ChangeKind, string> = { added: "was added", removed: "was removed", description: "has a new description", schema: "has a new input schema", lock: "" };

/** The one stderr line for a list that differs. */
export function warningLine(label: string, changes: readonly Omit<WatchLogEntry, "time" | "server">[]): string {
  const parts: string[] = [];
  for (const c of changes) {
    if (c.change === "lock") parts.push(`its tools differ from the record's fingerprint for version ${c.version ?? "unknown"} in smallprint.lock`);
    else parts.push(`the tool ${quoted(c.tool)} ${WORDS[c.change]}`);
  }
  const shown = parts.length > 5 ? [...parts.slice(0, 5), `${parts.length - 5} more`] : parts;
  // a difference from the lock alone is not called a change by the server: a running server can state its schemas in
  // another form than the published package the record read (legal and accuracy review, 15 Oct 2026)
  const head = changes.some((c) => c.change !== "lock") ? `${visible(label)} changed what it tells your agent since this watcher last saw it` : `what ${visible(label)} serves differs from smallprint.lock`;
  return `smallprint watch: ${head}: ${shown.join("; ")}. Nothing was stopped. Run npx smallprint check to see the details.`;
}

/**
 * Reads a copy of both directions, line by line, and calls onList with each whole tools/list answer. It keeps no message:
 * a line is parsed only when it can be about tools/list, initialize or list_changed, and dropped once read.
 */
export class Observer {
  private client = new StringDecoder("utf8");
  private server = new StringDecoder("utf8");
  private clientBuf = "";
  private serverBuf = "";
  private skipClient = false;
  private skipServer = false;
  /** Request ids of tools/list calls waiting for an answer, and whether each asked for a later page. */
  private pending = new Map<string, boolean>();
  private initIds = new Set<string>();
  private collecting: ToolInput[] | null = null;
  private listChanged = false;
  /** The version the server named in its initialize answer, when it did. */
  serverVersion: string | null = null;

  constructor(private readonly onList: (tools: ToolInput[], afterListChanged: boolean) => void) {}

  fromClient(chunk: Buffer | string): void {
    for (const line of this.lines(chunk, "client")) {
      if (!line.includes("tools/list") && !line.includes("initialize")) continue;
      for (const m of messages(line)) {
        if (m.id === undefined || m.id === null) continue;
        if (m.method === "tools/list") this.pending.set(JSON.stringify(m.id), Boolean(m.params && typeof m.params === "object" && (m.params as Record<string, unknown>).cursor));
        else if (m.method === "initialize") this.initIds.add(JSON.stringify(m.id));
      }
    }
  }

  fromServer(chunk: Buffer | string): void {
    for (const line of this.lines(chunk, "server")) {
      const maybeNotice = line.includes("list_changed");
      if (!maybeNotice && !this.pending.size && !this.initIds.size) continue;
      for (const m of messages(line)) {
        if (m.method === "notifications/tools/list_changed") { this.listChanged = true; continue; }
        if (m.id === undefined || m.id === null) continue;
        const key = JSON.stringify(m.id);
        if (this.initIds.delete(key)) {
          const v = (m.result as { serverInfo?: { version?: unknown } } | undefined)?.serverInfo?.version;
          if (typeof v === "string") this.serverVersion = v;
          continue;
        }
        if (!this.pending.has(key)) continue;
        const later = this.pending.get(key)!;
        this.pending.delete(key);
        const result = m.result as { tools?: unknown; nextCursor?: unknown } | undefined;
        if (!result || !Array.isArray(result.tools)) { this.collecting = null; continue; }
        if (!later) this.collecting = [];
        if (!this.collecting) continue; // a later page whose first page was not seen
        this.collecting.push(...(result.tools as ToolInput[]));
        if (typeof result.nextCursor === "string" && result.nextCursor) continue;
        const tools = this.collecting;
        this.collecting = null;
        const after = this.listChanged;
        this.listChanged = false;
        this.onList(tools, after);
      }
    }
  }

  private *lines(chunk: Buffer | string, side: "client" | "server"): Generator<string> {
    const dec = side === "client" ? this.client : this.server;
    let buf = (side === "client" ? this.clientBuf : this.serverBuf) + (typeof chunk === "string" ? chunk : dec.write(chunk));
    let skip = side === "client" ? this.skipClient : this.skipServer;
    let i: number;
    const out: string[] = [];
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (skip) { skip = false; continue; }
      if (line.trim()) out.push(line);
    }
    if (buf.length > MAX_LINE) { buf = ""; skip = true; }
    if (side === "client") { this.clientBuf = buf; this.skipClient = skip; } else { this.serverBuf = buf; this.skipServer = skip; }
    yield* out;
  }
}

type Msg = { id?: unknown; method?: unknown; params?: unknown; result?: unknown };
function messages(line: string): Msg[] {
  let j: unknown;
  try { j = JSON.parse(line); } catch { return []; }
  const list = Array.isArray(j) ? j : [j];
  return list.filter((m): m is Msg => typeof m === "object" && m !== null);
}

export interface LockMatch { version: string; digest: string }

/** The record's digest in the lock for this server at the version that runs, when the lock holds exactly that. */
export function lockDigest(lockText: string | null, command: string, args: readonly string[], runningVersion: string | null): LockMatch | null {
  if (!lockText) return null;
  let lock;
  try { lock = parseLock(lockText); } catch { return null; }
  const id = inferPackage(command, args);
  const version = id.version ?? runningVersion;
  if (!id.canonicalName || !version) return null;
  const hit = lock.items.find((i) => i.kind === "mcp" && i.canonicalName === id.canonicalName && i.version === version && typeof i.recordSha256 === "string");
  return hit ? { version, digest: hit.recordSha256! } : null;
}

export interface WatcherOptions {
  command: string;
  args: readonly string[];
  stateDir: string;
  /** smallprint.lock's text when there is one; read once at the start. */
  lockText: string | null;
  warn: (line: string) => void;
  /** A desktop notification on this machine when a list differs; best effort, never an error. */
  notify?: (title: string, body: string) => void;
  now?: () => Date;
}

/** The notification for a list that differs: the server's name from the user's own config and a count, never the server's text. */
export function notificationFor(name: string, changes: readonly Omit<WatchLogEntry, "time" | "server">[]): { title: string; body: string } {
  // the name comes from the user's own config, but a path can still hold any character; none of them reach the notification
  const label = visible(name).replace(/[\t\n]/g, " ");
  const tools = changes.filter((c) => c.change !== "lock").length;
  if (!tools) return { title: `${label} differs from your lock`, body: "Its list of tools does not match the fingerprint in smallprint.lock. Nothing was stopped. Run npx smallprint check to see it." };
  return { title: `${label} changed`, body: `${tools} change${tools === 1 ? "" : "s"} to what it tells your agent. Nothing was stopped. Run npx smallprint check to see ${tools === 1 ? "it" : "them"}.` };
}

/** The comparing and recording part: given a whole tool list, compare, warn, log, store. Throws on a file it cannot write. */
export function makeListHandler(o: WatcherOptions, serverVersion: () => string | null): (tools: ToolInput[], afterListChanged: boolean) => void {
  const label = serverLabel(o.command, o.args);
  const dir = join(watchDir(o.stateDir), "servers");
  const file = join(dir, `${serverKey(o.command, o.args)}.json`);
  return (tools, afterListChanged) => {
    const now = (o.now ?? (() => new Date()))().toISOString();
    const fps = fingerprintTools(tools);
    const digest = toolsDigest(tools);
    let snap: Snapshot | null = null;
    if (existsSync(file)) {
      try { snap = JSON.parse(readFileSync(file, "utf8")) as Snapshot; } catch { snap = null; }
      if (snap && !Array.isArray(snap.tools)) snap = null;
    }
    const changes = snap ? compareFingerprints(snap.tools, fps) : [];
    const lock = lockDigest(o.lockText, o.command, o.args, serverVersion());
    let lockWarned = snap?.lockWarned;
    if (lock && lock.digest !== digest && lockWarned !== digest) {
      changes.unshift({ tool: "(all tools)", change: "lock", version: lock.version, fingerprintBefore: lock.digest.slice(0, 16), fingerprintAfter: digest.slice(0, 16) });
      lockWarned = digest;
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (changes.length) {
      const lines = changes.map((c) => JSON.stringify({ time: now, server: label, ...c, ...(afterListChanged ? { afterListChanged: true } : {}) } satisfies WatchLogEntry)).join("\n");
      appendFileSync(watchLogFile(o.stateDir), lines + "\n", { mode: 0o600 });
      o.warn(warningLine(label, changes));
      if (o.notify) { try { const n = notificationFor(label, changes); o.notify(n.title, n.body); } catch { /* no desktop */ } }
    }
    const next: Snapshot = { server: label, seen: now, digest, tools: fps, ...(lockWarned ? { lockWarned } : {}) };
    writeFileSync(file, JSON.stringify(next), { mode: 0o600 });
  };
}

export interface RunWatchOptions {
  command: string;
  args: string[];
  stateDir: string;
  lockText: string | null;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  env?: NodeJS.ProcessEnv;
  forwardSignals?: boolean;
  notify?: (title: string, body: string) => void;
}

/** Start the server, pass everything through, watch a copy. Resolves with the server's exit code once its output is written. */
export function runWatch(o: RunWatchOptions): Promise<number> {
  return new Promise((resolve) => {
    let done = false;
    const say = (line: string) => { try { o.stderr.write(line + "\n"); } catch { /* stderr closed */ } };
    const child = spawn(o.command, o.args, { stdio: ["pipe", "pipe", "inherit"], env: o.env ?? process.env, shell: process.platform === "win32" });

    // the passthrough: piped straight through, nothing in between
    o.stdin.pipe(child.stdin);
    child.stdout.pipe(o.stdout, { end: false });
    child.stdin.on("error", () => { /* the server closed its input; its exit is handled below */ });
    o.stdout.on("error", () => { try { child.kill(); } catch { /* gone */ } });

    // the watching: a copy of both directions, every step inside a try, and one line when it stops
    let watching = true;
    const stop = (err: unknown) => {
      if (!watching) return;
      watching = false;
      o.stdin.off("data", onClient);
      child.stdout.off("data", onServer);
      const e = err as { code?: string; name?: string };
      say(`smallprint watch: the watcher stopped (${e?.code ?? e?.name ?? "error"}), so changes to this server's tools are no longer noticed. Every message still passes through unchanged.`);
    };
    let observer: Observer | null = null;
    const onClient = (chunk: Buffer) => { if (!watching) return; try { observer!.fromClient(chunk); } catch (e) { stop(e); } };
    const onServer = (chunk: Buffer) => { if (!watching) return; try { observer!.fromServer(chunk); } catch (e) { stop(e); } };
    try {
      const handler = makeListHandler({ command: o.command, args: o.args, stateDir: o.stateDir, lockText: o.lockText, warn: say, ...(o.notify ? { notify: o.notify } : {}) }, () => observer?.serverVersion ?? null);
      observer = new Observer((tools, after) => handler(tools, after));
      o.stdin.on("data", onClient);
      child.stdout.on("data", onServer);
    } catch (e) {
      stop(e);
    }

    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
    const forward = (s: NodeJS.Signals) => { try { child.kill(s); } catch { /* gone */ } };
    if (o.forwardSignals) for (const s of signals) process.on(s, forward);

    const finish = (code: number) => {
      if (done) return;
      done = true;
      if (o.forwardSignals) for (const s of signals) process.off(s, forward);
      o.stdin.unpipe(child.stdin);
      o.stdin.off("data", onClient);
      // an empty write calls back once everything written before it has been handed on
      o.stdout.write("", () => resolve(code));
    };
    child.on("error", (e: NodeJS.ErrnoException) => {
      say(`smallprint watch: could not start ${basename(o.command)} (${e.code ?? e.name}).`);
      finish(127);
    });
    child.on("close", (code, signal) => finish(code ?? (signal ? 128 + (signalNumber(signal) ?? 0) : 1)));
  });
}

function signalNumber(s: NodeJS.Signals): number | null {
  return ({ SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 } as Record<string, number>)[s] ?? null;
}

/** The log's entries written after `since` (an ISO time), oldest first; an unreadable line is left out. */
export function watchLogSince(stateDir: string, since: string | undefined): WatchLogEntry[] {
  const f = watchLogFile(stateDir);
  if (!existsSync(f)) return [];
  let text: string;
  try { text = readFileSync(f, "utf8"); } catch { return []; }
  const out: WatchLogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as WatchLogEntry;
      if (typeof e.time === "string" && (!since || e.time > since)) out.push(e);
    } catch { /* not a log line */ }
  }
  return out;
}

// a server's own text is printed with every control character written out, so it cannot act on the reader's terminal
const clip = (s: string | undefined, n = 300) => (s === undefined ? "" : visible(s.length > n ? `${s.slice(0, n)}…` : s));

/** The lines `check` prints for the watcher's log since the last check. */
export function formatWatchEntries(entries: readonly WatchLogEntry[]): string[] {
  if (!entries.length) return [];
  const lines = [`\nsmallprint watch noticed ${entries.length} difference${entries.length === 1 ? "" : "s"} since the last check. Nothing was stopped. It compares tool lists only; it does not see what a tool does when it runs.`];
  for (const e of entries) {
    const when = new Date(e.time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    if (e.change === "lock") {
      lines.push(`  ${when}  ${visible(e.server)}: its tools differ from the record's fingerprint for version ${e.version ?? "unknown"} in smallprint.lock (lock ${e.fingerprintBefore}, served ${e.fingerprintAfter})`);
      continue;
    }
    lines.push(`  ${when}  ${visible(e.server)}: the tool ${quoted(e.tool)} ${WORDS[e.change]}`);
    if (e.change === "description") {
      lines.push(`      before: ${clip(e.descriptionBefore)}`);
      lines.push(`      after:  ${clip(e.descriptionAfter)}`);
    } else if (e.change === "added" && e.descriptionAfter) lines.push(`      description: ${clip(e.descriptionAfter)}`);
    else if (e.change === "schema") lines.push(`      input schema fingerprint was ${e.fingerprintBefore}, now ${e.fingerprintAfter}`);
  }
  return lines;
}
