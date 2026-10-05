/**
 * Claude Code mods (decision 370). Anthropic's mods reference (code.claude.com/docs/en/plugins/mods/reference, read 3 Oct
 * 2026): a mod is a plugin whose hooks/hooks.json names a hooks module under "modules", a path relative to hooks.json,
 * and Claude Code runs that module's register(on, options) inside itself. From there a hook can change the tool
 * descriptions Claude reads (tool.describe), the system prompt and the user's prompts (prompt.*, skill.prompt), allow,
 * block or replace tool calls (tool.call, tool.check), and the mods API reaches files, the network, programs and models.
 *
 * The command finds each mod among the Claude Code plugins on the machine, fingerprints its hooks modules and the files
 * they import (each is also a watched instruction file, so a change to its code is reported like a changed CLAUDE.md), and lists what the
 * code says it does. The list is read from the module's text, the events it passes to on() and the mods API calls it
 * writes out: code written to hide what it does is not caught, and a file loaded by a path built at run time is not
 * read. Nothing about a mod is sent.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { claudeCodePlugins, type InstalledPlugin } from "./plugins";

export interface Mod {
  plugin: string;
  root: string;
  /** The first hooks module, the code Claude Code runs. */
  module: string;
  /** Every code file read: each module hooks.json names, and the files inside the plugin they import. */
  files: string[];
  sha256: string;
  /** What the code says it does, in plain words, in a fixed order. */
  capabilities: string[];
}

const MODULE_MAX = 4 * 1024 * 1024;
const ON = (events: string) => new RegExp(`\\bon\\(\\s*['"\`](?:${events})['"\`]`);

