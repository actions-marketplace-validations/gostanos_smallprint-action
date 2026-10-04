/**
 * Claude Code plugins (tools audit of 29 Sep 2026, fix 2). A plugin installed with `claude plugin install` brings its
 * own MCP servers, skills, hooks, commands and agent definitions, and none of them sit in the files the command read
 * before, so `check` said "No MCP servers or skills found" on a machine with a plugin installed. Claude Code lists what
 * is installed in ~/.claude/plugins/installed_plugins.json: version 1 keeps one record per plugin, version 2 a list of
 * records per plugin (one per scope), each with an installPath. Only an install path inside the home directory is
 * read, the same rule the root-owned reporter keeps for imports, so a line in that file cannot point the command at
 * the rest of the disk. The Python reporter (report/smallprint-report.py) reads the same list the same way.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
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
  return join(pluginsRoot(home), "installed_plugins.json");
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

/**
 * Codex plugins (decision 363). OpenAI's guide (developers.openai.com/plugins/build/plugins, read 3 Oct 2026): "ChatGPT
 * installs plugins into ~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/". Each plugin folder holds
 * .codex-plugin/plugin.json, its servers in .mcp.json (the same mcpServers map Claude Code plugins use) and any skills/.
 * The newest version folder of each plugin is read, real folders only (no symbolic links), inside the home directory.
 */
export function codexPluginsRoot(home = homedir()): string {
  return join(home, ".codex", "plugins", "cache");
}

const realDirs = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((n) => !n.startsWith(".")).map((n) => join(dir, n)).filter((p) => {
      try {
        return lstatSync(p).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
};

export function codexPlugins(home = homedir()): InstalledPlugin[] {
  const root = codexPluginsRoot(home);
  if (!existsSync(root) || !inside(home, root)) return [];
  const out: InstalledPlugin[] = [];
  for (const marketplace of realDirs(root).sort()) {
    for (const plugin of realDirs(marketplace).sort()) {
      const versions = realDirs(plugin).map((v) => ({ v, at: (() => { try { return statSync(v).mtimeMs; } catch { return 0; } })() })).sort((a, b) => b.at - a.at);
      const newest = versions[0]?.v;
      if (!newest || !inside(home, newest)) continue;
      out.push({ name: plugin.split(sep).pop()!, root: newest });
      if (out.length >= PLUGINS_MAX) return out;
    }
  }
  return out;
}

/**
 * GitHub Copilot CLI plugins (decision 363). GitHub's CLI plugin reference (docs.github.com, read 3 Oct 2026): installed
 * plugins are kept in ~/.copilot/installed-plugins/MARKETPLACE/PLUGIN-NAME, or installed-plugins/_direct/SOURCE-ID/ when
 * installed directly, and COPILOT_HOME moves ~/.copilot. A plugin keeps its servers in mcp.json (the same mcpServers map)
 * and its skills in skills/. Only a COPILOT_HOME inside the home directory is followed.
 */
export function copilotPluginsRoot(home = homedir()): string {
  const env = process.env.COPILOT_HOME;
  const base = env && inside(home, env) ? resolve(env) : join(home, ".copilot");
  return join(base, "installed-plugins");
}

export function copilotPlugins(home = homedir()): InstalledPlugin[] {
  const root = copilotPluginsRoot(home);
  if (!existsSync(root) || !inside(home, root)) return [];
  const out: InstalledPlugin[] = [];
  for (const marketplace of realDirs(root).sort()) {
    for (const plugin of realDirs(marketplace).sort()) {
      if (!inside(home, plugin)) continue;
      out.push({ name: plugin.split(sep).pop()!, root: plugin });
      if (out.length >= PLUGINS_MAX) return out;
    }
  }
  return out;
}

/**
 * Claude Code plugins that are not in installed_plugins.json (decision 370). Anthropic's plugin loading reference
 * (code.claude.com/docs/en/plugins/loading, read 3 Oct 2026): plugins turned on for a claude.ai account, from the Claude
 * directory, load as <name>@synced from the plugins root's synced/ folder, with no install record; a plugin directory with
 * a .claude-plugin/plugin.json saved under ~/.claude/skills/ or the project's .claude/skills/ loads as <name>@skills-dir;
 * and CLAUDE_CODE_PLUGIN_CACHE_DIR moves the plugins root from ~/.claude/plugins. The synced folder's inner layout is not
 * documented, so a plugin there is any real folder, up to three levels down, that holds .claude-plugin/plugin.json.
 */
export function pluginsRoot(home = homedir()): string {
  const env = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR;
  return env && inside(home, env) ? resolve(env) : join(home, ".claude", "plugins");
}

/** The manifest's name, or the folder's when the manifest has none. */
export function manifestName(root: string): string {
  try {
    const n = (JSON.parse(readFileSync(pluginManifestPath(root), "utf8")) as { name?: unknown }).name;
    if (typeof n === "string" && /^[\w.@-]{1,100}$/.test(n)) return n;
  } catch {
    // a manifest that does not parse still names a plugin by its folder
  }
  return root.split(sep).pop()!;
}

const isPluginDir = (d: string) => existsSync(pluginManifestPath(d));

export function syncedPlugins(home = homedir()): InstalledPlugin[] {
  const root = join(pluginsRoot(home), "synced");
  if (!existsSync(root) || !inside(home, root)) return [];
  const out: InstalledPlugin[] = [];
  const walk = (dir: string, depth: number) => {
    for (const d of realDirs(dir)) {
      if (out.length >= PLUGINS_MAX) return;
      if (isPluginDir(d)) {
        if (inside(home, d)) out.push({ name: manifestName(d), root: d });
      } else if (depth < 3) walk(d, depth + 1);
    }
  };
  walk(root, 1);
  return out;
}

export function skillsDirPlugins(home = homedir(), cwd = process.cwd()): InstalledPlugin[] {
  const out: InstalledPlugin[] = [];
  for (const base of [join(home, ".claude", "skills"), join(cwd, ".claude", "skills")]) {
    for (const d of realDirs(base)) {
      if (isPluginDir(d) && inside(home, d) || (isPluginDir(d) && d.startsWith(resolve(cwd) + sep))) out.push({ name: manifestName(d), root: d });
      if (out.length >= PLUGINS_MAX) return out;
    }
  }
  return out;
}

/** Every Claude Code plugin on the machine: installed from a marketplace, synced from claude.ai, or saved under skills/, each folder once. */
export function claudeCodePlugins(home = homedir(), cwd = process.cwd()): InstalledPlugin[] {
  const seen = new Set<string>();
  const out: InstalledPlugin[] = [];
  for (const p of [...installedPlugins(home), ...syncedPlugins(home), ...skillsDirPlugins(home, cwd)]) {
    const key = resolve(p.root);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
