#!/usr/bin/env python3
"""Small Print level-four reporter. Runs as root from a root-owned scheduled job, so an
agent running as the user cannot read its token, forge its report or stop it.

It does exactly what `smallprint sync` does for instruction files and skills, and nothing
else: hash a fixed list of files under one user's home, hash each skill folder, and post
kind labels, path hashes and content hashes to smallprint.dev. It never reads a file it did
not list, never follows a symbolic link, never executes anything, and never sends a path,
a file's contents or a config value. Standard library only, no dependencies, so the only
code running as root is this file and the system interpreter.

    smallprint-report.py --user nick --label "mac mini" [--every 6] [--base https://smallprint.dev]
                         [--token-file /etc/smallprint/token] [--dry-run] [--json]
"""
import argparse
import datetime
import hashlib
import hmac
import json
import os
import pwd
import re
import stat as S
import sys
import urllib.error
import urllib.request

# the version of the smallprint package this file ships in; test/version.test.ts holds the two together
VERSION = "0.1.8"
FILE_MAX = 5_000_000
DIR_MAX_FILES = 200
SKILL_MAX_FILES = 2000
IMPORT_MAX, IMPORT_DEPTH = 20, 3


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_text(s: str) -> str:
    return sha256(s.encode("utf-8"))


def locations(home: str, cwd: str):
    j = os.path.join

    def openclaw(root):
        return [(j(root, f), "openclaw", f"OpenClaw {f}, home", "home", None) for f in ["AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "USER.md", "HEARTBEAT.md", "BOOTSTRAP.md", "MEMORY.md"]]

    desktop = j(home, "Library", "Application Support", "Claude", "claude_desktop_config.json") if sys.platform == "darwin" else j(os.environ.get("APPDATA", j(home, "AppData", "Roaming")), "Claude", "claude_desktop_config.json")
    L = [
        (j(home, ".claude", "CLAUDE.md"), "claude-code", "Claude Code CLAUDE.md, home", "home", None),
        (j(home, ".claude", "settings.json"), "claude-code", "Claude Code settings.json, home", "home", None),
        (j(cwd, "CLAUDE.md"), "claude-code", "Claude Code CLAUDE.md, project", "project", None),
        (j(cwd, "CLAUDE.local.md"), "claude-code", "Claude Code CLAUDE.local.md, project", "project", None),
        (j(cwd, ".claude", "CLAUDE.md"), "claude-code", "Claude Code .claude/CLAUDE.md, project", "project", None),
        (j(cwd, ".claude", "settings.json"), "claude-code", "Claude Code settings.json, project", "project", None),
        (j(cwd, ".claude", "settings.local.json"), "claude-code", "Claude Code settings.local.json, project", "project", None),
        (j(home, ".codex", "AGENTS.md"), "codex", "Codex AGENTS.md, home", "home", None),
        (j(cwd, "AGENTS.md"), "codex", "Codex AGENTS.md, project", "project", None),
        (j(cwd, ".cursorrules"), "cursor", "Cursor .cursorrules, project", "project", None),
        (j(cwd, ".cursor", "rules"), "cursor", "Cursor rules file, project", "project", "dir"),
        (j(home, ".codeium", "windsurf", "memories", "global_rules.md"), "windsurf", "Windsurf global rules, home", "home", None),
        (j(cwd, ".windsurfrules"), "windsurf", "Windsurf .windsurfrules, project", "project", None),
        (j(cwd, ".windsurf", "rules"), "windsurf", "Windsurf rules file, project", "project", "dir"),
        (j(home, ".claude", "agents"), "claude-code", "Claude Code agent definition, home", "home", "dir"),
        (j(cwd, ".claude", "agents"), "claude-code", "Claude Code agent definition, project", "project", "dir"),
        (j(home, ".claude", "commands"), "claude-code", "Claude Code command, home", "home", "dir"),
        (j(cwd, ".claude", "commands"), "claude-code", "Claude Code command, project", "project", "dir"),
        (j(cwd, ".github", "copilot-instructions.md"), "manual", "Copilot instructions, project", "project", None),
        (j(home, ".gemini", "GEMINI.md"), "manual", "Gemini GEMINI.md, home", "home", None),
        (j(cwd, "GEMINI.md"), "manual", "Gemini GEMINI.md, project", "project", None),
        (j(cwd, ".clinerules"), "manual", "Cline .clinerules, project", "project", None),
        (j(cwd, ".roo", "rules"), "manual", "Roo rules file, project", "project", "dir"),
    ]
    L += mcp_config_locations(home, cwd, desktop)
    L += openclaw(j(home, ".openclaw", "workspace")) + openclaw(j(home, "clawd"))
    L.append((j(home, ".openclaw", "openclaw.json"), "openclaw", "OpenClaw config, home", "home", None))
    L += plugin_locations(home)
    return L


def vscode_base(home):
    j = os.path.join
    return j(os.environ.get("APPDATA", j(home, "AppData", "Roaming")), "Code", "User") if sys.platform == "win32" else j(home, "Library", "Application Support", "Code", "User")


def mcp_config_locations(home, cwd, desktop):
    """The files that hold server definitions, in the order of configLocations in discover.ts, which is the one table of
    clients: every client the command lists servers from is watched here too. Zed and Gemini were listed and not watched
    until 0.1.8. Codex's TOML is hashed whole; the JSON configs by the digest of their server definitions."""
    j = os.path.join
    g = lambda ext, f: j(vscode_base(home), "globalStorage", ext, "settings", f)
    return [
        (desktop, "claude-desktop", "Claude Desktop MCP servers, home", "home", "mcp-json"),
        (j(home, ".claude.json"), "claude-code", "Claude Code MCP servers, home", "home", "mcp-json"),
        (j(cwd, ".mcp.json"), "claude-code", "Claude Code MCP servers, project", "project", "mcp-json"),
        (j(home, ".cursor", "mcp.json"), "cursor", "Cursor MCP servers, home", "home", "mcp-json"),
        (j(cwd, ".cursor", "mcp.json"), "cursor", "Cursor MCP servers, project", "project", "mcp-json"),
        (j(home, ".codeium", "windsurf", "mcp_config.json"), "windsurf", "Windsurf MCP servers, home", "home", "mcp-json"),
        (j(home, ".codex", "config.toml"), "codex", "Codex config.toml, home", "home", None),
        (j(cwd, ".codex", "config.toml"), "codex", "Codex config.toml, project", "project", None),
        (j(cwd, ".vscode", "mcp.json"), "vscode", "VS Code MCP servers, project", "project", "mcp-json"),
        (j(vscode_base(home), "mcp.json"), "vscode", "VS Code MCP servers, home", "home", "mcp-json"),
        (j(home, ".config", "zed", "settings.json"), "zed", "Zed MCP servers, home", "home", "mcp-json"),
        (j(cwd, ".zed", "settings.json"), "zed", "Zed MCP servers, project", "project", "mcp-json"),
        (j(home, ".gemini", "settings.json"), "gemini", "Gemini MCP servers, home", "home", "mcp-json"),
        (j(cwd, ".gemini", "settings.json"), "gemini", "Gemini MCP servers, project", "project", "mcp-json"),
        (j(cwd, ".windsurf", "mcp.json"), "windsurf", "Windsurf MCP servers, project", "project", "mcp-json"),
        (g("saoudrizwan.claude-dev", "cline_mcp_settings.json"), "cline", "Cline MCP servers, home", "home", "mcp-json"),
        (j(cwd, ".roo", "mcp.json"), "roo", "Roo MCP servers, project", "project", "mcp-json"),
        (g("rooveterinaryinc.roo-cline", "mcp_settings.json"), "roo", "Roo MCP servers, home", "home", "mcp-json"),
    ]


PLUGINS_MAX = 50


def inside_home(path, home, owner_uid=None):
    try:
        real = os.path.realpath(path)
        base = os.path.realpath(home)
        if real != base and not real.startswith(base + os.sep):
            return False
        return owner_uid is None or os.lstat(path).st_uid == owner_uid
    except Exception:
        return False


def installed_plugins(home):
    """Claude Code plugins from ~/.claude/plugins/installed_plugins.json, the same list the node CLI reads (plugins.ts):
    only an install folder inside the user's home is read, so a line in that file cannot point root at the rest of the disk."""
    try:
        with open(os.path.join(home, ".claude", "plugins", "installed_plugins.json"), "rb") as f:
            doc = json.loads(f.read().decode("utf-8", "replace"))
    except Exception:
        return []
    plugins = doc.get("plugins") if isinstance(doc, dict) else None
    if not isinstance(plugins, dict):
        return []
    try:
        owner_uid = os.stat(home).st_uid
    except Exception:
        owner_uid = -1
    out, seen = [], set()
    for key in sorted(plugins):
        raw = plugins[key]
        records = raw if isinstance(raw, list) else [raw]
        name = key.split("@")[0] or key
        for r in records:
            p = r.get("installPath") if isinstance(r, dict) else None
            if not isinstance(p, str) or not p:
                continue
            root = os.path.abspath(p)
            if root in seen or not os.path.isdir(root) or os.path.islink(root) or not inside_home(root, home, owner_uid):
                continue
            seen.add(root)
            out.append((name, root))
            if len(out) >= PLUGINS_MAX:
                return out
    return out


def _manifest_name(root):
    try:
        with open(os.path.join(root, ".claude-plugin", "plugin.json"), "rb") as f:
            n = json.loads(f.read().decode("utf-8", "replace")).get("name")
        if isinstance(n, str) and re.match(r"^[\w.@-]{1,100}$", n):
            return n
    except Exception:
        pass
    return os.path.basename(root)


def claude_plugins(home, cwd=None):
    """Every Claude Code plugin, the same list as claudeCodePlugins in plugins.ts (decision 370): installed from a
    marketplace, synced from claude.ai under ~/.claude/plugins/synced/ (any real folder up to three levels down holding
    .claude-plugin/plugin.json), and saved under ~/.claude/skills/ or the project's .claude/skills/. Each folder once."""
    cwd = cwd or home
    try:
        owner_uid = os.stat(home).st_uid
    except Exception:
        owner_uid = -1
    out = list(installed_plugins(home))
    is_plugin = lambda d: os.path.isfile(os.path.join(d, ".claude-plugin", "plugin.json"))
    synced = os.path.join(home, ".claude", "plugins", "synced")
    found = []

    def walk(d, depth):
        for c in _real_dirs(d):
            if len(found) >= PLUGINS_MAX:
                return
            if is_plugin(c):
                if inside_home(c, home, owner_uid):
                    found.append((_manifest_name(c), c))
            elif depth < 3:
                walk(c, depth + 1)

    if os.path.isdir(synced) and not os.path.islink(synced) and inside_home(synced, home, owner_uid):
        walk(synced, 1)
    out += found
    skills = []
    for base in (os.path.join(home, ".claude", "skills"), os.path.join(cwd, ".claude", "skills")):
        for c in _real_dirs(base):
            if is_plugin(c) and (inside_home(c, home, owner_uid) or os.path.realpath(c).startswith(os.path.realpath(cwd) + os.sep)):
                skills.append((_manifest_name(c), c))
            if len(skills) >= PLUGINS_MAX:
                break
    out += skills
    seen, uniq = set(), []
    for name, root in out:
        k = os.path.abspath(root)
        if k in seen:
            continue
        seen.add(k)
        uniq.append((name, root))
    return uniq


MOD_FILES_MAX = 40
MOD_IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["'`](\.{1,2}/[^"'`\n]+)["'`]""")
MOD_EXTENSIONS = ["", ".js", ".mjs", ".cjs", ".ts", "/index.js", "/index.mjs"]


def inside_plugin(root, path):
    """A real file inside the plugin, never a link out of it (insidePlugin in mods.ts)."""
    try:
        real_root = os.path.realpath(root)
        real = os.path.realpath(path)
        return (real == real_root or real.startswith(real_root + os.sep)) and os.path.isfile(path) and not os.path.islink(path)
    except Exception:
        return False


def mod_module_paths(root):
    """Every code file of a mod, as modModulePaths in mods.ts: each module hooks/hooks.json names, in the order written,
    and every file inside the plugin those import by a relative path, in the order found (decision 370; all of them
    since 0.1.8, where only the first module was read before)."""
    hooks = os.path.join(root, "hooks", "hooks.json")
    try:
        with open(hooks, "rb") as f:
            modules = json.loads(f.read().decode("utf-8", "replace")).get("modules")
    except Exception:
        return []
    named = [m for m in modules if isinstance(m, str) and m] if isinstance(modules, list) else []
    queue = [p for p in (os.path.abspath(os.path.join(os.path.dirname(hooks), m)) for m in named) if inside_plugin(root, p)]
    out = []
    while queue and len(out) < MOD_FILES_MAX:
        file = queue.pop(0)
        if file in out:
            continue
        out.append(file)
        try:
            if os.lstat(file).st_size > 4 * 1024 * 1024:
                continue
            with open(file, "rb") as f:
                src = f.read().decode("utf-8", "replace")
        except Exception:
            continue
        for m in MOD_IMPORT.finditer(src):
            target = next((p for p in (os.path.abspath(os.path.join(os.path.dirname(file), m.group(1) + e)) for e in MOD_EXTENSIONS) if inside_plugin(root, p)), None)
            if target and target not in out and target not in queue:
                queue.append(target)
    return out


def manifest_has_servers(root):
    try:
        with open(os.path.join(root, ".claude-plugin", "plugin.json"), "rb") as f:
            m = json.loads(f.read().decode("utf-8", "replace")).get("mcpServers")
        return isinstance(m, dict)
    except Exception:
        return False


def _real_dirs(d):
    try:
        return sorted(os.path.join(d, n) for n in os.listdir(d) if not n.startswith(".") and os.path.isdir(os.path.join(d, n)) and not os.path.islink(os.path.join(d, n)))
    except Exception:
        return []


def codex_plugins(home):
    """Codex plugins, the same as codexPlugins in plugins.ts: ~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/,
    the newest version folder of each, real folders inside the home only (decision 363)."""
    root = os.path.join(home, ".codex", "plugins", "cache")
    try:
        owner_uid = os.stat(home).st_uid
    except Exception:
        owner_uid = -1
    if not os.path.isdir(root) or os.path.islink(root) or not inside_home(root, home, owner_uid):
        return []
    out = []
    for m in _real_dirs(root):
        for p in _real_dirs(m):
            versions = sorted(_real_dirs(p), key=lambda v: os.path.getmtime(v), reverse=True)
            if versions and inside_home(versions[0], home, owner_uid):
                out.append((os.path.basename(p), versions[0]))
                if len(out) >= PLUGINS_MAX:
                    return out
    return out


def copilot_plugins(home):
    """GitHub Copilot CLI plugins, the same as copilotPlugins in plugins.ts: ~/.copilot/installed-plugins/<marketplace>/<plugin>/.
    The root reporter cannot see the user's COPILOT_HOME, so it reads the default folder only (decision 363)."""
    root = os.path.join(home, ".copilot", "installed-plugins")
    try:
        owner_uid = os.stat(home).st_uid
    except Exception:
        owner_uid = -1
    if not os.path.isdir(root) or os.path.islink(root) or not inside_home(root, home, owner_uid):
        return []
    out = []
    for m in _real_dirs(root):
        for p in _real_dirs(m):
            if inside_home(p, home, owner_uid):
                out.append((os.path.basename(p), p))
                if len(out) >= PLUGINS_MAX:
                    return out
    return out


def plugin_locations(home):
    j = os.path.join
    L = []
    for _name, root in claude_plugins(home):
        L.append((j(root, ".mcp.json"), "claude-code", "Claude Code plugin MCP servers, home", "home", "mcp-json"))
        if manifest_has_servers(root):
            L.append((j(root, ".claude-plugin", "plugin.json"), "claude-code", "Claude Code plugin MCP servers, home", "home", "mcp-json"))
        L.append((j(root, "hooks", "hooks.json"), "claude-code", "Claude Code plugin hooks, home", "home", None))
        L.append((j(root, "commands"), "claude-code", "Claude Code plugin command, home", "home", "dir"))
        L.append((j(root, "agents"), "claude-code", "Claude Code plugin agent definition, home", "home", "dir"))
        for mod in mod_module_paths(root):
            L.append((mod, "claude-code", "Claude Code mod code, home", "home", None))
    for _name, root in codex_plugins(home):
        L.append((j(root, ".mcp.json"), "codex", "Codex plugin MCP servers, home", "home", "mcp-json"))
        L.append((j(root, "agents"), "codex", "Codex plugin agent definition, home", "home", "dir"))
    for _name, root in copilot_plugins(home):
        L.append((j(root, "mcp.json"), "copilot", "Copilot plugin MCP servers, home", "home", "mcp-json"))
        L.append((j(root, "agents"), "copilot", "Copilot plugin agent definition, home", "home", "dir"))
    return L


def canon(v):
    if isinstance(v, list):
        return [canon(x) for x in v]
    if isinstance(v, dict):
        return {k: canon(v[k]) for k in sorted(v)}
    return v


def dumps(v) -> str:
    # matches JSON.stringify: no spaces, keys in the order given
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)


def is_bare_server_map(j) -> bool:
    """A plugin's .mcp.json: no wrapper key, and every value a server definition (parse.ts isBareServerMap)."""
    if not isinstance(j, dict) or any(k in j for k in ("mcpServers", "servers", "context_servers", "projects")) or not j:
        return False
    return all(isinstance(v, dict) and any(isinstance(v.get(k), str) for k in ("command", "url", "serverUrl")) for v in j.values())


def keyed_hash(key: str, kind: str, value: str) -> str:
    """HMAC-SHA256 under the machine's salt, the same as keyedHash in instructions.ts (security audit item 36)."""
    return hmac.new(bytes.fromhex(key), f"{kind}\0{value}".encode("utf-8"), hashlib.sha256).hexdigest()


def mcp_digest(text: str, key=None):
    try:
        j = json.loads(text)
    except Exception:
        return None
    if not isinstance(j, dict):
        return None
    servers = {}

    def take(m, prefix):
        if not isinstance(m, dict):
            return
        for name, d in m.items():
            if isinstance(d, dict):
                d = dict(d)
                if isinstance(d.get("env"), dict):
                    d["env"] = {k: (f"hmac:{keyed_hash(key, 'env', str(v))}" if key else f"sha256:{sha256_text(str(v))}") for k, v in d["env"].items()}
            servers[prefix + name] = canon(d)

    if is_bare_server_map(j):
        take(j, "")
    take(j.get("mcpServers"), "")
    take(j.get("servers"), "")
    take(j.get("context_servers"), "")
    if isinstance(j.get("projects"), dict):
        for path, p in j["projects"].items():
            take(p.get("mcpServers") if isinstance(p, dict) else None, f"project:{(keyed_hash(key, 'project', path) if key else sha256_text(path))[:12]}/")
    sections = {name: sha256_text(dumps(d)) for name, d in servers.items()}
    return sha256_text(dumps(canon(servers))), sections


def section_hashes(text: str):
    try:
        j = json.loads(text)
    except Exception:
        return None
    if not isinstance(j, dict):
        return None
    return {k: sha256_text(dumps(v)) for k, v in j.items()}


IMPORT_RE = re.compile(r"(?:^|\s)@([^\s\"'`)]+)")


