# Small Print for Claude Code

A plugin that puts Small Print's command and record inside Claude Code.

- `/smallprint:check` lists the MCP servers, skills and instruction files this machine's agents have installed. Nothing is sent anywhere.
- `/smallprint:locked` checks that list against `smallprint.lock`, on this machine. Nothing is sent anywhere.
- `/smallprint:gate` asks Small Print's record whether, for each MCP server installed here that has a registry name, a change to what it tells an agent is on record since the lock, or a high or critical advisory covers the version installed. It sends the registry name of each server, one request each.
- The plugin also bundles Small Print's MCP server, `smallprint-mcp`, which gives Claude four read-only tools over the record: look an entry up, list the changes since a date, read the advisories, and ask whether a server's small print changed since a version you approved.

## Install

```
claude plugin marketplace add gostanos/smallprint-action
claude plugin install smallprint@smallprint
```

The commands run `smallprint@1.6.0` from npm, pinned to that one version. Small Print is at https://smallprint.dev, and the command's full guide is at https://smallprint.dev/cli.