/** In the order they are printed: what touches what Claude reads first, then reach outside Claude Code. */
export const CAPABILITIES: readonly [RegExp, string][] = [
  [ON("tool\\.describe"), "changes the tool descriptions Claude reads"],
  [ON("prompt\\.(?:compose|section|context|attachment|submit|fill|suggest)|skill\\.prompt"), "changes what Claude is told: the system prompt, your prompts or a skill's text"],
  [/\$\.prompt\.submit\s*\([^)]*asUser\s*:\s*true/s, "sends text to Claude as if you typed it"],
  [ON("tool\\.(?:call|check)"), "allows, blocks or replaces tool calls"],
  [ON("session\\.append"), "rewrites what the conversation keeps"],
  [ON("agent\\.(?:offer|spawn)"), "changes which subagents run"],
  [ON("plugin\\.register|engine\\.create"), "acts on other mods as they load"],
  [ON("session\\.(?:send|receive)") , "exchanges messages with other sessions"],
  [/\$\.session\.send\s*\(/, "exchanges messages with other sessions"],
  [/\$\.http\./, "uses the network"],
  [/\$\.process\./, "runs programs"],
  [/\$\.fs\.write\s*\(/, "writes files"],
  [/\$\.fs\.(?:read|list|stat|exists|ancestors)\s*\(/, "reads files"],
  [/\$\.env\.set\s*\(/, "changes environment variables"],
  [/\$\.mcp\./, "connects to MCP servers"],
  [/\$\.model\./, "calls a model"],
  [ON("\\*"), "handles every event"],
];

export function modCapabilities(src: string): string[] {
  const out: string[] = [];
  for (const [re, label] of CAPABILITIES) if (re.test(src) && !out.includes(label)) out.push(label);
  return out;
}

const within = (root: string, p: string): boolean => {
  try {
    const r = realpathSync(root);
    const q = realpathSync(p);
    return q === r || q.startsWith(r + sep);
  } catch {
    return false;
  }
};

/** A real file inside the plugin, never a link out of it. */
function insidePlugin(root: string, path: string): boolean {
  if (!existsSync(path) || !within(root, path)) return false;
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/** How many code files of one mod are read: its modules and what they import. A mod with more is said to be larger than the command reads. */
export const MOD_FILES_MAX = 40;

/** A relative import, however the code writes it: import ... from, a bare import, import() and require(). */
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["'`](\.{1,2}\/[^"'`\n]+)["'`]/g;
const EXTENSIONS = ["", ".js", ".mjs", ".cjs", ".ts", "/index.js", "/index.mjs"];

/**
 * Every code file of a mod (tools audit of 4 Oct 2026, fix 9): each module its hooks/hooks.json names, in the order
 * written, and every file inside the plugin those import by a relative path, in the order found. Until 0.1.8 only the
 * first module was read, so a network call added to a second module, or to a file the first one imports, changed
 * nothing the command printed. An import whose path is built at run time is not followed; the page says so.
 */
export function modModulePaths(root: string): string[] {
  const hooks = join(root, "hooks", "hooks.json");
  if (!existsSync(hooks)) return [];
  let modules: unknown;
  try {
    modules = (JSON.parse(readFileSync(hooks, "utf8")) as { modules?: unknown }).modules;
  } catch {
    return [];
  }
  const named = Array.isArray(modules) ? modules.filter((m): m is string => typeof m === "string" && m.length > 0) : [];
  const out: string[] = [];
  const queue = named.map((m) => resolve(dirname(hooks), m)).filter((path) => insidePlugin(root, path));
  while (queue.length && out.length < MOD_FILES_MAX) {
    const file = queue.shift()!;
    if (out.includes(file)) continue;
    out.push(file);
    let src: string;
    try {
      if (lstatSync(file).size > MODULE_MAX) continue;
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(IMPORT)) {
      const target = EXTENSIONS.map((e) => resolve(dirname(file), m[1]! + e)).find((path) => insidePlugin(root, path));
      if (target && !out.includes(target) && !queue.includes(target)) queue.push(target);
    }
  }
  return out;
}

/** The plugin's first hooks module, when its hooks/hooks.json names one inside the plugin: then it is a mod. */
export function modModulePath(root: string): string | null {
  return modModulePaths(root)[0] ?? null;
}

export function modOf(p: InstalledPlugin): Mod | null {
  const files = modModulePaths(p.root);
  const module = files[0];
  if (!module) return null;
  const hashes: string[] = [];
  let text = "";
  let oversize = files.length >= MOD_FILES_MAX;
  for (const f of files) {
    let src: Buffer;
    try {
      src = readFileSync(f);
    } catch {
      if (f === module) return null;
      continue;
    }
    hashes.push(createHash("sha256").update(src).digest("hex"));
    if (src.length > MODULE_MAX) oversize = true;
    else text += `${src.toString("utf8")}\n`;
  }
  // one file: its own hash, as before 0.1.8, so a mod with one module keeps the fingerprint it had; more: one hash over each file's
  const sha256 = hashes.length === 1 ? hashes[0]! : createHash("sha256").update(hashes.join("\n")).digest("hex");
  const capabilities = modCapabilities(text);
  if (oversize) capabilities.push("is larger than the command reads; read its code yourself");
  return { plugin: p.name, root: p.root, module, files, sha256, capabilities };
}

/** Every mod among the Claude Code plugins on the machine. */
export function findMods(home = homedir(), cwd = process.cwd()): Mod[] {
  return claudeCodePlugins(home, cwd).map(modOf).filter((m): m is Mod => !!m);
}

/** What the last run saw, per module path: the capabilities, so a new one can be named. */
export type ModBaseline = Record<string, string[]>;

export function compareMods(mods: readonly Mod[], before: ModBaseline): { mod: Mod; added: string[]; first: boolean }[] {
  return mods.map((m) => {
    const prev = before[m.module];
    return { mod: m, first: !prev, added: prev ? m.capabilities.filter((c) => !prev.includes(c)) : [] };
  });
}

export const modBaseline = (mods: readonly Mod[]): ModBaseline => Object.fromEntries(mods.map((m) => [m.module, m.capabilities]));
