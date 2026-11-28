#!/usr/bin/env node
import { doctor, format, hookOutput, summary } from "../src/checks.js";
import { paths } from "../src/config.js";

const HELP = `ccdoctor: check a Claude Code setup for broken or unwired pieces

  ccdoctor                  check settings, hooks, MCP servers and plugins
  ccdoctor --probe          also start each stdio MCP server and list its tools
  ccdoctor --timeout <s>    probe timeout in seconds (default 10)
  ccdoctor --json           print results as JSON
  ccdoctor hook             SessionStart hook mode: prints a warning only when something is wrong
  ccdoctor --help

Reads ~/.claude (or CLAUDE_CONFIG_DIR), ~/.claude.json and the current folder's
.claude/ and .mcp.json. Never writes anything. Exits 1 if any check fails.`;

const args = process.argv.slice(2);
const flags = new Set(args);
if (flags.has("--help") || flags.has("-h")) {
  console.log(HELP);
  process.exit(0);
}
if (args[0] === "hook") {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {}
  const cwd = input?.cwd || process.cwd();
  const out = hookOutput(await doctor(paths({ cwd })));
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
const ti = args.indexOf("--timeout");
const timeout = ti >= 0 ? Number(args[ti + 1]) * 1000 : 10000;
const unknown = args.filter((a, i) => !["--probe", "--json", "--timeout"].includes(a) && !(ti >= 0 && i === ti + 1));
if (unknown.length || !(timeout > 0 && timeout <= 2147483647)) {
  console.error(unknown.length ? `Unknown option: ${unknown[0]}\n\n${HELP}` : "--timeout needs a number of seconds");
  process.exit(2);
}

const results = await doctor(paths(), { probe: flags.has("--probe"), timeout });
console.log(flags.has("--json") ? JSON.stringify({ results, summary: summary(results) }, null, 2) : format(results));
process.exitCode = results.some((r) => r.level === "fail") ? 1 : 0;
