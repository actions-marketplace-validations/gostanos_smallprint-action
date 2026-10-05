/**
 * Instruction and settings files: the text an agent reads before it does
 * anything. CLAUDE.md, AGENTS.md, an OpenClaw workspace's TOOLS.md and SOUL.md,
 * Cursor and Windsurf rules, and the settings files where hooks live. None of
 * these are published anywhere, so there is no catalog to compare them with:
 * the only baseline is this machine's last run. Hashes are kept in the local
 * state file and nothing here is ever uploaded.
 */
import { createHash, createHmac } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { configLocations } from "./discover";
import { isBareServerMap, type Host } from "./parse";
import { claudeCodePlugins, codexPlugins, copilotPlugins, manifestHasServers, pluginManifestPath } from "./plugins";
import { modModulePaths } from "./mods";

export interface InstructionLocation {
  host: Host;
  path: string;
  /** What the file is, in words a person recognises: the only name the server ever sees. */
  kind: string;
  /** "home" for files under the home directory, "project" for files under the working directory. */
  scope: "home" | "project";
  /** A directory whose files are each recorded (Cursor and Windsurf rules folders). */
  dir?: boolean;
  /** MCP config files: hash the server definitions, not the raw file, so a state-heavy file like ~/.claude.json does not move every run and env values are hashed rather than the text that holds them. */
  digest?: "mcp-json";
}

export interface InstructionFile {
  host: Host;
  path: string;
  kind: string;
  scope: "home" | "project";
  sha256: string;
  bytes: number;
  /** For JSON settings files: a hash per top-level section, so a change can be named. */
  sections?: Record<string, string>;
  /** For MCP configs read with the machine's salt: the digest with env values and project paths keyed, which is what sync sends. */
  keyed?: { sha256: string; sections: Record<string, string> };
}

export interface InstructionRecord {
  sha256: string;
  /** ISO date the file was first recorded. */
  seen: string;
  /** ISO date of the last recorded change, if any. */
  changed?: string;
  changes?: number;
  sections?: Record<string, string>;
}

export type InstructionBaseline = Record<string, InstructionRecord>;

export type InstructionStatus =
  | { status: "new"; file: InstructionFile }
  | { status: "unchanged"; file: InstructionFile; since: string }
  | { status: "changed"; file: InstructionFile; previous: string; since: string; changes: number; /** Sections that differ, when both runs had section hashes. */ where?: string[] }
  | { status: "removed"; path: string; previous: string; since: string };

const FILE_MAX_BYTES = 5_000_000;
const DIR_MAX_FILES = 200;

