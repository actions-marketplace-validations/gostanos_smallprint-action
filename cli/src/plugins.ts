/**
 * Claude Code plugins (tools audit of 29 Sep 2026, fix 2). A plugin installed with `claude plugin install` brings its
 * own MCP servers, skills, hooks, commands and agent definitions, and none of them sit in the files the command read
 * before, so `check` said "No MCP servers or skills found" on a machine with a plugin installed. Claude Code lists what
 * is installed in ~/.claude/plugins/installed_plugins.json: version 1 keeps one record per plugin, version 2 a list of
 * records per plugin (one per scope), each with an installPath. Only an install path inside the home directory is
 * read, the same rule the root-owned reporter keeps for imports, so a line in that file cannot point the command at
 * the rest of the disk. The Python reporter (report/smallprint-report.py) reads the same list the same way.
 */
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

export interface InstalledPlugin {
  /** The plugin's name, the part before the @ in "name@marketplace". */
  name: string;
  /** The folder Claude Code installed it to. */
  root: string;
}

export const PLUGINS_MAX = 50;

export function pluginListPath(home = homedir()): string {
  return join(home, ".claude", "plugins", "installed_plugins.json");
}

function inside(home: string, path: string): boolean {
  try {
    const real = realpathSync(path);
    const base = realpathSync(home);
    return real === base || real.startsWith(base + sep);
  } catch {
    return false;
  }
}

/** Every installed plugin whose folder exists inside the home directory, in name order, each folder once. */
export function installedPlugins(home = homedir()): InstalledPlugin[] {
  const list = pluginListPath(home);
  if (!existsSync(list)) return [];
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(list, "utf8"));
  } catch {
    return [];
  }
  const plugins = doc && typeof doc === "object" ? (doc as { plugins?: unknown }).plugins : null;
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) return [];
  const out: InstalledPlugin[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(plugins as Record<string, unknown>).sort()) {
    const raw = (plugins as Record<string, unknown>)[key];
    const records = Array.isArray(raw) ? raw : [raw];
    const name = key.split("@")[0] || key;
    for (const r of records) {
      const p = r && typeof r === "object" ? (r as { installPath?: unknown }).installPath : null;
      if (typeof p !== "string" || !p) continue;
      const root = resolve(p);
      if (seen.has(root) || !existsSync(root) || !inside(home, root)) continue;
      try {
        if (!lstatSync(root).isDirectory()) continue;
      } catch {
        continue;
      }
      seen.add(root);
      out.push({ name, root });
      if (out.length >= PLUGINS_MAX) return out;
    }
  }
  return out;
}

/** plugin.json, when it declares its MCP servers inline rather than in .mcp.json. */
export function pluginManifestPath(root: string): string {
  return join(root, ".claude-plugin", "plugin.json");
}

export function manifestHasServers(root: string): boolean {
  try {
    const j = JSON.parse(readFileSync(pluginManifestPath(root), "utf8")) as { mcpServers?: unknown };
    return Boolean(j.mcpServers && typeof j.mcpServers === "object" && !Array.isArray(j.mcpServers));
  } catch {
    return false;
  }
}
