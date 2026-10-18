/**
 * Pure config parsing: no filesystem, no network, no node built-ins, so the
 * same code runs in the CLI and in the browser (the paste-a-config form). It
 * reads server names, commands, args and URLs. Env values are inspected for
 * hygiene notes and discarded; nothing here retains them.
 */
export type Host =
  | "claude-code"
  | "claude-desktop"
  | "cursor"
  | "codex"
  | "copilot"
  | "windsurf"
  | "vscode"
  | "zed"
  | "gemini"
  | "cline"
  | "roo"
  | "openclaw"
  | "hermes"
  | "harnos"
  // decision 458: every further client whose config file its own docs name (sources beside each row in discover.ts)
  | "kiro"
  | "opencode"
  | "kilo"
  | "crush"
  | "amp"
  | "continue"
  | "goose"
  | "lmstudio"
  | "qwen"
  | "junie"
  | "trae"
  | "augment"
  | "visual-studio"
  | "warp"
  | "zcode"
  | "manual";

/**
 * Where a JSON config keeps its servers (decision 458). "claude" is every shape the command read before: mcpServers,
 * VS Code's servers, Zed's context_servers, ~/.claude.json's projects, or a plugin's bare map. The others are one key
 * each: OpenCode, Kilo Code and Crush keep them under "mcp", Amp under "amp.mcpServers", ZCode under "mcp"."servers".
 */
export type JsonShape = "claude" | "mcp-key" | "amp" | "zcode";

/**
 * JSON with comments and trailing commas (JSONC), as Zed, VS Code, OpenCode, Kilo Code, Amp and Crush all accept, read
 * as JSON. Comments and a comma before a closing bracket are removed outside strings only; valid JSON comes back as it
 * went in, so a file that parsed before parses to the same value.
 */
export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      // a comma followed only by space and comments before } or ] is a trailing comma
      for (;;) {
        while (j < n && /\s/.test(text[j]!)) j++;
        if (text[j] === "/" && text[j + 1] === "/") {
          while (j < n && text[j] !== "\n") j++;
          continue;
        }
        if (text[j] === "/" && text[j + 1] === "*") {
          const end = text.indexOf("*/", j + 2);
          j = end < 0 ? n : end + 2;
          continue;
        }
        break;
      }
      if (text[j] === "}" || text[j] === "]") {
        i++;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

/** JSON.parse that also takes JSONC. A document that is valid JSON is parsed as it is. */
export function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(stripJsonc(text));
  }
}

/** Names that can be published: an npm package (optionally scoped) or a PyPI project. Paths never qualify. */
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const PYPI_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
/** What a pinned version may look like (semver, PEP 440, dist tags). Anything else, such as a path after an @, is dropped. */
const VERSION_SHAPE = /^[0-9A-Za-z][0-9A-Za-z.+_~-]{0,63}$/;
const cleanVersion = (v: string | null | undefined): string | null => (v && VERSION_SHAPE.test(v) ? v : null);
const SECRET_KEY = /(key|token|secret|password|passwd|credential|auth)/i;
const SECRET_VALUE = /^(sk-|ghp_|github_pat_|xox[abp]-|AKIA|AIza|-----BEGIN)|^[A-Za-z0-9_-]{32,}$/;
const ENV_REFERENCE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$|^\$[A-Za-z_][A-Za-z0-9_]*$/;

export interface DiscoveredServer {
  kind: "mcp";
  host: Host;
  /** Name as configured in the host. */
  name: string;
  configPath: string;
  transport: "stdio" | "http" | "sse" | "unknown";
  /** Best-effort package identity from the command line: npm:<pkg>, pypi:<pkg>, oci:<image>, or null for local paths. */
  canonicalName: string | null;
  /** Version pinned in the command line (npx pkg@1.2.3), if any. */
  version: string | null;
  /** Remote URL for http/sse servers (host only is kept, never query strings). */
  remoteHost: string | null;
  /** Local-only observations, never uploaded. */
  hygiene: string[];
}

export interface DiscoveredSkill {
  kind: "agent-skill";
  host: Host;
  name: string;
  path: string;
  /** SKILL.md frontmatter name / description when present. */
  displayName: string | null;
  description: string | null;
  /** Plain sha256 of SKILL.md and of every file, for the server to canonicalize. */
  files: { path: string; sha256: string }[];
  skillMdSha256: string;
}

