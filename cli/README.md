# smallprint

The thin, open client for [Small Print](https://smallprint.dev): find the MCP servers and agent skills your agents have installed, see what the advisory databases have on record for them, and get a grade with the rule printed next to it.

```
npx smallprint@0.1.6 check --no-upload   # see what your agents installed; with this flag alone, nothing is sent
npx smallprint check            # discover and print; asks before it sends anything, then grades; then one question: watch these every morning?
npx smallprint check --upload   # answer the send question up front (a script or CI has no terminal to ask in, so without it nothing is sent)
npx smallprint check --email you@company.com   # answer it up front; --no-signup never asks
npx smallprint check --share    # also get a card link you can post
npx smallprint check --json     # machine-readable inventory, nothing sent; says so in itself (about, sent) and names its fields at https://smallprint.dev/cli#json
npx smallprint@0.1.6 check        # pinned: npx then never fetches a version you have not read; pin it in anything unattended
npx smallprint check --live          # ask your hosted servers what they serve now, and compare with the record for their version
npx smallprint check --live-local    # the same for local servers too; shows the commands it will start and asks first, and never calls a tool; it starts them with the keys in your config, so keep production credentials out of that config
npx smallprint show npm/mcp-remote   # the record for one entry: baseline, tools read, advisories, last releases
npx smallprint show npm/@modelcontextprotocol/server-filesystem   # a real one: the reference filesystem server's 2026.7.10 release changed what one tool tells the agent (read_media_file now returns any file, not only images and audio); the record grades it medium
npx smallprint check --locked --sarif smallprint.sarif   # the lock check, plus a SARIF log for a code-scanning upload

SMALLPRINT_TOKEN=sp_... npx smallprint sync --label "work laptop"   # pin what you run to your daily brief
npx smallprint sync --label "work laptop" --dry-run                 # show what would be pinned
npx smallprint sync --label "work laptop" --prune                   # drop pins this machine no longer has
SMALLPRINT_TOKEN=sp_... npx smallprint schedule --install --label "work laptop"   # the sync every 6 hours, off-machine record of instruction files
```

Inside Claude Code, the same check is a plugin: `claude plugin marketplace add gostanos/smallprint-action`, then `claude plugin install smallprint@smallprint`, and `/smallprint:check` runs it with nothing sent. The plugin also bundles Small Print's MCP server, so Claude can read the record itself.

In VS Code or Cursor, the Small Print extension (`smallprint.smallprint-vscode`, on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=smallprint.smallprint-vscode) and [Open VSX](https://open-vsx.org/extension/smallprint/smallprint-vscode)) watches the same instruction files and skills in the editor, and after you allow it, looks up your MCP servers in the record by package name.

New to MCP servers and agent skills? https://smallprint.dev/guide is a step-by-step guide in plain words, and https://smallprint.dev/learn explains the basics in three levels, from what a terminal is to how to tell when an MCP server changes, with every fact linked to an official source.

Small Print is not only a lookup: pin what you run and it emails you the morning a change to any of it is graded high or critical, or a high or critical advisory names it, with the change and its grade. Choose everything in settings to hear about every change. Free keeps 25 pins, that daily brief, and the off-machine record of your instruction files from each sync you run yourself; Pro adds the scheduled sync on every machine, which keeps that record current without you (prices at https://smallprint.dev/pricing). Signing up is the question at the end of `check`: type your email, the account is created, everything found is pinned, and one emailed link turns the daily brief on. Your email is the account and the link is the login; no password. A token (from your settings page) is only needed to pin a second machine with `sync`. Every account starts with 30 days of Pro, no credit card required. After that, Free keeps 25 pins and the instruction file record from a sync you run by hand; the scheduled runs are Pro. The full guide with sample output is at https://smallprint.dev/cli.

What leaves your machine: server names, versions, hosts, file hashes of skills (the SKILL.md hash and one hash over all files), and with `sync` a kind label, a hash of the path (made with a random key created on your computer and never sent, `~/.config/smallprint/salt`) and a hash of the contents for each instruction file, CLAUDE.md imports included, the machine label (this computer's name unless you give `--label`), and the names of any agent firewalls present on the machine. Those names are kept under a keyed hash of the account and machine label, not under the account, so nobody reading the count can tell whose machine a row is; Small Print holds the key. `lock`, `gate` and `check --live` look entries up on the record by registry name (and `--live` by version or host). What never leaves: paths, config values, environment variables, tokens, file contents. Plaintext secrets and world-readable config files are reported locally only. With `--no-upload` nothing is sent; combined with `--live` it compares nothing, because the live check has to ask smallprint.dev. An address on your own machine or a private network is never sent in any mode.

Looks in: Claude Desktop, Claude Code (global, project, skills), Cursor, Windsurf, Codex, VS Code, Zed, Gemini CLI, Cline, Roo (the project's `.roo/mcp.json`), and the OpenClaw, Hermes and harnOS skill folders. The full list of files is at https://smallprint.dev/cli.

`check` also hashes your instruction files (CLAUDE.md and what it imports, including a bare `@docs/notes.md` path when that file exists, AGENTS.md, an OpenClaw workspace's TOOLS.md and SOUL.md, Cursor, Windsurf, Copilot, Gemini, Cline and Roo rules, Claude agents, commands and settings with hooks, installed Claude Code plugins, and the server definitions in your MCP configs, VS Code, Cline and Roo included, with env values hashed) and compares them with the last run on the same machine: first seen, unchanged since a date, changed, or removed. A prompt injection that rewrites one of these persists into every later run; this is the line that says so. For settings files the line names the section that changed (`in: permissions` is an always-allow click, `in: hooks` is worth reading). Five ways to keep that record, your choice:

- `check`: the record is a file on your machine and nothing is sent. An agent that can write files can change the record as well as the files. Fine for a look; not a defence.
- `sync`: the record lives on smallprint.dev as a hash of each path, a kind label and the content hash, and keeps every change as an event. An agent can push a new hash; it cannot erase that the hash changed. Seen the next time you run sync.
- a hook instead of a job: keep the token in `~/.config/smallprint/token` (chmod 600; sync finds it there) and run `npx -y smallprint sync --yes --quiet --label "work laptop"` from a Claude Code `SessionStart` hook, a git `post-checkout` hook, or your shell profile. Recipes at https://smallprint.dev/cli#hooks.
- `sudo --preserve-env=PATH,SMALLPRINT_TOKEN smallprint schedule --install --system`: level four. A root-owned job runs a short standard-library Python helper (`report/smallprint-report.py` in this package) with the system interpreter, with a root-owned token, so an agent running as you cannot read the token or forge a report, and if the job stops reporting, your brief says the machine went quiet. Refuses to install if the interpreter or destination is writable by anyone but root. Details at https://smallprint.dev/cli#system.
- `schedule --install`: installs a job on this machine that runs sync every six hours (launchd on macOS, systemd on Linux, a printed Task Scheduler command on Windows). You install it, `--uninstall` removes it, and a machine that goes quiet is reported in your brief. Nothing else ever installs it.

MIT. Everything clever lives on the server.

## Lock the small print, and fail the build when it changes

```
npx smallprint lock             # writes smallprint.lock: what this machine runs, and its instruction-file hashes
npx smallprint check --locked   # compares with the lock; exit 2 when anything changed. Local only, works offline
```

The lock holds the name, version and hashes of each server and skill, with the agent it was found in and, for a remote server, its host, and the paths and hashes of instruction files, never a configuration value. For a server with a registry identity and a version it also carries the record's digest of that version's tool names, descriptions and input schemas, fetched when the lock is written (`--offline` skips it), and `smallprint gate` says when the record's digest for that version has changed since. Commit it; `check --locked` then says exactly what changed, on a laptop or in CI. The GitHub Action, [gostanos/smallprint-action](https://github.com/gostanos/smallprint-action), runs that one command.

### As a pre-commit hook

With [pre-commit](https://pre-commit.com), the same check runs before every commit. Add this to `.pre-commit-config.yaml` in the repository that holds the lock:

```yaml
repos:
  - repo: https://github.com/gostanos/smallprint-action
    rev: v1.8
    hooks:
      - id: smallprint-locked   # runs smallprint check --locked; the commit stops when anything differs from the lock
      - id: smallprint-lock     # only when you ask: pre-commit run smallprint-lock --hook-stage manual
```

The hooks run the pinned version of this package with `npx`, so the machine needs Node 20 or later. `smallprint-locked` compares this repository with the lock on your machine and sends nothing. `smallprint-lock` writes the lock with `--project`, and like `smallprint lock` it asks the record for each server's digest by registry name; add `args: [--offline]` under it to skip that. pre-commit reports `smallprint-lock` as failed whenever it rewrote the file, which is how pre-commit shows that a hook changed a file, so read the change and commit it.

## Before a session: ask the record

```sh
npx smallprint gate --project   # exit 2 when a server's small print changed on the record since the lock, 3 when a high advisory covers the version here
npx smallprint gate && claude    # as a launcher line or a shell hook
```

The lock says whether this machine changed. The gate asks the record: for every server here with a registry identity, has its small print changed since the version in the lock, and does a high or critical advisory's version range cover the version installed here. An advisory whose range cannot be read, or a server whose version is not known, is printed as range unknown. One request per server, carrying the registry name and nothing else. An entry the record has not read is reported as unknown and only fails the gate with `--strict`.

It reads the same MCP configurations as `check`, listed above.

## Reading the record without the CLI

Every trust page is also JSON: `GET /api/asset/npm/@modelcontextprotocol/server-filesystem`. Every advisory too: `GET /api/advisory/CVE-2025-6514`. One exact version has a receipt, the digest of its tool names, descriptions and input schemas plus the signed chain row that covers it: `GET /api/receipt/npm/mcp-remote/0.14.3`. The words inside every entry's tool text: `GET /api/search?q=webhook`. One item per request, rate limited, same attribution and printed criteria as the pages.

Inside an agent instead of a terminal: the MCP server `smallprint-mcp` (`npx -y smallprint-mcp`, registry name `dev.smallprint/smallprint`) reads the same record with four tools: lookup_entry, changed_since_approval, changes_since, advisories_for.

## Source

The source that npm's package is built from can be read with its tests at https://github.com/gostanos/smallprint-action/tree/main/cli, and an issue can be opened there. That is the program, not anything it finds: what the command reads on your machine stays on your machine. npm installs about 125 KB of unminified JavaScript plus a 23 KB Python helper; everything clever lives on the server. What the record can and cannot see is written at https://smallprint.dev/faq.