export function instructionLocations(home = homedir(), cwd = process.cwd()): InstructionLocation[] {
  const openclaw = (root: string): InstructionLocation[] => ["AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "USER.md", "HEARTBEAT.md", "BOOTSTRAP.md", "MEMORY.md"].map((f) => ({ host: "openclaw" as const, path: join(root, f), kind: `OpenClaw ${f}, home`, scope: "home" as const }));
  return [
    { host: "claude-code", path: join(home, ".claude", "CLAUDE.md"), kind: "Claude Code CLAUDE.md, home", scope: "home" },
    { host: "claude-code", path: join(home, ".claude", "settings.json"), kind: "Claude Code settings.json, home", scope: "home" },
    { host: "claude-code", path: join(cwd, "CLAUDE.md"), kind: "Claude Code CLAUDE.md, project", scope: "project" },
    { host: "claude-code", path: join(cwd, "CLAUDE.local.md"), kind: "Claude Code CLAUDE.local.md, project", scope: "project" },
    { host: "claude-code", path: join(cwd, ".claude", "CLAUDE.md"), kind: "Claude Code .claude/CLAUDE.md, project", scope: "project" },
    { host: "claude-code", path: join(cwd, ".claude", "settings.json"), kind: "Claude Code settings.json, project", scope: "project" },
    { host: "claude-code", path: join(cwd, ".claude", "settings.local.json"), kind: "Claude Code settings.local.json, project", scope: "project" },
    { host: "codex", path: join(home, ".codex", "AGENTS.md"), kind: "Codex AGENTS.md, home", scope: "home" },
    { host: "codex", path: join(cwd, "AGENTS.md"), kind: "Codex AGENTS.md, project", scope: "project" },
    { host: "cursor", path: join(cwd, ".cursorrules"), kind: "Cursor .cursorrules, project", scope: "project" },
    { host: "cursor", path: join(cwd, ".cursor", "rules"), kind: "Cursor rules file, project", scope: "project", dir: true },
    { host: "windsurf", path: join(home, ".codeium", "windsurf", "memories", "global_rules.md"), kind: "Windsurf global rules, home", scope: "home" },
    { host: "windsurf", path: join(cwd, ".windsurfrules"), kind: "Windsurf .windsurfrules, project", scope: "project" },
    { host: "windsurf", path: join(cwd, ".windsurf", "rules"), kind: "Windsurf rules file, project", scope: "project", dir: true },
    { host: "claude-code", path: join(home, ".claude", "agents"), kind: "Claude Code agent definition, home", scope: "home", dir: true },
    { host: "claude-code", path: join(cwd, ".claude", "agents"), kind: "Claude Code agent definition, project", scope: "project", dir: true },
    { host: "claude-code", path: join(home, ".claude", "commands"), kind: "Claude Code command, home", scope: "home", dir: true },
    { host: "claude-code", path: join(cwd, ".claude", "commands"), kind: "Claude Code command, project", scope: "project", dir: true },
    { host: "manual", path: join(cwd, ".github", "copilot-instructions.md"), kind: "Copilot instructions, project", scope: "project" },
    { host: "manual", path: join(home, ".gemini", "GEMINI.md"), kind: "Gemini GEMINI.md, home", scope: "home" },
    { host: "manual", path: join(cwd, "GEMINI.md"), kind: "Gemini GEMINI.md, project", scope: "project" },
    { host: "manual", path: join(cwd, ".clinerules"), kind: "Cline .clinerules, project", scope: "project" },
    { host: "manual", path: join(cwd, ".roo", "rules"), kind: "Roo rules file, project", scope: "project", dir: true },
    // the MCP configs themselves: a server's command, args, URL or env changed under the same name
    ...mcpConfigLocations(home, cwd),
    ...openclaw(join(home, ".openclaw", "workspace")),
    ...openclaw(join(home, "clawd")),
    { host: "openclaw", path: join(home, ".openclaw", "openclaw.json"), kind: "OpenClaw config, home", scope: "home" },
    ...pluginLocations(home, cwd),
  ];
}

/** How each client is named in a kind label. A client missing here fails the test that walks the table. */
export const CLIENT_NAME: Partial<Record<Host, string>> = { "claude-desktop": "Claude Desktop", "claude-code": "Claude Code", cursor: "Cursor", windsurf: "Windsurf", codex: "Codex", vscode: "VS Code", zed: "Zed", gemini: "Gemini", cline: "Cline", roo: "Roo" };

/**
 * The files that hold server definitions, made from the one table of clients (configLocations in discover.ts): every
 * file the command lists servers from is a file the lock and the change record watch. A JSON config is watched by the
 * digest of its server definitions, so a settings file that also holds editor preferences (Zed, Gemini) does not read
 * as changed when a preference moves; Codex's TOML is hashed whole.
 */
export function mcpConfigLocations(home = homedir(), cwd = process.cwd()): InstructionLocation[] {
  return configLocations(home, cwd)
    .filter((l) => l.format !== "skills-dir")
    .map((l): InstructionLocation => {
      const client = CLIENT_NAME[l.host] ?? l.host;
      return l.format === "codex-toml" ? { host: l.host, path: l.path, kind: `${client} config.toml, ${l.scope}`, scope: l.scope } : { host: l.host, path: l.path, kind: `${client} MCP servers, ${l.scope}`, scope: l.scope, digest: "mcp-json" };
    });
}

/**
 * The kinds of server-definition file this version watches. A lock carries the list (`covers` in lock.ts), so a newer
 * command that watches one more client reads an older lock as "does not cover that file" and not as "a new file
 * appeared", and the lock check, the Action and the pre-commit hook do not fail on the day one of them is updated.
 */
export const mcpConfigKinds = (): string[] => [...new Set(mcpConfigLocations("/h", "/p").map((l) => l.kind))].sort();

/** The same list as 0.1.7 and earlier had it, for a lock those versions wrote, which carries no list of its own. */
export const MCP_CONFIG_KINDS_0_1_7: readonly string[] = ["Claude Code MCP servers, home", "Claude Code MCP servers, project", "Claude Desktop MCP servers, home", "Cline MCP servers, home", "Codex config.toml, home", "Cursor MCP servers, home", "Cursor MCP servers, project", "Roo MCP servers, home", "Roo MCP servers, project", "VS Code MCP servers, home", "VS Code MCP servers, project", "Windsurf MCP servers, home"];

const appDataOf = (home: string) => process.env.APPDATA ?? join(home, "AppData", "Roaming");

/** VS Code's user mcp.json. */
export function vscodeUserMcp(home = homedir()): string {
  return process.platform === "win32" ? join(appDataOf(home), "Code", "User", "mcp.json") : join(home, "Library", "Application Support", "Code", "User", "mcp.json");
}

/** A file in a VS Code extension's global storage settings folder (Cline, Roo). */
export function vscodeGlobalStorage(home: string, extension: string, file: string): string {
  return process.platform === "win32" ? join(appDataOf(home), "Code", "User", "globalStorage", extension, "settings", file) : join(home, "Library", "Application Support", "Code", "User", "globalStorage", extension, "settings", file);
}

/**
 * What each installed Claude Code plugin gives the agent (tools audit of 29 Sep 2026, fix 2): its MCP servers (.mcp.json,
 * in the plugin's bare-map shape, or inline in plugin.json), its hooks, its commands and its agent definitions. The kind
 * labels name no plugin: the server sees "Claude Code plugin hooks, home", never which plugin.
 */
export function pluginLocations(home = homedir(), cwd = process.cwd()): InstructionLocation[] {
  const out: InstructionLocation[] = [];
  for (const p of claudeCodePlugins(home, cwd)) {
    out.push({ host: "claude-code", path: join(p.root, ".mcp.json"), kind: "Claude Code plugin MCP servers, home", scope: "home", digest: "mcp-json" });
    if (manifestHasServers(p.root)) out.push({ host: "claude-code", path: pluginManifestPath(p.root), kind: "Claude Code plugin MCP servers, home", scope: "home", digest: "mcp-json" });
    out.push({ host: "claude-code", path: join(p.root, "hooks", "hooks.json"), kind: "Claude Code plugin hooks, home", scope: "home" });
    out.push({ host: "claude-code", path: join(p.root, "commands"), kind: "Claude Code plugin command, home", scope: "home", dir: true });
    out.push({ host: "claude-code", path: join(p.root, "agents"), kind: "Claude Code plugin agent definition, home", scope: "home", dir: true });
    // a mod's code, every module and what they import (decision 370): a change to any of it is reported like a changed CLAUDE.md
    for (const file of modModulePaths(p.root)) out.push({ host: "claude-code", path: file, kind: "Claude Code mod code, home", scope: "home" });
  }
  // Codex and GitHub Copilot CLI plugins (decision 363): their MCP servers and agent definitions, like a Claude Code plugin's
  for (const p of codexPlugins(home)) {
    out.push({ host: "codex", path: join(p.root, ".mcp.json"), kind: "Codex plugin MCP servers, home", scope: "home", digest: "mcp-json" });
    out.push({ host: "codex", path: join(p.root, "agents"), kind: "Codex plugin agent definition, home", scope: "home", dir: true });
  }
  for (const p of copilotPlugins(home)) {
    out.push({ host: "copilot", path: join(p.root, "mcp.json"), kind: "Copilot plugin MCP servers, home", scope: "home", digest: "mcp-json" });
    out.push({ host: "copilot", path: join(p.root, "agents"), kind: "Copilot plugin agent definition, home", scope: "home", dir: true });
  }
  return out;
}

/**
 * The server definitions in an MCP config, canonical, with every env value
 * replaced by its own hash: the digest moves when a command, an argument, a
 * URL or a secret changes, and the text hashed never contains the secret.
 * ~/.claude.json keeps per-project servers under projects.<path>.mcpServers;
 * those are folded in under "project:<hash of path>" so paths never appear.
 *
 * With a key (the machine's salt, decision in the security audit of 29 Sep 2026, item 36), every env value and every
 * project path is hashed with HMAC under that key instead of plain SHA-256, so a row on smallprint.dev cannot be used to
 * confirm a guessed secret or a guessed folder name. The lock and the local baseline use the digest without a key, so a
 * committed lock still compares equal on another machine; only what sync sends is keyed.
 */
export function mcpServersDigest(text: string, key?: string): { sha256: string; sections: Record<string, string> } | null {
  const valueHash = (kind: "env" | "project", v: string) => (key ? `hmac:${keyedHash(key, kind, v)}` : `sha256:${sha256(Buffer.from(v))}`);
  const projectPrefix = (path: string) => `project:${(key ? keyedHash(key, "project", path) : sha256(Buffer.from(path))).slice(0, 12)}/`;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object") return null;
  const j = doc as Record<string, unknown>;
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
    return v;
  };
  const servers: Record<string, unknown> = {};
  const take = (m: unknown, prefix: string) => {
    if (!m || typeof m !== "object" || Array.isArray(m)) return;
    for (const [name, def] of Object.entries(m as Record<string, unknown>)) {
      const d = def && typeof def === "object" ? { ...(def as Record<string, unknown>) } : def;
      if (d && typeof d === "object" && (d as Record<string, unknown>).env && typeof (d as Record<string, unknown>).env === "object") {
        const env = (d as Record<string, unknown>).env as Record<string, unknown>;
        (d as Record<string, unknown>).env = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, valueHash("env", String(v))]));
      }
      servers[prefix + name] = canon(d);
    }
  };
  // a plugin's .mcp.json is the bare map; VS Code keeps its servers under "servers" (tools audit of 29 Sep 2026, fixes 2
  // and 10). Before this, both hashed as an empty object, so a changed server in either never showed.
  if (isBareServerMap(j)) take(j, "");
  take(j.mcpServers, "");
  take(j.servers, "");
  // Zed keeps its servers under "context_servers"; the command listed them and hashed none until 0.1.8
  take(j.context_servers, "");
  if (j.projects && typeof j.projects === "object") for (const [path, p] of Object.entries(j.projects as Record<string, { mcpServers?: unknown }>)) take(p?.mcpServers, projectPrefix(path));
  const sections: Record<string, string> = {};
  for (const [name, def] of Object.entries(servers)) sections[name] = sha256(Buffer.from(JSON.stringify(def)));
  return { sha256: sha256(Buffer.from(JSON.stringify(canon(servers)))), sections };
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/**
 * HMAC-SHA256 under the machine's salt (64 hex characters, kept in ~/.config/smallprint/salt and never sent). The kind
 * goes in front of the value, so a path hash can never be mistaken for an env hash of the same text. The Python reporter
 * computes the same (keyed_hash in report/smallprint-report.py).
 */
