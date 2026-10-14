/**
 * Discovery: where each agent host keeps its MCP server and skill configuration,
 * and how to read it without touching secrets. This package is the open, thin
 * client: it collects names, versions, source hints and file hashes, and
 * nothing else. Config values, env vars and tokens never leave the machine;
 * the hygiene checks look at them locally and report only a finding.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, lstatSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { claudeCodePlugins, codexPlugins, copilotPlugins, manifestHasServers, pluginManifestPath, type InstalledPlugin } from "./plugins";
import { parseClaudeJson as parseJsonPure, parseCodexToml as parseTomlPure, parseContinueYaml as parseContinuePure, parseGooseYaml as parseGoosePure, type Discovered, type DiscoveredServer, type DiscoveredSkill, type Host, type JsonShape } from "./parse";


/**
 * The version npx actually runs for an unpinned `npx <pkg>` (decision 222): npx keeps each package it fetched under
 * ~/.npm/_npx/<hash>/node_modules/<pkg>/package.json, and the newest of those directories is the one the next run uses.
 * A grade about "the installed version" needs that number; without it the check could only say the version is unknown.
 */
export function versionFromNpxCache(pkg: string, npxDir: string = join(homedir(), ".npm", "_npx")): string | null {
  try {
    let best: { mtime: number; version: string } | null = null;
    for (const entry of readdirSync(npxDir)) {
      const pj = join(npxDir, entry, "node_modules", ...pkg.split("/"), "package.json");
      try {
        const st = statSync(pj);
        const version = String((JSON.parse(readFileSync(pj, "utf8")) as { version?: unknown }).version ?? "");
        if (!version) continue;
        if (!best || st.mtimeMs > best.mtime) best = { mtime: st.mtimeMs, version };
      } catch {
        /* not in this cache directory */
      }
    }
    return best?.version ?? null;
  } catch {
    return null;
  }
}

/** Fill a missing version for an npm server from the npx cache; a version pinned in the command line is left alone. */
function withCachedVersion<T extends DiscoveredServer>(s: T): T {
  if (s.version || !s.canonicalName?.startsWith("npm:") || s.transport !== "stdio") return s;
  const v = versionFromNpxCache(s.canonicalName.slice(4));
  return v ? { ...s, version: v } : s;
}

export * from "./parse";
import { toUpload as toUploadPure, type UploadItem } from "./parse";
/** toUpload with the tree hash filled in (node has crypto; the pure module does not). */
export function toUpload(items: readonly Discovered[]): UploadItem[] {
  return toUploadPure(items, (s) => createHash("sha256").update(s).digest("hex"));
}

/** Config files on disk get one more hygiene note the browser cannot make: world-readable mode bits. */
function fileModeHygiene(configPath: string): string[] {
  // Windows reports 0o666 for every file: the bits mean nothing there, so there is nothing to say
  if (platform() === "win32") return [];
  try {
    const mode = statSync(configPath).mode & 0o077;
    if (mode) return [`${configPath} is readable by other users (mode ${(statSync(configPath).mode & 0o777).toString(8)})`];
  } catch {
    // unreadable stat: nothing to say
  }
  return [];
}

export function parseClaudeJson(text: string, host: Host, configPath: string, namePrefix = "", shape: JsonShape = "claude"): DiscoveredServer[] {
  const extra = fileModeHygiene(configPath);
  return parseJsonPure(text, host, configPath, namePrefix, shape).map((s) => withCachedVersion({ ...s, hygiene: [...s.hygiene, ...extra] }));
}

/** Goose's or Continue's YAML, with the same file-mode note and npx version as the JSON configs (decision 458). */
export function parseYamlConfig(text: string, format: "goose-yaml" | "continue-yaml", configPath: string): DiscoveredServer[] {
  const extra = fileModeHygiene(configPath);
  return (format === "goose-yaml" ? parseGoosePure(text, configPath) : parseContinuePure(text, configPath)).map((s) => withCachedVersion({ ...s, hygiene: [...s.hygiene, ...extra] }));
}

