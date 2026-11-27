import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { doctor, format } from "../src/checks.js";
import { paths } from "../src/config.js";
import { FAKE_SERVER, tmp, write } from "./helpers.js";

function setup() {
  const home = tmp();
  const cwd = path.join(home, "proj");
  fs.mkdirSync(cwd);
  const config = path.join(home, "cfg");
  return { home, cwd, config, p: paths({ env: { CLAUDE_CONFIG_DIR: config, PATH: process.env.PATH }, home, cwd }) };
}
const find = (results, section, name) => results.find((r) => r.section === section && r.name.startsWith(name));

test("invalid settings JSON fails and missing hook scripts fail", async () => {
  const { cwd, config, p } = setup();
  write(path.join(cwd, ".claude", "settings.local.json"), "{ nope");
  write(path.join(config, "settings.json"), {
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node ~/gone.js hook" }] }] },
  });
  const results = await doctor(p);
  assert.match(find(results, "Settings", "~/proj/.claude/settings.local.json").detail, /invalid JSON/);
  assert.equal(find(results, "Hooks", "SessionStart").level, "fail");
  assert.match(format(results), /\d+ ok, 0 warn, 2 fail$/);
});

test("MCP servers resolve commands, warn on duplicates and never print env", async () => {
  const { cwd, config, p } = setup();
  write(path.join(config, ".claude.json"), {
    mcpServers: { dup: { command: "node", args: ["-e", "1"], env: { API_KEY: "sk-secret-value" } } },
    projects: { [cwd]: { mcpServers: { missing: { command: "no-such-binary-xyz" } } } },
  });
  write(path.join(cwd, ".mcp.json"), { mcpServers: { dup: { type: "http", url: "https://x", headers: { Authorization: "Bearer tok-secret" } } } });
  const results = await doctor(p);
  assert.equal(find(results, "MCP servers", "missing (local)").level, "fail");
  assert.match(results.find((r) => r.name === "dup").detail, /user, project/);
  assert.doesNotMatch(JSON.stringify(results), /secret/);
});

test("probe reports tools for stdio servers and skips remote ones", async () => {
  const { home, config, p } = setup();
  const server = write(path.join(home, "server.cjs"), FAKE_SERVER);
  write(path.join(config, ".claude.json"), {
    mcpServers: { fake: { command: "node", args: [server] }, remote: { type: "sse", url: "https://x" } },
  });
  const results = await doctor(p, { probe: true, timeout: 5000 });
  assert.equal(find(results, "Probe", "fake").detail, "2 tools");
  assert.match(find(results, "Probe", "remote").detail, /not probed/);
});

test("enabled plugins missing from the cache warn", async () => {
  const { config, p } = setup();
  fs.mkdirSync(path.join(config, "plugins", "cache", "market", "here", "1.0.0"), { recursive: true });
  write(path.join(config, "settings.json"), { enabledPlugins: { "here@market": true, "gone@market": true, "off@market": false } });
  const results = await doctor(p);
  assert.equal(find(results, "Plugins", "here@market").level, "ok");
  assert.equal(find(results, "Plugins", "gone@market").level, "warn");
  assert.equal(find(results, "Plugins", "off@market"), undefined);
});

test("MCP server whose package ships hooks warns until a hook references it", async () => {
  const { home, config, p } = setup();
  const pkg = path.join(home, "tool");
  write(path.join(pkg, "package.json"), {});
  write(path.join(pkg, "hooks", "hooks.json"), {});
  const bin = write(path.join(pkg, "bin", "tool.js"), "");
  write(path.join(config, ".claude.json"), { mcpServers: { mytool: { command: "node", args: [bin, "mcp"] }, agentmem: { command: "node", args: ["-e", "1"] } } });
  let results = await doctor(p);
  assert.equal(find(results, "Wiring", "mytool").detail, "MCP server registered but its hooks are missing");
  assert.equal(find(results, "Wiring", "agentmem").level, "warn");
  write(path.join(config, "settings.json"), {
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: `node ${bin} hook` }, { type: "command", command: "agentmem hook x" }] }] },
  });
  results = await doctor(p);
  assert.equal(find(results, "Wiring", "mytool").level, "ok");
  assert.equal(find(results, "Wiring", "agentmem").level, "ok");
});

test("MCP servers shipped by enabled plugins are checked and probed", async () => {
  const { config, p } = setup();
  const dir = path.join(config, "plugins", "cache", "market", "tool", "1.0.0");
  write(path.join(config, "settings.json"), { enabledPlugins: { "tool@market": true } });
  write(path.join(dir, "server.js"), FAKE_SERVER);
  write(path.join(dir, ".mcp.json"), { mcpServers: { live: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server.js"] } } });
  write(path.join(dir, ".claude-plugin", "plugin.json"), { mcpServers: "./extra.json" });
  write(path.join(dir, "extra.json"), { mcpServers: { broken: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/gone.js"] } } });
  const results = await doctor(p, { probe: true });
  assert.equal(find(results, "MCP servers", "live (plugin tool@market)").level, "ok");
  assert.equal(find(results, "MCP servers", "broken (plugin tool@market)").level, "fail");
  assert.equal(find(results, "Probe", "live (plugin tool@market)").detail, "2 tools");
});

test("project config is found when run from a subfolder", async () => {
  const { home, cwd, config, p } = setup();
  write(path.join(home, ".claude.json"), {});
  write(path.join(config, ".claude.json"), { projects: { [cwd]: { mcpServers: { local: { command: "node" } } } } });
  write(path.join(cwd, ".mcp.json"), { mcpServers: { shared: { command: "node" } } });
  const sub = path.join(cwd, "src", "deep");
  fs.mkdirSync(sub, { recursive: true });
  const results = await doctor({ ...p, cwd: sub });
  assert.equal(find(results, "Settings", "project root").name, "project root ~/proj");
  assert.equal(find(results, "MCP servers", "local (local)").level, "ok");
  assert.equal(find(results, "MCP servers", "shared (project)").level, "ok");
});