export type Discovered = DiscoveredServer | DiscoveredSkill;

/**
 * The real server inside `smallprint watch [options] -- <command> [args]`, started directly or through npx, bunx, pnpx,
 * pnpm dlx or yarn dlx (decision 513); null for any other command. `cmd` is the program's lower-case base name.
 */
export function watchedCommand(cmd: string, a: readonly string[]): { command: string; args: string[] } | null {
  let rest: readonly string[] | null = null;
  if (cmd === "smallprint") rest = a;
  else if (cmd === "npx" || cmd === "bunx" || cmd === "pnpx" || ((cmd === "pnpm" || cmd === "yarn") && a[0] === "dlx")) {
    const after = cmd === "pnpm" || cmd === "yarn" ? a.slice(1) : a;
    const i = after.findIndex((x) => !x.startsWith("-"));
    if (i >= 0 && /^smallprint(?:@[^/\s]+)?$/.test(after[i]!)) rest = after.slice(i + 1);
  }
  if (!rest || rest[0] !== "watch") return null;
  const dash = rest.indexOf("--");
  if (dash < 0 || !rest[dash + 1]) return null;
  return { command: rest[dash + 1]!, args: rest.slice(dash + 2) };
}

export function inferPackage(command: string | undefined, args: readonly string[]): { canonicalName: string | null; version: string | null; transport: DiscoveredServer["transport"] } {
  let cmd = ((command ?? "").split(/[\\/]/).pop() ?? "").replace(/\.(?:cmd|exe|bat)$/i, "").toLowerCase();
  let a = args.filter((x) => typeof x === "string");
  // Windows shims: "cmd /c npx ..." and "powershell -Command npx ..."
  if ((cmd === "cmd" && /^\/c$/i.test(a[0] ?? "")) || (cmd === "powershell" && /^-c(?:ommand)?$/i.test(a[0] ?? ""))) {
    cmd = ((a[1] ?? "").split(/[\\/]/).pop() ?? "").replace(/\.(?:cmd|exe|bat)$/i, "").toLowerCase();
    a = a.slice(2);
  }
  // a server started through `smallprint watch -- <command>` (decision 513) is the server it starts, not the smallprint package
  const inner = watchedCommand(cmd, a);
  if (inner) return inferPackage(inner.command, inner.args);
  const firstPositional = (list: readonly string[]) => list.find((x) => !x.startsWith("-"));
  const splitVersion = (spec: string): [string, string | null] => {
    const m = /^(@?[^@]+)(?:@(.+))?$/.exec(spec);
    return m ? [m[1]!, m[2] ?? null] : [spec, null];
  };
  if (cmd === "npx" || cmd === "bunx" || cmd === "pnpx" || (cmd === "pnpm" && a[0] === "dlx") || (cmd === "yarn" && a[0] === "dlx")) {
    const rest = cmd === "npx" || cmd === "bunx" || cmd === "pnpx" ? a : a.slice(1);
    const spec = firstPositional(rest.filter((x) => x !== "-y" && x !== "--yes" && !x.startsWith("--package")));
    if (spec && NPM_NAME.test(splitVersion(spec)[0])) {
      const [name, version] = splitVersion(spec);
      return { canonicalName: `npm:${name}`, version: cleanVersion(version), transport: "stdio" };
    }
  }
  if (cmd === "uvx" || cmd === "pipx") {
    // pipx runs a package with `pipx run [options] <spec> [args]`; uvx is `uvx [options] <spec> [args]`.
    // Options that take a value are skipped with their value, so `--python 3.11` never becomes the package;
    // `--from` (uvx) and `--spec` (pipx) name the package itself when the positional is an entry point.
    const rest = cmd === "pipx" ? (a[0] === "run" ? a.slice(1) : []) : a;
    const valued = new Set(["--python", "-p", "--with", "-w", "--with-requirements", "--with-editable", "--index", "--default-index", "--index-url", "-i", "--extra-index-url", "--find-links", "-f", "--constraint", "-c", "--overrides", "--build-constraint", "--refresh-package", "--python-preference", "--python-platform", "--cache-dir", "--config-file", "--project", "--directory", "--exclude-newer", "--resolution", "--prerelease", "--color", "--link-mode", "--pip-args", "--spec"]);
    let spec: string | undefined;
    let named: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const x = rest[i]!;
      if (x === "--from" || x === "--spec") {
        named = rest[i + 1];
        i++;
        continue;
      }
      if (valued.has(x)) {
        i++;
        continue;
      }
      if (x.startsWith("-")) continue;
      spec = x;
      break;
    }
    const chosen = named ?? spec;
    if (chosen) {
      const m = /^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?(?:==(.+))?$/.exec(chosen);
      if (m) return { canonicalName: `pypi:${m[1]!.toLowerCase().replace(/[-_.]+/g, "-")}`, version: cleanVersion(m[2]), transport: "stdio" };
    }
    return { canonicalName: null, version: null, transport: "stdio" };
  }
  if (cmd === "uv" && a[0] === "run") {
    const rest = a.slice(1);
    let spec: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const x = rest[i]!;
      if (x === "--directory" || x === "--project" || x === "--with" || x === "--python" || x === "-p") {
        i++; // the value belongs to the option
        continue;
      }
      if (x.startsWith("-")) continue;
      spec = x;
      break;
    }
    if (spec && PYPI_NAME.test(spec)) return { canonicalName: `pypi:${spec.toLowerCase().replace(/[-_.]+/g, "-")}`, version: null, transport: "stdio" };
    return { canonicalName: null, version: null, transport: "stdio" };
  }
  if ((cmd === "python" || cmd === "python3") && a[0] === "-m" && a[1] && PYPI_NAME.test(a[1])) {
    return { canonicalName: `pypi:${a[1].toLowerCase().replace(/[-_.]+/g, "-")}`, version: null, transport: "stdio" };
  }
  if (cmd === "docker" && a[0] === "run") {
    // the image is the first argument that is not an option or an option's value; anything after it is the container
    // command. The value after --env-file, -v or --mount is a path on this machine and is never taken for the image
    // (security audit of 29 Sep 2026, item 35: `--env-file config/prod.env` was sent as oci:config/prod.env).
    const valued = new Set(["-e", "--env", "--env-file", "-v", "--volume", "--mount", "--name", "--network", "--net", "-w", "--workdir", "--entrypoint", "-l", "--label", "--label-file", "-p", "--publish", "-u", "--user", "--pull", "--platform", "-m", "--memory", "--cpus", "--add-host", "--cap-add", "--cap-drop", "--device", "--dns", "-h", "--hostname", "--ipc", "--log-driver", "--log-opt", "--restart", "--runtime", "--security-opt", "--shm-size", "--stop-signal", "--tmpfs", "--ulimit", "--gpus", "--expose", "--cidfile", "--volumes-from", "--link", "--pid", "--uts", "--userns", "--group-add", "--health-cmd", "--mac-address", "--ip", "--ip6", "--storage-opt", "--sysctl", "--cgroup-parent", "--cgroupns", "--isolation", "--detach-keys", "--annotation", "--attach", "-a"]);
    let positional: string | undefined;
    const rest = a.slice(1);
    for (let i = 0; i < rest.length; i++) {
      const x = rest[i]!;
      if (valued.has(x)) {
        i++;
        continue;
      }
      if (x.startsWith("-")) continue;
      positional = x;
      break;
    }
    const image = positional && /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+(:[A-Za-z0-9._-]+)?$/.test(positional) && !positional.startsWith("/") && !positional.startsWith(".") ? positional : undefined;
    if (image) {
      const [name, version] = image.includes(":") ? [image.slice(0, image.lastIndexOf(":")), image.slice(image.lastIndexOf(":") + 1)] : [image, null];
      return { canonicalName: `oci:${name}`, version: cleanVersion(version), transport: "stdio" };
    }
  }
  if (cmd === "node" || cmd === "deno" || cmd === "bun" || cmd === "python" || cmd === "python3" || cmd === "sh" || cmd === "bash") return { canonicalName: null, version: null, transport: "stdio" };
  return { canonicalName: null, version: null, transport: command ? "stdio" : "unknown" };
}

