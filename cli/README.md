# smallprint

The thin, open client for [Small Print](https://smallprint.dev): find the MCP servers and agent skills your agents have installed, see the advisories on record for them, and get a grade with the rule printed next to it.

```
npx smallprint@1.6.0 check --no-upload   # see what your agents installed; with this flag alone, nothing is sent
npx smallprint check            # discover and print; asks before it sends anything, then grades; then one question: watch these in the daily brief?
npx smallprint check --upload   # answer the send question up front (a script or CI has no terminal to ask in, so without it nothing is sent)
npx smallprint check --email you@company.com   # answer it up front; --no-signup never asks
npx smallprint check --share    # also get a card link you can post
npx smallprint check --json     # machine-readable inventory, nothing sent; says so in itself (about, sent) and names its fields at https://smallprint.dev/cli#json
npx smallprint@1.6.0 check        # pinned to one exact version; pin it in anything unattended
npx smallprint check --live          # ask your hosted servers what they serve now, and compare with the record for their version
npx smallprint check --live-local    # the same for local servers too; shows the commands it will start and asks first, and never calls a tool; it starts them with the keys in your config, so keep production credentials out of that config
npx smallprint show npm/mcp-remote   # the record for one entry: baseline, how it was read, advisories, last releases
npx smallprint show npm/@modelcontextprotocol/server-filesystem   # a real one: the reference filesystem server's 2026.7.10 release changed what one tool tells the agent (read_media_file now returns any file, not only images and audio); the record grades it medium
npx smallprint check --locked --sarif smallprint.sarif   # the lock check, plus a SARIF log for a code-scanning upload
npx smallprint@1.6.0 version --check   # is a newer version published? one request to npm and nothing else; plain --version asks nothing
npx smallprint watch -- npx -y @modelcontextprotocol/server-filesystem ~/projects   # run a server through a watcher that warns when its tools change and never stops a call
npx smallprint scan-chats            # look for keys and passwords in your agents' conversation logs on this machine; asks first, sends nothing
ANTHROPIC_API_KEY=... npx smallprint cost --local   # what each MCP server's tool definitions cost a model on every request, counted with your own key; nothing goes to smallprint.dev

SMALLPRINT_TOKEN=sp_... npx smallprint sync --label "work laptop"   # pin what you run to your daily brief
npx smallprint sync --label "work laptop" --dry-run                 # show what would be pinned
npx smallprint sync --label "work laptop" --prune                   # drop pins this machine no longer has
SMALLPRINT_TOKEN=sp_... npx smallprint schedule --install --label "work laptop"   # the sync every 6 hours, off-machine record of instruction files
```

`npx smallprint check --html` runs the same check and also writes what it found as one page, `smallprint-report.html` in the current folder, or the file you name after the flag. The page lists each agent app with its servers and skills, what the record says about each one, how each compares with your `smallprint.lock` when there is one, and the instruction-file lines the check flags, each with its rule. It loads nothing from the internet when you open it. With `--no-upload` nothing is sent, so the page has no grades and shows what was found and the lock column.

Inside Claude Code, the same check is a plugin: `claude plugin marketplace add gostanos/smallprint-action`, then `claude plugin install smallprint@smallprint`, and `/smallprint:check` runs it with nothing sent. The plugin also bundles Small Print's MCP server, so Claude can read the record itself.

In VS Code or Cursor, the Small Print extension (`smallprint.smallprint-vscode`, on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=smallprint.smallprint-vscode) and [Open VSX](https://open-vsx.org/extension/smallprint/smallprint-vscode)) watches the same instruction files and skills in the editor, and after you allow it, looks up your MCP servers in the record by package name.

New to MCP servers and agent skills? https://smallprint.dev/guide is a step-by-step guide in plain words, and https://smallprint.dev/learn explains the basics in three levels, from what a terminal is to how to tell when an MCP server changes.

Small Print is not only a lookup: pin what you run and it emails you in the next daily brief after a change to any of it is graded high or critical, or a high or critical advisory names it, with the change and its grade. Choose everything in settings to hear about every change. Signing up is the question at the end of `check`: type your email, and a new account gets what was found pinned; the emailed link opens a page where one button turns the daily brief on. An account needs only an email address, and the emailed link is the login. `sync` needs a token from your settings page. New accounts get 30 days of Pro, no credit card required. What each plan includes, and the prices, are at https://smallprint.dev/pricing. The full guide with sample output is at https://smallprint.dev/cli.

What leaves your machine, in short: `check` sends the names, versions and hosts of the servers and skills it found and hashes of skill files; `sync` adds, for each instruction file, a kind label and hashes of its path and contents, and for a JSON file the name of each top-level part with a hash of it, plus the machine label and the names of any agent firewalls present. Plaintext secrets and world-readable config files are reported on your machine only. With `--no-upload` nothing is sent; combined with `--live` it compares nothing, because the live check has to ask smallprint.dev. What each command sends, and when, is listed on the privacy page: https://smallprint.dev/legal/privacy.

Looks in: Claude Desktop, Claude Code (global, project, skills, installed plugins, plugins synced from the Claude directory), Cursor, Windsurf, Codex (including installed plugins), GitHub Copilot CLI plugins, VS Code, Visual Studio, Zed, Gemini CLI, Qwen Code, Cline, Roo, Kilo Code, Kiro, OpenCode, Crush, Amp, Continue, Goose, LM Studio, Junie, Trae, Augment (the Auggie command line), Warp, ZCode, the OpenClaw, Hermes and harnOS skill folders, the `.agents/skills` folders in your home folder and in the project, and a repository's own `skills/` folder at its root. The full list of files is at https://smallprint.dev/cli.

Claude Code mods, plugins whose code runs inside Claude Code, are listed with what their code can do (for example "can change the tool descriptions Claude reads" or "can use the network"), and a change to a mod's code, or an ability it did not have at the last run, is reported. The code files a mod names, and the files inside the plugin those import by a written path, are read, up to a limit. See https://smallprint.dev/cli#mods.

`check` also hashes your instruction files (CLAUDE.md and what it imports, including a bare `@docs/notes.md` path when that file exists, AGENTS.md, an OpenClaw workspace's TOOLS.md and SOUL.md, Cursor, Windsurf, Copilot, Gemini, Cline, Roo, Continue and Aider rules, the text files in a project's Kiro, Amp, OpenCode, Antigravity, Devin, Cline and Codex folders, Claude agents, commands and settings with hooks, installed Claude Code plugins, and the server definitions in the MCP configs of every client listed above, with env values hashed; a rules, commands or agents folder is read four levels down, and a skills folder's groups one level down) and compares them with the last run on the same machine: first seen, unchanged since a date, changed, or removed. A prompt injection that rewrites one of these persists into every later run; this is the line that says so. For settings files the line names the section that changed (`in: permissions` is an always-allow click, `in: hooks` is worth reading). Five ways to keep that record, your choice:

- `check`: the record is a file on your machine and nothing is sent. An agent that can write files can change the record as well as the files. Fine for a look; not a defence.
- `sync`: the record lives on smallprint.dev and keeps every change as an event. An agent can push a new hash; it cannot erase that the hash changed. Seen the next time you run sync.
- a hook instead of a job: keep the token in `~/.config/smallprint/token` (chmod 600; sync finds it there) and run `npx -y smallprint sync --yes --quiet --label "work laptop"` from a Claude Code `SessionStart` hook, a git `post-checkout` hook, or your shell profile. Recipes at https://smallprint.dev/cli#hooks.
- `sudo --preserve-env=PATH,SMALLPRINT_TOKEN smallprint schedule --install --system`: level four. A root-owned job runs a short standard-library Python helper (`report/smallprint-report.py` in this package) with the system interpreter and its own root-owned copy of your token. It reports the account's instruction files and skills in the same form as `sync`; it does not pin MCP servers to the brief or send firewall names, which `sync` from your own account does, and if the job stops reporting, your brief says the machine went quiet. Refuses to install if the interpreter or destination is writable by anyone but root. Details at https://smallprint.dev/cli#system.
- `schedule --install`: installs a job on this machine that runs sync every six hours (launchd on macOS, systemd on Linux, a printed Task Scheduler command on Windows). You install it, `--uninstall` removes it, and a machine that goes quiet is reported in your brief. Nothing else ever installs it.

When a Markdown or text instruction file changes, `check` also shows the lines that were added, with the line number, and grades each one with the rules the record uses for published tool text (https://smallprint.dev/how-we-grade). The rules on taking data out, on overrides and on hidden text grade high, and the rules on an unconfirmed action ("without asking" and the like) and on a sensitive destination grade medium. A line such as "Do NOT mention the internal booking_reference to the customer." is printed with `high: contains words this rule looks for, such as "do not tell" or "ignore previous instructions" (the override rule)`, and under every graded line the command prints "If you did not add this line, find out what did before your agent runs again." Your own edits will match sometimes, so a grade is a reason to look, not a verdict. Up to 20 added lines are shown for each file, each clipped to 200 characters, and removed lines are counted. A character that does not show on screen is printed as its code point, such as `<U+200B>`. To do this, the state file keeps a hash of each line, made with the key in `~/.config/smallprint/salt` (`check` writes it if it is not there yet), and never the text; nothing about the lines is sent. A file with more than 5,000 distinct lines is remembered by its hash alone, and the command says its added lines cannot be shown. The first time the command reads a file, it records the lines and reads them once for the high rules only, on hidden text, taking data out and overrides; a line that matches is shown under "First look" with "This line was already in the file the first time the command read it. If you did not write it, find out where it came from before your agent runs again." Nothing else is graded on a first read. Settings files, MCP configs and scripts are not shown line by line, because their lines can hold keys. `--no-instruction-text` prints the one line per file instead, with no text from the file, for a terminal or a CI log that should not hold it.

MIT. The record and everything it reads live on the server. The command carries one copy of the grading rules, so it can grade a line added to an instruction file without sending the line anywhere.

## What 1.0 holds stable

From 1.0.0, these do not change without a new major version: the commands `check`, `show`, `sync`, `schedule`, `lock` and `gate` and their flags; the shape of `check --json` and of the SARIF log; the lock file written by `lock` and read by `check --locked`; what leaves your machine, as described above; and the four tools of the MCP server, their names and their inputs. A flag or a field can be added in a minor version; nothing listed here is removed or renamed in one.

What can change in any version: the grading rules, since a grade describes the text and the rules are printed at https://smallprint.dev/how-we-grade; which sources the record reads; and the wording of messages.

## Lock the small print, and fail the build when it changes

```
npx smallprint lock             # writes smallprint.lock: what this machine runs, and its instruction-file hashes
npx smallprint check --locked   # compares with the lock; exit 2 when anything changed. Local only, works offline
```

The lock holds the name, version and hashes of each server and skill, with the agent it was found in and, for a remote server, its host, and the paths and hashes of instruction files, never a configuration value. It also lists the kinds of file the command that wrote it knew how to read, so when a later version learns a new location, a file found there is reported as not covered by the lock rather than as new, and a build gated on an older lock does not fail on the day the command updates. For a server with a registry identity and a version it also carries the record's digest of that version's tool names, descriptions and input schemas when the record's answer lists one, fetched when the lock is written (`--offline` skips it), and `smallprint gate` says when the record's digest for that version has changed since. Commit it; `check --locked` then says exactly what changed, on a laptop or in CI. When an instruction file changed from the lock, it also shows the lines added since the lock and their grades, so a pull request that adds a hiding sentence to CLAUDE.md shows the sentence and its grade in the build log; the exit code stays the same, and `--no-instruction-text` leaves the lines out. For this the lock keeps a hash of each line of a text instruction file: a plain hash for a file in the project, so a CI runner can compare it, and for a file in your home folder a hash made with your machine's key, which no other machine can compare. A lock written by an earlier version has no line hashes, so run `smallprint lock` again to keep them. The GitHub Action, [gostanos/smallprint-action](https://github.com/gostanos/smallprint-action), runs that one command.

### As a pre-commit hook

With [pre-commit](https://pre-commit.com), the same check runs before every commit. Add this to `.pre-commit-config.yaml` in the repository that holds the lock:

```yaml
repos:
  - repo: https://github.com/gostanos/smallprint-action
    rev: v1.19
    hooks:
      - id: smallprint-locked   # runs smallprint check --locked; the commit stops when anything differs from the lock
      - id: smallprint-lock     # only when you ask: pre-commit run smallprint-lock --hook-stage manual
```

The hooks run the pinned version of this package with `npx`, so the machine needs Node 20 or later. `smallprint-locked` compares this repository with the lock on your machine and sends nothing. `smallprint-lock` writes the lock with `--project`, and like `smallprint lock` it asks the record for each server's digest by registry name; add `args: [--offline]` under it to skip that. pre-commit reports `smallprint-lock` as failed whenever it rewrote the file, which is how pre-commit shows that a hook changed a file, so read the change and commit it. The `rev` above, the Action's tag and the command it runs are released together, so a lock written by any one of the three is accepted by the other two. A lock also says which kinds of file it covers, so a newer command that watches one more client names the file it found and does not fail on it.

## Before a session: ask the record

```sh
npx smallprint gate --project   # exit 3 when a high or critical advisory covers a version here; otherwise 2 when a change to a server's small print is on record between the lock and the pinned version
npx smallprint gate && claude    # as a launcher line or a shell hook
```

The lock says whether this machine changed. The gate asks the record: for every server here with a registry identity, is a change to its small print on record between the version in the lock and the pinned version (the newest on record when the config pins none), and does a high or critical advisory's version range cover the version installed here. A release counts as a change only when it holds a change to the text; a different fingerprint alone does not. A server pinned to the version in its lock passes however many releases came after it; those are printed as news. An advisory whose range cannot be read, or a server whose version is not known, is printed as range unknown. A version with no tool text on record, or two versions the record has not compared, is reported as unknown, never as unchanged, and fails the gate only with `--strict`. Exit 3 means an advisory covers a version here, whatever else is true; exit 2 means a change to the small print is on record, or with `--strict` that something could not be answered. One request per server, carrying the registry name.

It reads the same MCP configurations as `check`, listed above.

## Watch a server while it runs

```
npx smallprint watch -- <the server's command> [its arguments]
```

`smallprint watch` starts a local MCP server for your agent and passes every message between them through unchanged, in both directions. It watches and warns; it never stops, changes or adds a message. While it runs, it reads the server's answers to `tools/list` and notes when the server says its tool list changed. It compares each tool's name, description and input schema with the last list it saw from the same server command, and, when your `smallprint.lock` holds the record's fingerprint for the version that is running, with that fingerprint. When something differs, it writes one line to the server's log in your MCP client and adds a line for each change to `~/.config/smallprint/watch/changes.jsonl`. It also shows a notification on your desktop with the server's name and how many changes it found, on macOS, and on Linux when `notify-send` is installed; Windows gets no notification. `--no-notify` leaves the notification out. The next `smallprint check` prints the changes: a tool added or removed, a new description (shown before and after, because the description is what your agent reads), or a new input schema. If the watching part fails, it says so in one line and every message keeps passing through. The watcher itself sits between your client and the server, so if the watch process stops, the connection to that server ends, as it would if the server stopped.

It keeps the last tool list it saw from each server (names, descriptions and fingerprints) and the log of changes. It never keeps or prints what a call sends or what it gets back, the server's arguments or its environment values, and it sends nothing anywhere.

What it does not do: it does not look at what a tool does when it runs, at a server's prompts or resources, or at anything other than the tool list, and it does not stop or approve anything. A difference it reports is a fact about the text, not a judgment of the server. It is not a firewall or a security control, and like the rest of the command it comes with no warranty (see LICENSE).

To use it, put `npx -y smallprint watch --` in front of the server's command in your MCP config. In Claude Code (`.mcp.json` in the project, or `~/.claude.json`) and in Cursor (`~/.cursor/mcp.json`, or `.cursor/mcp.json` in the project) the entry looks the same:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "smallprint", "watch", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/Users/you/projects"]
    }
  }
}
```

Pin the version (`smallprint@<version>`) once you have read it, as with any `npx` line. `check`, `lock` and `gate` read a wrapped entry as the server inside it, so wrapping a server does not change how it is listed or graded. `--file <path>` names a lock other than `smallprint.lock` in the folder the server starts in.

## Count what your MCP servers' tools cost

```
ANTHROPIC_API_KEY=... npx smallprint cost            # hosted servers only
ANTHROPIC_API_KEY=... npx smallprint cost --local    # local servers too; shows the commands it will start and asks first
npx smallprint cost --json                           # the same counts for a script
```

Every request your agent sends to a model carries each connected tool's name, description and input schema. `smallprint cost` asks each server for its tools the way `check --live` does, sends those definitions to Anthropic's token counter with your own key (Anthropic does not charge for counting), and prints each server's tokens and what they cost on one request on Claude Haiku 5.5, Sonnet 5.5, Opus 5.5 and Fable 5.1, without caching. The count leaves out the one-word message it sends and the fixed instructions Anthropic adds for any request with tools, so it is the definitions alone. It sends nothing to smallprint.dev. When the total is over 100,000 tokens it says so, because Haiku 5.5 then charges its higher price for the whole prompt. How the numbers come out across the 50 most-downloaded MCP servers on npm: https://smallprint.dev/blog/what-mcp-servers-cost

## Look for keys and passwords in your agents' conversation logs

```
npx smallprint scan-chats            # asks first, then reads and prints what it found, masked
npx smallprint scan-chats --json     # the same findings for a script
```

`smallprint scan-chats` runs only when you type it; `check`, `sync`, `lock`, `schedule` and every other command never do. Unless you add `--yes`, it first asks this question: "This reads your agents' conversation logs on this machine to look for keys and passwords. Nothing is sent. Continue? [y/N]" It reads the logs each agent keeps on this machine, in these places: Claude Code's `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`), Codex's `~/.codex/sessions` and `~/.codex/history.jsonl` (or the same under `$CODEX_HOME`), and Gemini CLI's `~/.gemini/tmp/<project>/chats`. It lists each place with the number of files it read there.

It looks for AWS access key IDs and secret keys, GitHub, OpenAI, Anthropic, Stripe and Slack tokens, private key blocks, passwords inside an address such as `postgres://user:password@host`, and assignments such as `DB_PASSWORD=...`. Values that look like examples, placeholders or code such as `password=args.password` are left out, so a real secret written in one of those forms can be missed, and a match is not always a real secret. A key in a form not listed here is not looked for. For each finding it prints the file, the line number, the kind of key and at most its first four characters. It never prints or writes a whole value, it does not change or delete any log, and it sends nothing. The command cannot tell whether a match is a real key or whether it has been used. Text in these logs may have been sent to an AI model during a conversation, so if one of them is a real key or password, consider replacing it where it was issued.

## Reading the record without the CLI

Every trust page is also JSON: `GET /api/asset/npm/@modelcontextprotocol/server-filesystem`. Every advisory too: `GET /api/advisory/CVE-2025-6514`. A receipt for one exact version, with the digest of its tool names, descriptions and input schemas, which another tool can keep and check later against the chain: `GET /api/receipt/npm/@modelcontextprotocol/server-filesystem/2026.7.10`. The opening of each tool and skill text can be searched: `GET /api/search?q=webhook`. Rate limited, with the same attribution and printed criteria as the pages.

Inside an agent instead of a terminal: the MCP server `smallprint-mcp` (`npx -y smallprint-mcp`, registry name `dev.smallprint/smallprint`) reads the same record with four tools: lookup_entry, changed_since_approval, changes_since, advisories_for.

## Source

The source that npm's package is built from can be read with its tests at https://github.com/gostanos/smallprint-action/tree/main/cli, and an issue can be opened there. That is the program, not anything it finds: what the command reads on your machine stays on your machine. npm installs one file of unminified JavaScript and one Python helper; the record and everything it reads live on the server. What the record can and cannot see is written at https://smallprint.dev/faq.