def claude_imports(text: str, from_dir: str, home: str):
    out = []

    def at(r):
        return os.path.join(home, r[2:]) if r.startswith("~/") else (r if r.startswith("/") else os.path.normpath(os.path.join(from_dir, r)))

    for m in IMPORT_RE.finditer(text):
        raw = m.group(1)
        p = None
        if raw.startswith(("~/", "./", "../", "/")):
            p = at(raw)
        else:
            # a bare relative path (@README, @docs/x.md) counts only when it names a file that exists (instructions.ts claudeImports)
            for r in (raw, re.sub(r"[.,;:!?]+$", "", raw)):
                if not r or r.startswith("@"):
                    continue
                c = at(r)
                try:
                    if S.S_ISREG(os.lstat(c).st_mode):
                        p = c
                        break
                except OSError:
                    pass
        if p and p not in out:
            out.append(p)
        if len(out) >= IMPORT_MAX:
            break
    return out


def read_one(path, host, kind, scope, mode, imported=False, key=None):
    st = os.lstat(path)
    if not S.S_ISREG(st.st_mode) or st.st_size > FILE_MAX:
        return None
    with open(path, "rb") as f:
        buf = f.read()
    if mode == "mcp-json":
        d = mcp_digest(buf.decode("utf-8", "replace"))
        if not d:
            return None
        out = {"path": path, "host": host, "kind": kind, "scope": scope, "sha256": d[0], "sections": d[1]}
        if key:
            k = mcp_digest(buf.decode("utf-8", "replace"), key)
            out["keyed"] = {"sha256": k[0], "sections": k[1]}
        return out
    out = {"path": path, "host": host, "kind": kind, "scope": scope, "sha256": sha256(buf)}
    # an imported file is hashed whole: no per-key hashes for text whose path the import author chose
    if not imported and path.endswith(".json"):
        s = section_hashes(buf.decode("utf-8", "replace"))
        if s is not None:
            out["sections"] = s
    return out


