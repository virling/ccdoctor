# ccdoctor

Checks your Claude Code setup and reports what is broken or registered but not wired up. One command, read-only, zero dependencies.

Typical catch: an MCP server is registered but the hooks that make it useful are missing from `settings.json`, so it silently does nothing.

## Requirements

- Node.js 20 or newer

## Install

Run it from your project, or any folder inside it. ccdoctor walks up to the project folder Claude Code uses:

```bash
npx @virling/ccdoctor
```

## Example

```
$ npx @virling/ccdoctor
Settings
  ok    ~/.claude/settings.json

Hooks
  ok    PreToolUse [user] ~/.claude/hooks/block-unsigned-push.sh
  fail  SessionStart [user] node ~/tools/old.js hook: script not found: ~/tools/old.js

MCP servers
  ok    agentmem (user): ~/projects/memory/bin/agentmem.js
  info  linear (local, http): remote, not checked

Plugins
  ok    swift-lsp@claude-plugins-official

Wiring
  warn  agentmem: MCP server registered but its hooks are missing

3 ok, 1 warn, 1 fail
```

Exit code is 1 when any check fails.

## Checks

- **Settings.** `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`), and `.claude/settings.json` and `.claude/settings.local.json` in the current folder. Invalid JSON fails.
- **Hooks.** Every `command` hook in those files. The executable must exist on `PATH` or as a file (`~` and `$CLAUDE_PROJECT_DIR` are expanded). For `node`, `bash`, `python3` and similar, the script path must exist too. A script run directly without the executable bit warns. Only the first command of a shell line is checked.
- **MCP servers.** User scope (`mcpServers` in `~/.claude.json`), local scope (`projects[<this folder>].mcpServers` in `~/.claude.json`) project scope (`.mcp.json`), and servers shipped by enabled plugins (their `.mcp.json` or `mcpServers` in `.claude-plugin/plugin.json`, with `${CLAUDE_PLUGIN_ROOT}` expanded). For stdio servers the command must resolve. A name defined in more than one scope warns. `env` values, headers and URLs are never printed.
- **Plugins.** Each plugin set to `true` in `enabledPlugins` must have a folder under `~/.claude/plugins/cache/<marketplace>/<plugin>/`. Missing ones warn.
- **Wiring.** A stdio MCP server named `agentmem`, or whose package ships `hooks/hooks.json`, warns when no hook command (in settings or enabled plugins) mentions its name or package folder.
- **Probe** (`--probe`). Starts each stdio server, sends `initialize`, `notifications/initialized` and `tools/list`, reports the tool count or the error, then kills it. http and sse servers are not probed.

## Options

```
ccdoctor                  check settings, hooks, MCP servers and plugins
ccdoctor --probe          also start each stdio MCP server and list its tools
ccdoctor --timeout <s>    probe timeout in seconds (default 10)
ccdoctor --json           print results as JSON
ccdoctor --help
```

ccdoctor never writes to your configuration.

## More tools from Virling

- [agentmem](https://github.com/virling/agentmem): project memory for AI coding agents, shared across Claude Code, Cursor, Codex and other MCP clients.
- [ciwhy](https://github.com/virling/ciwhy): finds the real error in a failed GitHub Actions run and tells you if it is flaky.
- [npmship](https://github.com/virling/npmship): releases an npm package and verifies it landed on npm, in CI and on GitHub.
- [subagents](https://github.com/virling/subagents): reviews what Claude Code subagents did in a session and flags repeated or wasted work.

## License

[PolyForm Noncommercial 1.0.0](LICENSE)