/** Env hygiene only: which env values look like plaintext secrets. Values are inspected and discarded, never returned. */
export function envHygiene(entry: Record<string, unknown>, configPath: string): string[] {
  const out: string[] = [];
  const env = entry.env;
  if (env && typeof env === "object") {
    for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
      // a reference to a variable set elsewhere (${GITHUB_TOKEN}, $GITHUB_TOKEN) holds no secret in this file; and a match on
      // the name alone is a guess, so the line says what it looks like, not what it holds (pass 4 audit of 16 Oct 2026)
      if (typeof v !== "string" || !v || ENV_REFERENCE.test(v.trim())) continue;
      if (SECRET_KEY.test(k) || SECRET_VALUE.test(v)) out.push(`env ${k} looks like a plaintext secret in ${configPath}`);
    }
  }
  return out;
}

/**
 * One server entry in the common shape (decision 458): OpenCode and Kilo Code give the command and its arguments as one
 * array and the env under "environment"; Goose writes "cmd", "envs" and "uri". Nothing else is changed or kept.
 */
export function normalizeEntry(raw: Record<string, unknown>): Record<string, unknown> {
  const e: Record<string, unknown> = { ...raw };
  if (Array.isArray(e.command)) {
    const parts = (e.command as unknown[]).filter((x): x is string => typeof x === "string");
    e.command = parts[0];
    e.args = [...parts.slice(1), ...(Array.isArray(e.args) ? (e.args as unknown[]) : [])];
  }
  if (e.command === undefined && typeof e.cmd === "string") e.command = e.cmd;
  if (e.url === undefined && typeof e.uri === "string") e.url = e.uri;
  for (const k of ["environment", "envs"]) {
    const v = e[k];
    if (v && typeof v === "object" && !Array.isArray(v)) e.env = { ...((e.env as Record<string, unknown> | undefined) ?? {}), ...(v as Record<string, unknown>) };
  }
  return e;
}