/** The block files in Continue's .continue/mcpServers/ folder: YAML blocks, and JSON configs copied from other clients. */
export const CONTINUE_DIR_EXT: readonly string[] = [".yaml", ".yml", ".json"];
export function continueDirFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .sort()
      .filter((n) => !n.startsWith(".") && CONTINUE_DIR_EXT.some((e) => n.endsWith(e)))
      .map((n) => join(dir, n))
      .filter((p) => lstatSync(p).isFile());
  } catch {
    return [];
  }
}

export function parseCodexToml(text: string, configPath: string): DiscoveredServer[] {
  const extra = fileModeHygiene(configPath);
  return parseTomlPure(text, configPath).map((s) => withCachedVersion({ ...s, hygiene: [...s.hygiene, ...extra] }));
}


export interface DiscoverOptions {
  home?: string;
  cwd?: string;
  /** Extra config files to read as Claude-style JSON (tests). */
  extraJsonConfigs?: { path: string; host: Host }[];
}

export interface ConfigLocation {
  host: Host;
  path: string;
  format: "claude-json" | "cursor-json" | "codex-toml" | "skills-dir" | "goose-yaml" | "continue-yaml" | "continue-dir";
  /** For a JSON config whose servers are not where Claude-style configs keep them: the one key its client uses. */
  shape?: JsonShape;
  /** Under the home directory or under the working directory. The lock and the change record read it (instructions.ts). */
  scope: "home" | "project";
}

