import fs from "node:fs";
import path from "node:path";
import { checkCommand, expand, isFile, tokenize } from "./command.js";
import { pluginDir, readJson, settingsFiles } from "./config.js";
import { probe } from "./probe.js";

function packageRoot(file) {
  if (!file) return null;
  let dir = path.dirname(fs.realpathSync(file));
  while (!fs.existsSync(path.join(dir, "package.json"))) {
    if (dir === path.dirname(dir)) return null;
    dir = path.dirname(dir);
  }
  return dir;
}

function hookCommands(hooks = {}) {
  return Object.entries(hooks).flatMap(([event, groups]) =>
    (Array.isArray(groups) ? groups : []).flatMap((g) =>
      (g.hooks || []).filter((h) => h.type === "command").map((h) => ({ event, command: h.command }))
    )
  );
}

export async function doctor(p, { probe: doProbe = false, timeout = 10000 } = {}) {
  const results = [];
  const short = (s) => s.split(p.home).join("~");
  const add = (section, level, name, detail = "") => results.push({ section, level, name: short(name), detail: short(detail) });
  const ctx = { cwd: p.cwd, home: p.home, PATH: p.PATH, vars: { ...p.env, CLAUDE_PROJECT_DIR: p.cwd } };

  const settings = settingsFiles(p).map((f) => ({ ...f, ...readJson(f.file) })).filter((f) => !f.missing);
  if (!settings.length) add("Settings", "info", "no settings files found");
  for (const s of settings) add("Settings", s.error ? "fail" : "ok", s.file, s.error ? `invalid JSON: ${s.error}` : "");
  const valid = settings.filter((s) => s.data);

  const commands = [];
  for (const s of valid) {
    for (const h of hookCommands(s.data.hooks)) {
      commands.push(h.command);
      const r = checkCommand(tokenize(h.command), ctx);
      add("Hooks", r.level, `${h.event} [${s.scope}] ${h.command}`, r.level === "ok" ? "" : r.detail);
    }
  }
  if (!commands.length) add("Hooks", "info", "no hooks configured");

  const servers = [];
  const collect = (map, scope) => Object.entries(map || {}).forEach(([name, config]) => servers.push({ name, scope, config }));
  const claudeJson = readJson(p.claudeJson);
  const mcpJson = readJson(path.join(p.cwd, ".mcp.json"));
  if (claudeJson.error) add("MCP servers", "fail", p.claudeJson, `invalid JSON: ${claudeJson.error}`);
  if (mcpJson.error) add("MCP servers", "fail", path.join(p.cwd, ".mcp.json"), `invalid JSON: ${mcpJson.error}`);
  collect(claudeJson.data?.mcpServers, "user");
  collect(claudeJson.data?.projects?.[p.cwd]?.mcpServers, "local");
  collect(mcpJson.data?.mcpServers, "project");
  if (!servers.length) add("MCP servers", "info", "no MCP servers registered");

  const stdio = [];
  for (const s of servers) {
    const type = s.config.type || (s.config.url ? "http" : "stdio");
    if (type !== "stdio") {
      add("MCP servers", "info", `${s.name} (${s.scope}, ${type})`, "remote, not checked");
      continue;
    }
    const r = checkCommand([s.config.command ?? "", ...(s.config.args || [])], ctx);
    add("MCP servers", r.level, `${s.name} (${s.scope})`, r.detail);
    stdio.push(Object.assign(s, { check: r }));
  }
  for (const name of new Set(servers.map((s) => s.name))) {
    const list = servers.filter((s) => s.name === name);
    if (list.length > 1) add("MCP servers", "warn", name, `defined more than once: ${list.map((s) => s.scope).join(", ")}`);
  }

  if (doProbe) {
    for (const s of servers.filter((s) => !stdio.includes(s))) add("Probe", "info", s.name, "not probed (remote)");
    const runnable = stdio.filter((s) => s.check.level !== "fail");
    const probed = await Promise.all(
      runnable.map((s) => {
        const env = { ...p.env };
        for (const [k, v] of Object.entries(s.config.env || {})) env[k] = expand(String(v), p.env, p.home);
        const args = (s.config.args || []).map((a) => expand(a, p.env, p.home));
        return probe(expand(s.config.command, p.env, p.home), args, { cwd: p.cwd, env, timeout });
      })
    );
    runnable.forEach((s, i) => {
      const r = probed[i];
      add("Probe", r.error ? "fail" : "ok", `${s.name} (${s.scope})`, r.error || `${r.tools} tools`);
    });
    for (const s of stdio.filter((s) => !runnable.includes(s))) add("Probe", "info", s.name, "not probed (command not found)");
  }

  const enabled = Object.assign({}, ...valid.map((s) => s.data.enabledPlugins || {}));
  const keys = Object.keys(enabled).filter((k) => enabled[k] === true);
  if (!keys.length) add("Plugins", "info", "no plugins enabled");
  for (const key of keys) {
    const dir = pluginDir(p.configDir, key);
    add("Plugins", dir ? "ok" : "warn", key, dir ? "" : "enabled but not found in plugins/cache");
    if (dir) commands.push(...hookCommands(readJson(path.join(dir, "hooks", "hooks.json")).data?.hooks).map((h) => h.command));
  }

  for (const s of stdio) {
    const root = packageRoot(s.check.files.at(-1));
    const shipsHooks = root && isFile(path.join(root, "hooks", "hooks.json"));
    if (s.name !== "agentmem" && !shipsHooks) continue;
    const wired = commands.some((c) => c.includes(s.name) || (root && c.includes(root)));
    add("Wiring", wired ? "ok" : "warn", s.name, wired ? "hooks found" : "MCP server registered but its hooks are missing");
  }
  return results;
}

export function summary(results) {
  const count = (level) => results.filter((r) => r.level === level).length;
  return { ok: count("ok"), warn: count("warn"), fail: count("fail") };
}

export function format(results) {
  const lines = [];
  for (const section of new Set(results.map((r) => r.section))) {
    lines.push(section);
    for (const r of results.filter((r) => r.section === section)) {
      lines.push(`  ${r.level.padEnd(5)} ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
    }
    lines.push("");
  }
  const s = summary(results);
  lines.push(`${s.ok} ok, ${s.warn} warn, ${s.fail} fail`);
  return lines.join("\n");
}
