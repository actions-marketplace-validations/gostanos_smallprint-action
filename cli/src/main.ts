#!/usr/bin/env node
/**
 * npx smallprint check [--json] [--no-upload] [--upload|--yes] [--share] [--email <you@x>] [--no-signup] [--html [file]] [--base <url>]
 * npx smallprint show <registry>/<name>      the record for one entry, from the read API (decision 223)
 * npx smallprint check --locked [--sarif <file>]   the lock check, with a SARIF log for code scanning
 * npx smallprint check --live [--live-local] [--yes]   what each server serves now against the record for its version
 * npx smallprint sync  --label "work laptop" [--yes] [--prune] [--dry-run] [--base <url>]
 *   Needs SMALLPRINT_TOKEN (or --token), minted on your brief settings page. Uploads the same
 *   inventory as check and pins it to your account, so the daily brief watches it. Also sends
 *   the instruction files as a hash of each path, a kind label and the content hash, so the
 *   record of them lives off the machine and every change reaches the brief.
 * npx smallprint schedule --install --label "work laptop"   the same sync every six hours (launchd or systemd), installed by you, removed by you
 *
 * Finds the MCP servers and skills your agents have installed, prints what it
 * found and exactly what it would send, then asks smallprint.dev for advisories
 * and a grade. Nothing leaves the machine but names, versions, hosts and file
 * hashes (and with sync, a kind label and a hash of the path for each instruction file); config values, env vars and tokens are looked at locally for hygiene
 * findings that are printed here and never uploaded. Instruction files
 * (CLAUDE.md, AGENTS.md, OpenClaw's TOOLS.md and SOUL.md, Cursor and Windsurf
 * rules, settings with hooks) are hashed and compared with the last run on
 * this machine; those hashes stay in the local state file.
 *
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { discover, toUpload, type Discovered } from "./discover";
import { detectFirewalls, firewallsForUpload } from "./firewalls";
import { compareInstructions, formatInstructions, FORMER_HASHES_NOTE, pathHash, readInstructionFiles, sendsFormerHashes, toFileUpload, type InstructionBaseline } from "./instructions";
import { compareMods, findMods, modBaseline, type ModBaseline } from "./mods";
import { gateExit, gateServer, type GateRecord } from "./gate";
import { releaseGrade } from "./release";
import { ask, readAssetReply, readCheckReply, readSyncReply, UnexpectedReply, type CheckReply, type FileChange } from "./ask";
import { baselineDateWords, kindOf, plural, readWords, remoteAnswerWords, type RecordAnswer } from "./record";
import { isPrivateHost, withoutPrivateHosts } from "./private-host";
import { machineSalt, SALT_SHAPE, saltFile } from "./salt";
import { buildLock, diffIsEmpty, diffLock, displayPath, formatDiff, formatNotCompared, itemKey, LOCK_FILE, parseLock, projectItems, rootSkillKeys, underProject, type LockScope, sarifLog } from "./lock";
import { HTML_FILE, matchResults, NO_COVERING_ADVISORY, renderReport, rowsOf, type LockState, type ReportData, type ReportFile } from "./html-report";
import { formatLineChange, keyId, lockedLineChange, lockLineMemory, rememberLines, type LineChange } from "./lines";
import type { DiscoveredServer } from "./parse";
import { compareTools, launchFor, lookupFailed, plainUrl, readHosted, readStdio, type RecordTool, type ToolComparison } from "./live";
import { launchdPlist, schtasksCommand, systemdUnits, schedulePlan, systemLaunchdPlist, systemPaths, systemPlan, systemUnits } from "./schedule";
import { formatWatchEntries, runWatch, watchLogSince } from "./watch";
import { chatSources, countByKind, formatScan, SCAN_QUESTION, scanChats } from "./chatscan";
import { execFileSync, spawn as spawnChild } from "node:child_process";
import { chmodSync, chownSync, copyFileSync, lstatSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
// for watch, everything after "--" is the server's own command line: it is never read as this command's flags
const serverArgv = argv[0] === "watch" && argv.includes("--") ? argv.slice(argv.indexOf("--") + 1) : [];
const args = argv[0] === "watch" && argv.includes("--") ? argv.slice(0, argv.indexOf("--")) : argv;
const cmd = args[0];
import { isYes, sendConsent } from "./consent";
import { versionCheckLine } from "./update-check";
const flag = (k: string) => args.includes(`--${k}`);
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
// the root-owned reporter (--system) never takes its destination from the environment: an agent running as the user can
// set SMALLPRINT_BASE_URL in a shell profile, and the install would bake that host into a root job (decision 110)
const systemMode = args[0] === "schedule" && args.includes("--system");
const base = (opt("base") ?? (systemMode ? undefined : process.env.SMALLPRINT_BASE_URL) ?? "https://smallprint.dev").replace(/\/$/, "");
{
  // uploads carry a bearer token: plain http is allowed only to this machine
  let u: URL | null;
  try {
    u = new URL(base);
  } catch {
    u = null;
  }
  const local = u !== null && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
  if (!u || (u.protocol !== "https:" && !local) || u.username || u.password) {
    console.error(`Refusing base URL ${base}: use https (http is allowed only for localhost).`);
    process.exit(2);
  }
}

const VERSION = "1.5.2";
const TIMEOUT = () => AbortSignal.timeout(20_000);
/**
 * The one command for level four. sudo's own environment reset drops NODE_OPTIONS and every other variable an agent
 * could have planted in a shell profile; PATH is kept so npx is found, and the token travels beside it. The base URL is
 * never read from the environment in --system mode.
 */
const SYSTEM_INSTALL = 'sudo --preserve-env=PATH,SMALLPRINT_TOKEN npx -y smallprint schedule --install --system --label "this machine"';

/**
 * Local state: where a successful signup from this machine is remembered (so
 * check stops asking) and the hash baseline for instruction files. Never uploaded.
 */
interface State {
  signedUp?: string;
  instructions?: InstructionBaseline;
  /** What each mod's code said it does at the last run, so a new capability can be named (decision 370). */
  mods?: ModBaseline;
  /** Scheduled runs so far: the first reports at once, later ones wait a random slice of the interval. */
  scheduledRuns?: number;
  /** "<base> <label>" for each machine label whose record has moved to keyed hashes; the unkeyed ones are not sent again. */
  keyedLabels?: string[];
  /** The short name of the salt the line sets under `instructions` were keyed with (lines.ts keyId); sets made under another are not compared. */
  linesKey?: string;
  /** The time of the newest watch log entry check has printed (decision 513). */
  watchShownUntil?: string;
}
function stateDir(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "smallprint");
}
function stateFile(): string {
  return join(stateDir(), "state.json");
}
function readState(): State {
  try {
    if (!existsSync(stateFile())) return {};
    return JSON.parse(readFileSync(stateFile(), "utf8")) as State;
  } catch {
    return {};
  }
}
function writeState(state: State): void {
  try {
    mkdirSync(dirname(stateFile()), { recursive: true, mode: 0o700 });
    writeFileSync(stateFile(), JSON.stringify(state), { mode: 0o600 });
  } catch {
    /* a read-only home is fine; the question just comes back next time */
  }
}

/**
 * The token, in order: --token (discouraged, it lands in shell history), the
 * environment, then ~/.config/smallprint/token, a file only you can read, so a
 * hook or a shell profile can run sync without carrying the token in its text.
 */
