# Small Print (MCP)

[![Small Print check](https://github.com/gostanos/smallprint-action/actions/workflows/small-print.yml/badge.svg)](https://github.com/gostanos/smallprint-action/actions/workflows/small-print.yml)


[![M8ven Score](https://m8ven.ai/badge/mcp/gostanos-smallprint-action-12nii2?v=f92621c28b9eb0ba49f7f8dc22ea074d&variant=verified)](https://m8ven.ai/mcp/gostanos-smallprint-action-12nii2)

Small Print keeps a record of the text that MCP servers, agent skills and plugins give your AI agent, and tells you when a change is graded high or critical. Every night it fetches the lists of the public registries, reads the new versions it finds, keeps every version it has read, and grades each change by a written rule: https://smallprint.dev.

- **Get an email the morning a change to something you use is graded high or critical.** Sign up with just your email address at https://smallprint.dev/start, from the watch box on any entry's page, or by typing it when `npx smallprint check` asks. Pin the servers and skills you use; by default the daily brief shows changes graded high or critical and high or critical advisories, by email or Discord, and choosing everything in settings brings every change. No password, and no credit card required.
- **Check what your agents have installed**, free and with no account: `npx smallprint@0.1.8 check --no-upload` prints what it found and sends nothing; without the flag it asks before sending names and versions to get grades. Or paste a config file at https://smallprint.dev/check.
- **Plans:** every account starts with 30 days of Pro. After that, the Free plan keeps 25 pins, the daily brief, and the off-machine record of your instruction files from each sync you run by hand. Pro adds the scheduled sync, which keeps that record current without you, and removes the pin limit. https://smallprint.dev/pricing
- **New to this?** A step-by-step guide in plain words: https://smallprint.dev/guide

The grading rules are printed at https://smallprint.dev/how-we-grade.

## What is in this repository

- **This Action** fails a build when the small print in a repository changed since its lock was written.
- **`npx smallprint gate`** asks the record before a session whether any server here changed since the lock or gained a high advisory; exit codes for a shell hook. CLI 0.1.8.
- **[`mcp/`](./mcp)**: `smallprint-mcp`, an MCP server with four read-only tools over the public record (`npx -y smallprint-mcp`; registry name `dev.smallprint/smallprint`).
- **`Dockerfile`** builds and runs that server over stdio, for registries that start a server to check it answers.
- **[`cli/`](./cli)**: the source of the `smallprint` command, from which the npm package is built, with its tests. `npx smallprint@0.1.8 check --no-upload` prints what it found and sends nothing.
- **[`vscode/`](./vscode)**: the Small Print extension for VS Code and Cursor, the same files that go to the stores.
- **[`tools/verify-chain.mjs`](./tools/verify-chain.mjs)**: checks the record chain from the public API: every link, every signature, and the entries hash of every day whose lines are kept; `node tools/verify-chain.mjs`. Rows written before 4 October 2026 link, and their entries cannot be recomputed.

## Small Print check, as a GitHub Action

Fails the build when the small print your agents read has changed: an MCP server's version, a skill's files, or an instruction file such as CLAUDE.md, AGENTS.md or an `.mcp.json`, compared with a lock you committed.

```yaml
- uses: gostanos/smallprint-action@v1.10
```

Write the lock from the repository's directory on a machine that has the intended configuration, with `--project` so it holds only what lives in the repository (the `.mcp.json`, the `.claude/` and `.cursor/` folders, `CLAUDE.md`, `AGENTS.md` and the rest), and commit it:

```bash
npx smallprint lock --project
git add smallprint.lock
```

To see it working, [gostanos/smallprint-demo](https://github.com/gostanos/smallprint-demo) passes on its main branch, and [its open pull request](https://github.com/gostanos/smallprint-demo/pull/1) fails because it changes the filesystem server from version 2026.7.4 to 2026.7.10, and the lock check names that change. The check compares versions and file fingerprints; it does not read tool descriptions.

The check is local: it reads the repository's config and instruction files, compares them with the lock, and sends nothing anywhere. It exits 2 when something changed and prints what. When the change is yours, run `npx smallprint lock --project` again and commit. A lock written without `--project` also holds the machine's home-directory entries, which a CI runner does not have, so that check would fail on every run; the lock records which kind it is and the check honours it.

Inputs: `lockfile` (default `smallprint.lock`), `version` (the CLI version, default 0.1.8).

### With a code-scanning upload

The step can write what changed as a SARIF log, and GitHub's upload-sarif action turns each line into a code-scanning alert on the pull request. Needs the `--sarif` flag, which is in `smallprint` 0.1.4 and later. The upload needs the `security-events: write` permission, and `if: always()` lets it run after the check has failed, so the build still fails when something changed.

```yaml
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: gostanos/smallprint-action@v1.10
        with:
          sarif: smallprint.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: smallprint.sarif
```

### As a pre-commit hook

With [pre-commit](https://pre-commit.com), the same check runs before every commit, offline. Add this to `.pre-commit-config.yaml` in the repository that holds the lock:

```yaml
repos:
  - repo: https://github.com/gostanos/smallprint-action
    rev: v1.10
    hooks:
      - id: smallprint-locked   # runs smallprint check --locked; the commit stops when anything differs from the lock
      - id: smallprint-lock     # only when you ask: pre-commit run smallprint-lock --hook-stage manual
```

The hooks run the pinned version of the command with `npx`, so the machine needs Node 20 or later.
