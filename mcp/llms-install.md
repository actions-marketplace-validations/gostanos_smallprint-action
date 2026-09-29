# Installing smallprint-mcp

smallprint-mcp is a read-only MCP server over Small Print's public record of MCP servers, agent skills and plugins. It needs Node.js 18 or later, and no account, key or configuration.

Add this to the MCP settings file (for Cline, `cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "smallprint": {
      "command": "npx",
      "args": ["-y", "smallprint-mcp@0.2.3"]
    }
  }
}
```

Then restart the MCP servers. Four tools appear: `lookup_entry`, `changed_since_approval`, `changes_since` and `advisories_for`. To check it works, call `lookup_entry` with `name` set to `npm:@modelcontextprotocol/server-filesystem`; the answer names the entry, its versions on record and its page on https://smallprint.dev.

The server reads https://smallprint.dev/api and nothing else, and sends only the entry names it is asked about.
