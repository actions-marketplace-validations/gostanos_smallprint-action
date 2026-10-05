---
name: gate
description: Ask Small Print's record whether any MCP server installed here has changed what it tells an agent since the lock, or gained a high advisory. Sends the registry name of each server, and nothing else.
allowed-tools: Bash(npx -y smallprint@0.1.8 gate:*)
disable-model-invocation: true
---

# The gate

The command below asked smallprint.dev, for each MCP server this machine has installed, whether its small print changed between the version in the lock and the version this machine runs, and whether a high or critical advisory covers the version installed here. It sent the registry name of each server, one request each, and nothing else. It exits with code 3 when a high or critical advisory covers an installed version, and otherwise with code 2 when a small print changed.

```!
npx -y smallprint@0.1.8 gate || true
```

Show the user the result above as it was printed, in a code block. Then say, in plain sentences, what it means: nothing changed, or which servers changed or carry an advisory, with the link the command printed for each one. Do not judge whether a server is safe; say what the record holds and where to read it.