function serverFromEntry(host: Host, name: string, raw: Record<string, unknown>, configPath: string): DiscoveredServer {
  const entry = normalizeEntry(raw);
  // Zed's older form nests the program and its arguments under "command": { "path": ..., "args": [...] }
  const nested = entry.command && typeof entry.command === "object" && !Array.isArray(entry.command) ? (entry.command as Record<string, unknown>) : null;
  const command = typeof entry.command === "string" ? entry.command : nested && typeof nested.path === "string" ? nested.path : undefined;
  const args = Array.isArray(entry.args) ? (entry.args as string[]) : nested && Array.isArray(nested.args) ? (nested.args as string[]) : [];
  const url = typeof entry.url === "string" ? entry.url : typeof entry.serverUrl === "string" ? entry.serverUrl : null;
  const inferred = inferPackage(command, args);
  let transport = inferred.transport;
  let remoteHost: string | null = null;
  if (url) {
    transport = typeof entry.type === "string" && /sse/i.test(entry.type) ? "sse" : "http";
    try {
      remoteHost = new URL(url).host;
    } catch {
      remoteHost = null;
    }
  }
  return { kind: "mcp", host, name, configPath, transport, canonicalName: inferred.canonicalName, version: inferred.version, remoteHost, hygiene: envHygiene(entry, configPath) };
}

/**
 * A Claude Code plugin's .mcp.json is a bare map of servers, with no mcpServers key around it (tools audit of 29 Sep
 * 2026, fix 2). A document counts as one only when it has none of the wrapper keys and every value is a server
 * definition: an object with a command, a url or a serverUrl. A settings file with any other top-level value is not.
 */
export function isBareServerMap(j: unknown): j is Record<string, Record<string, unknown>> {
  if (!j || typeof j !== "object" || Array.isArray(j)) return false;
  const o = j as Record<string, unknown>;
  if ("mcpServers" in o || "servers" in o || "context_servers" in o || "projects" in o) return false;
  const values = Object.values(o);
  return values.length > 0 && values.every((v) => v !== null && typeof v === "object" && !Array.isArray(v) && (typeof (v as Record<string, unknown>).command === "string" || typeof (v as Record<string, unknown>).url === "string" || typeof (v as Record<string, unknown>).serverUrl === "string"));
}

/**
 * The maps of servers in one parsed JSON config, each with the name prefix its servers get, for the shape its client
 * writes. The digest in instructions.ts hashes the same maps, so what is listed and what is locked never differ.
 */
