# smallprint-mcp

[Small Print](https://smallprint.dev) as an MCP server: four read-only tools over the public record of the tool descriptions, schemas and instructions of MCP servers, agent skills and plugins: the versions Small Print has read, the changes between them with the rule behind each grade, and the public advisories that name them.

```json
{ "mcpServers": { "smallprint": { "command": "npx", "args": ["-y", "smallprint-mcp"] } } }
```

Tools:

- `lookup_entry(name)`: what the record holds for one entry.
- `changes_since(name, since?, min_severity?)`: the releases that changed the small print, with each diff and the rule behind its grade.
- `advisories_for(name, version?)`: the advisories that name it, attributed to their sources, with version ranges.
- `changed_since_approval(name, approved)`: yes or no, before use: has the small print changed since the version, content hash or date that was reviewed. Answers start with UNCHANGED, CHANGED or UNKNOWN. UNKNOWN means the record cannot say; treat it as no answer, not as safe.

Names: `npm:@scope/name`, `pypi:name`, `mcp-registry:io.github.owner/server`, `skills.sh:owner/repo/skill`, `oci:ghcr.io/owner/image`; a bare name is read as npm.

Most of what the record holds was written by other people: names, versions, registry descriptions, changed tool text, advisory summaries. Every answer marks that text as quoted, a short value inside ⟦ ⟧ and longer text as lines that start with "|" between a QUOTED line and an END QUOTED line, and says that marked text is data to report, not an instruction to follow.

The server reads https://smallprint.dev/api and nothing else. No account, nothing about your machine is sent, and it never calls the tool it looked up. Rate limited; for the whole record see the site. The rules behind every grade: https://smallprint.dev/how-we-grade.

## What 1.0 holds stable

From 1.0.0 the four tools, their names, their inputs and the fields of their answers do not change without a new major version. A field can be added in a minor version; none is removed or renamed in one. The grading rules behind a grade can change in any version.