export function keyedHash(key: string, kind: "path" | "scope" | "env" | "project", value: string): string {
  return createHmac("sha256", Buffer.from(key, "hex")).update(`${kind}\0${value}`).digest("hex");
}

/**
 * A settings file is one document with several jobs: hooks (commands the agent
 * runs), permissions (what it may do without asking), env and the key helper.
 * Claude Code rewrites the permission list itself every time someone picks
 * "always allow", so a plain file hash would read as changed most days. One hash
 * per top-level key lets the report say which part changed. Values are hashed,
 * never kept.
 */
export function sectionHashes(text: string): Record<string, string> | undefined {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) out[k] = sha256(Buffer.from(JSON.stringify(v)));
  return out;
}

/** Hash one regular file; symbolic links and oversized files are skipped. An imported file is hashed whole: no per-key hashes for text the import author chose. */
function readOne(loc: InstructionLocation, path: string, imported = false, key?: string): InstructionFile | null {
  const st = lstatSync(path);
  if (!st.isFile() || st.size > FILE_MAX_BYTES) return null;
  const buf = readFileSync(path);
  if (loc.digest === "mcp-json") {
    const d = mcpServersDigest(buf.toString("utf8"));
    if (!d) return null;
    const k = key ? mcpServersDigest(buf.toString("utf8"), key) : null;
    return { host: loc.host, path, kind: loc.kind, scope: loc.scope, sha256: d.sha256, bytes: st.size, sections: d.sections, ...(k ? { keyed: { sha256: k.sha256, sections: k.sections } } : {}) };
  }
  const file: InstructionFile = { host: loc.host, path, kind: loc.kind, scope: loc.scope, sha256: sha256(buf), bytes: st.size };
  if (!imported && path.endsWith(".json")) {
    const sections = sectionHashes(buf.toString("utf8"));
    if (sections) file.sections = sections;
  }
  return file;
}

