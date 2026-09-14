#!/usr/bin/env node
// Project-scoped MCP server for the Aminocan spec-vs-impl audit.
// Read-only filesystem + SQL parser. No network, no DB connections.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const SERVER_DIR = dirname(__filename);
// tools/aminocan-mcp/server.mjs -> project root is two levels up
const PROJECT_ROOT = resolve(SERVER_DIR, "..", "..");

const DENY_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".vercel",
  "dist",
  "build",
  "coverage",
]);
const DENY_FILE_PATTERNS = [/^\.env(\..+)?$/i, /\.pem$/i, /\.key$/i];

function isDenied(absPath) {
  const rel = relative(PROJECT_ROOT, absPath);
  if (rel.startsWith("..") || resolve(absPath).indexOf(PROJECT_ROOT) !== 0) {
    return "outside project root";
  }
  const parts = rel.split(sep);
  for (const p of parts) {
    if (DENY_DIRS.has(p)) return `inside denied dir: ${p}`;
    for (const pat of DENY_FILE_PATTERNS) {
      if (pat.test(p)) return `denied file: ${p}`;
    }
  }
  return null;
}

function safePath(input) {
  if (typeof input !== "string" || !input) {
    throw new Error("path must be a non-empty string");
  }
  const abs = resolve(PROJECT_ROOT, input);
  const reason = isDenied(abs);
  if (reason) throw new Error(`access denied (${reason}): ${input}`);
  return abs;
}

async function walk(dir, opts = {}) {
  const { match, maxDepth = 12, _depth = 0 } = opts;
  if (_depth > maxDepth) return [];
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (isDenied(abs)) continue;
    if (e.isDirectory()) {
      out.push(...(await walk(abs, { match, maxDepth, _depth: _depth + 1 })));
    } else if (e.isFile()) {
      if (!match || match(abs)) out.push(abs);
    }
  }
  return out;
}

function rel(p) {
  return relative(PROJECT_ROOT, p).split(sep).join("/");
}

// ---------- Spec section parsing ----------

function parseSpecSections(text) {
  // Returns array of { level, title, anchor, line } for every # / ## / ### header.
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    const level = m[1].length;
    const title = m[2].trim();
    const anchor = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");
    out.push({ level, title, anchor, line: i + 1 });
  }
  return out;
}

function extractSection(text, target) {
  // Match by title (case-insensitive), section anchor, or line number.
  const sections = parseSpecSections(text);
  const lines = text.split(/\r?\n/);
  let idx = -1;
  if (typeof target === "number") {
    idx = sections.findIndex((s) => s.line === target);
  } else if (typeof target === "string") {
    const t = target.trim().toLowerCase();
    idx = sections.findIndex(
      (s) => s.title.toLowerCase() === t || s.anchor === t
    );
    if (idx < 0)
      idx = sections.findIndex((s) => s.title.toLowerCase().includes(t));
  }
  if (idx < 0) return null;
  const start = sections[idx].line - 1;
  const cur = sections[idx];
  let endLine = lines.length;
  for (let j = idx + 1; j < sections.length; j++) {
    if (sections[j].level <= cur.level) {
      endLine = sections[j].line - 1;
      break;
    }
  }
  return {
    title: cur.title,
    level: cur.level,
    startLine: cur.line,
    endLine,
    body: lines.slice(start, endLine).join("\n"),
  };
}

// ---------- SQL parsing ----------

function stripSqlComments(sql) {
  // Strip -- line comments and /* block */ comments.
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .trim();
}