export function serverMaps(doc: unknown, shape: JsonShape = "claude"): { prefix: string; map: Record<string, unknown>; projectPath?: string }[] {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
  const j = doc as Record<string, unknown>;
  const isMap = (m: unknown): m is Record<string, unknown> => !!m && typeof m === "object" && !Array.isArray(m);
  const out: { prefix: string; map: Record<string, unknown>; projectPath?: string }[] = [];
  const add = (m: unknown) => {
    if (isMap(m)) out.push({ prefix: "", map: m });
  };
  if (shape === "mcp-key") add(j.mcp);
  else if (shape === "amp") add(j["amp.mcpServers"]);
  else if (shape === "zcode") add(isMap(j.mcp) ? j.mcp.servers : undefined);
  else {
    if (isBareServerMap(j)) return [{ prefix: "", map: j }];
    add(j.mcpServers);
    // VS Code keeps them under "servers", Zed under "context_servers" (decision 143)
    add(j.servers);
    add(j.context_servers);
    // ~/.claude.json keeps per-project servers under projects.<path>.mcpServers
    if (isMap(j.projects)) for (const [path, p] of Object.entries(j.projects)) if (isMap(p) && isMap(p.mcpServers)) out.push({ prefix: "", map: p.mcpServers, projectPath: path });
  }
  return out;
}

export function parseClaudeJson(text: string, host: Host, configPath: string, namePrefix = "", shape: JsonShape = "claude"): DiscoveredServer[] {
  const out: DiscoveredServer[] = [];
  for (const { map } of serverMaps(parseJsonc(text), shape)) {
    for (const [name, entry] of Object.entries(map)) if (entry && typeof entry === "object" && !Array.isArray(entry)) out.push(serverFromEntry(host, namePrefix + name, entry as Record<string, unknown>, configPath));
  }
  return out;
}

/**
 * A small YAML reader for the two YAML configs the command reads (decision 458): Goose's config.yaml and Continue's
 * config.yaml and block files. It takes the block style both write (mappings, sequences, "- key: value" items), flow
 * lists and maps ([a, b], {}), quoted and plain scalars, comments and | or > text blocks. Anchors are dropped, an alias
 * reads as null, and true, false and null are the only words given a type; everything else stays a string. Anything
 * it does not understand is an error, reported for that file, never a guess. No dependency: the command has none.
 */