def import_allowed(path, home, owner_uid):
    """This runs as root, and the import line was written by the user (or an agent running as the user). Only a file
    inside the user's own home and owned by the user is followed: never /etc/shadow, never a root-owned file the user
    could not read themselves, and never a hash of it (decision 110)."""
    try:
        real = os.path.realpath(path)
        base = os.path.realpath(home)
        if real != base and not real.startswith(base + os.sep):
            return False
        return os.lstat(path).st_uid == owner_uid
    except Exception:
        return False


def read_files(home, cwd, key=None):
    out, seen = [], set()
    try:
        owner_uid = os.stat(home).st_uid
    except Exception:
        owner_uid = -1

    def push(f):
        if f and f["path"] not in seen:
            seen.add(f["path"])
            out.append(f)
            return True
        return False

    def follow(path, host, kind, scope, depth):
        if depth > IMPORT_DEPTH or (depth == 1 and not re.search(r"CLAUDE(?:\.local)?\.md$", path)):
            return
        try:
            text = open(path, "rb").read().decode("utf-8", "replace")
        except Exception:
            return
        for imp in claude_imports(text, os.path.dirname(path), home):
            if imp in seen or not os.path.exists(imp) or not import_allowed(imp, home, owner_uid):
                continue
            try:
                k = re.sub(r", (home|project)$", "", kind) + f" import, {scope}"
                if push(read_one(imp, host, k, scope, None, imported=True)):
                    follow(imp, host, kind, scope, depth + 1)
            except Exception:
                pass

    for path, host, kind, scope, mode in locations(home, cwd):
        if not os.path.exists(path):
            continue
        try:
            if mode == "dir":
                if not os.path.isdir(path) or os.path.islink(path):
                    continue
                for name in sorted(os.listdir(path))[:DIR_MAX_FILES]:
                    if name.startswith("."):
                        continue
                    push(read_one(os.path.join(path, name), host, kind, scope, None, key=key))
            elif push(read_one(path, host, kind, scope, mode, key=key)):
                follow(path, host, kind, scope, 1)
        except Exception:
            pass
    return out


