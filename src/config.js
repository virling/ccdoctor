import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function paths({ env = process.env, home = os.homedir(), cwd = process.cwd() } = {}) {
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const claudeJson = path.join(env.CLAUDE_CONFIG_DIR ? configDir : home, ".claude.json");
  return { env, home, cwd, configDir, claudeJson, PATH: env.PATH || "" };
}

export function readJson(file) {
  if (!fs.existsSync(file)) return { missing: true };
  try {
    return { data: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (e) {
    return { error: e.message };
  }
}

export function settingsFiles(p) {
  const files = [
    { scope: "user", file: path.join(p.configDir, "settings.json") },
    { scope: "project", file: path.join(p.cwd, ".claude", "settings.json") },
    { scope: "local", file: path.join(p.cwd, ".claude", "settings.local.json") },
  ];
  return files.filter((f, i) => files.findIndex((g) => g.file === f.file) === i);
}

export function pluginDir(configDir, key) {
  const installed = readJson(path.join(configDir, "plugins", "installed_plugins.json")).data?.plugins?.[key]?.[0]?.installPath;
  if (installed && fs.existsSync(installed)) return installed;
  const [name, market = ""] = key.split("@");
  const dir = path.join(configDir, "plugins", "cache", market, name);
  if (!fs.existsSync(dir)) return null;
  const versions = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  return versions.length ? path.join(dir, versions[0].name) : null;
}
