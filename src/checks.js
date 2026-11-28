import fs from "node:fs";
import path from "node:path";
import { MIN_PROMPTS, outsideReads } from "./approvals.js";
import { checkCommand, expand, isFile, tokenize } from "./command.js";
import { pluginDir, pluginServers, projectRoot, readJson, settingsFiles } from "./config.js";
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
      (Array.isArray(g?.hooks) ? g.hooks : []).filter((h) => h?.type === "command").map((h) => ({ event, command: h.command }))
    )
  );
}

export async function doctor(p, { probe: doProbe = false, timeout = 10000 } = {}) {
  const results = [];
  const short = (s) => s.split(p.home).join("~");
  const add = (section, level, name, detail = "") => results.push({ section, level, name: short(name), detail: short(detail) });
  const claudeJson = readJson(p.claudeJson);
  const root = projectRoot(p, Object.keys(claudeJson.data?.projects || {}));
  if (root !== p.cwd) add("Settings", "info", `project root ${root}`);
  p = { ...p, cwd: root };
  const ctx = { cwd: p.cwd, home: p.home, PATH: p.PATH, vars: { ...p.env, CLAUDE_PROJECT_DIR: p.cwd } };

  const settings = settingsFiles(p).map((f) => ({ ...f, ...readJson(f.file) })).filter((f) => !f.missing);
  if (!settings.length) add("Settings", "info", "no settings files found");
  for (const s of settings) add("Settings", s.error ? "fail" : "ok", s.file, s.error ? `invalid JSON: ${s.error}` : "");
  const valid = settings.filter((s) => s.data);

  const commands = [];
  for (const s of valid) {
    for (const h of hookCommands(s.data.hooks)) {
      if (typeof h.command !== "string" || !h.command.trim()) {
        add("Hooks", "fail", `${h.event} [${s.scope}]`, "hook has no command");
        continue;
      }
      commands.push(h.command);
      const tokens = tokenize(h.command);
      const r = checkCommand(tokens, ctx);
      add("Hooks", r.level, `${h.event} [${s.scope}] ${tokens.find((t) => !/^\w+=/.test(t)) ?? ""}`, r.level === "ok" ? "" : r.detail);
    }
  }
  if (!commands.length) add("Hooks", "info", "no hooks configured");

  const enabled = Object.assign({}, ...valid.map((s) => s.data.enabledPlugins || {}));
  const plugins = Object.keys(enabled).filter((k) => enabled[k] === true).map((key) => ({ key, dir: pluginDir(p.configDir, key) }));

  const servers = [];
  const collect = (map, scope, vars = {}) => Object.entries(map || {}).forEach(([name, config]) => servers.push({ name, scope, config, vars }));
  const mcpJson = readJson(path.join(p.cwd, ".mcp.json"));
  if (claudeJson.error) add("MCP servers", "fail", p.claudeJson, `invalid JSON: ${claudeJson.error}`);
  if (mcpJson.error) add("MCP servers", "fail", path.join(p.cwd, ".mcp.json"), `invalid JSON: ${mcpJson.error}`);
  collect(claudeJson.data?.mcpServers, "user");
  collect(claudeJson.data?.projects?.[p.cwd]?.mcpServers, "local");
  collect(mcpJson.data?.mcpServers, "project");
  for (const pl of plugins.filter((pl) => pl.dir)) collect(pluginServers(pl.dir), `plugin ${pl.key}`, { CLAUDE_PLUGIN_ROOT: pl.dir });
  if (!servers.length) add("MCP servers", "info", "no MCP servers registered");

  const stdio = [];
  for (const s of servers) {
    if (!s.config || typeof s.config !== "object") {
      add("MCP servers", "fail", `${s.name} (${s.scope})`, "invalid server config");
      continue;
    }
    const type = s.config.type || (s.config.url ? "http" : "stdio");
    if (type !== "stdio") {
      add("MCP servers", "info", `${s.name} (${s.scope}, ${type})`, "remote, not checked");
      continue;
    }
    if (typeof s.config.command !== "string" || !s.config.command) {
      add("MCP servers", "fail", `${s.name} (${s.scope})`, "no command");
      continue;
    }
    const r = checkCommand([s.config.command, ...(s.config.args || [])], { ...ctx, vars: { ...ctx.vars, ...s.vars } });
    add("MCP servers", r.level, `${s.name} (${s.scope})`, r.detail);
    stdio.push(Object.assign(s, { check: r }));
  }
  for (const name of new Set(servers.map((s) => s.name))) {
    const list = servers.filter((s) => s.name === name && !s.scope.startsWith("plugin"));
    if (list.length > 1) add("MCP servers", "warn", name, `defined more than once: ${list.map((s) => s.scope).join(", ")}`);
  }

  if (doProbe) {
    for (const s of servers.filter((s) => !stdio.includes(s))) add("Probe", "info", s.name, "not probed (remote)");
    const runnable = stdio.filter((s) => s.check.level !== "fail");
    const probed = await Promise.all(
      runnable.map((s) => {
        const vars = { ...p.env, ...s.vars };
        const env = { ...vars };
        for (const [k, v] of Object.entries(s.config.env || {})) env[k] = expand(String(v), vars, p.home);
        const args = (s.config.args || []).map((a) => expand(a, vars, p.home));
        return probe(expand(s.config.command, vars, p.home), args, { cwd: p.cwd, env, timeout });
      })
    );
    runnable.forEach((s, i) => {
      const r = probed[i];
      add("Probe", r.error ? "fail" : "ok", `${s.name} (${s.scope})`, r.error || `${r.tools} tools`);
    });
    for (const s of stdio.filter((s) => !runnable.includes(s))) add("Probe", "info", s.name, "not probed (command not found)");
  }

  if (!plugins.length) add("Plugins", "info", "no plugins enabled");
  for (const { key, dir } of plugins) {
    add("Plugins", dir ? "ok" : "warn", key, dir ? "" : "enabled but not found in plugins/cache");
    if (dir) commands.push(...hookCommands(readJson(path.join(dir, "hooks", "hooks.json")).data?.hooks).map((h) => h.command));
  }

  for (const s of stdio.filter((s) => !s.scope.startsWith("plugin"))) {
    const root = packageRoot(s.check.files.at(-1));
    const shipsHooks = root && isFile(path.join(root, "hooks", "hooks.json"));
    if (s.name !== "agentmem" && !shipsHooks) continue;
    const name = new RegExp(`(^|[^\\w-])${s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w-])`);
    const wired = commands.some((c) => name.test(c) || (root && c.includes(root)));
    add("Wiring", wired ? "ok" : "warn", s.name, wired ? "hooks found" : "MCP server registered but its hooks are missing");
  }

  const added = valid.flatMap((s) => s.data.permissions?.additionalDirectories || []).map((d) => path.resolve(p.cwd, expand(d, p.env, p.home)));
  const reads = outsideReads(p, p.cwd, added);
  if (reads.prompts) add("Permissions", "info", `${reads.prompts} permission prompts approved by hand in the last ${reads.days} days`);
  for (const f of reads.folders.filter((f) => f.count >= MIN_PROMPTS))
    add("Permissions", "warn", f.dir, `${f.count} prompts for reads outside the project in ${reads.days} days; add it to permissions.additionalDirectories or run /add-dir`);
  return results;
}

export function summary(results) {
  const count = (level) => results.filter((r) => r.level === level).length;
  return { ok: count("ok"), warn: count("warn"), fail: count("fail") };
}

export function hookOutput(results) {
  const problems = results.filter((r) => r.level !== "ok" && r.level !== "info");
  if (!problems.length) return null;
  const list = problems.map((r) => `${r.level} ${r.section}: ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
  return {
    systemMessage: `ccdoctor: ${problems.length} problem${problems.length === 1 ? "" : "s"} in your Claude Code setup. ${list[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}. Run npx @virling/ccdoctor for details.`,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `ccdoctor found problems in this Claude Code setup. Tell the user about them before starting other work:\n${list.join("\n")}`,
    },
  };
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