function tokenFile(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "smallprint", "token");
}
function readToken(): string | undefined {
  const given = opt("token") ?? process.env.SMALLPRINT_TOKEN;
  if (given) return given;
  try {
    if (!existsSync(tokenFile())) return undefined;
    const t = readFileSync(tokenFile(), "utf8").trim();
    return /^sp_[0-9a-f]{48}$/.test(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

/** The server's one line when it says no; the raw body when it is not JSON. */
async function errorLine(res: Response): Promise<string> {
  const text = (await res.text()).slice(0, 600);
  try {
    const j = JSON.parse(text) as { error?: string };
    if (typeof j.error === "string") return j.error;
  } catch {
    // not JSON: print what came back
  }
  return text;
}

/** A path shortened to ~ for reading only; the separator is the platform's. */
function tilde(p: string): string {
  const home = homedir();
  return p.startsWith(home + sep) ? "~" + p.slice(home.length) : p;
}

/** For the HTML report: a file in the project as ./name, else shortened to ~, so a shared report names no folders above the project. */
function shown(p: string): string {
  const cwd = process.cwd();
  return p.startsWith(cwd + sep) ? "." + p.slice(cwd.length) : tilde(p);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + "…" : s + " ".repeat(n - s.length);
}

function printTable(items: Discovered[]): void {
  console.log(pad("host", 16) + pad("kind", 8) + pad("name", 34) + pad("identity", 40) + "version");
  for (const it of items) {
    if (it.kind === "mcp") console.log(pad(it.host, 16) + pad("mcp", 8) + pad(it.name, 34) + pad(it.canonicalName ?? (it.remoteHost ? `remote ${it.remoteHost}` : "local command"), 40) + (it.version ?? ""));
    else console.log(pad(it.host, 16) + pad("skill", 8) + pad(it.displayName ?? it.name, 34) + pad(`${plural(it.files.length, "file")}, SKILL.md ${it.skillMdSha256.slice(0, 12)}`, 40));
  }
}

/**
 * Instruction files (CLAUDE.md, AGENTS.md, an OpenClaw workspace, Cursor and
 * Windsurf rules, settings with hooks) compared with this machine's last run.
 * Local only: the hashes live in the state file and are never sent.
 */
function reportInstructions(): { files: ReportFile[]; errors: string[] } {
  const errors: string[] = [];
  const files = readInstructionFiles(homedir(), process.cwd(), errors);
  const state = readState();
  const { statuses, baseline } = compareInstructions(files, state.instructions ?? {});
  // line memory (decision 470): a keyed hash of each line of each text file, so the next change can show the lines that
  // were added and grade them; sets made under another salt, or before this version, are recorded again and grade nothing
  const key = lineKey(state);
  const lineChanges: Map<string, LineChange> = key ? rememberLines(statuses, state.instructions ?? {}, baseline, key, state.linesKey === keyId(key)) : new Map();
  console.log("\nInstruction files (compared with this machine's last run, never uploaded):");
  if (!files.length && !statuses.length) {
    console.log("  none found (CLAUDE.md, AGENTS.md, OpenClaw workspace, Cursor and Windsurf rules, Claude settings).");
    return { files: [], errors };
  }
  const text = !flag("no-instruction-text");
  // what the HTML report shows of each file (--html): the status the line above prints and the lines printed under it
  const forReport: ReportFile[] = statuses.map((s) => {
    const change = text && s.status !== "removed" ? lineChanges.get(s.file.path) : undefined;
    if (s.status === "removed") return { path: shown(s.path), status: "removed", since: s.since };
    return { path: shown(s.file.path), status: s.status, ...(s.status !== "new" ? { since: s.since } : {}), ...(s.status === "changed" && s.where ? { where: s.where } : {}), ...(change ? { change } : {}) };
  });
  formatInstructions(statuses, homedir()).forEach((line, i) => {
    console.log(line);
    const s = statuses[i]!;
    // a changed file, or a file read for the first time with a line that matches a high rule (decision 499)
    const change = text && s.status !== "removed" ? lineChanges.get(s.file.path) : undefined;
    if (change) for (const l of formatLineChange(change)) console.log(l);
  });
  for (const e of errors) console.log(`  could not read ${e}`);
  const changed = statuses.filter((s) => s.status === "changed" || s.status === "removed").length;
  const fresh = statuses.filter((s) => s.status === "new").length;
  if (changed) console.log(`  ${changed} changed since the last run. If that was not you, read the file before your agent does.`);
  if (fresh && !state.instructions) console.log("  Recorded. From the next run on, a rewrite of any of these is reported here.");
  console.log("  This record is a file on this machine (~/.config/smallprint/state.json). An agent that can write files can change it as well as the files above.");
  console.log("  To keep a copy off this machine, run sync: the record then lives on smallprint.dev and keeps every change sync reports. https://smallprint.dev/cli#record");
  writeState({ ...state, instructions: baseline, ...(key ? { linesKey: keyId(key) } : {}) });
  return { files: forReport, errors };
}

/**
 * The key for line sets: the machine's salt (salt.ts), written now if there is none. One exception: a machine whose state
 * counts scheduled runs from before its salt existed still has unkeyed hashes for its next sync to move (sendsFormerHashes
 * in instructions.ts), and writing the salt here would hide that trace, so its lines wait until that sync writes it.
 */
function lineKey(state: State): string | undefined {
  const have = machineSalt(false);
  if (have) return have;
  if ((state.scheduledRuns ?? 0) > 0) return undefined;
  return machineSalt(true);
}

/**
 * Claude Code mods (decision 370): plugins whose code runs inside Claude Code. Each is named with what its code says
 * it does, and a capability it did not have at the last run is called out. Read on this machine and never sent; the
 * module itself is also a watched instruction file, so a change to its code shows in the section above.
 */
function reportMods(): void {
  const mods = findMods(homedir(), process.cwd());
  const state = readState();
  if (!mods.length && !state.mods) return;
  console.log("\nMods (Claude Code plugins whose code runs inside Claude Code; read on this machine, never uploaded):");
  if (!mods.length) console.log("  none found now.");
  for (const { mod, added, first } of compareMods(mods, state.mods ?? {})) {
    console.log(`  ${mod.plugin}: ${mod.capabilities.length ? mod.capabilities.join("; ") : "none of the abilities the command looks for"}`);
    console.log(`    code: ${tilde(mod.module)}${mod.files.length > 1 ? ` and ${plural(mod.files.length - 1, "more file")} it names or imports` : ""}, ${mod.sha256.slice(0, 12)}`);
    if (added.length) console.log(`    NEW since the last run: ${added.join("; ")}. If you did not expect this, read the mod's code before your next session.`);
    else if (first && state.mods) console.log("    first seen on this run.");
  }
  if (mods.length) console.log("  What each mod can do is read from its code's text; code written to hide what it does is not caught. https://smallprint.dev/cli#mods");
  writeState({ ...readState(), mods: modBaseline(mods) });
}

/** What smallprint watch noticed since the last check (decision 513), printed once. */
function reportWatch(): void {
  const state = readState();
  const entries = watchLogSince(stateDir(), state.watchShownUntil);
  if (!entries.length) return;
  for (const l of formatWatchEntries(entries)) console.log(l);
  writeState({ ...readState(), watchShownUntil: entries.reduce((t, e) => (e.time > t ? e.time : t), state.watchShownUntil ?? "") });
}

/** The lock on disk for --locked and lock; the path comes from --file, default smallprint.lock in the working directory. */
function lockPath(): string {
  return opt("file") ?? LOCK_FILE;
}

/** What the lock covers: --project keeps to the working directory (the shape CI can check); the default is the whole machine. */
function lockScope(fallback: LockScope = "machine"): LockScope {
  return flag("project") ? "project" : fallback;
}

/** The machine as the lock sees it, at the given scope. */
function currentLock(found: ReturnType<typeof discover>, scope: LockScope, withLines = false) {
  const cwd = process.cwd();
  const items = scope === "project" ? projectItems(found.items, cwd) : found.items;
  const files = readInstructionFiles(homedir(), cwd);
  // the lock keeps line hashes (decision 470): plain for a project file, whose text is in the repository the lock sits
  // beside, and keyed with this machine's salt for a home file, so a committed lock cannot confirm a guessed line
  const key = withLines ? machineSalt(false) : undefined;
  const lock = buildLock(toUpload(items), files, { scope, cwd, ...(withLines ? { lineMemory: (f: (typeof files)[number]) => lockLineMemory(f, key) } : {}) });
  return { lock, files, rootSkills: rootSkillKeys(items, cwd) };
}

/** `smallprint lock`: write what this machine runs and the hashes of its instruction files. Nothing is sent. */
async function lock(): Promise<number> {
  const scope = lockScope();
  const { lock: current, rootSkills } = currentLock(discover(), scope, true);
  const path = lockPath();
  let previous: ReturnType<typeof parseLock> | null = null;
  if (existsSync(path)) {
    try {
      previous = parseLock(readFileSync(path, "utf8"));
    } catch (err) {
      console.error(`${path}: ${(err as Error).message}; not overwriting it. Move it aside to write a fresh lock.`);
      return 1;
    }
  }
  // the record's digest of each pinned version rides in the lock (decision 224), so a later gate can tell if the record
  // itself changed for that version; skipped with --offline, and a server the record does not know keeps no digest
  if (!flag("offline")) {
    for (const it of current.items) {
      if (it.kind !== "mcp" || !it.canonicalName || !it.version) continue;
      const [registry, ...rest] = it.canonicalName.split(":");
      try {
        const res = await fetch(`${base}/api/asset/${registry}/${rest.join(":").split("/").map(encodeURIComponent).join("/")}`, { headers: { accept: "application/json", "user-agent": `smallprint-cli/${VERSION}` }, signal: TIMEOUT() });
        if (!res.ok) continue;
        const e = (await res.json()) as { versions?: { version: string; contentHash: string | null }[] };
        const h = e.versions?.find((v) => v.version === it.version)?.contentHash;
        if (h) it.recordSha256 = h;
      } catch {
        /* offline or slow: the lock is still complete without the digest */
      }
    }
  }
  // an unchanged machine leaves the file exactly as it was, byte for byte (decision 494): only the time it was written
  // would differ, and a lock that changes on every run shows up as a change in git and in anyone's own hash of it
  const sameAsBefore = (() => {
    if (!previous) return false;
    try {
      const was = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      return JSON.stringify({ ...was, written: "" }) === JSON.stringify({ ...current, written: "" });
    } catch {
      return false;
    }
  })();
  if (sameAsBefore) {
    console.log(`Nothing changed since the last lock; ${path} is left exactly as it was.`);
    return 0;
  }
  writeFileSync(path, JSON.stringify(current, null, 2) + "\n");
  console.log(`${previous ? "Updated" : "Wrote"} ${path} (${scope === "project" ? "this project only" : "this whole machine"}): ${plural(current.items.length, "server or skill", "servers and skills")}, ${plural(current.files.length, "instruction file")}. Names, versions, hosts, hashes and instruction-file paths; no configuration values.`);
  if (scope === "machine") console.log("For a lock the repository owns and CI can check, write it with --project: it then holds only what lives under this directory.");
  if (previous) {
    const d = diffLock(previous, current, rootSkills);
    if (!diffIsEmpty(d)) {
      console.log("Since the last lock:");
      for (const l of formatDiff(d)) console.log(l);
    } else console.log("Nothing changed since the last lock.");
  }
  console.log("Commit it. `smallprint check --locked` then fails when anything changes, here or in CI.");
  return 0;
}

/** `check --locked`: compare this machine with the lock and exit 2 when anything changed. Local only, works offline. */
function checkLocked(found: ReturnType<typeof discover>): number {
  const path = lockPath();
  if (!existsSync(path)) {
    console.error(`No ${path}. Write one with: smallprint lock`);
    return 1;
  }
  let previous: ReturnType<typeof parseLock>;
  try {
    previous = parseLock(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`${path}: ${(err as Error).message}`);
    return 1;
  }
  // the lock says what it covers; --project on the command line narrows an older machine lock to the project
  const scope = lockScope(previous.scope);
  const { lock: current, files, rootSkills } = currentLock(found, scope);
  const d = diffLock(previous, current, rootSkills);
  // under each changed instruction file, the lines added since the lock and their grades (decision 470);
  // --no-instruction-text keeps the one line it printed before
  const absolute = new Map(files.map((f) => [displayPath(f.path), f.path]));
  const key = machineSalt(false);
  const under = flag("no-instruction-text") ? undefined : (p: string): string[] => {
    const entry = previous.files.find((f) => f.path === p);
    const abs = absolute.get(p);
    return entry && abs ? lockedLineChange(entry, abs, key) : [];
  };
  // files the lock's writer did not watch, or this version does not read: said, and not a difference
  const notCompared = formatNotCompared(d);
  if (diffIsEmpty(d)) {
    console.log(`Matches ${path} (written ${previous.written.slice(0, 10)}, ${scope === "project" ? "this project" : "this machine"}): ${plural(current.items.length, "server or skill", "servers and skills")}, ${plural(current.files.length, "instruction file")}, nothing changed.`);
    for (const l of notCompared) console.log(l);
    return 0;
  }
  console.log(`Differs from ${path} (written ${previous.written.slice(0, 10)}):`);
  for (const l of formatDiff(d, under)) console.log(l);
  for (const l of notCompared) console.log(l);
  // --sarif <file>: the same lines as a SARIF 2.1.0 log, one result each, for a code-scanning upload (decision 223)
  const sarifPath = opt("sarif");
  if (sarifPath) {
    const lines = formatDiff(d);
    writeFileSync(sarifPath, JSON.stringify(sarifLog(lines, path, VERSION), null, 2));
    console.log(`SARIF written to ${sarifPath} (${lines.length} result${lines.length === 1 ? "" : "s"}).`);
  }
  console.log(`If these are yours, run \`smallprint lock${scope === "project" ? " --project" : ""}\` again and commit it. Exit 2.`);
  if (scope === "machine" && d.filesMissing.length + d.removed.length > 0) console.log("A machine lock includes home-directory entries, which another machine or a CI runner will not have; a lock written with --project holds only this repository's.");
  return 2;
}

/**
 * `check --live` and `check --live-local` (decision 269): what each server serves now against what the
 * record holds for its version. Exit 2 when any server serves something different, 0 otherwise.
 */
async function live(found: ReturnType<typeof discover>): Promise<number> {
  // --no-upload promises that nothing leaves the machine, and the live check has to ask smallprint.dev for the record of
  // each server (a registry name, a version or a host) and ask each hosted server for its tools; so with --no-upload it
  // asks nothing at all (tools audit of 29 Sep 2026, fix 6)
  if (flag("no-upload")) {
    console.log("--no-upload: nothing sent, so nothing was compared. The live check asks smallprint.dev for the record of each server, by its registry name, version or host, and asks each hosted server for its tools. Run it without --no-upload to compare.");
    return 0;
  }
  const servers = found.items.filter((i): i is DiscoveredServer => i.kind === "mcp");
  const withLocal = flag("live-local");
  const remote = servers.filter((s) => s.transport === "http" || s.transport === "sse");
  const local = servers.filter((s) => s.transport === "stdio" && s.canonicalName);
  if (!remote.length && !(withLocal && local.length)) {
    console.log(withLocal ? "No hosted servers and no local servers with a package identity found; nothing to compare." : `No hosted servers found. ${local.length ? `${local.length} local server${local.length === 1 ? "" : "s"} can be compared too, with --live-local, which starts each one.` : ""}`);
    return 0;
  }
  console.log("Asking each server what it serves now, and comparing names and descriptions with the record for its version.");
  console.log("What the servers answer stays on this machine; only a registry name, a version or a host is sent to look the record up.\n");
  let differs = 0;
  // the servers actually compared: a "?" line compared nothing, so the closing line never says "nothing differs" for it
  let compared = 0;
  // a lookup that failed is said as a failed lookup, never as a fact about the record (pass 4 audit of 16 Oct 2026): only
  // an answer, or a 404, says what the record holds
  const get = async <T,>(url: string): Promise<{ body: T | null; failed?: string }> => {
    try {
      const r = await fetch(url, { headers: { accept: "application/json", "user-agent": `smallprint-cli/${VERSION}` }, signal: TIMEOUT() });
      if (r.ok) return { body: (await r.json()) as T };
      return r.status === 404 ? { body: null } : { body: null, failed: lookupFailed(r.status) };
    } catch {
      return { body: null, failed: lookupFailed(null) };
    }
  };
  const receipt = async (cn: string, version: string) => {
    const [registry, ...rest] = cn.split(":");
    return get<{ tools?: RecordTool[] | null }>(`${base}/api/receipt/${registry}/${rest.join(":").split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(version)}`);
  };
  const report = (label: string, cmp: ToolComparison, version: string) => {
    compared++;
    if (cmp.same) { console.log(`  same     ${label}: every tool name and description matches the record, ${version}`); return; }
    differs++;
    console.log(`  DIFFERS  ${label}: what it serves now is not what the record holds, ${version}`);
    if (cmp.changed.length) console.log(`           description changed: ${cmp.changed.join(", ")}`);
    if (cmp.added.length) console.log(`           served now, not in the record: ${cmp.added.join(", ")}`);
    if (cmp.removed.length) console.log(`           in the record, not served now: ${cmp.removed.join(", ")}`);
  };
  for (const s of remote) {
    const l = launchFor(s);
    const url = l?.url;
    if (!url) { console.log(`  ?        ${s.name}: no address in its config`); continue; }
    const host = new URL(url).host;
    // a private address is never on the record, and asking about one would tell smallprint.dev about this network
    if (isPrivateHost(host)) { console.log(`  ?        ${s.name} (${host}): a private address, so it was not looked up on the record and there is nothing to compare`); continue; }
    const rec = await get<{ entries?: { canonicalName: string; url: string; version: string | null }[] }>(`${base}/api/remote?host=${encodeURIComponent(host)}`);
    const mine = plainUrl(url);
    const entry = rec.body?.entries?.find((e) => plainUrl(e.url) === mine);
    const read = await readHosted(url);
    if (!read.ok) { console.log(`  ?        ${s.name} (${host}): ${read.why}`); continue; }
    if (rec.failed) { console.log(`  ?        ${s.name} (${host}): serves ${read.tools.length} tools; ${rec.failed}, so nothing was compared`); continue; }
    if (!entry || !entry.version) { console.log(`  ?        ${s.name} (${host}): serves ${read.tools.length} tools; this address is not on the record, so there is nothing to compare`); continue; }
    const r = await receipt(entry.canonicalName, entry.version);
    if (!r.body?.tools) { console.log(`  ?        ${s.name} (${host}): ${r.failed ? `${r.failed}, so nothing was compared` : `the record has no tool list for ${entry.version}`}`); continue; }
    report(`${s.name} (${entry.canonicalName})`, compareTools(read.tools, r.body.tools), entry.version === "latest" ? "what it served when the record last read it" : `version ${entry.version}`);
  }
  if (withLocal && local.length) {
    const plan = local.map((s) => ({ s, l: launchFor(s) })).filter((x) => x.l && x.l.command);
    console.log(`${remote.length ? "\n" : ""}--live-local starts ${plan.length} local server${plan.length === 1 ? "" : "s"} with the command, arguments and environment in your config, asks each for its tools, and stops it:`);
    for (const { s, l } of plan) console.log(`  ${s.name}: ${l!.command} ${l!.args.join(" ")}`);
    let go = flag("yes");
    if (!go) {
      if (!process.stdin.isTTY) { console.log("\nNo terminal to ask in; nothing started. Run again with --yes to start them."); return differs ? 2 : 0; }
      go = isYes(await ask("\nStart them now? This runs their code, as your agent does. [y/N] "));
    }
    if (go) {
      console.log("");
      for (const { s, l } of plan) {
        if (!s.version) { console.log(`  ?        ${s.name}: version unknown, so there is no recorded version to compare with; pin an exact version`); continue; }
        const read = await readStdio(l!);
        if (!read.ok) { console.log(`  ?        ${s.name}: ${read.why}`); continue; }
        const r = await receipt(s.canonicalName!, s.version);
        if (!r.body?.tools) { console.log(`  ?        ${s.name}: ${r.failed ? `${r.failed}, so nothing was compared` : `the record has no tool list for ${s.version}`}`); continue; }
        report(`${s.name} (${s.canonicalName} ${s.version})`, compareTools(read.tools, r.body.tools), `version ${s.version}`);
      }
    } else console.log("Nothing started.");
  }
  console.log(differs ? `\n${differs} server${differs === 1 ? " serves" : "s serve"} something the record does not hold for that version. If you did not change it, read the entry page before your agent uses it.` : compared ? `\nNothing served differs from the record in the ${plural(compared, "server")} compared.` : "\nNo server was compared with the record.");
  return differs ? 2 : 0;
}

/**
 * Where --html writes the report: the path after the flag, or smallprint-report.html in the working directory. The
 * path is optional, so a word after --html that starts with "--" is the next flag, not a path.
 */
function htmlTarget(): string | undefined {
  const i = args.indexOf("--html");
  if (i < 0) return undefined;
  const next = args[i + 1];
  return resolve(next && !next.startsWith("--") ? next : HTML_FILE);
}

/** Each item against the lock, for the report's lock column; null when there is no lock. Local only, nothing is sent. */
function lockColumn(found: ReturnType<typeof discover>): { states: LockState[]; info: NonNullable<ReportData["lock"]> } | { problem: string } | null {
  const path = lockPath();
  if (!existsSync(path)) return null;
  let previous: ReturnType<typeof parseLock>;
  try {
    previous = parseLock(readFileSync(path, "utf8"));
  } catch (err) {
    return { problem: `${path} could not be read (${(err as Error).message}), so the lock column is left out.` };
  }
  const scope = lockScope(previous.scope);
  const { lock: current, rootSkills } = currentLock(found, scope);
  const d = diffLock(previous, current, rootSkills);
  const changed = new Map(d.changed.map((c) => [itemKey(c.after), c.what]));
  const inLock = new Set(previous.items.map(itemKey));
  const states = found.items.map((it): LockState => {
    const k = itemKey(it);
    const what = changed.get(k);
    if (what !== undefined) return { state: "changed", what };
    return inLock.has(k) ? { state: "matches" } : { state: "not in lock" };
  });
  return { states, info: { path, written: previous.written, scope, gone: d.removed.length } };
}

async function check(): Promise<number> {
  const found = discover();
  const html = htmlTarget();
  if (html && (flag("live") || flag("live-local") || flag("locked") || flag("json"))) console.error("--html writes a report of the plain check only, so no report is written with --json, --locked or --live.");
  if (flag("live") || flag("live-local")) return live(found);
  if (flag("locked")) return checkLocked(found);
  if (flag("json")) {
    const instructions = readInstructionFiles().map((f) => ({ host: f.host, path: f.path, sha256: f.sha256 }));
    // self-describing, because readers paste this into an assistant (decision 210): nothing was sent, and the fields are explained on the CLI page
    const mods = findMods(homedir(), process.cwd()).map((m) => ({ plugin: m.plugin, module: m.module, files: m.files, sha256: m.sha256, capabilities: m.capabilities }));
    console.log(JSON.stringify({ about: "https://smallprint.dev/cli#json", sent: "nothing", read: found.read, errors: found.errors, items: toUpload(found.items), instructions, mods }, null, 2));
    return 0;
  }
  // --html (decision 510): the report is written at every way out below that has the inventory, with grades when there are some
  let instructionReport: ReturnType<typeof reportInstructions> = { files: [], errors: [] };
  const finish = (code: number, graded: { reply: CheckReply } | { why: string; attempted?: boolean }): number => {
    if (!html) return code;
    const lock = lockColumn(found);
    const results = "reply" in graded ? matchResults(found.items, graded.reply.results) : undefined;
    const data: ReportData = {
      version: VERSION,
      readAt: new Date(),
      rows: rowsOf(found.items, { underProject: (p) => underProject(p), tilde: shown, ...(results ? { results } : {}), ...(lock && "states" in lock ? { lock: lock.states } : {}) }),
      grades: "reply" in graded ? { letter: graded.reply.grade, headline: graded.reply.headline, criterion: graded.reply.criterion } : null,
      ...("why" in graded ? { noGrades: graded.why, ...(graded.attempted ? { attempted: true } : {}) } : {}),
      noUpload: flag("no-upload"),
      lock: lock && "info" in lock ? lock.info : null,
      ...(lock && "problem" in lock ? { lockProblem: lock.problem } : {}),
      files: instructionReport.files,
      fileErrors: instructionReport.errors.map(tilde),
      linesHidden: flag("no-instruction-text"),
    };
    try {
      writeFileSync(html, renderReport(data));
    } catch (err) {
      console.error(`Could not write the report to ${html}: ${(err as Error).message}`);
      return code || 1;
    }
    console.log(`\nReport written to ${tilde(html)}. It loads nothing from the internet; open it in a browser.`);
    return code;
  };
  const noUploadWhy = "Grades were not looked up, because --no-upload sends nothing.";
  const notSent = (how: string) => ({ why: `Grades were not looked up, because nothing was sent. ${how}` });
  console.log(`Read ${found.read.length} config location${found.read.length === 1 ? "" : "s"}:`);
  for (const p of found.read) console.log(`  ${tilde(p)}`);
  for (const e of found.errors) console.log(`  could not read ${e.path}: ${e.error}`);
  console.log("");
  if (!found.items.length) {
    console.log("No MCP servers or skills found in the locations above (Claude Desktop, Claude Code and its plugins, Cursor, Windsurf, Codex, GitHub Copilot CLI plugins, VS Code, Visual Studio, Zed, Gemini CLI, Qwen Code, Cline, Roo, Kilo Code, Kiro, OpenCode, Crush, Amp, Continue, Goose, LM Studio, Junie, Trae, Augment, Warp, ZCode, OpenClaw, Hermes, harnOS).");
    console.log("Have a config somewhere else? Paste it at https://smallprint.dev/check.");
    instructionReport = reportInstructions();
    reportMods();
    reportWatch();
    return finish(0, { why: flag("no-upload") ? noUploadWhy : "No MCP servers or skills were found, so there was nothing to look up." });
  }
  printTable(found.items);
  const hygiene = [...new Set(found.items.flatMap((it) => (it.kind === "mcp" ? it.hygiene : [])))];
  if (hygiene.length) {
    console.log("\nLocal findings (never uploaded):");
    for (const h of hygiene) console.log(`  ${h}`);
  }
  instructionReport = reportInstructions();
  reportMods();
  reportWatch();
  if (flag("no-upload")) {
    console.log("\n--no-upload: nothing sent.");
    return finish(0, { why: noUploadWhy });
  }
  const payload = withoutPrivateHosts(toUpload(found.items)); // a private host is never sent (tools audit fix 6)
  // nothing leaves the machine until the person says so (decision 239): the list above is what would be sent, as names,
  // versions, hosts and file hashes; the question is asked in a terminal, and without one nothing is sent
  const what = `${payload.length} item${payload.length === 1 ? "" : "s"} (names, versions, hosts, file hashes; no config values)`;
  const consent = sendConsent({ noUpload: flag("no-upload"), upload: flag("upload"), yes: flag("yes"), share: flag("share"), email: opt("email") }, Boolean(process.stdin.isTTY));
  if (consent === "skip") {
    console.log(`\nNothing sent. To get grades and advisories for the list above, run again with --upload: it sends ${what} to ${base}/api/check.`);
    return finish(0, notSent("To get them, run npx smallprint check --upload --html."));
  }
  if (consent === "ask") {
    const answer = await ask(`\nSend ${what} to ${base}/api/check to get grades and advisories? [y/N] `);
    if (!isYes(answer)) {
      console.log("Nothing sent.");
      return finish(0, notSent("The answer at the question was no."));
    }
  }
  console.log(`\nSending to ${base}/api/check: ${what}.`);
  let res: Response;
  try {
    res = await fetch(`${base}/api/check`, { method: "POST", headers: { "content-type": "application/json", "user-agent": `smallprint-cli/${VERSION}` }, body: JSON.stringify({ items: payload, share: flag("share"), source: "cli" }), signal: TIMEOUT() });
  } catch (err) {
    console.error(`Could not reach ${base} (${(err as Error).message}). Check your connection or proxy; --no-upload prints the inventory without sending.`);
    return finish(1, { why: `There are no grades, because the check could not reach ${base}.`, attempted: true });
  }
  if (!res.ok) {
    console.error(`${base}/api/check answered ${res.status}: ${await errorLine(res)}`);
    return finish(1, { why: `There are no grades, because ${base}/api/check answered ${res.status}.`, attempted: true });
  }
  let r: CheckReply;
  try {
    r = await readCheckReply(res, `${base}/api/check`);
  } catch (err) {
    // the command still ends in the one sentence main prints for an answer it cannot read; the report says the same
    if (err instanceof UnexpectedReply) finish(1, { why: `There are no grades, because ${base}/api/check answered with something this version of the command cannot read.`, attempted: true });
    throw err;
  }
  console.log(`\nGrade ${r.grade}: ${r.headline}`);
  console.log(`  ${r.criterion}`);
  // "clean" is the status key the record answers with; on screen it reads as what it is, never as safe (decision 210), and
  // never as "no advisory" beside a line that names advisories on other versions (pass 5 audit of 16 Oct 2026)
  const statusWords = (s: string) => (s === "clean" ? NO_COVERING_ADVISORY : s);
  const width = Math.max(12, ...r.results.map((x) => statusWords(x.status).length));
  for (const x of r.results) console.log(`  ${pad(statusWords(x.status), width)} ${pad(x.name, 40)} ${x.detail}${x.url ? `  ${x.url}` : ""}`);
  if (r.cardUrl) console.log(`\nShareable card: ${r.cardUrl}`);
  else console.log("\nAdd --share for a card link you can post.");
  const code = finish(0, { reply: r });
  const brief = await offerBrief(payload);
  return brief || code;
}

/** The one question at the end of check: watch these in the daily brief? */
async function offerBrief(payload: ReturnType<typeof toUpload>): Promise<number> {
  if (flag("no-signup")) return 0;
  let email = opt("email")?.trim();
  if (!email) {
    if (!process.stdin.isTTY) return 0;
    const state = readState();
    if (state.signedUp) {
      console.log(`\nThis machine signed up as ${state.signedUp}. Pin changes with sync; run with --email to sign up another address.`);
      return 0;
    }
    email = (await ask("\nWatch these in the daily brief? Type your email to start. New accounts get 30 days of Pro, no credit card required. Your address is sent with the list above, this computer's name and your time zone. Enter to skip (--no-signup silences this): ")).trim();
    if (!email) return 0;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("That does not look like an email address. Nothing sent; the check above still stands.");
    return 0;
  }
  const label = hostname();
  let tz = "UTC";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    /* keep UTC */
  }
  let res: Response;
  try {
    res = await fetch(`${base}/api/start`, { method: "POST", headers: { "content-type": "application/json", "user-agent": `smallprint-cli/${VERSION}` }, body: JSON.stringify({ email, tz, label, items: payload }), signal: TIMEOUT() });
  } catch (err) {
    console.error(`Could not reach ${base} (${(err as Error).message}). Ask for your link at ${base}/start instead.`);
    return 1;
  }
  // an answer that is not the object expected is read as an empty one: the status still says whether it worked
  const raw = (await res.json().catch(() => null)) as unknown;
  const j = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as { message?: unknown; error?: unknown; notPinned?: unknown };
  if (!res.ok) {
    console.error(typeof j.error === "string" ? j.error : `${base}/api/start answered ${res.status}`);
    return 1;
  }
  console.log(`\n${typeof j.message === "string" ? j.message : "Sent."}`);
  for (const u of Array.isArray(j.notPinned) ? (j.notPinned as { name?: unknown; reason?: unknown }[]) : []) if (u && typeof u.name === "string") console.log(`  not pinned: ${u.name}: ${typeof u.reason === "string" ? u.reason : ""}`);
  writeState({ ...readState(), signedUp: email });
  return 0;
}

/**
 * A desktop notification, best effort, never an error (decision 270): macOS through osascript, Linux through
 * notify-send when it is installed, nothing on Windows or when running as root, where there is no desktop to show it on.
 */
function desktopNotify(title: string, body: string): void {
  if (typeof process.getuid === "function" && process.getuid() === 0) return;
  // quotes and backslashes would end the notification's text, and a line break or other control character would end the
  // script; all of them go, so no text can become part of the command
  const clean = (s: string) => s.replace(/["\\]/g, "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").slice(0, 200);
  try {
    const sp = spawnChild;
    if (process.platform === "darwin") sp("osascript", ["-e", `display notification "${clean(body)}" with title "Small Print" subtitle "${clean(title)}"`], { stdio: "ignore", detached: true }).unref();
    else if (process.platform === "linux") sp("notify-send", ["Small Print: " + clean(title), clean(body)], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    /* no desktop */
  }
}

async function sync(): Promise<number> {
  const token = readToken();
  if (opt("token")) console.error("Note: --token shows up in shell history and process listings; prefer SMALLPRINT_TOKEN in the environment or the token file (see --help).");
  const label = opt("label") ?? hostname();
  const quiet = flag("quiet");
  const say = (m: string) => {
    if (!quiet) console.log(m);
  };
  // a scheduled run waits a random slice of its interval first (a fifth, at most thirty minutes), so a rewrite
  // cannot be timed to sit between two predictable runs; --no-jitter for tests and hand runs
  const every = flag("scheduled") && opt("every") ? Number(opt("every")) * 3600 : 0;
  // scheduled runs counted before this one, and whether the salt was already on file: together they say whether this
  // machine reported before its hashes were keyed (see `migrate` below)
  const runsBefore = readState().scheduledRuns ?? 0;
  const saltBefore = machineSalt(false) !== undefined;
  if (every > 0) {
    const st = readState();
    const runs = st.scheduledRuns ?? 0;
    writeState({ ...st, scheduledRuns: runs + 1 });
    if (runs > 0 && !flag("no-jitter")) {
      const wait = Math.floor(Math.random() * Math.min(every / 5, 1800) * 1000);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  const found = discover();
  say(`Read ${found.read.length} config location${found.read.length === 1 ? "" : "s"}.`);
  // path hashes, project scopes and MCP env hashes are keyed with this machine's salt (security audit item 36)
  const key = machineSalt(true);
  const keyedId = `${base} ${label}`;
  const migrate = sendsFormerHashes({ hasKey: Boolean(key), labelKeyed: (readState().keyedLabels ?? []).includes(keyedId), saltBefore, runsBefore, asked: flag("migrate-unkeyed") });
  if (flag("migrate-unkeyed") && !migrate) say(`--migrate-unkeyed: "${label}" already reports keyed hashes from this machine, so there is nothing to move and no unkeyed hash is sent.`);
  const instructionFiles = readInstructionFiles(homedir(), process.cwd(), [], key);
  const byPathHash = new Map(instructionFiles.map((f) => [pathHash(f.path, key), f.path]));
  const fileUpload = toFileUpload(instructionFiles, process.cwd(), key, migrate);
  if (!found.items.length && !instructionFiles.length) {
    console.log("Nothing to pin: no MCP servers, skills or instruction files found.");
    return 0;
  }
  if (!quiet) printTable(found.items);
  const payload = withoutPrivateHosts(toUpload(found.items)); // a private host is never sent (tools audit fix 6)
  // agent firewalls on this machine, names only (decision 156): a count for Small Print, shown in no brief and on no page
  const firewalls = firewallsForUpload(detectFirewalls());
  say(`Agent firewalls: ${firewalls.length ? firewalls.join(", ") : "none detected"}${firewalls.length ? " (name only is sent)" : ""}`);
  say(`\nWill pin ${payload.length} item${payload.length === 1 ? "" : "s"} to your account as machine "${label}" via ${base}/api/sync, and record ${instructionFiles.length} instruction file${instructionFiles.length === 1 ? "" : "s"} there.`);
  say(`Sent: names, versions, hosts, file hashes (for a skill, its SKILL.md hash and one hash over all its files); for instruction files a kind label, a hash of the path ${key ? "keyed with a salt that stays on this machine" : "(not keyed: no salt file could be written on this machine)"}, the content hash, and for a JSON file the name of each top-level setting, or of each server in an MCP config, with a hash of it; for a file in this project, a hash of this folder; the machine label; the names of any agent firewalls found${every > 0 ? "; this run's interval" : ""}. What each command sends, and when, is listed on the privacy page: https://smallprint.dev/legal/privacy`);
  if (migrate) say(FORMER_HASHES_NOTE);
  if (flag("dry-run")) {
    for (const f of fileUpload.files) console.log(`  ${pad(f.kind, 44)} ${f.sha256.slice(0, 12)}  path hash ${f.pathHash.slice(0, 12)}${f.formerPathHash ? `  earlier unkeyed path hash ${f.formerPathHash.slice(0, 12)}` : ""}${f.formerSha256 ? `  earlier unkeyed content hash ${f.formerSha256.slice(0, 12)}` : ""}`);
    for (const [to, from] of Object.entries(fileUpload.formerScopes ?? {})) console.log(`  this project folder: scope ${to}  earlier unkeyed scope ${from}`);
    console.log("--dry-run: nothing sent.");
    return 0;
  }
  if (!token) {
    console.error(`\nNo token. Make one on your brief settings page, then: SMALLPRINT_TOKEN=sp_... npx smallprint sync --label "work laptop"\nOr keep it in ${tokenFile()} (chmod 600) and leave the environment alone.`);
    return 2;
  }
  if (!flag("yes")) {
    if (!process.stdin.isTTY) {
      console.error("\nRefusing to upload without --yes when not run interactively.");
      return 2;
    }
    if (!isYes(await ask("\nUpload and pin? [y/N] "))) {
      console.log("Not sent.");
      return 0;
    }
  }
  let res: Response;
  try {
    res = await fetch(`${base}/api/sync`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "user-agent": `smallprint-cli/${VERSION}` }, body: JSON.stringify({ label, items: payload, prune: flag("prune"), files: fileUpload.files, scopes: fileUpload.scopes, ...(fileUpload.formerScopes ? { formerScopes: fileUpload.formerScopes } : {}), firewalls, scheduled: flag("scheduled"), ...(flag("scheduled") && opt("every") ? { every: Math.round(Number(opt("every")) * 3600) } : {}) }), signal: TIMEOUT() });
  } catch (err) {
    console.error(`Could not reach ${base} (${(err as Error).message}). Check your connection or proxy and try again.`);
    return 1;
  }
  if (!res.ok) {
    console.error(`${base}/api/sync answered ${res.status}: ${await errorLine(res)}`);
    return 1;
  }
  const r = await readSyncReply(res, `${base}/api/sync`);
  // once a keyed report for this label is on record, no unkeyed hash is sent for it again: after a move the server
  // answers with "rekeyed", and a label that started keyed never had anything to move
  if (key && (!migrate || typeof r.rekeyed === "number")) writeState({ ...readState(), keyedLabels: [...new Set([...(readState().keyedLabels ?? []), keyedId])] });
  const summary = `Pinned ${r.pinned} (${r.created} new${r.dropped ? `, ${r.dropped} dropped` : ""}).`;
  const problems = r.unknown.map((u) => `  not pinned: ${u.name} (${u.host}): ${u.reason}`);
  const where = (c: FileChange) => (c.where ? `  in: ${c.where.length ? c.where.join(", ") : "formatting only"}` : "");
  const name = (c: { pathHash: string; kind: string }) => {
    const p = byPathHash.get(c.pathHash);
    return p ? tilde(p) : c.kind;
  };
  const fileLines: string[] = [];
  const alerts: string[] = [];
  if (r.files) {
    fileLines.push(`Instruction files reported for "${label}": ${r.files.recorded}. The record lives on smallprint.dev and keeps every change; a rewrite here cannot erase it.`);
    for (const c of r.files.changed) alerts.push(`  CHANGED since ${(c.since ?? "").slice(0, 10)}  ${name(c)}  was ${(c.from ?? "").slice(0, 12)}, now ${(c.to ?? "").slice(0, 12)}${where(c)}`);
    for (const c of r.files.removed) alerts.push(`  REMOVED  ${name(c)}  was ${(c.from ?? "").slice(0, 12)} since ${(c.since ?? "").slice(0, 10)}`);
    for (const c of r.files.returned) alerts.push(`  RETURNED ${name(c)}  ${c.from === c.to ? "same content as before" : `changed while away: was ${(c.from ?? "").slice(0, 12)}, now ${(c.to ?? "").slice(0, 12)}${where(c)}`}`);
    if (r.files.firstSeen.length) fileLines.push(`  ${r.files.firstSeen.length} first seen; from the next sync on, a change to any of them is recorded and reaches your brief.`);
    for (const l of r.files.limited) fileLines.push(`  not recorded: ${name(l)}: ${l.reason}`);
  }
  if (quiet) {
    // the scheduled run: one line when nothing changed, the alerts when something did
    console.log(`[${new Date().toISOString()}] ${summary} ${r.files ? `${r.files.recorded} instruction files reported` : ""}${alerts.length ? `; ${alerts.length} CHANGED` : ""}`);
    for (const a of alerts) console.log(a);
    // a desktop notification from the scheduled run when an instruction file changed (decision 270); --no-notify turns it off
    if (alerts.length && !flag("no-notify")) desktopNotify(`${alerts.length} instruction file${alerts.length === 1 ? "" : "s"} changed on "${label}"`, "If that was not you, read the file before your agent does. It is in your next brief.");
    for (const p of problems) console.log(p);
    return 0;
  }
  console.log(`\n${summary}`);
  for (const p of problems) console.log(p);
  for (const l of fileLines) console.log(l);
  if (alerts.length) {
    console.log("  Since the last report from this machine:");
    for (const a of alerts) console.log(a);
    console.log("  These are in your next brief. If that was not you, read the file before your agent does.");
  }
  console.log("Your next brief covers these pins and files.");
  return 0;
}

/** The home directory of another account, asked of the system rather than guessed. */
function homeOf(user: string): string {
  try {
    if (process.platform === "darwin") {
      const out = execFileSync("dscl", [".", "-read", `/Users/${user}`, "NFSHomeDirectory"], { encoding: "utf8" });
      const m = /NFSHomeDirectory:\s*(.+)/.exec(out);
      if (m) return m[1]!.trim();
    } else {
      const out = execFileSync("getent", ["passwd", user], { encoding: "utf8" });
      const home = out.split(":")[5];
      if (home) return home.trim();
    }
  } catch {
    /* fall through */
  }
  return process.platform === "darwin" ? `/Users/${user}` : `/home/${user}`;
}

/** True when a path is owned by root and writable by nobody else: the only kind of file root should run. */
function rootOnly(path: string): boolean {
  try {
    const st = statSync(path);
    return st.uid === 0 && (st.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

/**
 * Level four: install, remove or show the root-owned reporter. Needs sudo.
 * Copies the dependency-free Python helper shipped in this package to a
 * root-owned folder, puts the token in a root-owned file, and loads a system
 * job that runs the helper with the system interpreter. Refuses if the
 * interpreter or the destination is writable by anyone but root, because a
 * file the user can edit is a file the user's agent can edit.
 */
async function scheduleSystem(): Promise<number> {
  const plat = process.platform;
  if (plat !== "darwin" && plat !== "linux") {
    console.log("Level four (a root-owned reporter) is available on macOS and Linux. On Windows, level three under an administrator account is the closest equivalent.");
    return 2;
  }
  const paths = systemPaths(plat);
  if (flag("status")) {
    console.log(existsSync(paths.job) ? `Installed: ${paths.job}, helper ${paths.helper}, token ${paths.token} (root-owned). Log: ${paths.log}` : "Not installed. sudo smallprint schedule --install --system --label \"this machine\"");
    return 0;
  }
  if ((process.getuid?.() ?? 1) !== 0) {
    console.error(`Level four installs a root-owned job, so it needs sudo: ${SYSTEM_INSTALL}`);
    return 2;
  }
  // the installer runs as root from the user's shell, which is the one moment an agent running as the user could interfere:
  // a preload in NODE_OPTIONS would run as root before this line. Refuse it rather than run it (decision 110).
  if (process.env.NODE_OPTIONS && (flag("install") || flag("uninstall"))) {
    console.error(`NODE_OPTIONS is set (${process.env.NODE_OPTIONS.slice(0, 80)}). The level-four installer does not run with a preload; unset it, or run: ${SYSTEM_INSTALL}`);
    return 2;
  }
  if (flag("uninstall")) {
    if (plat === "darwin") {
      try {
        execFileSync("launchctl", ["bootout", "system", paths.job], { stdio: "ignore" });
      } catch {
        /* not loaded */
      }
    } else {
      try {
        execFileSync("systemctl", ["disable", "--now", "smallprint-report.timer"], { stdio: "ignore" });
      } catch {
        /* not enabled */
      }
    }
    rmSync(paths.job, { force: true });
    if (paths.timer) rmSync(paths.timer, { force: true });
    rmSync(paths.helper, { force: true });
    rmSync(paths.token, { force: true });
    rmSync(join(paths.tokenDir, "salt"), { force: true });
    rmSync(join(paths.tokenDir, "keyed-labels"), { force: true });
    rmSync(join(paths.tokenDir, "migrate-labels"), { force: true });
    if (plat === "linux") {
      try {
        execFileSync("systemctl", ["daemon-reload"], { stdio: "ignore" });
      } catch {
        /* fine */
      }
    }
    console.log(`Removed the root-owned reporter, its token and its job. The record on smallprint.dev stays. The log at ${paths.log} is left for you to read or delete.`);
    return 0;
  }
  if (!flag("install")) {
    console.log(`usage: ${SYSTEM_INSTALL} [--user name] [--every 6]\n       sudo npx -y smallprint schedule --uninstall --system\n       smallprint schedule --status --system`);
    return 2;
  }
  const user = opt("user") ?? process.env.SUDO_USER;
  if (!user || user === "root") {
    console.error("Say whose files to read: --user <account>, or run through sudo from that account so SUDO_USER is set.");
    return 2;
  }
  const userHome = homeOf(user);
  // the token: --token, the environment (sudo --preserve-env=SMALLPRINT_TOKEN keeps it), or the account's own token file
  let token = opt("token") ?? process.env.SMALLPRINT_TOKEN;
  if (!token) {
    try {
      token = readFileSync(join(userHome, ".config", "smallprint", "token"), "utf8").trim();
    } catch {
      token = undefined;
    }
  }
  if (!token || !/^sp_[0-9a-f]{48}$/.test(token)) {
    console.error(`No token. Put it in ${join(userHome, ".config", "smallprint", "token")} (chmod 600) or pass it: ${SYSTEM_INSTALL}`);
    return 2;
  }
  const python = "/usr/bin/python3";
  if (!rootOnly(python)) {
    console.error(`${python} is missing or not root-owned. On macOS install the Command Line Tools (xcode-select --install); on Linux install python3 from your distribution. Level four will not run an interpreter the account can edit.`);
    return 2;
  }
  try {
    execFileSync(python, ["-c", "import hashlib, json, pwd, urllib.request"], { stdio: "ignore" });
  } catch {
    console.error(`${python} did not start (on macOS this usually means the Command Line Tools are not installed: xcode-select --install).`);
    return 2;
  }
  const source = fileURLToPath(new URL("../report/smallprint-report.py", import.meta.url));
  if (!existsSync(source)) {
    console.error(`The helper is missing from this install (${source}). Reinstall the package.`);
    return 2;
  }
  // a reporter already installed here with no salt beside its token reported unkeyed hashes (it is from before 0.1.6):
  // its label is written down so the helper sends the earlier hashes once and the record keeps its history. A first
  // install has nothing to move and writes no such file.
  const reportedUnkeyed = existsSync(paths.helper) && existsSync(paths.token) && !existsSync(join(paths.tokenDir, "salt"));
  const every = Number(opt("every") ?? 6);
  const plan = systemPlan({ platform: plat, user, label: (opt("label") ?? hostname()).slice(0, 60), everyHours: Number.isFinite(every) ? every : 6, base });
  mkdirSync(paths.dir, { recursive: true, mode: 0o755 });
  chownSync(paths.dir, 0, 0);
  chmodSync(paths.dir, 0o755);
  copyFileSync(source, paths.helper);
  chownSync(paths.helper, 0, 0);
  chmodSync(paths.helper, 0o755);
  mkdirSync(paths.tokenDir, { recursive: true, mode: 0o700 });
  chownSync(paths.tokenDir, 0, 0);
  chmodSync(paths.tokenDir, 0o700);
  writeFileSync(paths.token, token + "\n", { mode: 0o600 });
  chownSync(paths.token, 0, 0);
  chmodSync(paths.token, 0o600);
  // the salt (security audit item 36): the account's own, when it is a plain file the account owns, so the root reporter's
  // hashes match the ones sync sent from this account; otherwise a new one for the root reporter only. Never written into
  // the account's home from here, because a root write there could follow a link the account planted.
  const saltPath = join(paths.tokenDir, "salt");
  let salt: string | undefined;
  try {
    const own = saltFile(join(userHome, ".config"));
    const lst = lstatSync(own);
    if (lst.isFile() && lst.uid === statSync(userHome).uid) {
      const s = readFileSync(own, "utf8").trim();
      if (SALT_SHAPE.test(s)) salt = s;
    }
  } catch {
    salt = undefined;
  }
  if (!salt) salt = existsSync(saltPath) ? machineSalt(false, saltPath) : undefined;
  if (!salt) salt = (await import("node:crypto")).randomBytes(32).toString("hex");
  writeFileSync(saltPath, salt + "\n", { mode: 0o600 });
  chownSync(saltPath, 0, 0);
  chmodSync(saltPath, 0o600);
  if (reportedUnkeyed) {
    const migratePath = join(paths.tokenDir, "migrate-labels");
    writeFileSync(migratePath, JSON.stringify([plan.label]), { mode: 0o600 });
    chownSync(migratePath, 0, 0);
    console.log(`An earlier reporter on this machine sent path hashes that were not keyed. Its next report as "${plan.label}" also sends those earlier hashes, once, so the record keeps its history under the keyed ones.`);
  }
  for (const p of [paths.dir, paths.helper, paths.tokenDir, paths.token, saltPath]) {
    if (!rootOnly(p)) {
      console.error(`${p} ended up writable by someone other than root; refusing to load the job. Check the ownership of its parent folders.`);
      return 2;
    }
  }
  // the helper's own copy on disk is what runs from now on: npx updates never touch it
  if (plat === "darwin") {
    const { path, body } = systemLaunchdPlist(plan);
    writeFileSync(path, body, { mode: 0o644 });
    chownSync(path, 0, 0);
    try {
      execFileSync("launchctl", ["bootout", "system", path], { stdio: "ignore" });
    } catch {
      /* first install */
    }
    execFileSync("launchctl", ["bootstrap", "system", path], { stdio: "inherit" });
  } else {
    const u = systemUnits(plan);
    writeFileSync(u.service.path, u.service.body, { mode: 0o644 });
    writeFileSync(u.timer.path, u.timer.body, { mode: 0o644 });
    execFileSync("systemctl", ["daemon-reload"], { stdio: "inherit" });
    execFileSync("systemctl", ["enable", "--now", "smallprint-report.timer"], { stdio: "inherit" });
  }
  console.log(`Installed the level-four reporter for account "${user}" as machine "${plan.label}":`);
  console.log(`  helper  ${paths.helper} (root-owned, ${python}, standard library only; read it, it is short)`);
  console.log(`  token   ${paths.token} (root-owned, mode 600)`);
  console.log(`  job     ${paths.job} (runs now, then every ${plan.everySeconds / 3600} hours)`);
  console.log(`  log     ${paths.log}`);
  // what it sends is said once, on the privacy page: the list here left out the names of settings, servers and skills (pass 6 audit of 16 Oct 2026)
  console.log("It reads the account's instruction files, MCP configs and skill folders and reports them in the same form as a sync. It does not pin MCP servers to the brief and sends no firewall names; sync from the account does those. What each command sends, and when, is listed on the privacy page: https://smallprint.dev/legal/privacy. Remove with: sudo smallprint schedule --uninstall --system");
  console.log("What it does not cover: files in project folders (it runs from the home directory), and an attacker who already has root.");
  return 0;
}

/** Tell the site a machine's schedule is gone. Quiet on every failure: removal must not depend on the network. */
async function tellUnscheduled(label: string): Promise<void> {
  const token = readToken();
  if (!token) return;
  try {
    await fetch(`${base}/api/sync`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "user-agent": `smallprint-cli/${VERSION}` }, body: JSON.stringify({ label, unschedule: true }), signal: TIMEOUT() });
  } catch {
    /* offline: the next hand-run sync says nothing about the schedule either way */
  }
}

/** Install, remove or show the scheduled sync. */
async function schedule(): Promise<number> {
  if (flag("system")) return scheduleSystem();
  const home = homedir();
  const plat = process.platform;
  const plistPath = join(home, "Library", "LaunchAgents", "dev.smallprint.sync.plist");
  const units = systemdUnits(schedulePlan({ home, execPath: process.execPath, version: VERSION, label: "", token: "" }));
  if (flag("status")) {
    if (plat === "darwin") console.log(existsSync(plistPath) ? `Installed: ${plistPath} (launchd). Log: ~/Library/Logs/smallprint/sync.log` : "Not installed. smallprint schedule --install --label \"this machine\"");
    else if (plat === "linux") console.log(existsSync(units.timer.path) ? `Installed: ${units.timer.path} (systemd user timer). Status: systemctl --user status smallprint-sync.timer` : "Not installed. smallprint schedule --install --label \"this machine\"");
    else console.log("On Windows the schedule is a Task Scheduler entry named \"Small Print sync\": schtasks /Query /TN \"Small Print sync\"");
    return 0;
  }
  if (flag("uninstall")) {
    // the site is told the schedule is gone, so the machine's silence is not news (decision 109); best effort, never blocks the removal
    const installedLabel = (() => {
      try {
        const text = readFileSync(plat === "darwin" ? plistPath : units.service.path, "utf8");
        const m = plat === "darwin" ? /<string>--label<\/string>\s*<string>([^<]*)<\/string>/.exec(text) : /--label "((?:[^"\\]|\\.)*)"/.exec(text);
        return m ? m[1]!.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\\"/g, '"') : undefined;
      } catch {
        return undefined;
      }
    })();
    await tellUnscheduled(opt("label") ?? installedLabel ?? hostname());
    if (plat === "darwin") {
      try {
        execFileSync("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}`, plistPath], { stdio: "ignore" });
      } catch {
        /* not loaded */
      }
      rmSync(plistPath, { force: true });
      console.log("Removed the launchd agent. The record on smallprint.dev stays; run sync by hand whenever you like.");
    } else if (plat === "linux") {
      try {
        execFileSync("systemctl", ["--user", "disable", "--now", "smallprint-sync.timer"], { stdio: "ignore" });
      } catch {
        /* not enabled */
      }
      rmSync(units.timer.path, { force: true });
      rmSync(units.service.path, { force: true });
      try {
        execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
      } catch {
        /* fine */
      }
      console.log("Removed the systemd user timer. The record on smallprint.dev stays.");
    } else console.log('Remove it with: schtasks /Delete /TN "Small Print sync" /F');
    return 0;
  }
  if (!flag("install")) {
    console.log("usage: smallprint schedule --install --label \"work laptop\" [--every 6]   (SMALLPRINT_TOKEN=sp_...)\n       smallprint schedule --status | --uninstall\nInstalls a job on this machine that runs \"smallprint sync\" every six hours and logs locally; each run sends what sync sends, and its interval. You install it; --uninstall removes it.");
    return 2;
  }
  const token = readToken();
  if (!token || !/^sp_[0-9a-f]{48}$/.test(token)) {
    console.error(`No token. Make one on your brief settings page, then: SMALLPRINT_TOKEN=sp_... npx smallprint schedule --install --label "work laptop" (or keep it in ${tokenFile()}, chmod 600)`);
    return 2;
  }
  const label = (opt("label") ?? hostname()).slice(0, 60);
  const every = Number(opt("every") ?? 6);
  const plan = schedulePlan({ home, execPath: process.execPath, version: VERSION, label, token, everyHours: Number.isFinite(every) ? every : 6 });
  if (plat === "darwin") {
    const { path, body } = launchdPlist(plan);
    mkdirSync(dirname(path), { recursive: true });
    mkdirSync(join(home, "Library", "Logs", "smallprint"), { recursive: true });
    writeFileSync(path, body, { mode: 0o600 });
    chmodSync(path, 0o600);
    const domain = `gui/${process.getuid?.() ?? 501}`;
    try {
      execFileSync("launchctl", ["bootout", domain, path], { stdio: "ignore" });
    } catch {
      /* first install */
    }
    execFileSync("launchctl", ["bootstrap", domain, path], { stdio: "inherit" });
    console.log(`Installed ${path} (readable by you only; it holds your token). It runs "smallprint sync --scheduled" now, then every ${plan.everySeconds / 3600} hours at a random moment inside a fifth of that, as machine "${label}", with npx pinned to smallprint@${VERSION}. Each run sends what sync sends, and its interval.`);
    console.log("Log: ~/Library/Logs/smallprint/sync.log. Remove with: smallprint schedule --uninstall");
    return 0;
  }
  if (plat === "linux") {
    const u = systemdUnits(plan);
    mkdirSync(u.dir, { recursive: true });
    writeFileSync(u.service.path, u.service.body, { mode: 0o600 });
    chmodSync(u.service.path, 0o600);
    writeFileSync(u.timer.path, u.timer.body, { mode: 0o644 });
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
    execFileSync("systemctl", ["--user", "enable", "--now", "smallprint-sync.timer"], { stdio: "inherit" });
    console.log(`Installed ${u.timer.path} and ${u.service.path} (the service file, which holds the token, is readable by you only). Runs every ${plan.everySeconds / 3600} hours as machine "${label}".`);
    console.log("If this machine has no login session at boot, run once: loginctl enable-linger $USER. Remove with: smallprint schedule --uninstall");
    return 0;
  }
  console.log("Windows: run this once in an elevated prompt (it stores the token in the task):");
  console.log(schtasksCommand(plan));
  return 0;
}


/**
 * `smallprint gate` (decision 145): the pre-session check. Each server here with a registry name is looked up on the
 * record, and the command exits non-zero when a change to the small print is on record between the lock and the pinned
 * version (the newest on record when none is pinned), or when an advisory's range covers an installed version. One request per server, carrying the registry name.
 * Made for a shell hook or a launcher: `smallprint gate && claude`.
 */
async function gate(): Promise<number> {
  const found = discover();
  const scope = lockScope();
  const items = toUpload(scope === "project" ? projectItems(found.items, process.cwd()) : found.items).filter((i) => i.kind === "mcp" && i.canonicalName);
  const path = lockPath();
  let locked: ReturnType<typeof parseLock> | null = null;
  if (existsSync(path)) {
    try {
      locked = parseLock(readFileSync(path, "utf8"));
    } catch (err) {
      console.error(`${path}: ${(err as Error).message}`);
      return 1;
    }
  }
  if (!items.length) {
    console.log("No MCP servers with a registry identity found in the configs read; nothing to gate on.");
    return 0;
  }
  const strict = flag("strict");
  const counts = { changed: 0, advisories: 0, unknown: 0 };
  for (const it of items) {
    const cn = it.canonicalName!;
    const [registry, ...rest] = cn.split(":");
    const url = `${base}/api/asset/${registry}/${rest.join(":").split("/").map(encodeURIComponent).join("/")}`;
    let e: GateRecord;
    try {
      const res = await fetch(url, { headers: { accept: "application/json", "user-agent": `smallprint-cli/${VERSION}` }, signal: TIMEOUT() });
      if (res.status === 404) { console.log(`  ?  ${cn}: not on the record`); counts.unknown++; continue; }
      if (!res.ok) { console.log(`  ?  ${cn}: record answered ${res.status}`); counts.unknown++; continue; }
      e = await readAssetReply<GateRecord>(res, url);
    } catch (err) {
      // one server the record could not answer for is an unknown, said in a line; the gate goes on to the next
      console.log(`  ?  ${cn}: ${err instanceof UnexpectedReply ? "the record's answer could not be read by this version of the command" : (err as Error).message}`); counts.unknown++; continue;
    }
    const lockedItem = locked?.items.find((l) => l.canonicalName === cn);
    // the version this machine runs is the one in its config; the lock's version is what it is compared with
    const v = gateServer(e, it.version ?? null, lockedItem ? { version: lockedItem.version, ...(lockedItem.recordSha256 ? { recordSha256: lockedItem.recordSha256 } : {}) } : undefined);
    if (v.changed) counts.changed++;
    if (v.advisory) counts.advisories++;
    if (v.unknown) counts.unknown++;
    console.log(`  ${v.mark}  ${cn}${it.version ? ` @ ${it.version}` : ""}: ${v.words.join("; ")}  ${e.asset.url}`);
  }
  const code = gateExit(counts, strict);
  const tally = `${counts.changed} changed, ${counts.advisories} with ${counts.advisories === 1 ? "an advisory that covers the version here" : "advisories that cover the version here"}, ${counts.unknown} unknown`;
  // "clear" only when every server was answered: an unknown is no answer, not a pass (pass 5 audit of 16 Oct 2026)
  console.log(code ? `Gate: ${tally}. Exit ${code}.` : counts.unknown ? `Gate: ${plural(items.length, "server")} checked, ${counts.unknown} unknown. The exit code is 0, and --strict fails on unknowns.` : `Gate: clear. ${plural(items.length, "server")}, 0 unknown.`);
  return code;
}

/** `smallprint show <registry>/<name>`: the record for one entry, from the public read API, in a screenful (decision 223). */
async function show(): Promise<number> {
  const spec = args[1];
  if (!spec || !spec.includes("/")) {
    console.error("usage: smallprint show <registry>/<name>, for example smallprint show npm/mcp-remote or smallprint show npm/@scope/name");
    return 1;
  }
  const slash = spec.indexOf("/");
  const registry = spec.slice(0, slash);
  const name = spec.slice(slash + 1);
  const url = `${base}/api/asset/${encodeURIComponent(registry)}/${name.split("/").map(encodeURIComponent).join("/")}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": `smallprint-cli/${VERSION}` }, signal: TIMEOUT() });
  } catch (err) {
    console.error(`could not reach ${base}: ${(err as Error).message}`);
    return 1;
  }
  if (res.status === 404) { console.log(`${spec}: not in the catalog.`); return 1; }
  if (!res.ok) { console.error(`${url} answered ${res.status}`); return 1; }
  const j = await readAssetReply<RecordAnswer & { asset: { canonicalName: string; displayName: string; kind: string; registry: string; description: string | null; url?: string }; baseline: { version: string; publishedAt: string | null; read?: boolean; firstSeen?: boolean; firstSeenAt?: string | null } | null; remoteRead?: { checkedAt: string; status: string; toolCount: number | null } | null; advisories: { id: string; severity: string; summary: string }[]; releases: { from: string | null; to: string; publishedAt: string | null; worst: string | null; identical: boolean; summary: string; changes?: { field: string; severity?: string }[] }[] }>(res, url);
  // the entry page's word for what it is, never "mcp" for npm's security holding package (pass 6 audit of 16 Oct 2026)
  console.log(`${j.asset.displayName}  (${kindOf(j) ?? j.asset.kind} on ${j.asset.registry})`);
  if (j.asset.description) console.log(`  ${j.asset.description.replace(/\s+/g, " ").slice(0, 160)}`);
  // how the pinned version was read is the site's answer (its read flag and read state), never a second rule here
  // "published" only when the site says the date is the source's; otherwise "first seen", with the day Small Print first
  // saw the version, as on the entry page and the home page's example (pass 3 and pass 5 audits of 16 Oct 2026)
  if (j.baseline) { const d = baselineDateWords(j.baseline); console.log(`  baseline ${j.baseline.version}${d ? `, ${d}` : ""}, ${readWords(j)}`); }
  if (j.remoteRead) console.log(`  asked ${remoteAnswerWords(j.remoteRead)}`);
  console.log(`  advisories on record: ${j.advisories.length}${j.advisories.length ? ` (worst ${j.advisories[0]!.severity}: ${j.advisories[0]!.id})` : ""}`);
  const rel = j.releases.slice(0, 5);
  if (rel.length) {
    console.log(`  last ${rel.length === 1 ? "release" : `${rel.length} releases`}:`);
    // a release that holds no change prints the site's summary alone ("no change on record"), never a grade beside it
    // the grade is the entry page's: the worst change to the small print, not an install script beside it (pass 5 audit)
    for (const r of rel) console.log(`    ${r.from ?? "first read"} -> ${r.to}${r.publishedAt ? `  ${r.publishedAt.slice(0, 10)}` : ""}  ${r.identical ? "identical small print" : r.changes && !r.changes.length ? String(r.summary ?? "") : `${releaseGrade(r) ?? "graded"}: ${String(r.summary ?? "").replace(/\s+/g, " ").slice(0, 90)}`}`);
  }
  // the page's own address as the site writes it (one rule on the site, decision 205), not a copy of that rule here:
  // the copy wrote a scope's "@" as "%40" after the site changed to "@" (full audit of 29 Sep 2026)
  if (j.asset.url) console.log(`  ${j.asset.url}`);
  return 0;
}

/**
 * `smallprint watch [--file smallprint.lock] -- <server command> [args]` (decision 513): start the server through a watcher
 * that passes every byte through unchanged and warns on stderr when its tools change. Nothing but the server's own
 * output is ever written to stdout, because stdout is the MCP connection.
 */
async function watch(): Promise<number> {
  if (!serverArgv.length) {
    console.error("usage: smallprint watch [--file smallprint.lock] [--no-notify] -- <server command> [its arguments]\nStarts the MCP server through a watcher that passes every message through unchanged and, when the server's tools change, warns on stderr and with a desktop notification (--no-notify leaves the notification out). It never stops a call and sends nothing.");
    return 2;
  }
  let lockText: string | null = null;
  try {
    if (existsSync(lockPath())) lockText = readFileSync(lockPath(), "utf8");
  } catch {
    /* no lock to compare with */
  }
  // a change also shows as a desktop notification, made on this machine (Nick, 15 Oct 2026: a warning only in a log can
  // go unseen); --no-notify leaves it out
  return runWatch({ command: serverArgv[0]!, args: serverArgv.slice(1), stateDir: stateDir(), lockText, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, forwardSignals: true, ...(flag("no-notify") ? {} : { notify: desktopNotify }) });
}

/** `smallprint scan-chats [--yes] [--json]` (decision 513): opt in, read the agents' conversation logs here, print masked findings. */
async function scanChatsCommand(): Promise<number> {
  if (!flag("yes")) {
    const answer = await ask(SCAN_QUESTION, process.stdin, flag("json") ? process.stderr : process.stdout);
    if (!isYes(answer)) {
      (flag("json") ? console.error : console.log)("Nothing was read.");
      return 1;
    }
  }
  const r = await scanChats(chatSources(homedir()), tilde);
  if (flag("json")) {
    console.log(JSON.stringify({ sent: "nothing", sources: r.sources, filesRead: r.filesRead, unreadable: r.unreadable, findings: r.findings, byKind: countByKind(r.findings) }, null, 2));
    return 0;
  }
  for (const l of formatScan(r)) console.log(l);
  return 0;
}

/** Each line of --help that names a command or a flag; test/help.test.ts holds this list to the commands and flags the code reads. */
const HELP = `smallprint ${VERSION}
usage: smallprint check [--json] [--no-upload] [--upload|--yes] [--share] [--email <you@x>] [--no-signup] [--no-instruction-text] [--html [file]] [--base <url>]
       smallprint check --live [--live-local] [--yes]          ask each hosted server what it serves now and compare with the record for its version; --live-local also starts local servers, after showing the commands and asking
       smallprint show <registry>/<name>                       the record for one entry: baseline, how it was read, advisories, last releases; for example smallprint show npm/mcp-remote
       smallprint lock [--project] [--offline] [--file smallprint.lock]   write what this machine runs, and its instruction-file hashes, to a file you commit; --project keeps to this directory; --offline asks the record nothing
       smallprint check --locked [--project] [--file ...] [--sarif <file>] [--no-instruction-text]   compare with the lock, exit 2 when anything changed; local only, works offline, made for CI; under a changed instruction file it shows the lines added since the lock and their grades; --sarif also writes a SARIF log for a code-scanning upload
       smallprint gate [--project] [--strict]                  ask the record about each server here that has a registry name: exit 3 when a high or critical advisory covers a version here, 2 when a change to the small print is on record between the lock and the pinned version (the newest on record when none is pinned) (--strict: or when something could not be answered); for a shell hook before a session
       smallprint sync --label "work laptop" [--yes] [--prune] [--dry-run] [--quiet] [--no-notify] [--migrate-unkeyed] [--base <url>]   (SMALLPRINT_TOKEN=sp_...)
       smallprint schedule --install --label "work laptop" [--every 6] | --status | --uninstall
       sudo --preserve-env=PATH,SMALLPRINT_TOKEN smallprint schedule --install --system --label "work laptop"   (level four: a root-owned reporter)
       smallprint watch [--file smallprint.lock] [--no-notify] -- <server command> [its arguments]   start an MCP server through a watcher that passes every message through unchanged and, when the server's tools change, warns on stderr and with a desktop notification (--no-notify leaves the notification out); it never stops a call and sends nothing
       smallprint scan-chats [--yes] [--json]                   look through your agents' conversation logs on this machine for keys and passwords, after asking first; each finding is shown masked, nothing is sent and no log is changed
       smallprint --version
       smallprint version --check                              ask npm for the newest published version and say whether this one is it; sends one request and nothing else, and plain --version asks nothing
  check   find the MCP servers and skills in the agent configs it reads and grade them; --json prints the inventory and sends nothing
          also hashes your instruction files (CLAUDE.md, AGENTS.md, OpenClaw workspace, Cursor and Windsurf rules) and reports any that changed since the last run, locally;
          under a changed file it shows the lines that were added and grades them with the rules at https://smallprint.dev/how-we-grade;
          --no-instruction-text prints only the one line per file, with no text from the file, for a terminal or CI log that should not hold it;
          --html [file] also writes what it found as one page to open in a browser (smallprint-report.html in this folder unless you name a file); the page loads nothing from the internet, and with --no-upload it has no grades
  sync    pin that inventory to your account so the daily brief watches it (token from your settings page);
          also records your instruction files there as hashes, so a rewrite on this machine cannot erase the record;
          --quiet prints one line (the scheduled run uses it), --no-notify turns off its desktop notification,
          --migrate-unkeyed is for a machine that synced by hand before version 0.1.6: it sends the earlier unkeyed path hashes once so the record keeps its history
  schedule  installs a job on this machine that runs sync every six hours (launchd on macOS, systemd on Linux); you install it, you remove it
  watch   put it in front of a server's command in your MCP config; it compares each tool's name, description and input schema with the last list it saw
          and with smallprint.lock, writes one line to the server's log in your MCP client when they differ, and the next check shows the changes;
          it keeps the last tool list it saw and a log of changes, never what a call sends or gets back
  scan-chats  reads the Claude Code, Codex and Gemini CLI conversation logs on this machine and names the file, the line and the kind of each key or password it finds;
          it runs only when you type it, asks first unless you add --yes, and --json prints the same findings, masked, for a script
Five ways to keep the record of your instruction files, weakest to strongest:
  check     the record is a file on this machine; an agent that can write files can change it too
  sync      the record is on smallprint.dev and keeps every change; seen the next time you run sync
  a hook    the same sync from a Claude Code SessionStart hook, a git hook or your shell profile (https://smallprint.dev/cli#hooks)
  schedule  the same, every six hours, and a machine that goes quiet is reported
  --system  the same from a root-owned job with its own root-owned copy of the token
Token: --token, or SMALLPRINT_TOKEN in the environment, or ~/.config/smallprint/token (chmod 600).
check sends names, versions, hosts and file hashes; sync adds a kind label and hashes for each instruction file, the name of each top-level part of a JSON one, the machine label, and the names of any agent firewalls it finds installed.
What each command sends, and when, is listed on the privacy page: https://smallprint.dev/legal/privacy`;

/** The commands, each returning its exit code; an answer from the site that cannot be read ends in one sentence, never a stack trace. */
const COMMANDS: Record<string, () => Promise<number>> = { check, show, lock, gate, sync, schedule, watch, "scan-chats": scanChatsCommand };

if (cmd && Object.hasOwn(COMMANDS, cmd)) {
  let code: number;
  try {
    code = await COMMANDS[cmd]!();
  } catch (err) {
    if (!(err instanceof UnexpectedReply)) throw err;
    console.error(err.message);
    code = 1;
  }
  process.exit(code);
} else if (cmd === "--version" || cmd === "-v" || cmd === "version") {
  // plain --version asks nothing; --check sends one request to npm's registry, which is the request and nothing more
  console.log(flag("check") ? await versionCheckLine(VERSION) : VERSION);
  process.exit(0);
} else {
  console.log(HELP);
  process.exit(cmd && cmd !== "--help" && cmd !== "-h" && cmd !== "help" ? 2 : 0);
}