/** Roo Code's MCP settings in VS Code's global storage, beside Cline's. */
export function rooHomeSettings(home = homedir(), win = platform() === "win32", appData = process.env.APPDATA ?? join(home, "AppData", "Roaming")): string {
  return win ? join(appData, "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json") : join(home, "Library", "Application Support", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json");
}

/**
 * Everything we look for, in order. Paths are best effort per docs/SOURCES.md. This is the one table of clients: every
 * row that holds server definitions is also a file the lock and the change record watch (mcpConfigLocations in
 * instructions.ts is made from it), so a client cannot be listed here without being locked. Zed and Gemini were listed
 * and not watched until 0.1.8, because the watched files were a second list kept by hand.
 */
export function configLocations(home = homedir(), cwd = process.cwd()): ConfigLocation[] {
  const win = platform() === "win32";
  const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
  return [
    { host: "claude-desktop", path: win ? join(appData, "Claude", "claude_desktop_config.json") : join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), format: "claude-json", scope: "home" },
    { host: "claude-code", path: join(home, ".claude.json"), format: "claude-json", scope: "home" },
    { host: "claude-code", path: join(cwd, ".mcp.json"), format: "claude-json", scope: "project" },
    { host: "claude-code", path: join(home, ".claude", "skills"), format: "skills-dir", scope: "home" },
    { host: "claude-code", path: join(cwd, ".claude", "skills"), format: "skills-dir", scope: "project" },
    // the .agents/skills convention (skills.sh and the agents that read it), home and project (decision 224)
    { host: "manual", path: join(home, ".agents", "skills"), format: "skills-dir", scope: "home" },
    { host: "manual", path: join(cwd, ".agents", "skills"), format: "skills-dir", scope: "project" },
    // a repository's own skills/ folder at its root (skills/<name>/SKILL.md), the layout most published skills
    // repositories use; project scope only, and a plugin's own skills/ folder is left to the plugin (discover below)
    { host: "manual", path: join(cwd, "skills"), format: "skills-dir", scope: "project" },
    { host: "cursor", path: join(home, ".cursor", "mcp.json"), format: "cursor-json", scope: "home" },
    { host: "cursor", path: join(cwd, ".cursor", "mcp.json"), format: "cursor-json", scope: "project" },
    { host: "windsurf", path: join(home, ".codeium", "windsurf", "mcp_config.json"), format: "cursor-json", scope: "home" },
    { host: "codex", path: join(home, ".codex", "config.toml"), format: "codex-toml", scope: "home" },
    { host: "codex", path: join(cwd, ".codex", "config.toml"), format: "codex-toml", scope: "project" },
    // decision 143: the clients agent-bom style tools discover and the lock did not
    { host: "vscode", path: join(cwd, ".vscode", "mcp.json"), format: "claude-json", scope: "project" },
    { host: "vscode", path: win ? join(appData, "Code", "User", "mcp.json") : join(home, "Library", "Application Support", "Code", "User", "mcp.json"), format: "claude-json", scope: "home" },
    { host: "zed", path: join(home, ".config", "zed", "settings.json"), format: "claude-json", scope: "home" },
    { host: "zed", path: join(cwd, ".zed", "settings.json"), format: "claude-json", scope: "project" },
    { host: "gemini", path: join(home, ".gemini", "settings.json"), format: "claude-json", scope: "home" },
    { host: "gemini", path: join(cwd, ".gemini", "settings.json"), format: "claude-json", scope: "project" },
    { host: "windsurf", path: join(cwd, ".windsurf", "mcp.json"), format: "cursor-json", scope: "project" },
    { host: "cline", path: win ? join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json") : join(home, "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"), format: "claude-json", scope: "home" },
    { host: "roo", path: join(cwd, ".roo", "mcp.json"), format: "claude-json", scope: "project" },
    // Cline's project-level server list (decision 445; the competitor's discovery reads it and the lock did not)
    { host: "cline", path: join(cwd, ".cline", "mcp.json"), format: "claude-json", scope: "project" },
    // Roo's home settings (tools audit of 29 Sep 2026, fix 10): the README said gate reads them and nothing did
    { host: "roo", path: rooHomeSettings(home, win, appData), format: "claude-json", scope: "home" },
    { host: "openclaw", path: join(home, ".openclaw", "skills"), format: "skills-dir", scope: "home" },
    { host: "openclaw", path: join(home, "clawd", "skills"), format: "skills-dir", scope: "home" },
    { host: "hermes", path: join(home, ".hermes", "skills"), format: "skills-dir", scope: "home" },
    { host: "harnos", path: join(home, ".harnos", "skills"), format: "skills-dir", scope: "home" },
    // decision 458 (Nick, 11 Oct 2026: no other tool should find more clients). Every row below is a path the client's
    // own documentation names, read on 11 Oct 2026 at the address beside it; a client whose docs name no file is not here.
    // Kiro: https://kiro.dev/docs/mcp/configuration/ ("User Level: ~/.kiro/settings/mcp.json", "Workspace Level: .kiro/settings/mcp.json")
    { host: "kiro", path: join(home, ".kiro", "settings", "mcp.json"), format: "claude-json", scope: "home" },
    { host: "kiro", path: join(cwd, ".kiro", "settings", "mcp.json"), format: "claude-json", scope: "project" },
    // OpenCode: https://opencode.ai/docs/config/ (global ~/.config/opencode/opencode.json, project opencode.json, JSON or
    // JSONC) and https://opencode.ai/docs/mcp-servers/ (servers under "mcp", command as one array, env as "environment")
    { host: "opencode", path: join(home, ".config", "opencode", "opencode.json"), format: "claude-json", shape: "mcp-key", scope: "home" },
    { host: "opencode", path: join(cwd, "opencode.json"), format: "claude-json", shape: "mcp-key", scope: "project" },
    // Kilo Code: https://kilo.ai/docs/features/mcp/using-mcp-in-kilo-code (~/.config/kilo/kilo.json or kilo.jsonc;
    // project kilo.json, kilo.jsonc, .kilo/kilo.json or .kilo/kilo.jsonc; servers under "mcp", OpenCode's entry shape)
    { host: "kilo", path: join(home, ".config", "kilo", "kilo.json"), format: "claude-json", shape: "mcp-key", scope: "home" },
    { host: "kilo", path: join(home, ".config", "kilo", "kilo.jsonc"), format: "claude-json", shape: "mcp-key", scope: "home" },
    { host: "kilo", path: join(cwd, "kilo.json"), format: "claude-json", shape: "mcp-key", scope: "project" },
    { host: "kilo", path: join(cwd, "kilo.jsonc"), format: "claude-json", shape: "mcp-key", scope: "project" },
    { host: "kilo", path: join(cwd, ".kilo", "kilo.json"), format: "claude-json", shape: "mcp-key", scope: "project" },
    { host: "kilo", path: join(cwd, ".kilo", "kilo.jsonc"), format: "claude-json", shape: "mcp-key", scope: "project" },
    // Crush: https://github.com/charmbracelet/crush/blob/main/docs/config/README.md ("Legacy JSON uses .crush.json /
    // crush.json in the same directories" as crushrc: the project and ~/.config/crush, %USERPROFILE%\.config\crush on
    // Windows per the README); servers under "mcp" (schema.json MCPConfig). crushrc is a shell script and is not read.
    { host: "crush", path: join(home, ".config", "crush", "crush.json"), format: "claude-json", shape: "mcp-key", scope: "home" },
    { host: "crush", path: join(cwd, ".crush.json"), format: "claude-json", shape: "mcp-key", scope: "project" },
    { host: "crush", path: join(cwd, "crush.json"), format: "claude-json", shape: "mcp-key", scope: "project" },
    // Amp: https://ampcode.com/docs/markdown/cli/settings (~/.config/amp/settings.json or .jsonc, %USERPROFILE%\.config\amp
    // on Windows; workspace .amp/settings.json or .jsonc; servers under "amp.mcpServers")
    { host: "amp", path: join(home, ".config", "amp", "settings.json"), format: "claude-json", shape: "amp", scope: "home" },
    { host: "amp", path: join(home, ".config", "amp", "settings.jsonc"), format: "claude-json", shape: "amp", scope: "home" },
    { host: "amp", path: join(cwd, ".amp", "settings.json"), format: "claude-json", shape: "amp", scope: "project" },
    { host: "amp", path: join(cwd, ".amp", "settings.jsonc"), format: "claude-json", shape: "amp", scope: "project" },
    // Continue: https://docs.continue.dev/customize/deep-dives/configuration (~/.continue/config.yaml, %USERPROFILE%\.continue
    // on Windows) and https://docs.continue.dev/customize/deep-dives/mcp (a list under mcpServers; block files and copied
    // JSON configs in the workspace's .continue/mcpServers/)
    { host: "continue", path: join(home, ".continue", "config.yaml"), format: "continue-yaml", scope: "home" },
    { host: "continue", path: join(cwd, ".continue", "mcpServers"), format: "continue-dir", scope: "project" },
    // Goose: https://goose-docs.ai/docs/guides/config-files (~/.config/goose/config.yaml; %APPDATA%\Block\goose\config\config.yaml
    // on Windows; servers are the stdio and streamable_http entries under "extensions")
    { host: "goose", path: win ? join(appData, "Block", "goose", "config", "config.yaml") : join(home, ".config", "goose", "config.yaml"), format: "goose-yaml", scope: "home" },
    // LM Studio: https://lmstudio.ai/blog/mcp ("mcp.json lives in ~/.lmstudio/mcp.json on macOS and Linux, and in
    // %USERPROFILE%/.lmstudio/mcp.json on Windows"; Cursor's notation)
    { host: "lmstudio", path: join(home, ".lmstudio", "mcp.json"), format: "claude-json", scope: "home" },
    // Qwen Code: https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/ (~/.qwen/settings.json, .qwen/settings.json)
    { host: "qwen", path: join(home, ".qwen", "settings.json"), format: "claude-json", scope: "home" },
    { host: "qwen", path: join(cwd, ".qwen", "settings.json"), format: "claude-json", scope: "project" },
    // Junie: https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html (~/.junie/mcp/mcp.json, .junie/mcp/mcp.json;
    // the IDE plugin uses the same files)
    { host: "junie", path: join(home, ".junie", "mcp", "mcp.json"), format: "claude-json", scope: "home" },
    { host: "junie", path: join(cwd, ".junie", "mcp", "mcp.json"), format: "claude-json", scope: "project" },
    // Trae: https://docs.trae.ai/ide/add-mcp-servers ("Create an mcp.json file in the .trae/ directory under the project
    // root"); its global list is kept by the app and the docs name no file for it
    { host: "trae", path: join(cwd, ".trae", "mcp.json"), format: "claude-json", scope: "project" },
    // Augment's Auggie CLI: https://docs.augmentcode.com/cli/integrations ("the Augment settings file ~/.augment/settings.json")
    { host: "augment", path: join(home, ".augment", "settings.json"), format: "claude-json", scope: "home" },
    // Visual Studio (Windows only): https://learn.microsoft.com/en-us/visualstudio/ide/mcp-servers (%USERPROFILE%\.mcp.json
    // and <SOLUTIONDIR>\.vs\mcp.json; its other locations are the .mcp.json, .vscode and .cursor files already above)
    ...(win ? [{ host: "visual-studio" as const, path: join(home, ".mcp.json"), format: "claude-json" as const, scope: "home" as const }] : []),
    { host: "visual-studio", path: join(cwd, ".vs", "mcp.json"), format: "claude-json", scope: "project" },
    // Warp: https://docs.warp.dev/knowledge-and-collaboration/mcp (file-based servers: ~/.warp/.mcp.json, .warp/.mcp.json,
    // and for "Other agents" ~/.agents/.mcp.json and .agents/.mcp.json)
    { host: "warp", path: join(home, ".warp", ".mcp.json"), format: "claude-json", scope: "home" },
    { host: "warp", path: join(cwd, ".warp", ".mcp.json"), format: "claude-json", scope: "project" },
    { host: "warp", path: join(home, ".agents", ".mcp.json"), format: "claude-json", scope: "home" },
    { host: "warp", path: join(cwd, ".agents", ".mcp.json"), format: "claude-json", scope: "project" },
    // ZCode (Z.ai's desktop coding agent): https://zcode.z.ai/en/docs/mcp-services (~/.zcode/cli/config.json and
    // <project>/.zcode/config.json under "mcp"."servers"; ~/.agents/mcp.json and <project>/.agents/mcp.json as mcpServers)
    { host: "zcode", path: join(home, ".zcode", "cli", "config.json"), format: "claude-json", shape: "zcode", scope: "home" },
    { host: "zcode", path: join(cwd, ".zcode", "config.json"), format: "claude-json", shape: "zcode", scope: "project" },
    { host: "zcode", path: join(home, ".agents", "mcp.json"), format: "claude-json", scope: "home" },
    { host: "zcode", path: join(cwd, ".agents", "mcp.json"), format: "claude-json", scope: "project" },
  ];
}


function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Ceilings for one skill: past these the skill is reported, not hashed, so a hostile tree cannot make the CLI read the disk. */
export const SKILL_MAX_FILES = 2_000;
export const SKILL_MAX_BYTES = 200_000_000;
const FILE_MAX_BYTES = 5_000_000;

export class SkillTooLarge extends Error {}

/**
 * Hash every regular file under a skill directory. Symbolic links are never
 * followed (lstat, not stat): a skill that ships `data -> ~` must not turn into
 * a listing of the home directory. Paths in the result are relative to the
 * skill and never leave it.
 */
export function readSkillDir(host: Host, dir: string): DiscoveredSkill | null {
  const skillMd = join(dir, "SKILL.md");
  if (!existsSync(skillMd) || lstatSync(skillMd).isSymbolicLink()) return null;
  const files: { path: string; sha256: string }[] = [];
  let total = 0;
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name === "node_modules" || name === ".git" || name === ".DS_Store") continue;
      const full = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(full);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(full, r);
      else if (st.isFile() && st.size <= FILE_MAX_BYTES) {
        total += st.size;
        if (files.length >= SKILL_MAX_FILES || total > SKILL_MAX_BYTES) throw new SkillTooLarge(`${dir}: more than ${SKILL_MAX_FILES} files or ${SKILL_MAX_BYTES / 1_000_000} MB`);
        files.push({ path: r, sha256: sha256(readFileSync(full)) });
      }
    }
  };
  walk(dir, "");
  const text = readFileSync(skillMd, "utf8");
  const fm = /^---\s*\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fm)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? null;
  return { kind: "agent-skill", host, name: dir.split(/[\\/]/).pop()!, path: dir, displayName: field("name"), description: field("description"), files, skillMdSha256: sha256(Buffer.from(text)) };
}