def read_skills(home, cwd):
    items = []
    roots = [(os.path.join(home, ".claude", "skills"), "claude-code"), (os.path.join(cwd, ".claude", "skills"), "claude-code"), (os.path.join(home, ".openclaw", "skills"), "openclaw"), (os.path.join(home, "clawd", "skills"), "openclaw")]
    # the skills of each installed Claude Code plugin, after the others, as the node CLI reads them (tools audit of 29 Sep 2026, fix 2)
    roots += [(os.path.join(root, "skills"), "claude-code") for _name, root in claude_plugins(home, cwd)]
    # then Codex and GitHub Copilot CLI plugins, in the same order the node CLI reads them (decision 363)
    roots += [(os.path.join(root, "skills"), "codex") for _name, root in codex_plugins(home)]
    roots += [(os.path.join(root, "skills"), "copilot") for _name, root in copilot_plugins(home)]
    seen = set()
    for root, host in roots:
        if root in seen or not os.path.isdir(root) or os.path.islink(root):
            continue
        seen.add(root)
        for name in sorted(os.listdir(root)):
            d = os.path.join(root, name)
            if os.path.islink(d) or not os.path.isdir(d):
                continue
            skill_md = os.path.join(d, "SKILL.md")
            if not os.path.isfile(skill_md) or os.path.islink(skill_md):
                continue
            files = []
            for dp, dns, fns in os.walk(d):
                dns[:] = [x for x in sorted(dns) if x not in ("node_modules", ".git") and not os.path.islink(os.path.join(dp, x))]
                for fn in sorted(fns):
                    fp = os.path.join(dp, fn)
                    if fn == ".DS_Store" or os.path.islink(fp) or not os.path.isfile(fp):
                        continue
                    if os.path.getsize(fp) > FILE_MAX or len(files) >= SKILL_MAX_FILES:
                        continue
                    with open(fp, "rb") as fh:
                        files.append((os.path.relpath(fp, d).replace(os.sep, "/"), sha256(fh.read())))
            tree = sha256_text("\n".join(f"{p} {h}" for p, h in sorted(files)))
            with open(skill_md, "rb") as fh:
                skill_hash = sha256(fh.read())
            items.append({"kind": "agent-skill", "host": host, "name": name, "canonicalName": None, "version": None, "skillMdSha256": skill_hash, "treeSha256": tree})
    return items