export function parseYaml(text: string): unknown {
  type Line = { indent: number; text: string; block?: string };
  const raw = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const lines: Line[] = [];
  const blank = (s: string) => /^\s*$/.test(s);
  const indentOf = (s: string) => s.length - s.trimStart().length;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]!;
    if (blank(r)) continue;
    const indent = indentOf(r);
    const t = stripYamlComment(r.trimStart());
    if (!t) continue;
    if (indent === 0 && (t === "---" || t === "..." || t.startsWith("%"))) continue;
    const line: Line = { indent, text: t };
    // a | or > text block: every following line indented further (or blank) belongs to it
    if (/(?::\s+|^-\s+)[|>][+-]?[0-9]?$/.test(t)) {
      const body: string[] = [];
      let j = i + 1;
      while (j < raw.length && (blank(raw[j]!) || indentOf(raw[j]!) > indent)) body.push(raw[j++]!);
      while (body.length && blank(body[body.length - 1]!)) body.pop();
      const min = Math.min(...body.filter((b) => !blank(b)).map(indentOf));
      const texts = body.map((b) => (blank(b) ? "" : b.slice(min)));
      line.block = /:\s+>|^-\s+>/.test(t) ? texts.join(" ").replace(/ {2,}/g, " ").trim() : texts.join("\n");
      i = j - 1;
    }
    lines.push(line);
  }
  let p = 0;
  const fail = (why: string): never => {
    throw new Error(`YAML not understood near "${(lines[p]?.text ?? "").slice(0, 40)}": ${why}`);
  };
  const isSeq = (t: string) => t === "-" || t.startsWith("- ");
  const keyOf = (t: string): { key: string; rest: string } | null => {
    if (t[0] === '"' || t[0] === "'") {
      const [k, end] = readQuoted(t, 0);
      let i = end;
      while (t[i] === " ") i++;
      if (t[i] !== ":" || !(i + 1 === t.length || /\s/.test(t[i + 1]!))) return null;
      return { key: k, rest: t.slice(i + 1).trim() };
    }
    if (/^[[{]/.test(t)) return null;
    const m = /^(.*?):(?:\s|$)/.exec(t);
    if (!m) return null;
    return { key: m[1]!.trim(), rest: t.slice(m[0].length).trim() };
  };
  // a flow value that opens on one line and closes on a later one is joined first
  const flowText = (first: string): string => {
    let s = first;
    const open = (x: string) => {
      let depth = 0;
      let q: string | null = null;
      for (let i = 0; i < x.length; i++) {
        const c = x[i]!;
        if (q) {
          if (c === "\\" && q === '"') i++;
          else if (c === q) q = null;
        } else if (c === '"' || c === "'") q = c;
        else if (c === "[" || c === "{") depth++;
        else if (c === "]" || c === "}") depth--;
      }
      return depth > 0;
    };
    while (open(s) && p < lines.length) s += " " + lines[p++]!.text;
    return s;
  };
  const value = (rest: string, line: Line, indent: number): unknown => {
    if (/^[|>]/.test(rest) && line.block !== undefined) return line.block;
    if (/^[[{]/.test(rest)) return parseFlow(flowText(rest));
    let s = rest;
    // a plain scalar carried on to more-indented lines is one value, folded with spaces
    if (!/^["']/.test(s)) while (p < lines.length && lines[p]!.indent > indent && !isSeq(lines[p]!.text) && !keyOf(lines[p]!.text)) s += " " + lines[p++]!.text;
    return yamlScalar(s);
  };
  const node = (): unknown => (isSeq(lines[p]!.text) ? seq(lines[p]!.indent) : map(lines[p]!.indent));
  const seq = (ind: number): unknown[] => {
    const out: unknown[] = [];
    while (p < lines.length && lines[p]!.indent === ind && isSeq(lines[p]!.text)) {
      const L = lines[p]!;
      const rest = L.text === "-" ? "" : L.text.slice(1).trimStart();
      if (!rest) {
        p++;
        out.push(p < lines.length && lines[p]!.indent > ind ? node() : null);
        continue;
      }
      if (isSeq(rest) || (keyOf(rest) && !/^[|>]/.test(rest))) {
        // "- key: value" opens a mapping (or "- - x" a list) at the column after the dash
        lines[p] = { indent: ind + (L.text.length - rest.length), text: rest, ...(L.block !== undefined ? { block: L.block } : {}) };
        out.push(node());
        continue;
      }
      p++;
      out.push(value(rest, L, ind));
    }
    return out;
  };
  const map = (ind: number): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    while (p < lines.length && lines[p]!.indent === ind && !isSeq(lines[p]!.text)) {
      const L = lines[p]!;
      const kv = keyOf(L.text);
      if (!kv) fail("expected key: value");
      p++;
      let v: unknown = null;
      if (kv!.rest === "") {
        const N = lines[p];
        if (N && N.indent > ind) v = node();
        else if (N && N.indent === ind && isSeq(N.text)) v = seq(ind);
      } else v = value(kv!.rest, L, ind);
      // "<<" merges an anchor this reader does not keep
      if (kv!.key !== "<<") out[kv!.key] = v;
    }
    return out;
  };
  if (!lines.length) return null;
  let doc: unknown;
  if (/^[[{]/.test(lines[0]!.text)) doc = parseFlow(flowText(lines[p++]!.text));
  else if (lines.length === 1 && !isSeq(lines[0]!.text) && !keyOf(lines[0]!.text)) doc = value(lines[p++]!.text, lines[0]!, -1);
  else doc = node();
  if (p < lines.length) fail("unexpected indentation");
  return doc;
}

/** A comment starts at a # that begins the line or follows a space, outside quotes. */
function stripYamlComment(s: string): string {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (q === '"' && c === "\\") i++;
      else if (c === q) {
        if (q === "'" && s[i + 1] === "'") i++;
        else q = null;
      }
      continue;
    }
    if ((c === '"' || c === "'") && (i === 0 || /[\s[{,:-]/.test(s[i - 1]!))) q = c;
    else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]!))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

/** A quoted YAML scalar starting at s[i]: its value and the index after the closing quote. */
function readQuoted(s: string, i: number): [string, number] {
  const q = s[i]!;
  let out = "";
  let j = i + 1;
  while (j < s.length) {
    const c = s[j]!;
    if (q === "'" && c === "'") {
      if (s[j + 1] === "'") {
        out += "'";
        j += 2;
        continue;
      }
      return [out, j + 1];
    }
    if (q === '"' && c === '"') return [out, j + 1];
    if (q === '"' && c === "\\") {
      const e = s[j + 1] ?? "";
      if (e === "u" && /^[0-9a-fA-F]{4}$/.test(s.slice(j + 2, j + 6))) {
        out += String.fromCharCode(parseInt(s.slice(j + 2, j + 6), 16));
        j += 6;
        continue;
      }
      out += ({ n: "\n", t: "\t", r: "\r", "0": "\0", '"': '"', "\\": "\\", "/": "/", " ": " " } as Record<string, string>)[e] ?? e;
      j += 2;
      continue;
    }
    out += c;
    j++;
  }
  throw new Error(`YAML not understood: unclosed quote in "${s.slice(i, i + 40)}"`);
}

function yamlScalar(s: string): unknown {
  let t = s.trim();
  // an anchor (&name) or a tag (!!str) before the value says nothing about it here
  t = t.replace(/^(?:&\S+\s+|!!?\S*\s+)+/, "");
  if (/^&\S+$/.test(t)) return null;
  if (t.startsWith("*")) return null;
  if (t[0] === '"' || t[0] === "'") {
    const [v, end] = readQuoted(t, 0);
    if (t.slice(end).trim()) throw new Error(`YAML not understood: text after a quoted value in "${t.slice(0, 40)}"`);
    return v;
  }
  if (t === "" || t === "~" || t === "null" || t === "Null" || t === "NULL") return null;
  if (/^(?:true|True|TRUE)$/.test(t)) return true;
  if (/^(?:false|False|FALSE)$/.test(t)) return false;
  return t;
}

function parseFlow(s: string): unknown {
  let i = 0;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i]!)) i++;
  };
  const bad = (): never => {
    throw new Error(`YAML not understood: flow value "${s.slice(0, 60)}"`);
  };
  const plain = (stops: RegExp) => {
    const start = i;
    while (i < s.length && !stops.test(s[i]!)) i++;
    return s.slice(start, i);
  };
  const val = (): unknown => {
    ws();
    const c = s[i];
    if (c === "[") {
      i++;
      const a: unknown[] = [];
      ws();
      if (s[i] === "]") {
        i++;
        return a;
      }
      for (;;) {
        a.push(val());
        ws();
        if (s[i] === ",") {
          i++;
          ws();
          if (s[i] === "]") {
            i++;
            return a;
          }
          continue;
        }
        if (s[i] === "]") {
          i++;
          return a;
        }
        return bad();
      }
    }
    if (c === "{") {
      i++;
      const o: Record<string, unknown> = {};
      ws();
      if (s[i] === "}") {
        i++;
        return o;
      }
      for (;;) {
        ws();
        let k: string;
        if (s[i] === '"' || s[i] === "'") {
          const [q, end] = readQuoted(s, i);
          k = q;
          i = end;
        } else k = plain(/[,}:]/).trim();
        ws();
        let v: unknown = null;
        if (s[i] === ":") {
          i++;
          v = val();
        }
        o[k] = v;
        ws();
        if (s[i] === ",") {
          i++;
          ws();
          if (s[i] === "}") {
            i++;
            return o;
          }
          continue;
        }
        if (s[i] === "}") {
          i++;
          return o;
        }
        return bad();
      }
    }
    if (c === '"' || c === "'") {
      const [q, end] = readQuoted(s, i);
      i = end;
      return q;
    }
    if (c === undefined) return bad();
    return yamlScalar(plain(/[,\]}]/));
  };
  const out = val();
  ws();
  if (i < s.length) bad();
  return out;
}