export function readSkillsDir(host: Host, root: string, errors: string[] = []): DiscoveredSkill[] {
  if (!existsSync(root)) return [];
  const out: DiscoveredSkill[] = [];
  for (const name of readdirSync(root).sort()) {
    const dir = join(root, name);
    try {
      const st = lstatSync(dir);
      if (st.isSymbolicLink()) {
        errors.push(`${dir}: skipped, symbolic link`);
        continue;
      }
      if (!st.isDirectory()) continue;
      const s = readSkillDir(host, dir);
      if (s) { out.push(s); continue; }
      // a group folder (decision 445): no SKILL.md of its own, skill folders one level down, as the competitor's pins
      // and the skill registries both allow; deeper than that nothing is read, and a file loose in the group is not a skill
      for (const inner of readdirSync(dir).sort()) {
        const sub = join(dir, inner);
        try {
          const ss = lstatSync(sub);
          if (ss.isSymbolicLink()) { errors.push(`${sub}: skipped, symbolic link`); continue; }
          if (!ss.isDirectory()) continue;
          const nested = readSkillDir(host, sub);
          if (nested) out.push(nested);
        } catch (err) {
          errors.push(`${sub}: skipped, ${err instanceof SkillTooLarge ? err.message : ((err as NodeJS.ErrnoException).code ?? "unreadable")}`);
        }
      }
    } catch (err) {
      errors.push(`${dir}: skipped, ${err instanceof SkillTooLarge ? err.message : ((err as NodeJS.ErrnoException).code ?? "unreadable")}`);
    }
  }
  return out;
}