const IMPORT_MAX = 20;
const IMPORT_DEPTH = 3;

/**
 * Claude Code follows `@path` imports inside CLAUDE.md (a home path, a relative
 * path, or an absolute one). A rewrite that adds an import and then edits the
 * imported file would otherwise move only once. So imported files are hashed
 * too, up to three levels and twenty files, under the parent's kind.
 */
export function claudeImports(text: string, fromDir: string, home: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\s)@([^\s"'`)]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < IMPORT_MAX) {
    const raw = m[1]!;
    const marked = raw.startsWith("~/") || raw.startsWith("./") || raw.startsWith("../") || raw.startsWith("/");
    const at = (r: string) => (r.startsWith("~/") ? join(home, r.slice(2)) : r.startsWith("/") ? r : resolve(fromDir, r));
    let p: string | null = marked ? at(raw) : null;
    if (!marked) {
      // a bare relative path, the form Claude Code's own docs use (@README, @docs/git-instructions.md), counts only when it
      // names a file that exists, so "@someone" in prose is not an import (tools audit of 29 Sep 2026, fix 5); a full stop or
      // comma after it at the end of a sentence is not part of the name
      for (const r of [raw, raw.replace(/[.,;:!?]+$/, "")]) {
        if (!r || r.startsWith("@")) continue;
        const c = at(r);
        try {
          if (lstatSync(c).isFile()) {
            p = c;
            break;
          }
        } catch {
          /* not a file here */
        }
      }
    }
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Every instruction file that exists on this machine, in a stable order. */
export function readInstructionFiles(home = homedir(), cwd = resolve(process.cwd()), errors: string[] = [], key?: string): InstructionFile[] {
  const out: InstructionFile[] = [];
  const seen = new Set<string>();
  const push = (f: InstructionFile | null) => {
    if (f && !seen.has(f.path)) {
      seen.add(f.path);
      out.push(f);
      return true;
    }
    return false;
  };
  const followImports = (loc: InstructionLocation, path: string, depth: number) => {
    // only CLAUDE.md files start a chain; the files they import are followed whatever they are called
    if (depth > IMPORT_DEPTH || (depth === 1 && !/CLAUDE(?:\.local)?\.md$/.test(path))) return;
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return;
    }
    for (const imp of claudeImports(text, dirname(path), home)) {
      if (seen.has(imp) || !existsSync(imp)) continue;
      try {
        const kind = `${loc.kind.replace(/, (home|project)$/, "")} import, ${loc.scope}`;
        if (push(readOne({ ...loc, kind }, imp, true))) followImports(loc, imp, depth + 1);
      } catch {
        /* unreadable import: skip */
      }
    }
  };
  for (const loc of instructionLocations(home, cwd)) {
    if (!existsSync(loc.path)) continue;
    try {
      if (loc.dir) {
        const st = lstatSync(loc.path);
        if (!st.isDirectory()) continue;
        const names = readdirSync(loc.path).sort().slice(0, DIR_MAX_FILES);
        for (const name of names) {
          if (name.startsWith(".")) continue;
          push(readOne(loc, join(loc.path, name), false, key));
        }
      } else if (push(readOne(loc, loc.path, false, key))) {
        followImports(loc, loc.path, 1);
      }
    } catch (err) {
      errors.push(`${loc.path}: ${(err as NodeJS.ErrnoException).code ?? "unreadable"}`);
    }
  }
  return out;
}

/**
 * Compare what is on disk with the baseline and return the new baseline. A
 * changed file is reported once, against the hash last recorded, and then the
 * new hash becomes the record: the next run reports it as unchanged since now.
 */
export function compareInstructions(files: InstructionFile[], baseline: InstructionBaseline, now = new Date()): { statuses: InstructionStatus[]; baseline: InstructionBaseline } {
  const at = now.toISOString();
  const next: InstructionBaseline = {};
  const statuses: InstructionStatus[] = [];
  for (const file of files) {
    const prev = baseline[file.path];
    const rec = (r: InstructionRecord): InstructionRecord => (file.sections ? { ...r, sections: file.sections } : r);
    if (!prev) {
      statuses.push({ status: "new", file });
      next[file.path] = rec({ sha256: file.sha256, seen: at });
    } else if (prev.sha256 === file.sha256) {
      statuses.push({ status: "unchanged", file, since: prev.changed ?? prev.seen });
      next[file.path] = rec(prev);
    } else {
      const changes = (prev.changes ?? 0) + 1;
      let where: string[] | undefined;
      if (prev.sections && file.sections) {
        const keys = new Set([...Object.keys(prev.sections), ...Object.keys(file.sections)]);
        where = [...keys].filter((k) => prev.sections![k] !== file.sections![k]).sort();
      }
      statuses.push({ status: "changed", file, previous: prev.sha256, since: prev.changed ?? prev.seen, changes, ...(where ? { where } : {}) });
      next[file.path] = rec({ sha256: file.sha256, seen: prev.seen, changed: at, changes });
    }
  }
  const present = new Set(files.map((f) => f.path));
  for (const [path, prev] of Object.entries(baseline)) {
    if (!present.has(path)) statuses.push({ status: "removed", path, previous: prev.sha256, since: prev.changed ?? prev.seen });
  }
  return { statuses, baseline: next };
}

/** Local calendar day, YYYY-MM-DD, so "since" reads the way the person remembers it. */
const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const short = (h: string) => h.slice(0, 12);

/** Lines for the terminal. `home` is shortened to ~ for reading only. */
export function formatInstructions(statuses: InstructionStatus[], home = homedir()): string[] {
  const tilde = (p: string) => (p.startsWith(home + "/") || p.startsWith(home + "\\") ? "~" + p.slice(home.length) : p);
  const lines: string[] = [];
  for (const s of statuses) {
    if (s.status === "new") lines.push(`  first seen  ${tilde(s.file.path)}  ${short(s.file.sha256)}`);
    else if (s.status === "unchanged") lines.push(`  unchanged   ${tilde(s.file.path)}  ${short(s.file.sha256)} since ${day(s.since)}`);
    else if (s.status === "changed") lines.push(`  CHANGED     ${tilde(s.file.path)}  was ${short(s.previous)} since ${day(s.since)}, now ${short(s.file.sha256)}${s.changes > 1 ? ` (change ${s.changes})` : ""}${s.where ? `  in: ${s.where.length ? s.where.join(", ") : "formatting only"}` : ""}`);
    else lines.push(`  REMOVED     ${tilde(s.path)}  was ${short(s.previous)} since ${day(s.since)}`);
  }
  return lines;
}

/** What sync sends for one file: a hash of the path, the kind label, the host, the scope, the content hash. Never the path. */
export interface FileUpload {
  pathHash: string;
  kind: string;
  host: Host;
  scope: string;
  sha256: string;
  sections?: Record<string, string>;
  /**
   * Sent once per machine label, on the first keyed sync (see toFileUpload): the unkeyed path hash and, for an MCP config,
   * the unkeyed digest this file was recorded under before, so the server can move its record to the keyed hash.
   */
  formerPathHash?: string;
  formerSha256?: string;
}

/** The hash of a path: HMAC under the machine's salt when there is one, plain SHA-256 (what 0.1.5 and earlier sent) without. */
export const pathHash = (path: string, key?: string): string => (key ? keyedHash(key, "path", path) : sha256(Buffer.from(path)));
/** A project scope is the working directory's hash, so a sync from another directory never reports this one's files removed. */
export const projectScope = (cwd: string, key?: string): string => `project:${(key ? keyedHash(key, "scope", resolve(cwd)) : sha256(Buffer.from(resolve(cwd)))).slice(0, 12)}`;

export interface FileUploadSet {
  files: FileUpload[];
  scopes: string[];
  /** On the first keyed sync only: each keyed project scope with the unkeyed one it replaces. */
  formerScopes?: Record<string, string>;
}

/**
 * Whether this sync also sends the earlier, unkeyed hashes (tools audit of 4 Oct 2026, fix 3). They exist to move a
 * record that was made before 0.1.6, when path hashes were plain SHA-256, and a plain hash of a path can confirm a
 * guessed user name or folder. Until 0.1.8 they went out on the first sync of every machine, new ones included, which
 * had nothing to move. They are sent only when this machine holds the trace of an earlier unkeyed report: scheduled
 * runs counted in its state file from before its salt file existed (every version that keys its hashes writes the salt
 * on its first sync, so runs without a salt were unkeyed), or when the person says so with --migrate-unkeyed, for a
 * machine that only ever synced by hand and so left no trace. Never for a label that already reports keyed hashes.
 */
export function sendsFormerHashes(s: { hasKey: boolean; labelKeyed: boolean; saltBefore: boolean; runsBefore: number; asked: boolean }): boolean {
  if (!s.hasKey || s.labelKeyed) return false;
  return s.asked || (!s.saltBefore && s.runsBefore > 0);
}

/** What the command prints, before it asks, on the one sync that sends them. */
export const FORMER_HASHES_NOTE =
  "Also sent, this once: this machine reported before path hashes were keyed, so for each instruction file the earlier unkeyed hash of its path (a plain SHA-256 of the full path) is sent beside the keyed one, with the earlier hash of this project folder and of each MCP config. They let the record keep its history under the keyed hashes; smallprint.dev uses them to find the old rows and does not keep them.";

/**
 * What sync sends for the instruction files. With a key, every path hash, project scope and MCP digest is keyed with the
 * machine's salt (security audit of 29 Sep 2026, item 36; tools audit fix 8), so a row cannot confirm a guessed user
 * name, folder or secret. `migrate` is set only by sendsFormerHashes above: each file then also carries the unkeyed
 * hashes it was recorded under, once, so the record keeps its history instead of reading every file as removed and new.
 * The server uses them only to find the old row and keeps none of them.
 */
export function toFileUpload(files: InstructionFile[], cwd = process.cwd(), key?: string, migrate = false): FileUploadSet {
  const scopes = new Set<string>(["home"]);
  const formerScopes: Record<string, string> = {};
  const out: FileUpload[] = files.map((f) => {
    const scope = f.scope === "home" ? "home" : projectScope(cwd, key);
    scopes.add(scope);
    if (key && migrate && scope !== "home") formerScopes[scope] = projectScope(cwd);
    const content = key && f.keyed ? f.keyed : { sha256: f.sha256, sections: f.sections };
    const former = key && migrate ? { formerPathHash: pathHash(f.path), ...(f.keyed ? { formerSha256: f.sha256 } : {}) } : {};
    return { pathHash: pathHash(f.path, key), kind: f.kind, host: f.host, scope, sha256: content.sha256, ...(content.sections ? { sections: content.sections } : {}), ...former };
  });
  return { files: out, scopes: [...scopes], ...(Object.keys(formerScopes).length ? { formerScopes } : {}) };
}