const isPlainMap = (m: unknown): m is Record<string, unknown> => !!m && typeof m === "object" && !Array.isArray(m);

/**
 * Goose's config.yaml (decision 458): servers are the entries under "extensions" that start a program (cmd) or name a
 * URL (uri). Builtin and platform extensions are part of Goose itself and have neither, so they are not listed.
 */
export function parseGooseYaml(text: string, configPath: string): DiscoveredServer[] {
  const doc = parseYaml(text);
  if (!isPlainMap(doc) || !isPlainMap(doc.extensions)) return [];
  const out: DiscoveredServer[] = [];
  for (const [name, e] of Object.entries(doc.extensions)) {
    if (!isPlainMap(e)) continue;
    const n = normalizeEntry(e);
    if (typeof n.command !== "string" && typeof n.url !== "string") continue;
    out.push(serverFromEntry("goose", name, e, configPath));
  }
  return out;
}

/**
 * Continue's config.yaml and its block files in .continue/mcpServers/ (decision 458): "mcpServers" is a list of
 * entries, each with its own name. An entry with neither a command nor a URL (a hub reference) names no program here.
 */
export function parseContinueYaml(text: string, configPath: string): DiscoveredServer[] {
  const doc = parseYaml(text);
  if (!isPlainMap(doc)) return [];
  const list = doc.mcpServers;
  const out: DiscoveredServer[] = [];
  const entries: [string, unknown][] = Array.isArray(list) ? list.map((e, i) => [isPlainMap(e) && typeof e.name === "string" ? e.name : String(i), e]) : isPlainMap(list) ? Object.entries(list) : [];
  for (const [name, e] of entries) {
    if (!isPlainMap(e) || (typeof e.command !== "string" && typeof e.url !== "string")) continue;
    out.push(serverFromEntry("continue", name, e, configPath));
  }
  return out;
}