export interface DiscoveryResult {
  items: Discovered[];
  /** Config files that existed and were read. */
  read: string[];
  /** Files that existed but could not be parsed. */
  errors: { path: string; error: string }[];
}

export function discover(opts: DiscoverOptions = {}): DiscoveryResult {
  const home = opts.home ?? homedir();
  const cwd = resolve(opts.cwd ?? process.cwd());
  const items: Discovered[] = [];
  const read: string[] = [];
  const errors: { path: string; error: string }[] = [];
  const locations: Pick<ConfigLocation, "host" | "path" | "format" | "shape">[] = [...configLocations(home, cwd), ...(opts.extraJsonConfigs ?? []).map((e) => ({ ...e, format: "claude-json" as const }))];
  // a run from the home directory makes the home and project entries the same file: read it once
  const seen = new Set<string>();
  // the plugins are listed first so that a skills folder which is a plugin's own (a run from inside a plugin, whose
  // skills/ is then also the project's root skills folder) is read once, under the plugin, as it was before that row
  const ccPlugins = claudeCodePlugins(home, cwd);
  // Codex and GitHub Copilot CLI plugins (decision 363): Codex keeps the servers in .mcp.json, Copilot in mcp.json
  const others: [InstalledPlugin, Host, string][] = [
    ...codexPlugins(home).map((p) => [p, "codex", ".mcp.json"] as [InstalledPlugin, Host, string]),
    ...copilotPlugins(home).map((p) => [p, "copilot", "mcp.json"] as [InstalledPlugin, Host, string]),
  ];
  const pluginSkillRoots = new Set([...ccPlugins.map((p) => p.root), ...others.map(([p]) => p.root)].map((r) => resolve(r, "skills")));
  for (const loc of locations) {
    if (!existsSync(loc.path)) continue;
    const key = resolve(loc.path);
    if (seen.has(key) || (loc.format === "skills-dir" && pluginSkillRoots.has(key))) continue;
    seen.add(key);
    try {
      if (loc.format === "skills-dir") {
        const skillErrors: string[] = [];
        const skills = readSkillsDir(loc.host, loc.path, skillErrors);
        for (const e of skillErrors) errors.push({ path: loc.path, error: e });
        if (skills.length) read.push(loc.path);
        items.push(...skills);
        continue;
      }
      if (loc.format === "continue-dir") {
        // each block file is its own config: one that cannot be read is reported and the others are still listed
        for (const file of continueDirFiles(loc.path)) {
          try {
            const t = readFileSync(file, "utf8");
            items.push(...(file.endsWith(".json") ? parseClaudeJson(t, loc.host, file) : parseYamlConfig(t, "continue-yaml", file)));
            read.push(file);
          } catch (err) {
            errors.push({ path: file, error: (err as Error).message });
          }
        }
        continue;
      }
      const text = readFileSync(loc.path, "utf8");
      read.push(loc.path);
      if (loc.format === "codex-toml") items.push(...parseCodexToml(text, loc.path));
      else if (loc.format === "goose-yaml" || loc.format === "continue-yaml") items.push(...parseYamlConfig(text, loc.format, loc.path));
      else items.push(...parseClaudeJson(text, loc.host, loc.path, "", loc.shape));
    } catch (err) {
      errors.push({ path: loc.path, error: (err as Error).message });
    }
  }
  // Claude Code plugins (tools audit of 29 Sep 2026, fix 2): each plugin's servers, named as Claude Code names them
  // (plugin:<plugin>:<server>), and its skills
  // installed from a marketplace, synced from the Claude directory, or saved under skills/ (decision 370)
  for (const plugin of ccPlugins) {
    const mcp = join(plugin.root, ".mcp.json");
    const manifest = pluginManifestPath(plugin.root);
    for (const [path, inline] of [[mcp, false], [manifest, true]] as const) {
      if (!existsSync(path) || (inline && !manifestHasServers(plugin.root))) continue;
      try {
        const text = readFileSync(path, "utf8");
        const json = inline ? JSON.stringify({ mcpServers: (JSON.parse(text) as { mcpServers: unknown }).mcpServers }) : text;
        items.push(...parseClaudeJson(json, "claude-code", path, `plugin:${plugin.name}:`));
        read.push(path);
      } catch (err) {
        errors.push({ path, error: (err as Error).message });
      }
    }
    const skillsRoot = join(plugin.root, "skills");
    if (existsSync(skillsRoot) && !seen.has(resolve(skillsRoot))) {
      seen.add(resolve(skillsRoot));
      const skillErrors: string[] = [];
      const skills = readSkillsDir("claude-code", skillsRoot, skillErrors);
      for (const e of skillErrors) errors.push({ path: skillsRoot, error: e });
      if (skills.length) read.push(skillsRoot);
      items.push(...skills);
    }
  }
  // Codex and GitHub Copilot CLI plugins (decision 363): each plugin's servers and skills, under its own host, named as
  // for Claude Code plugins
  for (const [plugin, pluginHost, mcpFile] of others) {
    const mcp = join(plugin.root, mcpFile);
    if (existsSync(mcp)) {
      try {
        items.push(...parseClaudeJson(readFileSync(mcp, "utf8"), pluginHost, mcp, `plugin:${plugin.name}:`));
        read.push(mcp);
      } catch (err) {
        errors.push({ path: mcp, error: (err as Error).message });
      }
    }
    const skillsRoot = join(plugin.root, "skills");
    if (existsSync(skillsRoot) && !seen.has(resolve(skillsRoot))) {
      seen.add(resolve(skillsRoot));
      const skillErrors: string[] = [];
      const skills = readSkillsDir(pluginHost, skillsRoot, skillErrors);
      for (const e of skillErrors) errors.push({ path: skillsRoot, error: e });
      if (skills.length) read.push(skillsRoot);
      items.push(...skills);
    }
  }
  return { items, read, errors };
}

/** The exact payload a check or sync sends. Names, versions, hosts, hashes: nothing else. */
