# aminocan-mcp

Project-scoped MCP server for the Aminocan spec-vs-implementation audit.

Read-only filesystem queries + a small SQL parser. No network, no DB. Denies `node_modules`, `.git`, `.next`, `.vercel`, `.env*`, `*.pem`, `*.key`.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_specs` | All `doc-ports/*.md` with H1/H2/H3 sections + line numbers. |
| `read_spec_section` | One section by title/anchor/line — avoids reading 30KB to read 200 lines. |
| `list_routes` | Next.js pages + API routes (with detected HTTP verbs). |
| `list_api_endpoints` | Shortcut: `list_routes` filtered to API. |
| `find_lib` | Filename substring search in `lib/`, `components/`, `contexts/`, `src/`. |
| `read_file` | Read a single project file (sandboxed). |
| `grep_code` | Regex search across project source. |
| `list_tables` | Tables parsed from SQL. `source: 'ref'` = `doc-ports/migrations-ref/` (target). `source: 'current'` = repo-root `*.sql` (current). |
| `describe_table` | Columns + constraints for one table from chosen source. |
| `diff_schema` | Tables only in ref, only in current, plus per-table column drift. Optionally scoped by `table`. |
| `cluster_map` | Look up a cluster in `feature-clusters-by-db-schema.md` and flag whether each referenced path exists today. |

## Wiring

Registered via `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "aminocan": {
      "command": "node",
      "args": ["./tools/aminocan-mcp/server.mjs"]
    }
  }
}
```

Restart Claude Code (or run `/mcp` and approve `aminocan`) to load it.

## Smoke test

```
node tools/aminocan-mcp/server.mjs --smoke
```

Exercises every handler in-process. Exits non-zero on the first failure.

## Notes

- SQL parser handles `CREATE TABLE [IF NOT EXISTS]` and `ALTER TABLE ... ADD/DROP COLUMN / ADD CONSTRAINT`. Triggers/RPC bodies inside `$$ ... $$` are skipped during statement splitting. Good enough for schema drift — not a real Postgres grammar.
- Routes are parsed by filename convention (`route.ts` = API, `page.ts(x)` = page). Route groups `(...)` are stripped from URLs.
- HTTP verbs are detected by `export (async function|const) GET|POST|...` patterns. Re-exports won't be caught.