function splitTopLevel(body, sep = ",") {
  // Splits on `sep` but ignores separators inside ( ) or quotes.
  const out = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inSingle) {
      cur += c;
      if (c === "'" && body[i - 1] !== "\\") inSingle = false;
      continue;
    }
    if (inDouble) {
      cur += c;
      if (c === '"' && body[i - 1] !== "\\") inDouble = false;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      cur += c;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      cur += c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (depth === 0 && c === sep) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseCreateTable(stmt) {
  // Returns { name, columns: [{name, type, constraints}], tableConstraints: [], raw }
  const m = /create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([a-zA-Z_][\w.]*)["`]?\s*\(([\s\S]*)\)\s*;?\s*$/i.exec(
    stmt
  );
  if (!m) return null;
  const name = m[1].replace(/^public\./i, "");
  const body = m[2];
  const parts = splitTopLevel(body, ",");
  const columns = [];
  const tableConstraints = [];
  for (const p of parts) {
    const head = p.split(/\s+/, 1)[0].toLowerCase();
    if (
      [
        "primary",
        "foreign",
        "unique",
        "check",
        "constraint",
        "exclude",
      ].includes(head)
    ) {
      tableConstraints.push(p.replace(/\s+/g, " "));
      continue;
    }
    const colMatch = /^["`]?([a-zA-Z_][\w]*)["`]?\s+(.+)$/s.exec(p);
    if (colMatch) {
      const colName = colMatch[1];
      const rest = colMatch[2].replace(/\s+/g, " ").trim();
      const typeMatch = /^([A-Za-z_][\w]*(?:\([^)]*\))?(?:\s*\[\s*\])?)\s*(.*)$/.exec(
        rest
      );
      const type = typeMatch ? typeMatch[1] : rest;
      const constraints = typeMatch ? typeMatch[2].trim() : "";
      columns.push({ name: colName, type, constraints });
    }
  }
  return { name, columns, tableConstraints };
}

function parseAlterTable(stmt) {
  // Captures ALTER TABLE ... ADD COLUMN [IF NOT EXISTS] foo TYPE [constraints]
  const m = /alter\s+table\s+(?:if\s+exists\s+)?["`]?([a-zA-Z_][\w.]*)["`]?\s+([\s\S]+?);?\s*$/i.exec(
    stmt
  );
  if (!m) return [];
  const table = m[1].replace(/^public\./i, "");
  const actions = splitTopLevel(m[2], ",");
  const out = [];
  for (const a of actions) {
    const add = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?["`]?([a-zA-Z_][\w]*)["`]?\s+([\s\S]+)$/i.exec(
      a
    );
    if (add) {
      const rest = add[2].replace(/\s+/g, " ").trim();
      const typeMatch = /^([A-Za-z_][\w]*(?:\([^)]*\))?(?:\s*\[\s*\])?)\s*(.*)$/.exec(
        rest
      );
      out.push({
        op: "add_column",
        table,
        column: add[1],
        type: typeMatch ? typeMatch[1] : rest,
        constraints: typeMatch ? typeMatch[2].trim() : "",
      });
      continue;
    }
    const drop = /^drop\s+column\s+(?:if\s+exists\s+)?["`]?([a-zA-Z_][\w]*)["`]?/i.exec(
      a
    );
    if (drop) {
      out.push({ op: "drop_column", table, column: drop[1] });
      continue;
    }
    const addConstraint = /^add\s+constraint\s+["`]?([a-zA-Z_][\w]*)["`]?\s+([\s\S]+)$/i.exec(
      a
    );
    if (addConstraint) {
      out.push({
        op: "add_constraint",
        table,
        name: addConstraint[1],
        spec: addConstraint[2].replace(/\s+/g, " ").trim(),
      });
      continue;
    }
  }
  return out;
}

function splitSqlStatements(sql) {
  // Naive split on `;` outside of $$ ... $$ blocks and quotes.
  const out = [];
  let cur = "";
  let inSingle = false;
  let inDollar = null;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (inDollar !== null) {
      cur += c;
      if (sql.substr(i, inDollar.length) === inDollar) {
        cur += sql.substr(i + 1, inDollar.length - 1);
        i += inDollar.length;
        inDollar = null;
        continue;
      }
      i++;
      continue;
    }
    if (inSingle) {
      cur += c;
      if (c === "'" && sql[i - 1] !== "\\") inSingle = false;
      i++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      cur += c;
      i++;
      continue;
    }
    const dollar = /^\$([a-zA-Z_]*)\$/.exec(sql.substr(i));
    if (dollar) {
      inDollar = dollar[0];
      cur += dollar[0];
      i += dollar[0].length;
      continue;
    }
    if (c === ";") {
      out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

async function loadSqlSource(source) {
  // source = "ref" -> doc-ports/migrations-ref/*.sql
  // source = "current" -> repo-root *.sql (excluding doc-ports/)
  const tables = new Map(); // name -> { name, columns: [], constraints: [], sources: [] }
  let files = [];
  if (source === "ref") {
    const dir = join(PROJECT_ROOT, "doc-ports", "migrations-ref");
    if (!existsSync(dir)) return { tables, files: [] };
    files = (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => join(dir, f));
  } else if (source === "current") {
    // Prefer the live-schema snapshot when present — authoritative truth
    // generated from the Supabase project. Falls back to the loose root
    // *-migration.sql files for backwards compatibility.
    const snapshot = join(PROJECT_ROOT, "_live-schema-snapshot.sql");
    if (existsSync(snapshot)) {
      files = [snapshot];
    } else {
      const entries = await readdir(PROJECT_ROOT, { withFileTypes: true });
      files = entries
        .filter((e) => e.isFile() && e.name.endsWith(".sql"))
        .map((e) => join(PROJECT_ROOT, e.name));
    }
  } else {
    throw new Error(`unknown source: ${source} (use 'ref' or 'current')`);
  }
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const clean = stripSqlComments(raw);
    const statements = splitSqlStatements(clean);
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (/^create\s+table/i.test(trimmed)) {
        const t = parseCreateTable(trimmed);
        if (!t) continue;
        if (!tables.has(t.name)) {
          tables.set(t.name, {
            name: t.name,
            columns: [],
            constraints: [],
            sources: [],
          });
        }
        const rec = tables.get(t.name);
        // Add any column not yet recorded (handles CREATE IF NOT EXISTS reruns).
        for (const c of t.columns) {
          if (!rec.columns.find((x) => x.name === c.name)) rec.columns.push(c);
        }
        for (const c of t.tableConstraints) {
          if (!rec.constraints.includes(c)) rec.constraints.push(c);
        }
        if (!rec.sources.includes(rel(file))) rec.sources.push(rel(file));
      } else if (/^alter\s+table/i.test(trimmed)) {
        const actions = parseAlterTable(trimmed);
        for (const a of actions) {
          if (!tables.has(a.table)) {
            tables.set(a.table, {
              name: a.table,
              columns: [],
              constraints: [],
              sources: [],
            });
          }
          const rec = tables.get(a.table);
          if (a.op === "add_column") {
            if (!rec.columns.find((x) => x.name === a.column)) {
              rec.columns.push({
                name: a.column,
                type: a.type,
                constraints: a.constraints,
              });
            }
          } else if (a.op === "drop_column") {
            rec.columns = rec.columns.filter((x) => x.name !== a.column);
          } else if (a.op === "add_constraint") {
            rec.constraints.push(`CONSTRAINT ${a.name} ${a.spec}`);
          }
          if (!rec.sources.includes(rel(file))) rec.sources.push(rel(file));
        }
      }
    }
  }
  return { tables, files: files.map(rel) };
}

// ---------- Tool handlers ----------

const TOOLS = [
  {
    name: "list_specs",
    description:
      "List every spec markdown file under doc-ports/ with its section headers (H1-H3). Use this first to find which file/section a cluster lives in.",
    inputSchema: {
      type: "object",
      properties: {
        include_overview: {
          type: "boolean",
          description:
            "Include feature-clusters-by-db-schema.md and feature-inventory-by-user-class.md (default true).",
          default: true,
        },
      },
    },
  },
  {
    name: "read_spec_section",
    description:
      "Return a single section from a doc-ports markdown file by section title (case-insensitive substring), anchor, or starting line number. Cheaper than reading the whole file.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description:
            "Path relative to project root, e.g. 'doc-ports/orders-payment-cluster.spec.md'.",
        },
        section: {
          type: "string",
          description:
            "Section title (e.g. 'Data Model') or anchor (e.g. 'data-model').",
        },
        line: {
          type: "integer",
          description:
            "Alternative to section: 1-based line number of the section header.",
        },
      },
      required: ["file"],
    },
  },
  {
    name: "list_routes",
    description:
      "List Next.js app routes (pages and API endpoints). Returns route URL + file path + detected HTTP verbs for API routes.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description:
            "Substring filter on route URL (e.g. '/admin/invoices', '/api/orders').",
        },
        kind: {
          type: "string",
          enum: ["page", "api", "all"],
          default: "all",
        },
      },
    },
  },
  {
    name: "list_api_endpoints",
    description:
      "Shortcut for list_routes with kind='api'. Returns every app/api/**/route.ts endpoint with HTTP verbs.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string" },
      },
    },
  },
  {
    name: "find_lib",
    description:
      "Find modules under lib/, components/, contexts/, src/ by filename substring. Returns file paths only.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Substring to match (case-insensitive).",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "read_file",
    description:
      "Read a project file. Denies node_modules/.env*/.git/.next/.vercel.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to project root." },
        max_bytes: {
          type: "integer",
          default: 200000,
          description: "Truncate longer files (default 200KB).",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "grep_code",
    description:
      "Search project source for a regex pattern. Skips node_modules/.git/.next/.vercel and binary files.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        glob: {
          type: "string",
          description:
            "Optional filename glob (e.g. '*.ts', 'lib/**/*.ts'). Defaults to all source.",
        },
        ignore_case: { type: "boolean", default: true },
        max_results: { type: "integer", default: 200 },
      },
      required: ["pattern"],
    },
  },
  {
    name: "list_tables",
    description:
      "Parse SQL files and return the full table list. source='ref' uses doc-ports/migrations-ref/ (target schema). source='current' uses repo-root *.sql (current schema).",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["ref", "current"], default: "ref" },
      },
    },
  },
  {
    name: "describe_table",
    description:
      "Return columns and table-level constraints for a single table from the chosen SQL source.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string" },
        source: { type: "string", enum: ["ref", "current"], default: "ref" },
      },
      required: ["table"],
    },
  },
  {
    name: "diff_schema",
    description:
      "Compare ref vs current schemas. Returns tables only in ref, only in current, and columns missing on either side for tables that exist in both.",
    inputSchema: {
      type: "object",
      properties: {
        table: {
          type: "string",
          description: "Optional: scope diff to a single table.",
        },
      },
    },
  },
  {
    name: "cluster_map",
    description:
      "Look up a doc-ports cluster (by number 1-11 or name) in feature-clusters-by-db-schema.md and return its DB tables, page paths, and API paths — with a flag for whether each path currently exists.",
    inputSchema: {
      type: "object",
      properties: {
        cluster: {
          type: "string",
          description:
            "Cluster number (e.g. '5') or substring of the cluster name (e.g. 'invoicing', 'fulfillment').",
        },
      },
      required: ["cluster"],
    },
  },
];

async function handleListSpecs(args) {
  const includeOverview = args?.include_overview !== false;
  const dir = join(PROJECT_ROOT, "doc-ports");
  const entries = await readdir(dir);
  const files = entries.filter((f) => f.endsWith(".md")).sort();
  const out = [];
  for (const f of files) {
    if (
      !includeOverview &&
      (f === "feature-clusters-by-db-schema.md" ||
        f === "feature-inventory-by-user-class.md")
    ) {
      continue;
    }
    const text = await readFile(join(dir, f), "utf8");
    const sections = parseSpecSections(text).filter((s) => s.level <= 3);
    const st = await stat(join(dir, f));
    out.push({
      file: `doc-ports/${f}`,
      bytes: st.size,
      sections: sections.map((s) => ({
        level: s.level,
        title: s.title,
        line: s.line,
      })),
    });
  }
  return out;
}

async function handleReadSpecSection(args) {
  const file = safePath(args.file);
  const text = await readFile(file, "utf8");
  if (args.section == null && args.line == null) {
    // Return the whole table of contents.
    return { sections: parseSpecSections(text) };
  }
  const section = extractSection(text, args.line ?? args.section);
  if (!section) {
    return { error: `section not found: ${args.section ?? args.line}` };
  }
  return { file: rel(file), ...section };
}

const HTTP_VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

async function scanRoutes() {
  const out = [];
  const appDir = join(PROJECT_ROOT, "app");
  const srcAppDir = join(PROJECT_ROOT, "src", "app");
  const roots = [appDir, srcAppDir].filter((d) => existsSync(d));
  for (const root of roots) {
    const files = await walk(root, {
      match: (f) =>
        /[\\/](route|page)\.(t|j)sx?$/.test(f),
    });
    for (const f of files) {
      const text = await readFile(f, "utf8");
      const relPath = rel(f);
      const isApi = relPath.includes("/api/");
      const kind = /route\.(t|j)sx?$/.test(f) ? "api" : "page";
      let routeUrl = relPath
        .replace(/^src\//, "")
        .replace(/^app/, "")
        .replace(/\/(route|page)\.(t|j)sx?$/, "")
        .replace(/\/\(([^)]+)\)/g, ""); // strip route groups
      if (!routeUrl) routeUrl = "/";
      const verbs = [];
      if (kind === "api") {
        for (const v of HTTP_VERBS) {
          const re = new RegExp(
            `export\\s+(?:async\\s+)?(?:const|function)\\s+${v}\\b`
          );
          if (re.test(text)) verbs.push(v);
        }
      }
      out.push({
        kind: kind === "api" ? "api" : isApi ? "api" : "page",
        url: routeUrl || "/",
        file: relPath,
        verbs: verbs.length ? verbs : undefined,
      });
    }
  }
  return out.sort((a, b) => a.url.localeCompare(b.url));
}

async function handleListRoutes(args) {
  const all = await scanRoutes();
  let filtered = all;
  if (args?.kind && args.kind !== "all") {
    filtered = filtered.filter((r) => r.kind === args.kind);
  }
  if (args?.filter) {
    const f = String(args.filter).toLowerCase();
    filtered = filtered.filter(
      (r) => r.url.toLowerCase().includes(f) || r.file.toLowerCase().includes(f)
    );
  }
  return { count: filtered.length, routes: filtered };
}

async function handleListApiEndpoints(args) {
  return handleListRoutes({ kind: "api", filter: args?.filter });
}

async function handleFindLib(args) {
  const term = String(args.name || "").toLowerCase();
  if (!term) throw new Error("name is required");
  const dirs = ["lib", "components", "contexts", "src"]
    .map((d) => join(PROJECT_ROOT, d))
    .filter((d) => existsSync(d));
  const matches = [];
  for (const d of dirs) {
    const files = await walk(d, {
      match: (f) => /\.(t|j)sx?$/.test(f),
    });
    for (const f of files) {
      if (f.toLowerCase().includes(term)) matches.push(rel(f));
    }
  }
  return { count: matches.length, files: matches.sort() };
}

async function handleReadFile(args) {
  const abs = safePath(args.path);
  const buf = await readFile(abs);
  const maxBytes = args.max_bytes ?? 200000;
  const truncated = buf.length > maxBytes;
  const text = buf.toString("utf8", 0, Math.min(buf.length, maxBytes));
  return {
    file: rel(abs),
    bytes: buf.length,
    truncated,
    content: text,
  };
}

async function handleGrep(args) {
  const flags = (args.ignore_case ?? true) ? "gi" : "g";
  const re = new RegExp(args.pattern, flags);
  const max = args.max_results ?? 200;
  const globPat = args.glob;
  const matchGlob = globPat
    ? globToRegex(globPat)
    : /\.(t|j)sx?$|\.mjs$|\.cjs$|\.md$|\.sql$|\.json$/;
  const files = await walk(PROJECT_ROOT, {
    match: (f) => matchGlob.test(rel(f)) || matchGlob.test(f),
  });
  const results = [];
  for (const f of files) {
    if (results.length >= max) break;
    let text;
    try {
      text = await readFile(f, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      if (re.test(lines[i])) {
        results.push({ file: rel(f), line: i + 1, text: lines[i].slice(0, 300) });
        if (results.length >= max) break;
      }
    }
  }
  return { count: results.length, truncated: results.length >= max, results };
}

function globToRegex(glob) {
  // Tiny glob: ** -> .*, * -> [^/]*, ? -> [^/]
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (/[.+^${}()|[\]\\]/.test(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp(re + "$");
}

async function handleListTables(args) {
  const source = args?.source || "ref";
  const { tables, files } = await loadSqlSource(source);
  const arr = [...tables.values()]
    .map((t) => ({
      name: t.name,
      columns: t.columns.length,
      sources: t.sources,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { source, sql_files: files, count: arr.length, tables: arr };
}

async function handleDescribeTable(args) {
  const source = args?.source || "ref";
  const { tables } = await loadSqlSource(source);
  const t = tables.get(args.table);
  if (!t) return { error: `table not found in source=${source}: ${args.table}` };
  return { source, ...t };
}

async function handleDiffSchema(args) {
  const ref = await loadSqlSource("ref");
  const cur = await loadSqlSource("current");
  if (args?.table) {
    const r = ref.tables.get(args.table);
    const c = cur.tables.get(args.table);
    if (!r && !c) return { error: `table not present in either source: ${args.table}` };
    return diffOne(args.table, r, c);
  }
  const refNames = new Set(ref.tables.keys());
  const curNames = new Set(cur.tables.keys());
  const onlyInRef = [...refNames].filter((n) => !curNames.has(n)).sort();
  const onlyInCurrent = [...curNames].filter((n) => !refNames.has(n)).sort();
  const both = [...refNames].filter((n) => curNames.has(n)).sort();
  const columnDiffs = [];
  for (const n of both) {
    const d = diffOne(n, ref.tables.get(n), cur.tables.get(n));
    if (
      d.columns_only_in_ref.length ||
      d.columns_only_in_current.length ||
      d.column_type_changes.length
    ) {
      columnDiffs.push(d);
    }
  }
  return {
    summary: {
      ref_tables: refNames.size,
      current_tables: curNames.size,
      only_in_ref: onlyInRef.length,
      only_in_current: onlyInCurrent.length,
      tables_with_column_drift: columnDiffs.length,
    },
    tables_only_in_ref: onlyInRef,
    tables_only_in_current: onlyInCurrent,
    column_drift: columnDiffs,
  };
}

function diffOne(name, r, c) {
  const refCols = new Map((r?.columns || []).map((x) => [x.name, x]));
  const curCols = new Map((c?.columns || []).map((x) => [x.name, x]));
  const only_in_ref = [...refCols.keys()]
    .filter((k) => !curCols.has(k))
    .map((k) => refCols.get(k));
  const only_in_current = [...curCols.keys()]
    .filter((k) => !refCols.has(k))
    .map((k) => curCols.get(k));
  const type_changes = [];
  for (const k of refCols.keys()) {
    if (!curCols.has(k)) continue;
    const a = refCols.get(k).type.toLowerCase();
    const b = curCols.get(k).type.toLowerCase();
    if (a !== b) {
      type_changes.push({
        column: k,
        ref_type: refCols.get(k).type,
        current_type: curCols.get(k).type,
      });
    }
  }
  return {
    table: name,
    in_ref: !!r,
    in_current: !!c,
    columns_only_in_ref: only_in_ref,
    columns_only_in_current: only_in_current,
    column_type_changes: type_changes,
  };
}

async function handleClusterMap(args) {
  const overview = join(
    PROJECT_ROOT,
    "doc-ports",
    "feature-clusters-by-db-schema.md"
  );
  const text = await readFile(overview, "utf8");
  const sections = parseSpecSections(text);
  const clusterHeaders = sections.filter((s) =>
    /^CLUSTER\s+\d+/i.test(s.title)
  );
  const term = String(args.cluster).trim().toLowerCase();
  let match = null;
  if (/^\d+$/.test(term)) {
    match = clusterHeaders.find((s) =>
      new RegExp(`^CLUSTER\\s+${term}\\b`, "i").test(s.title)
    );
  } else {
    match = clusterHeaders.find((s) => s.title.toLowerCase().includes(term));
  }
  if (!match) {
    return {
      error: `cluster not found: ${args.cluster}`,
      available: clusterHeaders.map((s) => s.title),
    };
  }
  const sec = extractSection(text, match.line);
  // Extract file path mentions like `app/...` and `lib/...` and `app/api/...`.
  const pathRe = /(?:app|lib|components|contexts|src)\/[\w./\-\[\]\(\)]+/g;
  const tableRe = /`([a-z_][a-z0-9_]+)`/g;
  const paths = [...new Set([...sec.body.matchAll(pathRe)].map((m) => m[0]))];
  const tables = [
    ...new Set([...sec.body.matchAll(tableRe)].map((m) => m[1])),
  ].filter((t) => /^[a-z_][a-z0-9_]+$/.test(t) && t.length > 2);
  const resolved = paths.map((p) => {
    const cleaned = p.replace(/[\[\]]/g, "");
    const abs = join(PROJECT_ROOT, cleaned);
    return { path: p, exists: existsSync(abs) };
  });
  return {
    cluster: match.title,
    line: match.line,
    referenced_paths: resolved,
    referenced_tables: tables,
    body: sec.body,
  };
}

// ---------- Server wiring ----------

const handlers = {
  list_specs: handleListSpecs,
  read_spec_section: handleReadSpecSection,
  list_routes: handleListRoutes,
  list_api_endpoints: handleListApiEndpoints,
  find_lib: handleFindLib,
  read_file: handleReadFile,
  grep_code: handleGrep,
  list_tables: handleListTables,
  describe_table: handleDescribeTable,
  diff_schema: handleDiffSchema,
  cluster_map: handleClusterMap,
};

async function smoke() {
  // Quick self-check; exits non-zero on the first failure.
  const checks = [
    ["list_specs", {}],
    ["list_tables", { source: "ref" }],
    ["list_tables", { source: "current" }],
    ["list_routes", { kind: "api" }],
    ["diff_schema", {}],
    ["cluster_map", { cluster: "5" }],
  ];
  for (const [name, args] of checks) {
    try {
      const r = await handlers[name](args);
      const summary =
        r && typeof r === "object" && "count" in r
          ? `count=${r.count}`
          : r && r.summary
            ? JSON.stringify(r.summary)
            : "ok";
      process.stdout.write(`[ok] ${name} ${summary}\n`);
    } catch (e) {
      process.stderr.write(`[fail] ${name}: ${e.stack || e.message}\n`);
      process.exit(1);
    }
  }
  process.stdout.write("smoke: all checks passed\n");
}

async function main() {
  if (process.argv.includes("--smoke")) {
    await smoke();
    return;
  }
  const server = new Server(
    { name: "aminocan-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments || {};
    const handler = handlers[name];
    if (!handler) {
      return {
        isError: true,
        content: [{ type: "text", text: `unknown tool: ${name}` }],
      };
    }
    try {
      const result = await handler(args);
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (e) {
      return {
        isError: true,
        content: [
          { type: "text", text: `${name} error: ${e.stack || e.message}` },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e.stack || e.message}\n`);
  process.exit(1);
});
