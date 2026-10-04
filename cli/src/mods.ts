/**
 * Claude Code mods (decision 370). Anthropic's mods reference (code.claude.com/docs/en/plugins/mods/reference, read 3 Oct
 * 2026): a mod is a plugin whose hooks/hooks.json names a hooks module under "modules", a path relative to hooks.json,
 * and Claude Code runs that module's register(on, options) inside itself. From there a hook can change the tool
 * descriptions Claude reads (tool.describe), the system prompt and the user's prompts (prompt.*, skill.prompt), allow,
 * block or replace tool calls (tool.call, tool.check), and the mods API reaches files, the network, programs and models.
 *
 * The command finds each mod among the Claude Code plugins on the machine, fingerprints its hooks module (the module is
 * also a watched instruction file, so a change to its code is reported like a changed CLAUDE.md), and lists what the
 * code says it does. The list is read from the module's text, the events it passes to on() and the mods API calls it
 * writes out: code written to hide what it does is not caught, and a module that loads other files is read only for
 * its own text. Nothing about a mod is sent.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { claudeCodePlugins, type InstalledPlugin } from "./plugins";

export interface Mod {
  plugin: string;
  root: string;
  /** The hooks module, the code Claude Code runs. */
  module: string;
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

/** The plugin's hooks module, when its hooks/hooks.json names one inside the plugin: then it is a mod. */
export function modModulePath(root: string): string | null {
  const hooks = join(root, "hooks", "hooks.json");
  if (!existsSync(hooks)) return null;
  let modules: unknown;
  try {
    modules = (JSON.parse(readFileSync(hooks, "utf8")) as { modules?: unknown }).modules;
  } catch {
    return null;
  }
  const first = Array.isArray(modules) ? modules.find((m): m is string => typeof m === "string" && m.length > 0) : null;
  if (!first) return null;
  const path = resolve(dirname(hooks), first);
  if (!existsSync(path) || !within(root, path)) return null;
  try {
    if (!lstatSync(path).isFile()) return null;
  } catch {
    return null;
  }
  return path;
}

export function modOf(p: InstalledPlugin): Mod | null {
  const module = modModulePath(p.root);
  if (!module) return null;
  let src: Buffer;
  try {
    src = readFileSync(module);
  } catch {
    return null;
  }
  if (src.length > MODULE_MAX) return { plugin: p.name, root: p.root, module, sha256: createHash("sha256").update(src).digest("hex"), capabilities: ["is larger than the command reads; read its code yourself"] };
  return { plugin: p.name, root: p.root, module, sha256: createHash("sha256").update(src).digest("hex"), capabilities: modCapabilities(src.toString("utf8")) };
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