/** Minimal TOML for Codex: [mcp_servers.<name>] tables with command, args, url. */
export function parseCodexToml(text: string, configPath: string): DiscoveredServer[] {
  const out: DiscoveredServer[] = [];
  let current: { name: string; entry: Record<string, unknown> } | null = null;
  let inEnv = false;
  const flush = () => {
    if (current) out.push(serverFromEntry("codex", current.name, current.entry, configPath));
    current = null;
    inEnv = false;
  };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const table = /^\[mcp_servers\.("?)([^"\]]+?)\1(\.env)?\]$/.exec(line);
    if (table) {
      if (table[3]) {
        // [mcp_servers.<name>.env]: values stay local, only their presence is judged
        if (current?.name === table[2]) inEnv = true;
      } else {
        flush();
        current = { name: table[2]!, entry: {} };
      }
      continue;
    }
    if (/^\[/.test(line)) {
      flush();
      continue;
    }
    if (!current) continue;
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const [, k, v] = kv;
    const value: unknown = v!.startsWith("[") ? [...v!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!) : v!.startsWith('"') ? v!.slice(1, v!.lastIndexOf('"')) : v;
    if (inEnv) {
      const env = (current.entry.env as Record<string, unknown> | undefined) ?? {};
      env[k!] = value;
      current.entry.env = env;
    } else current.entry[k!] = value;
  }
  flush();
  return out;
}


export interface UploadItem {
  kind: "mcp" | "agent-skill";
  host: Host;
  name: string;
  canonicalName: string | null;
  version: string | null;
  transport?: string;
  remoteHost?: string | null;
  skillMdSha256?: string;
  /** One hash over every file of the skill (path and hash, sorted), so a helper script rewritten under an unchanged SKILL.md still shows. */
  treeSha256?: string;
  files?: { path: string; sha256: string }[];
}

/** Pure: sha256 over "path sha256" lines in path order. Same input, same hash, on any machine. */
export function treeHash(files: readonly { path: string; sha256: string }[], sha256: (s: string) => string): string {
  return sha256(
    [...files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((f) => `${f.path} ${f.sha256}`)
      .join("\n"),
  );
}

export function toUpload(items: readonly Discovered[], sha256?: (s: string) => string): UploadItem[] {
  return items.map((it) =>
    it.kind === "mcp"
      ? { kind: "mcp", host: it.host, name: it.name, canonicalName: it.canonicalName, version: it.version, transport: it.transport, remoteHost: it.remoteHost }
      : // the file list stays on this machine: the server gets the SKILL.md hash and one hash over the whole tree, never the list
        { kind: "agent-skill", host: it.host, name: it.name, canonicalName: null, version: null, skillMdSha256: it.skillMdSha256, ...(sha256 ? { treeSha256: treeHash(it.files, sha256) } : {}) },
  );
}