def read_salt(path):
    try:
        with open(path) as fh:
            s = fh.read().strip()
        return s if re.fullmatch(r"[0-9a-f]{64}", s) else None
    except Exception:
        return None


def read_keyed_labels(path):
    try:
        with open(path) as fh:
            j = json.load(fh)
        return [x for x in j if isinstance(x, str)] if isinstance(j, list) else []
    except Exception:
        return []


def write_keyed_labels(path, labels):
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            json.dump(sorted(set(labels)), fh)
    except Exception:
        pass


def file_upload(f, key, migrate):
    """One file as sync sends it (toFileUpload in instructions.ts): keyed with the salt when there is one. With migrate, the
    unkeyed hashes it was recorded under ride along once so the server can move the record; see main for when that is."""
    content = f["keyed"] if key and "keyed" in f else {"sha256": f["sha256"], **({"sections": f["sections"]} if "sections" in f else {})}
    out = {"pathHash": keyed_hash(key, "path", f["path"]) if key else sha256_text(f["path"]), "kind": f["kind"], "host": f["host"], "scope": "home", "sha256": content["sha256"], **({"sections": content["sections"]} if "sections" in content else {})}
    if key and migrate:
        out["formerPathHash"] = sha256_text(f["path"])
        if "keyed" in f:
            out["formerSha256"] = f["sha256"]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True)
    ap.add_argument("--label", required=True)
    ap.add_argument("--every", type=float, default=6)
    ap.add_argument("--base", default="https://smallprint.dev")
    ap.add_argument("--token-file", default="/etc/smallprint/token")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--home", help="read this directory instead of the account's home (tests)")
    ap.add_argument("--salt-file", default="/etc/smallprint/salt", help="the root-owned copy of the machine's salt, written by schedule --install --system")
    ap.add_argument("--keyed-file", default="/etc/smallprint/keyed-labels", help="labels whose record already moved to keyed hashes")
    ap.add_argument("--migrate-file", default="/etc/smallprint/migrate-labels", help="labels that reported from this machine before hashes were keyed, written by the installer when it finds such a reporter")
    a = ap.parse_args()
    if not (a.base.startswith("https://") or a.base.startswith("http://localhost") or a.base.startswith("http://127.0.0.1")):
        sys.exit("refusing a non-https base")
    home = a.home or pwd.getpwnam(a.user).pw_dir
    key = read_salt(a.salt_file)
    keyed_labels = read_keyed_labels(a.keyed_file)
    # the earlier, unkeyed hashes go out only for a label the installer found reporting without a salt, once (tools audit
    # of 4 Oct 2026, fix 3); a machine that starts keyed has nothing to move and sends none
    migrate = bool(key) and a.label in read_keyed_labels(a.migrate_file) and a.label not in keyed_labels
    files = read_files(home, home, key)
    items = read_skills(home, home)
    upload = [file_upload(f, key, migrate) for f in files if f["scope"] == "home"]
    body = {"label": a.label, "items": items, "files": upload, "scopes": ["home"], "scheduled": True, "every": int(a.every * 3600), "reporter": "system"}
    if a.json:
        print(dumps({"files": [{"path": f["path"], "kind": f["kind"], "sha256": f["sha256"], **({"sections": f["sections"]} if "sections" in f else {})} for f in files], "items": items, "upload": upload}))
        return
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if a.dry_run:
        print(f"[{stamp}] dry run: would send {len(upload)} files and {len(items)} skills for {a.user} as {a.label!r} to {a.base}" + ("; with the earlier unkeyed hash of each path, this once" if migrate else ""))
        return
    try:
        with open(a.token_file) as fh:
            token = fh.read().strip()
    except Exception as e:
        sys.exit(f"[{stamp}] no token at {a.token_file}: {e}")
    req = urllib.request.Request(a.base.rstrip("/") + "/api/sync", data=dumps(body).encode(), headers={"content-type": "application/json", "authorization": f"Bearer {token}", "user-agent": f"smallprint-report/{VERSION}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.loads(r.read().decode())
        # a server that answers with "rekeyed" moved this label's record to the keyed hashes: the unkeyed ones are not sent again
        if key and (not migrate or isinstance(res.get("rekeyed"), int)):
            write_keyed_labels(a.keyed_file, keyed_labels + [a.label])
    except urllib.error.HTTPError as e:
        # the server's one line says why (a token revoked, a plan without the scheduled run); print it, not just the status
        try:
            detail = json.loads(e.read().decode()).get("error") or e.reason
        except Exception:
            detail = e.reason
        sys.exit(f"[{stamp}] send refused ({e.code}): {detail}")
    except Exception as e:
        sys.exit(f"[{stamp}] send failed: {e}")
    f = res.get("files") or {}
    changed = f.get("changed", []) + f.get("removed", []) + f.get("returned", [])
    print(f"[{stamp}] reported {f.get('recorded', 0)} files and {len(items)} skills for {a.user} as {a.label!r}" + (f"; {len(changed)} CHANGED" if changed else ""))
    for c in changed:
        where = f"  in: {', '.join(c['where']) or 'formatting only'}" if c.get("where") is not None else ""
        print(f"  {c.get('kind')}  was {(c.get('from') or 'none')[:12]}, now {(c.get('to') or 'none')[:12]}{where}")


if __name__ == "__main__":
    main()
